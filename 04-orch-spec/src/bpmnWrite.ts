// Specification → BPMN: write mappings and conditions into the diagram.
//
// The mappings live in the specification (as FEEL); the diagram only learns
// about them on **export**. Then the app writes them in the form of the engine:
//
//   Camunda 8   <zeebe:ioMapping>
//                 <zeebe:input  source="=client.name" target="name" />
//                 <zeebe:output source="=accountId"   target="accountId" />
//   Camunda 7   <camunda:inputOutput>
//                 <camunda:inputParameter name="name">${client.name}</camunda:inputParameter>
//               or on the subprocess <camunda:in source="client.name" target="name" />
//
// Conditions on branches likewise: `= amount > 3` becomes `=amount > 3` or
// `${amount > 3}`. FEEL that has no JUEL counterpart stays in the text
// and is reported — better visibly wrong than silently lost.
//
// Only steps that have mapping rows in the specification are
// touched; deselected rows do not go into the BPMN. Control parameters
// (`_handledErrors`, `_outputMock` …) stay as they are in the diagram.

import type { EngineId, Mapping, Model, ProcessSpec, Step, TimerSpec } from './types';
import { C8_LABEL } from './engineLabels';
import { ASSIGNMENT_KEYS, TECHNICAL, allSteps, isEventBoundary, unnamed, feelString, isInitWorker, isServiceWorker, mockFieldOf, mockRef, paramExpression } from './bpmn';
import { juelOptions, multiInstanceScopes, referencedVariables, resultVariables, withMultiInstance } from './feel';
import { catalogEntry } from './interactions';
import { engineExpression, feelBody, feelToGroovy, feelToJuel, type JuelOptions } from './feelJuel';
import { importExpression, isJuel, nullSafeCondition, stripNullSafe } from './juelFeel';
import { appendEl, orderBpmn, prependEl, removeEl } from './xmlFormat';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export interface WriteIssue {
  stepId: string;
  /** where: `Eingabe name`, `Ausgabe name`, `Zweig label` */
  where: string;
  text: string;
}

export interface WriteResult { xml: string; issues: WriteIssue[] }

const local = (el: Element): string => {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};
const kids = (el: Element) => Array.from(el.children);
const firstNamed = (el: Element, name: string): Element | null => kids(el).find(c => local(c) === name) ?? null;
const attr = (el: Element, name: string): string | undefined =>
  el.getAttribute(name) ?? el.getAttribute(`camunda:${name}`) ?? el.getAttribute(`zeebe:${name}`) ?? undefined;

/** script, list or map — values the specification only describes, does not write */
const isComplex = (p: Element): boolean => !!(firstNamed(p, 'script') || firstNamed(p, 'list') || firstNamed(p, 'map'));
/**
 * A mapping value that describes a script (`«groovy» …`) — stays as it is in the
 * BPMN. Also when wrapped as FEEL text (`= "«Groovy» …"`, from older states):
 * otherwise the export would replace the script with this text.
 */
const isScript = (m: Mapping): boolean => /^(=\s*")?«/.test(m.expression.trimStart());
/**
 * Is the row unchanged in the BPMN? Then the element stays literally as it is —
 * with `#{…}`, Spin calls (`.prop("x").value()`) or script, which the round trip
 * via FEEL does not bring back one to one. Only what someone changed
 * is written anew.
 */
const unchanged = (p: Element, m: Mapping, opts: JuelOptions = juelOpts): boolean => {
  if (paramExpression(p).trim() !== m.expression.trim()) return false;
  const old = attr(p, 'sourceExpression') ?? (firstNamed(p, 'script') ? '' : p.textContent ?? '');
  return !bareJsonPath(old) && !lacksEnding(old, m.expression, opts);
};

const SPIN_ENDING = /\.(?:stringValue|numberValue|boolValue|value|elementList)\(\)/g;
/**
 * A Spin path that only lacks its end (`….prop("clientKey")` instead of
 * `….prop("clientKey").numberValue()`) — written when the type was not yet
 * known. Otherwise equal, so write it anew; whatever someone wrote differently
 * by hand stays.
 */
function lacksEnding(old: string, expression: string, opts: JuelOptions = juelOpts): boolean {
  const body = feelBody(expression);
  if (!isJuel(old) || body == null) return false;
  const r = feelToJuel(body, opts);
  if (!r.ok) return false;
  const was = old.trim().replace(/^[$#]\{|\}$/g, '').replace(/\s+/g, '');
  const now = r.juel.replace(/\s+/g, '');
  const count = (t: string) => (t.match(SPIN_ENDING) ?? []).length;
  return was !== now && was.replace(SPIN_ENDING, '') === now.replace(SPIN_ENDING, '') && count(now) > count(was);
}

/**
 * JUEL from an older state that reads a path like a Java field
 * (`${a.b.c}`, `execution.getVariable("a").b`). In Camunda 7 `a` is JSON
 * (Spin) — that only works with `prop("b")`, so the text is written anew.
 * Except `execution.…` and the result of a DMN decision (a map).
 */
function bareJsonPath(text: string): boolean {
  if (!isJuel(text)) return false;
  const code = text
    .replace(/execution\.getVariable\(\s*["']([A-Za-z_]\w*)["']\s*\)/g, '$1')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  for (const m of code.matchAll(/(?<![\w.)\]])([A-Za-z_]\w*)\s*\.\s*[A-Za-z_]\w*\b(?!\s*\()/g)) {
    if (m[1] !== 'execution' && !juelOpts.plainRoots?.has(m[1])) return true;
  }
  return false;
}

/**
 * Write mappings and conditions of the specification into the BPMN. Otherwise
 * the XML stays unchanged (layout, IDs, everything else).
 */
/**
 * How FEEL is translated for Camunda 7 — set for the duration of
 * `writeBpmn`: JUEL reads the optional process variables (In, InitIn …) with
 * `execution.getVariable("x")`, otherwise it throws when they are missing.
 */
let juelOpts: JuelOptions = {};
/**
 * For the outputs of a step: the expression reads the result of the
 * service (`= debitCardDetail.basicData.clientKey`) — its fields
 * determine how a Spin path ends, not the process variables alone.
 */
let outputOpts: (stepId: string) => JuelOptions = () => juelOpts;
/**
 * For inputs, conditions and assignment of a step: the process variables —
 * in a multi-instance including the element (`newDebitMastercard`), otherwise
 * its path would end without `boolValue()` & co. (as in the findings, see withMultiInstance)
 */
let inputOpts: (stepId: string) => JuelOptions = () => juelOpts;

export function writeBpmn(xml: string, spec: ProcessSpec, model: Model | null = null): WriteResult {
  juelOpts = juelOptions(spec, model);
  const steps = new Map(allSteps(spec.steps).map(s => [s.id, s]));
  const scopes = multiInstanceScopes(spec.steps);
  const inCache = new Map<string, JuelOptions>();
  inputOpts = stepId => {
    if (!scopes.get(stepId)?.length) return juelOpts;
    let o = inCache.get(stepId);
    if (!o) inCache.set(stepId, o = { ...juelOpts, vars: withMultiInstance([...(juelOpts.vars ?? [])], scopes.get(stepId)) });
    return o;
  };
  const cache = new Map<string, JuelOptions>();
  outputOpts = stepId => {
    const step = steps.get(stepId);
    if (!step) return juelOpts;
    let o = cache.get(stepId);
    if (!o) cache.set(stepId, o = { ...juelOpts, vars: withMultiInstance(resultVariables(step, spec, model, catalogEntry(step, model)), scopes.get(stepId)) });
    return o;
  };
  try {
    return writeBpmnWith(xml, spec);
  } finally {
    juelOpts = {};
    outputOpts = () => juelOpts;
    inputOpts = () => juelOpts;
  }
}

function writeBpmnWith(xml: string, spec: ProcessSpec): WriteResult {
  const issues: WriteIssue[] = [];
  const engine: EngineId = spec.engine ?? 'c7';
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const defs = doc.documentElement;
  if (!defs || local(defs) !== 'definitions' || doc.getElementsByTagName('parsererror').length) {
    return { xml, issues: [{ stepId: '', where: 'BPMN', text: 'Das Diagramm ist kein lesbares BPMN — nichts geschrieben.' }] };
  }
  const prefix = defs.prefix ? `${defs.prefix}:` : '';
  const bpmnEl = (name: string) => doc.createElementNS(BPMN_NS, `${prefix}${name}`);

  // Ensure the namespaces of the engine — as a real declaration, otherwise
  // the serializer repeats them on every new element
  const declare = (prefix: string, uri: string) => {
    if (!defs.hasAttribute(`xmlns:${prefix}`)) defs.setAttributeNS(XMLNS_NS, `xmlns:${prefix}`, uri);
  };
  if (engine === 'c8') declare('zeebe', ZEEBE_NS);
  if (engine === 'c7') declare('camunda', CAMUNDA_NS);
  declare('xsi', XSI_NS);

  // all elements with an ID
  const byId = new Map<string, Element>();
  const visit = (el: Element) => {
    const id = el.getAttribute('id');
    if (id && !byId.has(id)) byId.set(id, el);
    for (const c of kids(el)) visit(c);
  };
  visit(defs);

  const ensureExt = (el: Element): Element => {
    let ext = firstNamed(el, 'extensionElements');
    if (!ext) {
      ext = bpmnEl('extensionElements');
      prependEl(el, ext);
    }
    return ext;
  };

  const active = (ms: Mapping[] | undefined) => (ms ?? []).filter(m => !m.disabled && m.name.trim());
  /** service from the BPMN — it keeps how it returns its outputs (`_manualOutMapping`) */
  const fromBpmn = (s: Step) => s.kind === 'service' && s.manualOutMapping !== undefined;
  /**
   * For a service from the BPMN, an output of the service does not become an
   * output parameter — the worker sets it itself, or it stays local as
   * before. Only a newly ticked one with manual mapping is mapped.
   */
  const writtenOutputs = (s: Step, before: ElementState | null) => active(s.outputs).filter(m => !fromBpmn(s) || !serviceRow(s, m, before)
    || (!!s.manualOutMapping && !(s.outputVariables ?? []).includes(m.name.trim())));
  /**
   * An output of the service under its own name: `fromService` — or, in a
   * specification without this marker, `x = x` with x in `_outputVariables`, for
   * which the diagram has no output parameter (it was never there as a mapping).
   */
  const serviceRow = (s: Step, m: Mapping, before: ElementState | null) => !!m.fromService
    || (m.expression.trim().replace(/^=\s*/, '') === m.name.trim() && (s.outputVariables ?? []).includes(m.name.trim())
      && !before?.outputParams.has(m.name.trim()));

  for (const step0 of allSteps(spec.steps)) {
    const el = byId.get(step0.id);
    // What the diagram already says applies where the specification does not know it (yet) —
    // an older one knows neither the kind of the service nor its mock variable
    const before = el ? elementState(el) : null;
    // every service in the diagram has a kind since the import — if it is missing, the
    // specification is older and the diagram applies (without `_manualOutMapping`: not manual)
    // A service with outputs of its own, but neither `_manualOutMapping` nor
    // `_outputVariables` in the diagram (newly drawn or imported like that): it
    // is written like one created in the specification (manually
    // mapped). Otherwise the worker would write its whole Out as process variables —
    // and overwrite e.g. an `accountKey` of the process. A custom worker
    // (topic starts with the process ID), on the other hand, returns its Out on purpose.
    const ownWorker = !!step0.topic && !!spec.processId && step0.topic.startsWith(spec.processId);
    const mappedLater = step0.kind === 'service' && !!before && before.manual === undefined && !before.hasOutputVariables
      && !isInitWorker(step0, spec.processId) && !ownWorker
      && active(step0.outputs).some(m => !m.fromService);
    const step: Step = {
      ...step0,
      ...(mappedLater ? { manualOutMapping: undefined, outputVariables: undefined } : {}),
      ...(!mappedLater && step0.manualOutMapping === undefined && step0.kind === 'service' && before ? { manualOutMapping: !!before.manual } : {}),
      ...(step0.outputVariables === undefined && before?.outputVariables ? { outputVariables: before.outputVariables } : {}),
      ...(step0.mock === undefined && before?.mock ? { mock: before.mock } : {}),
    };
    const hasRows = (step.inputs?.length ?? 0) + (step.outputs?.length ?? 0) > 0;
    if (hasRows && !el) {
      if (active(step.inputs).length || active(step.outputs).length) {
        issues.push({ stepId: step.id, where: 'Schritt', text: 'steht nicht im Diagramm — Mappings nicht geschrieben.' });
      }
      continue;
    }
    if (el && hasRows) {
      const ext = ensureExt(el);
      const ins = active(step.inputs);
      const outs = writtenOutputs(step, before);
      if (engine === 'c8') writeZeebe(doc, ext, ins, outs, step.id, issues);
      else if (local(el) === 'callActivity') writeCamundaInOut(doc, ext, ins, outs, step.id, issues);
      else writeCamundaIo(doc, ext, ins, outs, step.id, issues);
    }

    if (el) writeImplementation(doc, el, ensureExt, engine, step, spec.processId, issues);
    if (el) writeBoundaryTimers(doc, byId, engine, step, issues);
    // Signal or message of the boundary events — into their boundary event
    for (const e of step.errors ?? []) {
      const b = isEventBoundary(e) && e.boundaryId && !e.pattern ? byId.get(e.boundaryId) : undefined;
      if (b) writeMessage(doc, b, engine, { id: e.boundaryId!, messageName: e.messageName, correlationKey: e.correlationKey });
    }

    // The init worker returns the InitIn — without filter and without mapping
    if (el && step.kind === 'service' && isInitWorker(step, spec.processId)) {
      setControl(doc, ensureExt(el), engine, '_manualOutMapping', undefined);
      setControl(doc, ensureExt(el), engine, '_outputVariables', undefined);
    } else if (el && fromBpmn(step)) {
      // Service from the BPMN: `_manualOutMapping` stays as it is. `_outputVariables`
      // only if the ticked outputs have changed — the imported
      // list without the deselected ones, with the newly ticked ones; if it was missing (= everything), it stays absent
      if (step.outputVariables !== undefined) {
        const rows = (step.outputs ?? []).filter(m => serviceRow(step, m, before));
        const off = new Set(rows.filter(m => m.disabled).map(m => m.name.trim()));
        const vars = step.outputVariables.filter(v => !off.has(v));
        for (const m of rows) if (!m.disabled && !vars.includes(m.name.trim())) vars.push(m.name.trim());
        const same = vars.length === step.outputVariables.length && vars.every(v => step.outputVariables!.includes(v));
        if (!same) {
          const list = vars.length ? vars.join(', ') : 'NONE';
          setControl(doc, ensureExt(el), engine, '_outputVariables', engine === 'c8' ? `=${feelString(list)}` : list);
        }
      }
    } else if (el && step.kind === 'service') {
      // Service: the outputs are mapped by hand, and the worker knows which variables it needs
      const vars: string[] = [];
      for (const m of active(step.outputs)) {
        for (const v of referencedVariables(importExpression(m.expression))) if (!vars.includes(v)) vars.push(v);
      }
      // without variables: `NONE`, and the outputs are not mapped by hand
      const list = vars.length ? vars.join(', ') : 'NONE';
      setControl(doc, ensureExt(el), engine, '_manualOutMapping', !vars.length ? undefined : engine === 'c8' ? '=true' : '#{true}');
      setControl(doc, ensureExt(el), engine, '_outputVariables', engine === 'c8' ? `=${feelString(list)}` : list);
    }

    // Mocks: the chosen `_output…Mock` points to the field in the InConfig. The
    // mock control of the process always goes along — the field may be empty
    if (el && (step.kind === 'service' || step.kind === 'call') && !isInitWorker(step, spec.processId)) {
      const ext = ensureExt(el);
      const call = step.kind === 'call';
      const kind = step.mockKind === 'service' && !isServiceWorker(step) ? undefined : step.mockKind;
      const pass = (name: string) => (engine === 'c8' ? `=${name}` : `#{execution.getVariable('${name}')}`);
      // the variable the BPMN already names (`getPoasMock`) — otherwise the one from the step name
      // if the same variable is already there (`source="getPoasMock"`), it stays as it is
      const mockControl = (name: '_outputMock' | '_outputServiceMock', on: boolean) => {
        const was = before?.inputs.get(name);
        if (on && was !== undefined && mockRef(was) === mockFieldOf(step)) return;
        setControl(doc, ext, engine, name, on ? pass(mockFieldOf(step)) : undefined, call);
      };
      mockControl('_outputMock', kind === 'output');
      mockControl('_outputServiceMock', kind === 'service');
      // The control of the process (mocks; who started it — the subprocess
      // checks the same identity) is only needed by a subprocess that does not see the
      // variables anyway: in C7 always (`camunda:in`), in C8 only with
      // `propagateAllParentVariables="false"`. A worker reads them itself.
      // A mere pass-through is dropped otherwise — a fixed value (`= true`) stays.
      const calledEl = firstNamed(ext, 'calledElement');
      const needsPass = call && (engine === 'c7' || calledEl?.getAttribute('propagateAllParentVariables') === 'false');
      for (const name of ['_servicesMocked', '_mockedWorkers', '_identityCorrelation']) {
        if (needsPass) setControl(doc, ext, engine, name, pass(name), call);
        else if (isPassThrough(before?.inputs.get(name), name)) setControl(doc, ext, engine, name, undefined, call);
      }
      // The old way to the identity (deprecated, but BPF/MAP still start without
      // `_identityCorrelation`): without it a C7 subprocess would run with the
      // technical user. If the variable is missing, it stays empty there. Otherwise untouched.
      if (call && engine === 'c7') setControl(doc, ext, engine, 'impersonateUserId', pass('impersonateUserId'), call);
    }

    // Conditions on the branches — FEEL only; an old JUEL text stays as it is
    for (const b of step.branches ?? []) {
      if (b.isDefault || !b.condition) continue;
      const body = feelBody(b.condition);
      if (body == null) continue;
      const flow = byId.get(b.id);
      if (!flow || local(flow) !== 'sequenceFlow') continue;
      // unchanged since the import → the old text stays literally — in
      // Camunda 8 only if it is already null-safe (see nullSafeCondition).
      // And only if it is already in the form of the engine: a `= …` in a
      // Camunda 7 diagram is not an expression but a fixed text
      // (the condition would yield a string) — that one is translated
      const before = firstNamed(flow, 'conditionExpression');
      const old = before?.textContent ?? '';
      const safe = engine !== 'c8' || stripNullSafe(old) !== old || /^=\s*(true|false)\s*$/.test(old.trim());
      const inEngineForm = engine === 'c8' ? old.trim().startsWith('=') : isJuel(old);
      let text: string;
      let translated = true;
      if (engine === 'c8') text = `=${nullSafeCondition(body)}`;
      else {
        const r = feelToJuel(body, inputOpts(step.id));
        if (r.ok) text = `\${${r.juel}}`;
        else { text = b.condition; translated = false; }
      }
      if (before && safe && inEngineForm && stripNullSafe(importExpression(old)).trim() === b.condition.trim()) {
        // the same expression — it stays as it is; unless it differs
        // only in which variable may be missing (`execution.getVariable`):
        // that follows today's data model
        const bare = (t: string) => t.replace(/execution\.getVariable\(\s*["']([A-Za-z_]\w*)["']\s*\)/g, '$1').replace(/\s+/g, '');
        if (engine === 'c8' || !translated || old.trim() === text || (bare(old) !== bare(text) && !bareJsonPath(old) && !lacksEnding(old, b.condition, inputOpts(step.id)))) continue;
      } else if (!translated) {
        issues.push({ stepId: step.id, where: `Zweig «${b.label}»`, text: `nicht nach JUEL übersetzbar: ${(feelToJuel(body, inputOpts(step.id)) as { reason: string }).reason}` });
      }
      let cond = firstNamed(flow, 'conditionExpression');
      if (!cond) {
        cond = bpmnEl('conditionExpression');
        cond.setAttributeNS(XSI_NS, 'xsi:type', `${prefix}tFormalExpression`);
        appendEl(flow, cond);
      }
      cond.textContent = text;
    }
  }

  // The business key goes to every subprocess — even without mapping rows
  for (const el of byId.values()) {
    if (local(el) === 'callActivity') ensureBusinessKey(doc, ensureExt(el), engine);
  }

  // What the Modeler's linter complains about and follows from the diagram itself
  tidyGlobals(defs, issues);
  // the shapes per element — once for the naming; it removes only labels, no shapes
  const shapes = shapesOf(defs);
  nameBoundaryEvents(defs, spec, shapes);
  nameSteps(byId, spec, shapes);
  checkStartMessage(defs, spec, issues);

  // The control parameters (`_…`) always come last — inputs stay before outputs
  for (const el of byId.values()) {
    const ext = firstNamed(el, 'extensionElements');
    if (ext) controlsLast(ext);
  }

  // the order of the schema — otherwise Camunda 7 rejects the deployment
  orderBpmn(doc);
  let out = new XMLSerializer().serializeToString(doc);
  // The XML declaration should stay — and be on a line of its own
  const decl = /^<\?xml[^>]*\?>/.exec(xml)?.[0];
  if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
  out = out.replace(/^(<\?xml[^>]*\?>)(?!\n)/, '$1\n');
  return { xml: out, issues };
}

// ── Clean-up ────────────────────────────────────────────────────────────────
const GLOBALS = ['message', 'error', 'signal', 'escalation'];
const REF_ATTRS = ['messageRef', 'errorRef', 'signalRef', 'escalationRef'];

const allElements = (root: Element): Element[] => [root, ...kids(root).flatMap(allElements)];
/** A reference attribute — with or without prefix (`errorRef`, `camunda:errorRef`) */
const refAttrs = (el: Element): Attr[] =>
  Array.from(el.attributes).filter(a => REF_ATTRS.includes(a.localName || a.name.replace(/^.*:/, '')));

/**
 * Messages, errors, signals and escalations: each only once, and only
 * if it is needed (linter rule `global`). Copying a message event in the
 * editor creates a second `bpmn:message` with the same
 * name — for the engine the same message. The copy is dropped, its
 * references point to the original. Equal means: same name, same
 * code and same content (Camunda 8: `zeebe:subscription`); otherwise both
 * stay and it is reported.
 */
function tidyGlobals(defs: Element, issues: WriteIssue[]) {
  const globals = kids(defs).filter(el => GLOBALS.includes(local(el)));
  const serializer = new XMLSerializer();
  const content = (el: Element) => kids(el).map(c => serializer.serializeToString(c)).join('');
  const keyOf = (el: Element) => [local(el), el.getAttribute('name') ?? '', el.getAttribute('errorCode') ?? '', el.getAttribute('escalationCode') ?? ''].join('|');
  const replaced = new Map<string, string>();
  const kept = new Map<string, Element>();
  for (const el of globals) {
    const name = el.getAttribute('name');
    if (!name) continue;
    const first = kept.get(keyOf(el));
    if (!first) { kept.set(keyOf(el), el); continue; }
    if (content(first) !== content(el)) {
      issues.push({ stepId: el.getAttribute('id') ?? '', where: 'Diagramm', text: `«${name}» gibt es zweimal mit verschiedenem Inhalt — von Hand bereinigen.` });
      continue;
    }
    replaced.set(el.getAttribute('id') ?? '', first.getAttribute('id') ?? '');
  }
  const everything = allElements(defs);
  for (const el of everything) {
    for (const a of refAttrs(el)) {
      const to = replaced.get(a.value);
      if (to) a.value = to;
    }
  }
  for (const el of globals) if (replaced.has(el.getAttribute('id') ?? '')) removeEl(el);
  // what nobody needs any more
  const used = new Set(everything.flatMap(el => refAttrs(el).map(a => a.value)));
  for (const el of globals) {
    if (el.parentNode && !used.has(el.getAttribute('id') ?? '')) removeEl(el);
  }
}

/**
 * A boundary event without a name (linter rule `label-required`) is named as
 * the projects do it: after the error, the message or the signal it
 * listens to — a catch-all after the handled errors of the step
 * (`_handledErrors`), otherwise «Catch All». On the next sync the name
 * becomes the code of the error case — the same for the handled errors.
 */
function nameBoundaryEvents(defs: Element, spec: ProcessSpec, shapes: Map<string, Element[]>) {
  const byId = new Map(allElements(defs).map(el => [el.getAttribute('id') ?? '', el] as [string, Element]));
  const steps = new Map(allSteps(spec.steps).map(s => [s.id, s] as [string, Step]));
  const nameOfRef = (def: Element, ref: string, code?: string): string | undefined => {
    const id = def.getAttribute(ref);
    const target = id ? byId.get(id) : undefined;
    return target ? (target.getAttribute('name') || (code ? target.getAttribute(code) : null) || undefined) : undefined;
  };
  for (const el of byId.values()) {
    if (local(el) !== 'boundaryEvent' || el.getAttribute('name')?.trim()) continue;
    const def = kids(el).find(c => local(c).endsWith('EventDefinition'));
    if (!def) continue;
    let name: string | undefined;
    switch (local(def)) {
      case 'errorEventDefinition': {
        const handled = (steps.get(el.getAttribute('attachedToRef') ?? '')?.errors ?? []).filter(e => e.declared).map(e => e.code);
        name = def.getAttribute('errorRef') ? nameOfRef(def, 'errorRef', 'errorCode') : handled.length ? handled.join(', ') : 'Catch All';
        break;
      }
      case 'messageEventDefinition': name = nameOfRef(def, 'messageRef'); break;
      case 'signalEventDefinition': name = nameOfRef(def, 'signalRef'); break;
      case 'escalationEventDefinition': name = nameOfRef(def, 'escalationRef', 'escalationCode'); break;
    }
    if (name) giveName(el, name, shapes);
  }
}

/**
 * An element only gets its name here. The position of its label in the
 * diagram was never visible before — often a leftover, somewhere off to the side.
 * It is dropped; the Modeler places the label anew, below the element.
 */
function giveName(el: Element, name: string, shapes: Map<string, Element[]>) {
  el.setAttribute('name', name);
  const id = el.getAttribute('id');
  if (!id) return;
  for (const di of shapes.get(id) ?? []) {
    for (const label of kids(di).filter(k => local(k) === 'BPMNLabel')) removeEl(label);
  }
}

/** The shapes per `bpmnElement` — built once, not per named element */
function shapesOf(defs: Element): Map<string, Element[]> {
  const m = new Map<string, Element[]>();
  for (const di of allElements(defs)) {
    const ref = local(di) === 'BPMNShape' ? di.getAttribute('bpmnElement') : null;
    if (ref) m.set(ref, [...(m.get(ref) ?? []), di]);
  }
  return m;
}

/**
 * An element without a label (linter rule `label-required`) gets the name the
 * specification gave it — otherwise it would be named like its ID in the flow. Not start, end
 * and gateways: their substitute name («Start», «Verzweigung») is not a label.
 */
function nameSteps(byId: Map<string, Element>, spec: ProcessSpec, shapes: Map<string, Element[]>) {
  for (const s of allSteps(spec.steps)) {
    if (unnamed(s) || s.kind === 'start' || s.kind === 'end' || s.kind === 'gateway') continue;
    const el = byId.get(s.id);
    if (el && !el.getAttribute('name')?.trim()) giveName(el, s.name.trim(), shapes);
  }
}

/**
 * If the process starts with a message, in the projects it is named like the
 * process. A different one is usually left over from a copied process — it is
 * not renamed (whoever sends it depends on it), but reported.
 */
function checkStartMessage(defs: Element, spec: ProcessSpec, issues: WriteIssue[]) {
  const processId = spec.processId?.trim();
  if (!processId) return;
  const byId = new Map(kids(defs).map(el => [el.getAttribute('id') ?? '', el] as [string, Element]));
  for (const proc of kids(defs).filter(el => local(el) === 'process')) {
    for (const start of kids(proc).filter(el => local(el) === 'startEvent')) {
      const def = kids(start).find(c => local(c) === 'messageEventDefinition');
      const name = def ? byId.get(def.getAttribute('messageRef') ?? '')?.getAttribute('name') : undefined;
      if (name && name !== processId) {
        issues.push({ stepId: start.getAttribute('id') ?? '', where: 'Start-Nachricht', text: `heisst «${name}», nicht wie der Prozess «${processId}» — aus einem kopierten Prozess?` });
      }
    }
  }
}

// ── Implementation ──────────────────────────────────────────────────────────
/**
 * Topic or called process — as the specification knows them (when the service
 * is chosen, the step takes both from the catalog). A task that was only
 * created in Orch Spec or turned into a service would otherwise have them
 * nowhere in the diagram, and the engine would not know what to execute.
 *
 *   Camunda 7   camunda:type="external" camunda:topic="…"   or    calledElement="…"
 *   Camunda 8   <zeebe:taskDefinition type="…" />           or    <zeebe:calledElement processId="…" />
 *
 * If it is missing in the diagram too, this is reported.
 */
function writeImplementation(
  doc: Document, el: Element, ensureExt: (el: Element) => Element, engine: EngineId, step: Step,
  processId: string | undefined, issues: WriteIssue[],
) {
  const zeebe = (name: string): Element | undefined => {
    const ext = firstNamed(el, 'extensionElements');
    return ext ? kids(ext).find(c => local(c) === name) : undefined;
  };
  const zeebeOrNew = (name: string, attrs: Record<string, string> = {}): Element => {
    const found = zeebe(name);
    if (found) return found;
    const created = doc.createElementNS(ZEEBE_NS, `zeebe:${name}`);
    for (const [k, v] of Object.entries(attrs)) created.setAttribute(k, v);
    prependEl(ensureExt(el), created);
    return created;
  };
  const missing = (text: string) => issues.push({ stepId: step.id, where: 'Implementierung', text });

  if (step.timer) writeTimer(doc, el, engine, step.timer, step.id, 'Timer', issues);
  writeMessage(doc, el, engine, step);

  if (local(el) === 'serviceTask') {
    // the init worker of the template listens to the process ID (Orchescala convention)
    const topic = step.topic?.trim() || (el.getAttribute('id') === 'InitProcessTask' ? processId?.trim() : undefined);
    if (engine === 'c8') {
      if (topic) zeebeOrNew('taskDefinition').setAttribute('type', topic);
      else if (!zeebe('taskDefinition')?.getAttribute('type')) missing('Service Task ohne Job-Typ — im Schritt einen Service wählen.');
      return;
    }
    // another implementation (Java class, expression) stays as it is
    if (['class', 'expression', 'delegateExpression'].some(a => attr(el, a))) return;
    if (topic) {
      el.setAttributeNS(CAMUNDA_NS, 'camunda:type', 'external');
      el.setAttributeNS(CAMUNDA_NS, 'camunda:topic', topic);
    } else if (!attr(el, 'topic')) missing('Service Task ohne Topic — im Schritt einen Service wählen.');
  }

  if (local(el) === 'userTask') {
    // Assignment: only what the specification names — and if unchanged since the
    // import, the text stays literally (as with the conditions)
    for (const key of ASSIGNMENT_KEYS) {
      const value = step[key]?.trim();
      if (!value) continue;
      const holder = engine === 'c8' ? zeebe('assignmentDefinition') : el;
      const old = holder ? attr(holder, key) : undefined;
      if (old != null && importExpression(old).trim() === value && !bareJsonPath(old)) continue;
      const r = engineExpression(value, engine, inputOpts(step.id));
      if (r.issue) issues.push({ stepId: step.id, where: 'Zuständigkeit', text: `${key} nicht nach JUEL übersetzbar: ${r.issue}` });
      if (engine === 'c8') zeebeOrNew('assignmentDefinition').setAttribute(key, r.text);
      else el.setAttributeNS(CAMUNDA_NS, `camunda:${key}`, r.text);
    }
  }

  if (local(el) === 'callActivity') {
    const called = step.calledProcess?.trim();
    if (engine === 'c8') {
      // Orchescala maps explicitly: in only the inputs, back only the outputs — never all
      // variables (otherwise the subprocess would see e.g. the processInstanceId of the parent process)
      const ce = called ? zeebeOrNew('calledElement') : zeebe('calledElement');
      if (called) ce!.setAttribute('processId', called);
      else if (!ce?.getAttribute('processId')) missing('Teilprozess ohne gerufenen Prozess — im Schritt einen Service wählen.');
      if (ce) {
        ce.setAttribute('propagateAllChildVariables', 'false');
        ce.setAttribute('propagateAllParentVariables', 'false');
      }
      return;
    }
    if (called) el.setAttribute('calledElement', called);
    else if (!el.getAttribute('calledElement')) missing('Teilprozess ohne gerufenen Prozess — im Schritt einen Service wählen.');
  }
}

/**
 * Message or signal of the step — name and (Camunda 8, waiting) the
 * correlation key, as the specification knows them. Both hang on the
 * global `<bpmn:message>` / `<bpmn:signal>`, which other elements may share:
 * then only this element points to another one — an existing one
 * with that name, otherwise a copy. Whatever nobody needs any more is cleared by `tidyGlobals`.
 */
function writeMessage(doc: Document, el: Element, engine: EngineId, step: Pick<Step, 'id' | 'messageName' | 'correlationKey'>) {
  const name = step.messageName?.trim();
  if (!name) return;
  const holder = local(el) === 'receiveTask' || local(el) === 'sendTask' ? el
    : kids(el).find(c => local(c) === 'messageEventDefinition' || local(c) === 'signalEventDefinition');
  if (!holder) return;
  const tag = local(holder) === 'signalEventDefinition' ? 'signal' : 'message';
  const refAttr = `${tag}Ref`;
  const defs = doc.documentElement;
  const globals = kids(defs).filter(g => local(g) === tag);
  const users = (id: string) => allElements(defs).filter(x => x.getAttribute(refAttr) === id).length;
  const key = engine === 'c8' && tag === 'message' && ['receiveTask', 'intermediateCatchEvent', 'boundaryEvent'].includes(local(el))
    ? step.correlationKey?.trim() : undefined;
  const keyOf = (g: Element) => {
    const ext = firstNamed(g, 'extensionElements');
    return (ext && firstNamed(ext, 'subscription')?.getAttribute('correlationKey')) ?? undefined;
  };
  const fits = (g: Element) => g.getAttribute('name') === name && (!key || keyOf(g) === key);

  let current = globals.find(g => g.getAttribute('id') === holder.getAttribute(refAttr));
  if (!current || !fits(current)) {
    const other = globals.find(g => g !== current && fits(g));
    if (other) current = other;
    else if (!current || users(current.getAttribute('id') ?? '') > 1) {
      // one of its own: a copy of the previous one (including extensions) or new
      const fresh = current ? (current.cloneNode(true) as Element) : doc.createElementNS(BPMN_NS, `${defs.prefix ? `${defs.prefix}:` : ''}${tag}`);
      // a copy: whatever carries an ID inside it would otherwise have it twice
      for (const d of allElements(fresh).slice(1)) d.removeAttribute('id');
      const ids = new Set(allElements(defs).map(x => x.getAttribute('id')));
      let i = 1;
      while (ids.has(`${tag === 'signal' ? 'Signal' : 'Message'}_${step.id}${i > 1 ? `_${i}` : ''}`)) i++;
      fresh.setAttribute('id', `${tag === 'signal' ? 'Signal' : 'Message'}_${step.id}${i > 1 ? `_${i}` : ''}`);
      const diagram = kids(defs).find(g => local(g) === 'BPMNDiagram');
      if (diagram) defs.insertBefore(fresh, diagram); else appendEl(defs, fresh);
      current = fresh;
    }
    holder.setAttribute(refAttr, current.getAttribute('id')!);
    current.setAttribute('name', name);
  }
  if (key && keyOf(current) !== key) {
    let ext = firstNamed(current, 'extensionElements');
    if (!ext) {
      ext = doc.createElementNS(BPMN_NS, `${defs.prefix ? `${defs.prefix}:` : ''}extensionElements`);
      prependEl(current, ext);
    }
    let sub = firstNamed(ext, 'subscription');
    if (!sub) {
      sub = doc.createElementNS(ZEEBE_NS, 'zeebe:subscription');
      appendEl(ext, sub);
    }
    sub.setAttribute('correlationKey', key);
  }
}

const TIMER_TAG: Record<TimerSpec['kind'], string> = { duration: 'timeDuration', date: 'timeDate', cycle: 'timeCycle' };

/**
 * The timer of an event — `= timerX` as `${timerX}` (Camunda 7) or
 * `=timerX` (Camunda 8); fixed text stays text. If the diagram says the same
 * (equal except for the notation of the engine), it stays untouched.
 */
function writeTimer(doc: Document, el: Element, engine: EngineId, timer: TimerSpec, stepId: string, where: string, issues: WriteIssue[]) {
  const def = kids(el).find(c => local(c) === 'timerEventDefinition');
  const expression = timer.expression.trim();
  if (!def) return;
  if (!expression) {
    issues.push({ stepId, where, text: 'ohne Wert — im Diagramm bleibt der bisherige; im Schritt eine Variable setzen, z. B. = timerWait.' });
    return;
  }
  const tag = TIMER_TAG[timer.kind];
  const current = kids(def).filter(c => Object.values(TIMER_TAG).includes(local(c)));
  const same = current.length === 1 && local(current[0]) === tag
    && importExpression((current[0].textContent ?? '').trim()).trim() === expression;
  if (same) return;
  const r = engineExpression(expression, engine);
  if (r.issue) issues.push({ stepId, where, text: `nicht nach JUEL übersetzbar: ${r.issue}` });
  const prefix = def.tagName.includes(':') ? `${def.tagName.split(':')[0]}:` : '';
  for (const c of current) removeEl(c);
  const t = doc.createElementNS(BPMN_NS, `${prefix}${tag}`);
  t.setAttributeNS(XSI_NS, 'xsi:type', `${prefix}tFormalExpression`);
  t.textContent = r.text;
  appendEl(def, t);
}

/**
 * The timers of the boundary events on the step — into the element the import
 * remembered; only an older specification without its ID finds it via the
 * name or the ID on the step, with the same code in order (as the
 * import creates the entries). If the remembered ID does not match (any more) or the
 * assignment is unclear, the diagram stays as it is — otherwise it might hit
 * another boundary event. The timer of a pattern is set by the pattern.
 */
function writeBoundaryTimers(doc: Document, byId: Map<string, Element>, engine: EngineId, step: Step, issues: WriteIssue[]) {
  const errors = step.errors ?? [];
  const claimed = new Set(errors.map(x => x.boundaryId).filter(Boolean));
  for (const e of errors) {
    if (!e.boundary || !e.timer || e.pattern) continue;
    const where = `Timer «${e.code}»`;
    const missing = (text: string) => issues.push({ stepId: step.id, where, text });
    const attached = (b: Element | undefined) => b && local(b) === 'boundaryEvent' && b.getAttribute('attachedToRef') === step.id ? b : undefined;
    let el: Element | undefined;
    if (e.boundaryId) {
      el = attached(byId.get(e.boundaryId));
      if (!el) { missing(`Boundary-Event «${e.boundaryId}» hängt nicht (mehr) an diesem Schritt — Timer nicht geschrieben; den Abgleich mit dem Diagramm starten.`); continue; }
    } else {
      // only timers count — an error boundary event with the same name does not make it unclear
      const isTimer = (b: Element) => kids(b).some(c => local(c) === 'timerEventDefinition');
      const mine = errors.filter(x => x.boundary && x.timer && x.code === e.code && !x.boundaryId);
      const candidates = [...byId.values()].filter(b => attached(b) && isTimer(b) && !claimed.has(b.getAttribute('id') ?? '')
        && (b.getAttribute('name')?.trim() === e.code || b.getAttribute('id') === e.code));
      if (!candidates.length) { missing('kein Timer-Boundary-Event dazu im Diagramm — Timer nicht geschrieben; den Abgleich mit dem Diagramm starten.'); continue; }
      if (candidates.length !== mine.length) { missing(`${candidates.length} Boundary-Events heissen «${e.code}» — unklar, welches; Timer nicht geschrieben. Den Abgleich mit dem Diagramm starten.`); continue; }
      el = candidates[mine.indexOf(e)];
    }
    if (!kids(el).some(c => local(c) === 'timerEventDefinition')) {
      missing('das Boundary-Event im Diagramm ist kein Timer (mehr) — Timer nicht geschrieben; den Abgleich mit dem Diagramm starten.');
      continue;
    }
    writeTimer(doc, el, engine, e.timer, step.id, where, issues);
  }
}

// ── Control parameters on the step ───────────────────────────────────────────────
/**
 * Set `_manualOutMapping` & co. (or remove with `undefined`) — Camunda 7
 * as a local variable or, on the subprocess, as `camunda:in`; Camunda 8 as an input.
 */
/** `#{execution.getVariable('x')}`, `${x}`, `=x` or `x` — the variable x merely passed on */
function isPassThrough(value: string | undefined, name: string): boolean {
  const v = value?.trim();
  if (!v) return false;
  return v === name || v === `\${${name}}` || v === `#{${name}}` || new RegExp(`^=\\s*${name}$`).test(v)
    || new RegExp(`^#\\{\\s*execution\\.getVariable\\(\\s*['"]${name}['"]\\s*\\)\\s*\\}$`).test(v);
}

/** What an element of the diagram already says about its service — read before writing. */
interface ElementState {
  /** `_manualOutMapping` — undefined if it is missing */
  manual?: boolean;
  /** is `_outputVariables` there (even empty)? */
  hasOutputVariables: boolean;
  /** `_outputVariables` — undefined if it is missing or empty (= everything); `NONE` is [] */
  outputVariables?: string[];
  /** the names of the output parameters */
  outputParams: Set<string>;
  /** `_outputMock` or `_outputServiceMock`, as it stands */
  mock?: string;
  /** all inputs and `camunda:in`, as they stand — name → value */
  inputs: Map<string, string>;
}

function elementState(el: Element): ElementState {
  const inputs = new Map<string, string>();
  const outputParams = new Set<string>();
  const ext = firstNamed(el, 'extensionElements');
  for (const c of ext ? kids(ext) : []) {
    const n = local(c);
    if (n === 'inputOutput' || n === 'ioMapping') {
      for (const p of kids(c)) {
        const pn = local(p);
        const name = attr(p, 'name') ?? attr(p, 'target') ?? '';
        if (pn === 'inputParameter') inputs.set(name, p.textContent?.trim() ?? '');
        else if (pn === 'input') inputs.set(name, attr(p, 'source') ?? '');
        else if (pn === 'outputParameter' || pn === 'output') outputParams.add(name);
      }
    } else if (n === 'in') {
      const target = attr(c, 'target');
      if (target) inputs.set(target, attr(c, 'sourceExpression') ?? attr(c, 'source') ?? '');
    } else if (n === 'out') {
      const target = attr(c, 'target');
      if (target) outputParams.add(target);
    }
  }
  const manual = inputs.get('_manualOutMapping');
  const raw = inputs.get('_outputVariables');
  // C8: `="a, b"` — C7: `a, b`
  const text = raw?.replace(/^=\s*/, '').replace(/^"(.*)"$/s, '$1').trim();
  const list = text ? text.split(',').map(v => v.trim()).filter(Boolean) : [];
  return {
    ...(manual !== undefined ? { manual: /true/i.test(manual) } : {}),
    hasOutputVariables: raw !== undefined,
    ...(list.length ? { outputVariables: list.filter(v => v.toUpperCase() !== 'NONE') } : {}),
    outputParams,
    inputs,
    ...(inputs.get('_outputMock') || inputs.get('_outputServiceMock')
      ? { mock: inputs.get('_outputMock') || inputs.get('_outputServiceMock') } : {}),
  };
}

function setControl(doc: Document, ext: Element, engine: EngineId, name: string, value: string | undefined, call = false) {
  if (engine === 'c7' && call) {
    for (const p of kids(ext)) if (local(p) === 'in' && attr(p, 'target') === name) removeEl(p);
    if (value === undefined) return;
    const p = doc.createElementNS(CAMUNDA_NS, 'camunda:in');
    // simply pass on a variable: `source="_servicesMocked"` — if it is missing,
    // it stays empty in the subprocess (optional), and it reads more simply
    const plain = /^#\{execution\.getVariable\('(\w+)'\)\}$/.exec(value);
    if (plain) p.setAttribute('source', plain[1]);
    else p.setAttribute('sourceExpression', value);
    p.setAttribute('target', name);
    appendEl(ext, p);
    return;
  }
  if (engine === 'c8') {
    let io = firstNamed(ext, 'ioMapping');
    for (const p of io ? kids(io) : []) if (local(p) === 'input' && attr(p, 'target') === name) removeEl(p);
    if (value === undefined) return;
    if (!io) { io = doc.createElementNS(ZEEBE_NS, 'zeebe:ioMapping'); appendEl(ext, io); }
    const p = doc.createElementNS(ZEEBE_NS, 'zeebe:input');
    p.setAttribute('source', value);
    p.setAttribute('target', name);
    appendEl(io, p);
    return;
  }
  let io = firstNamed(ext, 'inputOutput');
  for (const p of io ? kids(io) : []) if (local(p) === 'inputParameter' && attr(p, 'name') === name) removeEl(p);
  if (value === undefined) return;
  if (!io) { io = doc.createElementNS(CAMUNDA_NS, 'camunda:inputOutput'); appendEl(ext, io); }
  const p = doc.createElementNS(CAMUNDA_NS, 'camunda:inputParameter');
  p.setAttribute('name', name);
  p.textContent = value;
  appendEl(io, p);
}

/** Order: business inputs, `_…` inputs, business outputs, `_…` outputs */
function controlsLast(ext: Element) {
  const isControl = (p: Element) => (attr(p, 'target') ?? attr(p, 'name') ?? '').startsWith('_');
  const reorder = (parent: Element, isIn: (p: Element) => boolean) => {
    const all = kids(parent);
    const sorted = [
      ...all.filter(p => isIn(p) && !isControl(p)), ...all.filter(p => isIn(p) && isControl(p)),
      ...all.filter(p => !isIn(p) && !isControl(p)), ...all.filter(p => !isIn(p) && isControl(p)),
    ];
    if (sorted.every((p, i) => p === all[i])) return;
    for (const p of all) removeEl(p);
    for (const p of sorted) appendEl(parent, p);
  };
  const zio = firstNamed(ext, 'ioMapping');
  if (zio) reorder(zio, p => local(p) === 'input');
  const cio = firstNamed(ext, 'inputOutput');
  if (cio) reorder(cio, p => local(p) === 'inputParameter');
  // on the subprocess (Camunda 7): `camunda:in` with `_…` at the end
  const rest = kids(ext);
  const ins = rest.filter(p => local(p) === 'in' && isControl(p));
  const behind = ins.length && rest.slice(rest.indexOf(ins[0])).some(p => !ins.includes(p));
  if (behind) for (const p of ins) { removeEl(p); appendEl(ext, p); }
}

// ── Business key to the subprocess ──────────────────────────────────────────
// Camunda 7 has `camunda:in businessKey` for this; in Camunda 8 the business
// key is a variable and is passed as the input `businessKey`.
function ensureBusinessKey(doc: Document, ext: Element, engine: EngineId) {
  if (engine === 'c8') {
    let io = firstNamed(ext, 'ioMapping');
    if (io && kids(io).some(p => local(p) === 'input' && attr(p, 'target') === 'businessKey')) return;
    const p = doc.createElementNS(ZEEBE_NS, 'zeebe:input');
    p.setAttribute('source', '=businessKey');
    p.setAttribute('target', 'businessKey');
    if (io) { const rest = kids(io); for (const k of rest) removeEl(k); for (const k of [p, ...rest]) appendEl(io, k); }
    else { io = doc.createElementNS(ZEEBE_NS, 'zeebe:ioMapping'); appendEl(ext, io); appendEl(io, p); }
    return;
  }
  if (kids(ext).some(p => local(p) === 'in' && attr(p, 'businessKey'))) return;
  const p = doc.createElementNS(CAMUNDA_NS, 'camunda:in');
  p.setAttribute('businessKey', '#{execution.processBusinessKey}');
  appendEl(ext, p);
}

// ── Camunda 8 ────────────────────────────────────────────────────────────────
function writeZeebe(doc: Document, ext: Element, ins: Mapping[], outs: Mapping[], stepId: string, issues: WriteIssue[]) {
  const old = firstNamed(ext, 'ioMapping');
  const oldKids = old ? kids(old) : [];
  // keep control parameters from the old mapping
  const keep = oldKids.filter(p => TECHNICAL.has(attr(p, 'target') ?? ''));
  if (old) removeEl(old);
  if (!ins.length && !outs.length && !keep.length) return;
  const io = doc.createElementNS(ZEEBE_NS, 'zeebe:ioMapping');
  const source = (m: Mapping, where: string): string => {
    const e = engineExpression(m.expression, 'c8');
    if (feelBody(m.expression) == null && /^[$#]\{/.test(m.expression.trim())) {
      issues.push({ stepId, where, text: `«${m.expression}» ist kein FEEL — ${C8_LABEL} nimmt es als festen Text. Als «= …» schreiben.` });
    }
    return e.text;
  };
  const same = (tag: 'input' | 'output', m: Mapping): Element | undefined =>
    oldKids.find(p => local(p) === tag && attr(p, 'target') === m.name.trim() && unchanged(p, m));
  for (const m of ins) {
    const p = same('input', m) ?? doc.createElementNS(ZEEBE_NS, 'zeebe:input');
    if (!p.hasAttribute('target')) { p.setAttribute('source', source(m, `Eingabe «${m.name}»`)); p.setAttribute('target', m.name.trim()); }
    io.appendChild(p);
  }
  for (const p of keep) if (local(p) === 'input') io.appendChild(p);
  for (const m of outs) {
    const p = same('output', m) ?? doc.createElementNS(ZEEBE_NS, 'zeebe:output');
    if (!p.hasAttribute('target')) { p.setAttribute('source', source(m, `Ausgabe «${m.name}»`)); p.setAttribute('target', m.name.trim()); }
    io.appendChild(p);
  }
  for (const p of keep) if (local(p) === 'output') io.appendChild(p);
  appendEl(ext, io);
  // indent the children afterwards — appendChild knows no line breaks
  const inner = kids(io);
  for (const p of inner) p.remove();
  for (const p of inner) appendEl(io, p);
}

// ── Camunda 7 ────────────────────────────────────────────────────────────────
/**
 * FEEL → `${…}`; JUEL from an old import stays; whatever cannot be translated is
 * reported. `script`: a list or a context (JSON) goes as a
 * Groovy script (see feelToGroovy) — only where a script can go
 * (`camunda:inputParameter` / `outputParameter`, not `camunda:in`).
 */
function juelOf(m: Mapping, stepId: string, where: string, issues: WriteIssue[], script = false, opts: JuelOptions = juelOpts): { text: string; plain?: string; script?: string } {
  const body = feelBody(m.expression);
  if (body == null) return { text: m.expression };
  const r = feelToJuel(body, opts);
  if (r.ok) return { text: `\${${r.juel}}`, ...(r.plain ? { plain: r.plain } : {}) };
  if (script) {
    const g = feelToGroovy(body);
    if (g.ok) return { text: m.expression, script: g.script };
    issues.push({ stepId, where, text: `nicht nach JUEL übersetzbar: ${r.reason}; als JSON-Skript auch nicht: ${g.reason} — FEEL steht unverändert im BPMN.` });
    return { text: m.expression };
  }
  issues.push({ stepId, where, text: `nicht nach JUEL übersetzbar: ${r.reason} — FEEL steht unverändert im BPMN.` });
  return { text: m.expression };
}

/** Set the value of a `camunda:inputParameter` / `outputParameter` — as text or as a Groovy script */
function setCamundaValue(doc: Document, p: Element, v: { text: string; script?: string }) {
  if (!v.script) { p.textContent = v.text; return; }
  const sc = doc.createElementNS(CAMUNDA_NS, 'camunda:script');
  sc.setAttribute('scriptFormat', 'groovy');
  sc.textContent = v.script;
  p.appendChild(sc);
}

function writeCamundaIo(doc: Document, ext: Element, ins: Mapping[], outs: Mapping[], stepId: string, issues: WriteIssue[]) {
  let io = firstNamed(ext, 'inputOutput');
  if (!io) {
    io = doc.createElementNS(CAMUNDA_NS, 'camunda:inputOutput');
    appendEl(ext, io);
  }
  // Control parameters stay, business rows are replaced — except
  // scripts, lists and maps: the specification only describes those
  // (`«groovy» …`), they are not written. They stay as long as
  // their row is still there and has not replaced the value with FEEL.
  const keep = new Set<string>();
  for (const p of kids(io)) {
    const name = attr(p, 'name') ?? '';
    if (TECHNICAL.has(name)) continue;
    const tag = local(p) === 'inputParameter' ? 'in' : 'out';
    const row = (tag === 'in' ? ins : outs).find(m => m.name.trim() === name);
    if (row && !keep.has(`${tag}:${name}`) && (unchanged(p, row, tag === 'in' ? inputOpts(stepId) : outputOpts(stepId)) || (isComplex(p) && (isScript(row) || feelBody(row.expression) == null)))) {
      keep.add(`${tag}:${name}`);
      continue;
    }
    removeEl(p);
  }
  const scriptGone = (m: Mapping, where: string): boolean => {
    if (!isScript(m)) return false;
    issues.push({ stepId, where, text: 'ist ein Skript — die Spezifikation beschreibt es nur; im BPMN steht es nicht mehr. Dort pflegen.' });
    return true;
  };
  for (const m of ins) {
    if (keep.has(`in:${m.name.trim()}`) || scriptGone(m, `Eingabe «${m.name}»`)) continue;
    const p = doc.createElementNS(CAMUNDA_NS, 'camunda:inputParameter');
    p.setAttribute('name', m.name.trim());
    setCamundaValue(doc, p, juelOf(m, stepId, `Eingabe «${m.name}»`, issues, true, inputOpts(stepId)));
    appendEl(io, p);
  }
  for (const m of outs) {
    if (keep.has(`out:${m.name.trim()}`) || scriptGone(m, `Ausgabe «${m.name}»`)) continue;
    const p = doc.createElementNS(CAMUNDA_NS, 'camunda:outputParameter');
    p.setAttribute('name', m.name.trim());
    setCamundaValue(doc, p, juelOf(m, stepId, `Ausgabe «${m.name}»`, issues, true, outputOpts(stepId)));
    appendEl(io, p);
  }
  if (!kids(io).length) removeEl(io);
}

function writeCamundaInOut(doc: Document, ext: Element, ins: Mapping[], outs: Mapping[], stepId: string, issues: WriteIssue[]) {
  // Besides `camunda:in/out`, a subprocess can also carry an `inputOutput`
  // — the import reads both as mapping. Whatever is there is maintained
  // there: scripts stay, text is replaced; only what does not exist
  // there comes as `camunda:in/out`.
  const io = firstNamed(ext, 'inputOutput');
  const ioParam = (tag: 'in' | 'out', name: string): Element | null =>
    io ? kids(io).find(p => local(p) === (tag === 'in' ? 'inputParameter' : 'outputParameter') && attr(p, 'name') === name) ?? null : null;
  // businessKey, `variables="all"` and control parameters stay — and
  // rows that are unchanged, literally
  const kept = new Set<Mapping>();
  for (const p of kids(ext)) {
    const n = local(p);
    if (n !== 'in' && n !== 'out') continue;
    if (attr(p, 'businessKey') || attr(p, 'variables')) continue;
    if (TECHNICAL.has(attr(p, 'target') ?? '') || TECHNICAL.has(attr(p, 'source') ?? '')) continue;
    const row = (n === 'in' ? ins : outs).find(m => !kept.has(m) && (attr(p, 'target') ?? attr(p, 'targetVariable')) === m.name.trim() && unchanged(p, m, n === 'in' ? inputOpts(stepId) : outputOpts(stepId)));
    if (row) { kept.add(row); continue; }
    removeEl(p);
  }
  const put = (tag: 'in' | 'out', m: Mapping, where: string) => {
    if (kept.has(m)) return;
    const name = m.name.trim();
    const opts = tag === 'in' ? inputOpts(stepId) : outputOpts(stepId);
    const existing = ioParam(tag, name);
    // a local variable in the `inputOutput`: unchanged it stays, a
    // script anyway; a changed text is replaced there — unless
    // the same name also goes through as `camunda:in`, then that is the row
    const twice = (tag === 'in' ? ins : outs).filter(x => x.name.trim() === name).length > 1;
    if (existing && (unchanged(existing, m, opts) || (isComplex(existing) && (isScript(m) || feelBody(m.expression) == null)))) return;
    if (isScript(m)) {
      issues.push({ stepId, where, text: 'ist ein Skript — die Spezifikation beschreibt es nur; im BPMN steht es nicht mehr. Dort pflegen.' });
      return;
    }
    if (existing && !twice) {
      for (const k of kids(existing)) k.remove();
      existing.textContent = juelOf(m, stepId, where, issues, false, opts).text;
      return;
    }
    const p = doc.createElementNS(CAMUNDA_NS, `camunda:${tag}`);
    const j = juelOf(m, stepId, where, issues, false, opts);
    // a mere variable path is `source`, everything else `sourceExpression`
    if (j.plain && !j.plain.includes('.') && !j.plain.includes('[')) p.setAttribute('source', j.plain);
    else p.setAttribute('sourceExpression', j.text);
    p.setAttribute('target', name);
    appendEl(ext, p);
  };
  for (const m of ins) put('in', m, `Eingabe «${m.name}»`);
  for (const m of outs) put('out', m, `Ausgabe «${m.name}»`);
}
