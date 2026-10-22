// Convert BPMN between Camunda 7 and Camunda 8 — in both directions.
//
// Mechanically, on the XML: layout, IDs, topics and names stay, only the
// engine extensions change form (rules as in the migration guide
// of the bpmn-c7-to-c8 skill):
//
//   Camunda 7                                  Camunda 8
//   camunda:type="external" camunda:topic      zeebe:taskDefinition type
//   camunda:inputOutput (input/outputParam.)   zeebe:ioMapping (input/output)
//   calledElement + camunda:in / camunda:out   zeebe:calledElement + zeebe:ioMapping
//   camunda:decisionRef / resultVariable       zeebe:calledDecision
//   camunda:assignee / candidateGroups …       zeebe:userTask + assignmentDefinition
//   camunda:collection / elementVariable       zeebe:loopCharacteristics
//   camunda:properties                         zeebe:properties
//   camunda:versionTag                         zeebe:versionTag
//   camunda:modelerTemplate                    zeebe:modelerTemplate (service reference)
//   ${…} (JUEL)                                =… (FEEL)
//
// What has no equivalent is dropped — the engine specifics without
// meaning for the flow (async, job priority …) silently, everything else with
// a message: listeners, scripts, correlation keys, expressions that cannot
// be translated. Better visibly open than silently wrong.

import type { EngineId } from './types.ts';
import { C7_LABEL, C8_LABEL } from './engineLabels.ts';
import { feelBody, feelToJuel } from './feelJuel.ts';
import { importExpression, isJuel, nullSafeCondition, stripNullSafe } from './juelFeel.ts';
import { appendEl, orderBpmn, prependEl, removeEl } from './xmlFormat.ts';
import type { WriteIssue, WriteResult } from './bpmnWrite.ts';
import { errorListSource, parseErrorList } from './errorCodes.ts';

/** `_handledErrors` / `_regexHandledErrors`: list in Camunda 8, text with commas in Camunda 7 */
const ERROR_LISTS = new Set(['_handledErrors', '_regexHandledErrors']);

const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';
const MODELER_NS = 'http://camunda.org/schema/modeler/1.0';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** Platform details for the Modeler */
const PLATFORM: Record<EngineId, { name: string; version: string }> = {
  c7: { name: 'Camunda Platform', version: '7.23.0' },
  c8: { name: 'Camunda Cloud', version: '8.9.0' },
};

/** Camunda 7 attributes without meaning in Camunda 8 — dropped silently */
const C7_ONLY = new Set([
  'asyncBefore', 'asyncAfter', 'async', 'exclusive', 'jobPriority', 'taskPriority', 'failedJobRetryTimeCycle',
  'historyTimeToLive', 'isStartableInTasklist', 'calledElementBinding', 'calledElementVersion',
  'calledElementVersionTag', 'calledElementTenantId', 'decisionRefBinding', 'decisionRefVersion',
  'decisionRefVersionTag', 'decisionRefTenantId', 'mapDecisionResult', 'diagramRelationId', 'errorMessage', 'initiator',
  'candidateStarterGroups', 'candidateStarterUsers', 'priority',
]);

const local = (el: Element): string => {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};
const kids = (el: Element) => Array.from(el.children);
const firstNamed = (el: Element, name: string, ns?: string): Element | null =>
  kids(el).find(c => local(c) === name && (!ns || c.namespaceURI === ns)) ?? null;
const inNs = (el: Element, ns: string) => el.namespaceURI === ns;

function descendants(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => { out.push(el); for (const k of kids(el)) walk(k); };
  walk(root);
  return out;
}

/** Engine of a diagram — as the import recognizes it */
export const detectEngine = (xml: string): EngineId =>
  /http:\/\/camunda\.org\/schema\/zeebe|executionPlatform="Camunda Cloud"/.test(xml) ? 'c8' : 'c7';

// ── Expressions ──────────────────────────────────────────────────────────────
type Issue = (where: string, text: string) => void;

/** JUEL/text → FEEL with `=`; fixed text stays fixed text (timer, condition) */
function toFeel(text: string, where: string, issue: Issue): string {
  const t = text.trim();
  if (!t || t.startsWith('=') || !isJuel(t)) return t;
  const f = importExpression(t);
  if (f.startsWith('= ')) return `=${f.slice(2)}`;
  issue(where, `«${t}» ist nicht nach FEEL übersetzbar — von Hand anpassen.`);
  return t;
}

const feelString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Source of a `zeebe:input/output` — everything there is FEEL, so fixed text is a string */
function toFeelSource(text: string, where: string, issue: Issue): string {
  const t = text.trim();
  if (!t) return '=null';
  if (t.startsWith('=')) return t;
  if (!isJuel(t)) return `=${feelString(t)}`;
  return toFeel(t, where, issue);
}

/** FEEL → `${…}`; fixed text stays */
function toJuel(text: string, where: string, issue: Issue): string {
  const t = text.trim();
  const body = feelBody(t);
  if (body == null) return t;
  const r = feelToJuel(body);
  if (r.ok) return `\${${r.juel}}`;
  issue(where, `«${t}» ist nicht nach JUEL übersetzbar (${r.reason}) — von Hand anpassen.`);
  return t;
}

/** Value of a `camunda:inputParameter` from a zeebe source: a FEEL string becomes fixed text again */
function toJuelValue(source: string, where: string, issue: Issue): string {
  const body = feelBody(source.trim());
  const lit = body != null ? /^"((?:[^"\\]|\\.)*)"$/.exec(body) : null;
  if (lit) return lit[1].replace(/\\(["\\])/g, '$1');
  return toJuel(source, where, issue);
}

/** bare variable name (`=client`) — for `camunda:in source` */
const plainVar = (source: string): string | null => {
  const b = feelBody(source.trim());
  return b != null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(b) ? b : null;
};

// ── Conversion ───────────────────────────────────────────────────────────────
/**
 * Bring the diagram into the form of the target engine. If it is already in this
 * form, it comes back unchanged.
 */
/**
 * `correlationKeys`: the correlation key chosen at the step per element ID —
 * a waiting message without one gets the suggestion `=businessKey` in Camunda 8.
 */
export function convertBpmn(xml: string, target: EngineId, opts: { timeToLive?: string; correlationKeys?: Record<string, string> } = {}): WriteResult & { changed: boolean } {
  const issues: WriteIssue[] = [];
  if (detectEngine(xml) === target) return { xml, issues, changed: false };
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const defs = doc.documentElement;
  if (!defs || local(defs) !== 'definitions' || doc.getElementsByTagName('parsererror').length) {
    return { xml, changed: false, issues: [{ stepId: '', where: 'BPMN', text: 'Das Diagramm ist kein lesbares BPMN — nichts umgewandelt.' }] };
  }
  const bpmnPrefix = defs.prefix ? `${defs.prefix}:` : '';
  const ctx: Ctx = {
    doc, issues, later: [], correlationKeys: opts.correlationKeys ?? {},
    bpmnEl: name => doc.createElementNS(defs.namespaceURI, `${bpmnPrefix}${name}`),
  };

  const declare = (prefix: string, uri: string) => {
    if (!defs.hasAttribute(`xmlns:${prefix}`)) defs.setAttributeNS(XMLNS_NS, `xmlns:${prefix}`, uri);
  };
  declare(target === 'c8' ? 'zeebe' : 'camunda', target === 'c8' ? ZEEBE_NS : CAMUNDA_NS);
  declare('modeler', MODELER_NS);
  defs.setAttributeNS(MODELER_NS, 'modeler:executionPlatform', PLATFORM[target].name);
  defs.setAttributeNS(MODELER_NS, 'modeler:executionPlatformVersion', PLATFORM[target].version);

  if (target === 'c8') toC8(defs, ctx);
  else toC7(defs, ctx, opts);

  // the namespace of the old engine, when nothing is left in it
  const oldNs = target === 'c8' ? CAMUNDA_NS : ZEEBE_NS;
  for (const a of Array.from(defs.attributes)) {
    if (a.name.startsWith('xmlns:') && a.value === oldNs && !usesNs(defs, oldNs)) defs.removeAttribute(a.name);
  }

  orderBpmn(doc);
  let out = new XMLSerializer().serializeToString(doc);
  const decl = /^<\?xml[^>]*\?>/.exec(xml)?.[0];
  if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
  out = out.replace(/^(<\?xml[^>]*\?>)(?!\n)/, '$1\n');
  // two identical listeners on the same element are one message
  const seen = new Set<string>();
  const unique = issues.filter(i => { const k = `${i.stepId}|${i.where}|${i.text}`; return !seen.has(k) && !!seen.add(k); });
  return { xml: out, issues: unique, changed: true };
}

interface Ctx {
  doc: Document;
  issues: WriteIssue[];
  bpmnEl: (name: string) => Element;
  /** Children that can only be indented once their parent is attached */
  later: Array<[Element, Element[]]>;
  /** Element ID → chosen correlation key (see convertBpmn) */
  correlationKeys: Record<string, string>;
}

function usesNs(root: Element, ns: string): boolean {
  return descendants(root).some(e => e.namespaceURI === ns || Array.from(e.attributes).some(a => a.namespaceURI === ns));
}

const idOf = (el: Element): string => {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const id = e.getAttribute('id');
    if (id) return id;
  }
  return '';
};

const issueAt = (ctx: Ctx, el: Element): Issue => (where, text) => ctx.issues.push({ stepId: idOf(el), where, text });

/** `extensionElements` of the element — created if missing */
function extOf(ctx: Ctx, el: Element): Element {
  let ext = firstNamed(el, 'extensionElements');
  if (!ext) {
    ext = ctx.bpmnEl('extensionElements');
    // nothing may come before `documentation`
    const doc = firstNamed(el, 'documentation');
    if (doc) el.insertBefore(ext, doc.nextSibling);
    else prependEl(el, ext);
  }
  return ext;
}

function create(ctx: Ctx, ns: string, prefix: string, name: string, attrs: Record<string, string | undefined> = {}): Element {
  const e = ctx.doc.createElementNS(ns, `${prefix}:${name}`);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== '') e.setAttribute(k, v);
  return e;
}

/** Insert children with indentation */
function fill(parent: Element, children: Element[]) {
  for (const c of children) appendEl(parent, c);
}

/** remove `extensionElements` that became empty */
function dropEmptyExt(el: Element) {
  const ext = firstNamed(el, 'extensionElements');
  if (ext && !kids(ext).length) removeEl(ext);
}

// ── Camunda 7 → Camunda 8 ────────────────────────────────────────────────────
function toC8(defs: Element, ctx: Ctx) {
  const cattr = (el: Element, name: string) => el.getAttributeNS(CAMUNDA_NS, name);
  const zeebe = (name: string, attrs: Record<string, string | undefined> = {}) => create(ctx, ZEEBE_NS, 'zeebe', name, attrs);
  const touched: Element[] = [];
  const setEvents: SetEvent[] = [];

  for (const el of descendants(defs)) {
    if (inNs(el, CAMUNDA_NS) || inNs(el, ZEEBE_NS)) continue;
    const name = local(el);
    const issue = issueAt(ctx, el);
    const add: Element[] = [];
    const ext0 = firstNamed(el, 'extensionElements');

    // ── External task: topic → job type (for message events on the event itself)
    const topic = cattr(el, 'topic');
    if (topic) {
      const holder = name === 'messageEventDefinition' && el.parentElement ? el.parentElement : el;
      if (holder === el) add.push(zeebe('taskDefinition', { type: topic }));
      else { const e = extOf(ctx, holder); prependEl(e, zeebe('taskDefinition', { type: topic })); touched.push(holder); }
    }
    for (const a of ['class', 'delegateExpression', 'expression']) {
      if (cattr(el, a)) issue('Implementierung', `camunda:${a}="${cattr(el, a)}" — in ${C8_LABEL} als Job-Worker (zeebe:taskDefinition) umsetzen.`);
    }

    // ── Subprocess: calledElement + in/out
    const io: Element[] = [];
    if (name === 'callActivity') {
      const called = el.getAttribute('calledElement');
      const ins = ext0 ? kids(ext0).filter(k => inNs(k, CAMUNDA_NS) && local(k) === 'in') : [];
      const outs = ext0 ? kids(ext0).filter(k => inNs(k, CAMUNDA_NS) && local(k) === 'out') : [];
      const all = (xs: Element[]) => xs.some(x => x.getAttribute('variables') === 'all');
      // Orchescala maps explicitly — never all variables, in either direction
      add.push(zeebe('calledElement', {
        processId: called ? toFeel(called, 'Aufgerufener Prozess', issue) : undefined,
        propagateAllChildVariables: 'false',
        propagateAllParentVariables: 'false',
      }));
      if (all(ins)) issue('Teilprozess', 'camunda:in variables="all" — Orchescala gibt nur explizit gemappte Eingaben weiter; die gebrauchten als Eingaben mappen.');
      if (all(outs)) issue('Teilprozess', 'camunda:out variables="all" — Orchescala übernimmt nur explizit gemappte Ausgaben; die gebrauchten als Ausgaben mappen.');
      if (called) el.removeAttribute('calledElement');
      for (const [xs, tag] of [[ins, 'input'], [outs, 'output']] as const) {
        for (const x of xs) {
          if (x.getAttribute('businessKey')) continue; // is passed below as variable «businessKey»
          if (x.getAttribute('variables') === 'all') continue;
          const target = x.getAttribute('target') ?? '';
          const src = x.getAttribute('source');
          const expr = x.getAttribute('sourceExpression');
          const where = `${tag === 'input' ? 'Eingabe' : 'Ausgabe'} «${target}»`;
          const source = src ? `=${src}` : toFeelSource(expr ?? '', where, issue);
          io.push(zeebe(tag, { source, target }));
        }
      }
      // The business key always goes to the subprocess — in Camunda 8 as a variable
      if (!io.some(p => local(p) === 'input' && p.getAttribute('target') === 'businessKey')) {
        io.unshift(zeebe('input', { source: '=businessKey', target: 'businessKey' }));
      }
    }

    // ── Listeners that only set a variable → output mapping (the usual
    //    pattern on end events: `execution.setVariable("processStatus", "…")`) —
    //    on the element or on a none throw event before/after it (placementOf)
    const cio = ext0 ? firstNamed(ext0, 'inputOutput', CAMUNDA_NS) : null;
    // only outputs that become a zeebe:output (complexParam: a script, a list, a map not)
    const hasOutputs = io.some(p => local(p) === 'output')
      || (!!cio && kids(cio).some(p => local(p) === 'outputParameter' && !complexParam(p)));
    const listeners = ext0 ? kids(ext0).filter(k => inNs(k, CAMUNDA_NS) && local(k) === 'executionListener') : [];
    // after the own outputs — in Camunda 7 the end listener ran after the output mapping
    const listenerOutputs: Element[] = [];
    for (const l of listeners) {
      const sv = setVariableOf(l.getAttribute('expression') ?? '');
      if (!sv) continue;
      const event = l.getAttribute('event') ?? 'start';
      const place = placementOf(el, event, hasOutputs);
      if (!place) {
        issue('Listener', `setVariable «${sv.name}» NICHT übernommen — Listener-Event «${event}» hier unbekannt: von Hand umsetzen.`);
        keepAsComment(el, [listenerText(l)]);
        removeEl(l);
        continue;
      }
      const output = zeebe('output', { source: toFeelSource(`\${${sv.value}}`, `Ausgabe «${sv.name}»`, issue), target: sv.name });
      if (place === 'here') listenerOutputs.push(output);
      else {
        const known = setEvents.find(x => x.el === el && x.place === place);
        if (known) { known.outputs.push(output); known.listeners.push(listenerText(l)); }
        else setEvents.push({ el, place, outputs: [output], listeners: [listenerText(l)] });
      }
      removeEl(l);
    }

    // ── local variables: inputOutput → ioMapping
    if (cio) {
      for (const p of kids(cio)) {
        const tag = local(p) === 'inputParameter' ? 'input' : 'output';
        const target = p.getAttribute('name') ?? '';
        const where = `${tag === 'input' ? 'Eingabe' : 'Ausgabe'} «${target}»`;
        const complex = complexParam(p);
        if (complex) {
          issue(where, local(complex) === 'script'
            ? `ist ein Skript — in ${C8_LABEL} als FEEL-Ausdruck neu schreiben.`
            : `ist eine ${local(complex) === 'list' ? 'Liste' : 'Map'} — als FEEL-Ausdruck neu schreiben.`);
          continue;
        }
        if (tag === 'input' && ERROR_LISTS.has(target)) { io.push(zeebe(tag, { source: errorListSource(parseErrorList(p.textContent ?? ''), 'c8'), target })); continue; }
        io.push(zeebe(tag, { source: toFeelSource(p.textContent ?? '', where, issue), target }));
      }
    }
    io.push(...listenerOutputs);
    if (io.length) {
      const m = zeebe('ioMapping');
      add.push(m);
      // inputs before outputs — that is what the schema wants
      const sorted = [...io.filter(x => local(x) === 'input'), ...io.filter(x => local(x) === 'output')];
      ctx.later.push([m, sorted]);
    }

    // ── DMN
    const decision = cattr(el, 'decisionRef');
    if (decision) {
      const result = cattr(el, 'resultVariable');
      if (!result) issue('Entscheidung', `${C8_LABEL} braucht eine resultVariable — ergänzen.`);
      add.push(zeebe('calledDecision', { decisionId: decision, resultVariable: result || undefined }));
      issue('Entscheidung', `Ergebnisform prüfen: ${C8_LABEL} liefert je nach Hit Policy einen Wert, einen Context oder eine Liste (${C7_LABEL} immer eine Liste).`);
    }

    // ── User task
    if (name === 'userTask') {
      add.push(zeebe('userTask'));
      const assignee = cattr(el, 'assignee'), groups = cattr(el, 'candidateGroups'), users = cattr(el, 'candidateUsers');
      if (assignee || groups || users) {
        add.push(zeebe('assignmentDefinition', {
          assignee: assignee ? toFeel(assignee, 'Zuständig', issue) : undefined,
          candidateGroups: groups ? toFeel(groups, 'Gruppen', issue) : undefined,
          candidateUsers: users ? toFeel(users, 'Benutzer', issue) : undefined,
        }));
      }
      const due = cattr(el, 'dueDate'), follow = cattr(el, 'followUpDate');
      if (due || follow) {
        add.push(zeebe('taskSchedule', {
          dueDate: due ? toFeel(due, 'Fälligkeit', issue) : undefined,
          followUpDate: follow ? toFeel(follow, 'Wiedervorlage', issue) : undefined,
        }));
      }
    }
    const formKey = cattr(el, 'formKey');
    if (formKey) {
      if (name === 'userTask') add.push(zeebe('formDefinition', { externalReference: formKey }));
      issue('Formular', `formKey «${formKey}» — in ${C8_LABEL} als Formular (externe Referenz) prüfen.`);
    }

    // ── Multi-instance
    if (name === 'multiInstanceLoopCharacteristics') {
      const coll = cattr(el, 'collection'), elem = cattr(el, 'elementVariable');
      if (coll || elem) {
        const lc = zeebe('loopCharacteristics', {
          inputCollection: coll ? toFeelSource(coll, 'Sammlung', issue) : undefined,
          inputElement: elem || undefined,
        });
        add.push(lc);
      }
      if (firstNamed(el, 'loopCardinality')) issue('Mehrfachausführung', `loopCardinality gibt es in ${C8_LABEL} nicht — über eine Sammlung lösen.`);
      const cc = firstNamed(el, 'completionCondition');
      if (cc) cc.textContent = toFeel(cc.textContent ?? '', 'Abschlussbedingung', issue);
    }

    // ── Conditions and timers
    if (name === 'conditionExpression') {
      if (el.getAttribute('language')) issue('Bedingung', `Skript-Bedingung (${el.getAttribute('language')}) — als FEEL neu schreiben.`);
      else {
        // null-safe as in the export: in Camunda 7 `null` simply was `false`
        const feel = toFeel(el.textContent ?? '', 'Bedingung', issue);
        el.textContent = feel.startsWith('=') ? `=${nullSafeCondition(feel.slice(1))}` : feel;
      }
    }
    if (['timeDuration', 'timeDate', 'timeCycle'].includes(name)) {
      el.textContent = toFeel(el.textContent ?? '', 'Timer', issue);
    }

    // ── Messages: whoever waits needs a correlation key
    if (name === 'messageEventDefinition' || name === 'receiveTask') {
      const holder = name === 'receiveTask' ? el : el.parentElement;
      const waits = holder && ['intermediateCatchEvent', 'boundaryEvent', 'receiveTask'].includes(local(holder));
      const ref = el.getAttribute('messageRef');
      const msg = ref ? descendants(defs).find(m => local(m) === 'message' && m.getAttribute('id') === ref) : null;
      if (waits && msg) {
        const mext = extOf(ctx, msg);
        if (!firstNamed(mext, 'subscription', ZEEBE_NS)) {
          const chosen = ctx.correlationKeys[holder.getAttribute('id') ?? ''];
          appendEl(mext, zeebe('subscription', { correlationKey: chosen ?? '=businessKey' }));
          if (!chosen) issueAt(ctx, holder)('Nachricht', `«${msg.getAttribute('name') ?? ref}» — Korrelationsschlüssel «=businessKey» vorgeschlagen, prüfen.`);
        }
      }
    }
    // Names of message and signal: an expression (`…-${mainProcessInstanceId}`) becomes FEEL —
    // otherwise Camunda 8 would take it literally, and nothing would arrive
    if (name === 'message' || name === 'signal') {
      const n = el.getAttribute('name');
      if (n && isJuel(n)) el.setAttribute('name', toFeel(n, name === 'signal' ? 'Signalname' : 'Nachrichtenname', issue));
    }

    // ── Element template: the reference to the service stays
    for (const a of TEMPLATE_ATTRS) {
      const v = cattr(el, a);
      if (v) el.setAttributeNS(ZEEBE_NS, `zeebe:${a}`, v);
    }

    // ── Process
    if (name === 'process') {
      const tag = cattr(el, 'versionTag');
      if (tag) add.push(zeebe('versionTag', { value: tag }));
    }

    // ── Properties
    const props = ext0 ? firstNamed(ext0, 'properties', CAMUNDA_NS) : null;
    if (props) {
      const zp = zeebe('properties');
      ctx.later.push([zp, kids(props).map(p => zeebe('property', { name: p.getAttribute('name') ?? '', value: p.getAttribute('value') ?? '' }))]);
      add.push(zp);
    }

    // ── what remains: report and remove
    if (ext0) {
      for (const k of kids(ext0).filter(k => inNs(k, CAMUNDA_NS))) {
        const n = local(k);
        if (!['in', 'out', 'inputOutput', 'properties'].includes(n)) {
          issue(n === 'executionListener' || n === 'taskListener' ? 'Listener' : 'Erweiterung',
            n === 'executionListener' || n === 'taskListener'
              ? `camunda:${n} entfernt — in ${C8_LABEL} als Job-Worker-Listener oder Output-Mapping umsetzen.`
              : `camunda:${n} entfernt — hat in ${C8_LABEL} kein Gegenstück.`);
        }
        removeEl(k);
      }
    }
    for (const a of Array.from(el.attributes)) {
      if (a.namespaceURI !== CAMUNDA_NS) continue;
      const n = a.localName;
      const handled = ['type', 'topic', 'class', 'delegateExpression', 'expression', 'decisionRef', 'resultVariable',
        'assignee', 'candidateGroups', 'candidateUsers', 'dueDate', 'followUpDate', 'formKey', 'collection',
        'elementVariable', 'versionTag', ...TEMPLATE_ATTRS];
      if (!handled.includes(n) && !C7_ONLY.has(n)) issue('Erweiterung', `camunda:${n}="${a.value}" entfernt — hat in ${C8_LABEL} kein Gegenstück.`);
      el.removeAttributeNode(a);
    }
    if (name === 'scriptTask') issue('Skript', `Skript-Aufgabe — in ${C8_LABEL} als FEEL (zeebe:script) oder Job-Worker umsetzen.`);

    if (add.length) {
      const ext = extOf(ctx, el);
      fill(ext, add);
    }
    touched.push(el);
  }

  for (const [parent, children] of ctx.later) fill(parent, children);
  for (const el of touched) dropEmptyExt(el);
  if (setEvents.length) {
    // once for all events: the assigned ids and the diagram
    const ids = new Set(descendants(defs).map(e => e.getAttribute('id')).filter(Boolean));
    const uniqueId = (base: string) => { let n = base; for (let i = 2; ids.has(n); i++) n = `${base}_${i}`; ids.add(n); return n; };
    const di = diagramOf(defs);
    // the take listeners first: so their event comes after the one of an end listener at the source
    // (Camunda 7: first end, then take, then start at the target)
    const ordered = [...setEvents.filter(e => e.place === 'on'), ...setEvents.filter(e => e.place !== 'on')];
    for (const e of ordered) insertSetEvent(ctx, e, uniqueId, di);
  }
}

// ── Camunda 8 → Camunda 7 ────────────────────────────────────────────────────
function toC7(defs: Element, ctx: Ctx, opts: { timeToLive?: string }) {
  const setC = (el: Element, name: string, value: string | undefined) => {
    if (value !== undefined && value !== '') el.setAttributeNS(CAMUNDA_NS, `camunda:${name}`, value);
  };
  const camunda = (name: string, attrs: Record<string, string | undefined> = {}) => create(ctx, CAMUNDA_NS, 'camunda', name, attrs);
  const touched: Element[] = [];

  for (const el of descendants(defs)) {
    if (inNs(el, CAMUNDA_NS) || inNs(el, ZEEBE_NS)) continue;
    const name = local(el);
    const issue = issueAt(ctx, el);
    const ext = firstNamed(el, 'extensionElements');
    const z = (n: string) => (ext ? firstNamed(ext, n, ZEEBE_NS) : null);
    const add: Element[] = [];

    // ── Job type → external task (for message events on the event definition)
    const task = z('taskDefinition');
    if (task) {
      const type = toJuel(task.getAttribute('type') ?? '', 'Job-Typ', issue);
      const med = firstNamed(el, 'messageEventDefinition');
      const holder = ['intermediateThrowEvent', 'endEvent'].includes(name) && med ? med : el;
      setC(holder, 'type', 'external');
      setC(holder, 'topic', type);
    }

    // ── Subprocess
    const called = z('calledElement');
    const ioM = z('ioMapping');
    const io = ioM ? kids(ioM) : [];
    if (name === 'callActivity') {
      if (called) {
        const pid = called.getAttribute('processId') ?? '';
        el.setAttribute('calledElement', pid.startsWith('=') ? toJuel(pid, 'Aufgerufener Prozess', issue) : pid);
        // Default in Camunda 8: both «true»
        if (called.getAttribute('propagateAllParentVariables') !== 'false') add.push(camunda('in', { variables: 'all' }));
        if (called.getAttribute('propagateAllChildVariables') !== 'false') add.push(camunda('out', { variables: 'all' }));
      }
      // The business key always goes to the subprocess — Camunda 7 has `camunda:in businessKey` for that
      add.push(camunda('in', { businessKey: '#{execution.processBusinessKey}' }));
      for (const p of io) {
        const tag = local(p) === 'input' ? 'in' : 'out';
        const target = p.getAttribute('target') ?? '';
        if (tag === 'in' && target === 'businessKey') continue;
        const source = p.getAttribute('source') ?? '';
        const where = `${tag === 'in' ? 'Eingabe' : 'Ausgabe'} «${target}»`;
        const plain = plainVar(source);
        add.push(plain
          ? camunda(tag, { source: plain, target })
          : camunda(tag, { sourceExpression: source.trim().startsWith('=') ? toJuel(source, where, issue) : source, target }));
      }
    } else if (io.length && EVENTS.has(name) && io.every(p => local(p) === 'output')) {
      // Camunda 7 knows no output mapping on events — there a
      // listener sets the variable (the pattern it came from in Camunda 8)
      for (const p of io) {
        const target = p.getAttribute('target') ?? '';
        const juel = toJuel(p.getAttribute('source') ?? '', `Ausgabe «${target}»`, issue);
        const value = /^\$\{([\s\S]*)\}$/.exec(juel)?.[1] ?? JSON.stringify(juel);
        add.push(camunda('executionListener', { expression: `\${execution.setVariable(${JSON.stringify(target)}, ${value})}`, event: 'start' }));
      }
    } else if (io.length) {
      const cio = camunda('inputOutput');
      const params = io.map(p => {
        const tag = local(p) === 'input' ? 'inputParameter' : 'outputParameter';
        const target = p.getAttribute('target') ?? '';
        const e = camunda(tag, { name: target });
        if (tag === 'inputParameter' && ERROR_LISTS.has(target)) {
          e.textContent = errorListSource(parseErrorList(p.getAttribute('source') ?? ''), 'c7', (x, why) => issue(`Eingabe «${target}»`, `«${x}» ist nicht nach JUEL übersetzbar (${why}) — von Hand anpassen.`));
          return e;
        }
        e.textContent = toJuelValue(p.getAttribute('source') ?? '', `${tag === 'inputParameter' ? 'Eingabe' : 'Ausgabe'} «${target}»`, issue);
        return e;
      });
      ctx.later.push([cio, params]);
      add.push(cio);
    }

    // ── DMN
    const dec = z('calledDecision');
    if (dec) {
      setC(el, 'decisionRef', dec.getAttribute('decisionId') ?? '');
      setC(el, 'resultVariable', dec.getAttribute('resultVariable') ?? '');
      issue('Entscheidung', `Ergebnisform prüfen: ${C7_LABEL} liefert per Vorgabe eine Liste (mapDecisionResult).`);
    }

    // ── User task
    const assign = z('assignmentDefinition');
    if (assign) {
      setC(el, 'assignee', toJuelAttr(assign.getAttribute('assignee'), 'Zuständig', issue));
      setC(el, 'candidateGroups', toJuelAttr(assign.getAttribute('candidateGroups'), 'Gruppen', issue));
      setC(el, 'candidateUsers', toJuelAttr(assign.getAttribute('candidateUsers'), 'Benutzer', issue));
    }
    const sched = z('taskSchedule');
    if (sched) {
      setC(el, 'dueDate', toJuelAttr(sched.getAttribute('dueDate'), 'Fälligkeit', issue));
      setC(el, 'followUpDate', toJuelAttr(sched.getAttribute('followUpDate'), 'Wiedervorlage', issue));
    }
    const form = z('formDefinition');
    if (form) {
      const key = form.getAttribute('externalReference') ?? form.getAttribute('formKey') ?? form.getAttribute('formId');
      if (key) setC(el, 'formKey', key);
      issue('Formular', `Formular «${key ?? ''}» — in ${C7_LABEL} als formKey prüfen.`);
    }

    // ── Multi-instance
    if (name === 'multiInstanceLoopCharacteristics') {
      const lc = z('loopCharacteristics');
      if (lc) {
        const coll = lc.getAttribute('inputCollection');
        if (coll) setC(el, 'collection', coll.trim().startsWith('=') ? toJuel(coll, 'Sammlung', issue) : coll);
        setC(el, 'elementVariable', lc.getAttribute('inputElement') ?? '');
        if (lc.getAttribute('outputCollection')) issue('Mehrfachausführung', `outputCollection/outputElement gibt es in ${C7_LABEL} nicht — Ergebnisse von Hand sammeln.`);
      }
      const cc = firstNamed(el, 'completionCondition');
      if (cc) cc.textContent = toJuel(cc.textContent ?? '', 'Abschlussbedingung', issue);
    }

    // ── Conditions and timers
    // Camunda 7 does not need the wrapper `(…) = true` — there `null` is `false` anyway
    if (name === 'conditionExpression') el.textContent = toJuel(stripNullSafe(el.textContent ?? '').replace(/^= /, '='), 'Bedingung', issue);
    if (['timeDuration', 'timeDate', 'timeCycle'].includes(name)) el.textContent = toJuel(el.textContent ?? '', 'Timer', issue);
    if (name === 'message' || name === 'signal') {
      const n = el.getAttribute('name');
      if (n?.startsWith('=')) el.setAttribute('name', toJuel(n, name === 'signal' ? 'Signalname' : 'Nachrichtenname', issue));
    }

    // ── Process
    if (name === 'process') {
      const tag = z('versionTag');
      if (tag) setC(el, 'versionTag', tag.getAttribute('value') ?? '');
      if (!el.getAttributeNS(CAMUNDA_NS, 'historyTimeToLive')) {
        if (opts.timeToLive) setC(el, 'historyTimeToLive', opts.timeToLive);
        else issue('Prozess', `${C7_LABEL} verlangt historyTimeToLive — in der Spezifikation setzen.`);
      }
    }

    // ── Properties
    const zp = z('properties');
    if (zp) {
      const cp = camunda('properties');
      ctx.later.push([cp, kids(zp).map(p => camunda('property', { name: p.getAttribute('name') ?? '', value: p.getAttribute('value') ?? '' }))]);
      add.push(cp);
    }

    // ── what remains: report and remove
    if (ext) {
      const handled = ['taskDefinition', 'calledElement', 'ioMapping', 'calledDecision', 'assignmentDefinition',
        'taskSchedule', 'formDefinition', 'loopCharacteristics', 'versionTag', 'properties', 'userTask', 'subscription'];
      for (const k of kids(ext).filter(k => inNs(k, ZEEBE_NS))) {
        const n = local(k);
        if (!handled.includes(n)) {
          issue(n.endsWith('Listeners') ? 'Listener' : 'Erweiterung', n.endsWith('Listeners')
            ? `zeebe:${n} entfernt — in ${C7_LABEL} als camunda:${n.replace(/s$/, '')} umsetzen.`
            : `zeebe:${n} entfernt — hat in ${C7_LABEL} kein Gegenstück.`);
        }
        removeEl(k);
      }
    }
    for (const a of Array.from(el.attributes)) {
      if (a.namespaceURI !== ZEEBE_NS) continue;
      if (TEMPLATE_ATTRS.includes(a.localName)) setC(el, a.localName, a.value);
      el.removeAttributeNode(a);
    }

    if (add.length) fill(extOf(ctx, el), add);
    touched.push(el);
  }

  for (const [parent, children] of ctx.later) fill(parent, children);
  for (const el of touched) dropEmptyExt(el);
}

/** Reference to the element template — the same in both engines, just in the other namespace */
const TEMPLATE_ATTRS = ['modelerTemplate', 'modelerTemplateVersion', 'modelerTemplateIcon'];

/** Events on which Camunda 7 knows no output mapping — there a listener sets it */
const EVENTS = new Set(['startEvent', 'endEvent', 'boundaryEvent']);

// ── Listener → none throw event ──────────────────────────────────────────────
//
// An output mapping applies when the element completes: on a none/link
// event immediately, on others only once they are done — but the listener set the
// variable on entry. On gateways and end events with a definition
// Zeebe accepts it and ignores it (verified on the cluster: event-based gateway, error
// end event). And a first output mapping on a task would take away its
// other results (only the mapped ones go into the process). There
// a none throw event before or after it sets the variable — visible in the diagram.

/** `on`: on the flow itself (a take listener on a sequence flow) */
type Placement = 'here' | 'before' | 'after' | 'on';

/** where an own event sets the variable */
type EventPlacement = Exclude<Placement, 'here'>;

/** `listeners`: the Camunda 7 listeners, as text — if one remains without an event, it stays as a comment on the element */
interface SetEvent { el: Element; place: EventPlacement; outputs: Element[]; listeners: string[] }

const listenerText = (l: Element) => `camunda:executionListener event="${l.getAttribute('event') ?? 'start'}" expression="${l.getAttribute('expression') ?? ''}"`;

/** What was not taken over stays as a comment on the element — for manual work */
function keepAsComment(el: Element, listeners: string[], flows: string[] = []) {
  const where = flows.length ? ` auf ${flows.map(f => `«${f}»`).join(', ')}` : '';
  for (const text of listeners) {
    // `--` must not appear in an XML comment
    prependEl(el, el.ownerDocument.createComment(` ${C7_LABEL}, nicht übernommen${where}: ${text.replace(/--/g, '- -')} `) as unknown as Element);
  }
}

/** how the event got into the diagram */
type Drawn = 'ok' | 'tight' | 'short' | 'none';

/** Intermediate events — without a definition or as a link they complete as soon as they occur */
const INTERMEDIATE_EVENTS = new Set(['intermediateThrowEvent', 'intermediateCatchEvent']);

function placementOf(el: Element, event: string, hasOutputs: boolean): Placement | null {
  const name = local(el);
  if (name === 'sequenceFlow') return event === 'take' ? 'on' : null;
  if (event !== 'start' && event !== 'end') return null;
  const definitions = kids(el).map(local).filter(n => n.endsWith('EventDefinition'));
  if (name === 'startEvent' || name === 'boundaryEvent') return 'here';
  if (name === 'endEvent' && !definitions.length) return 'here';
  if (INTERMEDIATE_EVENTS.has(name) && definitions.every(d => d === 'linkEventDefinition')) return 'here';
  if (name === 'endEvent' || event === 'start') return 'before';
  // a parallel fork branches immediately: one event before it instead of one per branch (simultaneous)
  if (name === 'parallelGateway' && incomingOf(el).length === 1) return 'before';
  // a gateway never has an effective output mapping, not even with outputs
  if (name.endsWith('Gateway')) return 'after';
  return hasOutputs ? 'here' : 'after';
}

const incomingOf = (el: Element) => (el.parentElement ? kids(el.parentElement) : [])
  .filter(k => local(k) === 'sequenceFlow' && k.getAttribute('targetRef') === el.getAttribute('id'));

function setEventReason(el: Element, place: EventPlacement): string {
  const name = local(el);
  if (place === 'on') return 'der take-Listener lief beim Durchlaufen des Flusses';
  if (name.endsWith('Gateway') || name === 'endEvent') return `ein Output-Mapping am ${name} ignoriert ${C8_LABEL}`;
  return place === 'before'
    ? 'ein Output-Mapping griffe erst beim Abschluss, der Listener setzte die Variable beim Betreten'
    : 'ein erstes Output-Mapping nähme dem Element seine übrigen Ergebnisse';
}

/** A none throw event with the output mappings on every flow before or after it —
 *  one per flow, so a join gateway keeps waiting for all branches. */
function insertSetEvent(ctx: Ctx, { el, place, outputs, listeners }: SetEvent, uniqueId: (base: string) => string, di: Diagram | null) {
  const id = el.getAttribute('id') ?? '';
  const parent = el.parentElement;
  const issue = issueAt(ctx, el);
  const names = outputs.map(o => o.getAttribute('target')).join(', ');
  const side = place === 'before' ? 'davor' : place === 'after' ? 'danach' : 'auf dem Fluss';
  const flowsOf = (p: Element) => place === 'on' ? [el]
    : kids(p).filter(k => local(k) === 'sequenceFlow' && k.getAttribute(place === 'before' ? 'targetRef' : 'sourceRef') === id);
  const flows = parent ? flowsOf(parent) : [];
  if (!parent || !flows.length) {
    issue('Listener', `setVariable «${names}» NICHT übernommen — ${setEventReason(el, place)}, und es gibt keinen Fluss ${side}: von Hand umsetzen.`);
    keepAsComment(el, listeners);
    return;
  }
  const sourceOf = (flow: Element) => kids(parent).find(k => k.getAttribute('id') === flow.getAttribute('sourceRef'));
  // what behaves differently from the listener — say it in the dialog
  const hints = [
    // a listener per instance becomes one event for the whole multi-instance
    firstNamed(el, 'multiInstanceLoopCharacteristics') ? 'Mehrfachausführung: das Event läuft einmal, der Listener lief je Instanz — prüfen.' : '',
    flows.length > 1 ? `Ein Event je Fluss: die Variable wird bis zu ${flows.length}-mal gesetzt${
      // more than one flow without a condition (except at the exclusive gateway): they run in parallel
      place === 'after' && local(el) !== 'exclusiveGateway' && flows.filter(f => !firstNamed(f, 'conditionExpression')).length > 1
        ? ', auf parallelen Zweigen gleichzeitig' : ''
    } — bei einem nicht festen Wert (Zähler, Zeit) prüfen.` : '',
  ].filter(Boolean).map(h => ` ${h}`).join('');
  // a separate message: on this path the variable is missing
  const interrupted = place === 'after' ? interruptedBy(parent, id) : '';
  if (interrupted) issue('Listener', `setVariable «${names}» fehlt bei ${interrupted}`);
  let first = true;
  const skipped: string[] = [];
  for (const flow of flows) {
    const source = sourceOf(flow);
    if (!source) {
      issue('Listener', `setVariable «${names}» NICHT übernommen auf «${flow.getAttribute('id')}» — die Quelle des Flusses fehlt: von Hand umsetzen.`);
      skipped.push(flow.getAttribute('id') ?? '');
      continue;
    }
    if (local(source) === 'eventBasedGateway') {
      // after an event-based gateway only a catch event may follow
      issue('Listener', `setVariable «${names}» NICHT übernommen auf «${flow.getAttribute('id')}» — nach einem Event-Based Gateway darf nur ein Catch-Event stehen: von Hand umsetzen (z. B. als Output-Mapping am Catch-Event).`);
      skipped.push(flow.getAttribute('id') ?? '');
      continue;
    }
    const evId = uniqueId(`${id}_Set${place === 'before' ? 'Before' : place === 'after' ? 'After' : ''}`);
    const nfId = uniqueId(`${evId}_Flow`);
    insertOnFlow(ctx, parent, flow, evId, nfId, `set ${names}`, first ? outputs : outputs.map(o => o.cloneNode(true) as Element));
    first = false;
    const drawn: Drawn = di?.place(evId, nfId, flow.getAttribute('id') ?? '', place === 'before', uniqueId) ?? 'none';
    issue('Listener', `setVariable «${names}» — None-Throw-Event «set ${names}» ${side} eingefügt: ${setEventReason(el, place)}.${hints} ${DRAWN_TEXT[drawn]}`);
  }
  // all skipped: the listener is not taken over, otherwise only on these flows
  if (skipped.length) keepAsComment(el, listeners, skipped.length < flows.length ? skipped : []);
}

const DRAWN_TEXT: Record<Drawn, string> = {
  ok: 'Lage im Diagramm prüfen.',
  tight: 'Lage im Diagramm prüfen (wenig Platz auf dem Fluss).',
  short: 'Ohne Diagramm-Eintrag (zu wenig Platz auf dem Fluss) — im Modeler einzeichnen.',
  none: 'Ohne Diagramm-Eintrag (dem Fluss fehlt die Kante) — im Modeler einzeichnen.',
};

/** An interrupting boundary event (also an error): then the end listener ran too, the event after it did not */
function interruptedBy(parent: Element, id: string): string {
  const boundaries = kids(parent).filter(k => local(k) === 'boundaryEvent' && k.getAttribute('attachedToRef') === id
    && k.getAttribute('cancelActivity') !== 'false');
  return boundaries.length
    ? `Abbruch oder Fehler über ${boundaries.map(b => `«${b.getAttribute('name') || b.getAttribute('id')}»`).join(', ')}: dort lief der Listener auch, das Event nicht — dort ergänzen.`
    : '';
}

/** Put the event on the flow: the flow (with its condition) ends at the
 *  event, a new one leads to the previous target. */
function insertOnFlow(ctx: Ctx, parent: Element, flow: Element, evId: string, nfId: string, name: string, outputs: Element[]) {
  const ref = (tag: 'incoming' | 'outgoing', text: string) => { const r = ctx.bpmnEl(tag); r.textContent = text; return r; };
  const flowId = flow.getAttribute('id') ?? '';
  const targetId = flow.getAttribute('targetRef') ?? '';
  const target = kids(parent).find(k => k.getAttribute('id') === targetId);
  const ev = ctx.bpmnEl('intermediateThrowEvent');
  ev.setAttribute('id', evId);
  ev.setAttribute('name', name);
  const nf = ctx.bpmnEl('sequenceFlow');
  nf.setAttribute('id', nfId);
  nf.setAttribute('sourceRef', evId);
  nf.setAttribute('targetRef', targetId);
  flow.setAttribute('targetRef', evId);
  const old = target && kids(target).find(k => local(k) === 'incoming' && k.textContent?.trim() === flowId);
  if (old) removeEl(old);
  if (target) appendEl(target, ref('incoming', nfId));
  appendEl(parent, ev);
  appendEl(parent, nf);
  const ext = ctx.bpmnEl('extensionElements');
  appendEl(ev, ext);
  const io = create(ctx, ZEEBE_NS, 'zeebe', 'ioMapping');
  appendEl(ext, io);
  fill(io, outputs);
  appendEl(ev, ref('incoming', flowId));
  appendEl(ev, ref('outgoing', nfId));
}

interface Point { x: number; y: number }

/** Size of an event in the diagram (width = height) — and the room from which on it is not cramped */
const EVENT_SIZE = 36;
const EVENT_ROOM = EVENT_SIZE + 20;

type Diagram = NonNullable<ReturnType<typeof diagramOf>>;

/** The diagram: shape and edge for the inserted event — on the last segment
 *  of the flow before it or the first of the flow after it */
function diagramOf(defs: Element) {
  const all = descendants(defs);
  const edges = all.filter(e => local(e) === 'BPMNEdge');
  const shape0 = all.find(e => local(e) === 'BPMNShape');
  const bounds0 = shape0 ? firstNamed(shape0, 'Bounds') : null;
  const wp0 = edges.map(e => firstNamed(e, 'waypoint')).find(Boolean);
  if (!shape0 || !bounds0 || !wp0) return null;
  const doc = defs.ownerDocument;
  const make = (like: Element, name: string, attrs: Record<string, string | number>) => {
    const prefix = like.prefix ?? (like.tagName.includes(':') ? like.tagName.split(':')[0] : '');
    const e = doc.createElementNS(like.namespaceURI, prefix ? `${prefix}:${name}` : name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const pointsOf = (edge: Element): Point[] =>
    // parseFloat: a missing value is NaN (Number(null) would be 0)
    kids(edge).filter(k => local(k) === 'waypoint').map(w => ({ x: parseFloat(w.getAttribute('x') ?? ''), y: parseFloat(w.getAttribute('y') ?? '') }));
  const setPoints = (edge: Element, points: Point[]) => {
    // the waypoints before the label — that is what the schema wants (waypoint*, BPMNLabel?)
    const rest = kids(edge).filter(k => local(k) !== 'waypoint');
    for (const k of kids(edge)) removeEl(k);
    for (const p of points) appendEl(edge, make(wp0, 'waypoint', { x: Math.round(p.x), y: Math.round(p.y) }));
    for (const k of rest) appendEl(edge, k);
  };
  return {
    /** `none`: no (usable) edge, `short`: the segment is shorter than the event —
     *  both without a diagram entry; `tight`: hardly any room next to the event */
    place(evId: string, nfId: string, flowId: string, atEnd: boolean, uniqueId: (base: string) => string): Drawn {
      const flowEdge = edges.find(e => e.getAttribute('bpmnElement') === flowId);
      const points = flowEdge ? pointsOf(flowEdge) : [];
      const plane = flowEdge?.parentElement;
      if (!flowEdge || !plane || points.length < 2) return 'none';
      const at = atEnd ? points.length - 2 : 0;
      const [a, b] = [points[at], points[at + 1]];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // a waypoint without a coordinate: draw nothing instead of NaN
      if (!Number.isFinite(len)) return 'none';
      // shorter than the event: the shortened edges would run backwards
      if (len < EVENT_SIZE) return 'short';
      const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const shape = make(shape0, 'BPMNShape', { id: uniqueId(`${evId}_di`), bpmnElement: evId });
      appendEl(plane, shape);
      const r = EVENT_SIZE / 2;
      appendEl(shape, make(bounds0, 'Bounds', { x: Math.round(c.x - r), y: Math.round(c.y - r), width: EVENT_SIZE, height: EVENT_SIZE }));
      const edge = make(flowEdge, 'BPMNEdge', { id: uniqueId(`${nfId}_di`), bpmnElement: nfId });
      appendEl(plane, edge);
      edges.push(edge); // another event can land on the new flow
      // the edge of the flow ends at the event, the new one continues on the old path
      setPoints(flowEdge, [...points.slice(0, at + 1), { x: c.x - d.x * r, y: c.y - d.y * r }]);
      setPoints(edge, [{ x: c.x + d.x * r, y: c.y + d.y * r }, ...points.slice(at + 1)]);
      return len < EVENT_ROOM ? 'tight' : 'ok';
    },
  };
}

/** A parameter with a script, list or map — does not become a zeebe:input/output */
const complexParam = (p: Element): Element | undefined => kids(p).find(k => ['script', 'list', 'map'].includes(local(k)));

/** `${execution.setVariable("x", v)}` → { name: x, value: v } */
function setVariableOf(expression: string): { name: string; value: string } | null {
  const m = /^[$#]\{\s*execution\.setVariable\(\s*(["'])([^"']+)\1\s*,\s*([\s\S]+?)\s*\)\s*\}$/.exec(expression.trim());
  return m ? { name: m[2], value: m[3] } : null;
}

function toJuelAttr(v: string | null, where: string, issue: Issue): string | undefined {
  if (!v) return undefined;
  return v.trim().startsWith('=') ? toJuel(v, where, issue) : v;
}
