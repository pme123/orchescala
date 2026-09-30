// Spezifikation → BPMN: Mappings und Bedingungen ins Diagramm schreiben.
//
// Die Mappings leben in der Spezifikation (als FEEL), das Diagramm kennt sie
// erst beim **Export**. Dann schreibt die App sie in die Form der Engine:
//
//   Camunda 8   <zeebe:ioMapping>
//                 <zeebe:input  source="=client.name" target="name" />
//                 <zeebe:output source="=accountId"   target="accountId" />
//   Camunda 7   <camunda:inputOutput>
//                 <camunda:inputParameter name="name">${client.name}</camunda:inputParameter>
//               bzw. am Teilprozess <camunda:in source="client.name" target="name" />
//
// Bedingungen an Zweigen ebenso: `= amount > 3` wird zu `=amount > 3` bzw.
// `${amount > 3}`. FEEL, das kein JUEL-Gegenstück hat, bleibt im Text stehen
// und wird gemeldet — lieber sichtbar falsch als still verloren.
//
// Nur Schritte, die in der Spezifikation Mapping-Zeilen haben, werden
// angefasst; abgewählte Zeilen kommen nicht ins BPMN. Steuerparameter
// (`_handledErrors`, `_outputMock` …) bleiben, wie sie im Diagramm stehen.

import type { EngineId, Mapping, ProcessSpec, Step } from './types';
import { TECHNICAL, allSteps, feelString, isInitWorker, isServiceWorker, mockField, paramExpression } from './bpmn';
import { referencedVariables } from './feel';
import { engineExpression, feelBody, feelToJuel } from './feelJuel';
import { importExpression } from './juelFeel';
import { appendEl, prependEl, removeEl } from './xmlFormat';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export interface WriteIssue {
  stepId: string;
  /** wo: `Eingabe name`, `Ausgabe name`, `Zweig label` */
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

/** Skript, Liste oder Map — Werte, die die Spezifikation nur beschreibt, nicht schreibt */
const isComplex = (p: Element): boolean => !!(firstNamed(p, 'script') || firstNamed(p, 'list') || firstNamed(p, 'map'));
/** Ein Mapping-Wert, der ein Skript beschreibt (`«groovy» …`) — bleibt, wie er im BPMN steht */
const isScript = (m: Mapping): boolean => m.expression.trimStart().startsWith('«');
/**
 * Steht die Zeile unverändert im BPMN? Dann bleibt das Element wörtlich —
 * mit `#{…}`, Spin-Aufrufen (`.prop("x").value()`) oder Skript, die der Weg
 * über FEEL nicht eins zu eins zurückbringt. Nur was jemand geändert hat,
 * wird neu geschrieben.
 */
const unchanged = (p: Element, m: Mapping): boolean => paramExpression(p).trim() === m.expression.trim();

/**
 * Mappings und Bedingungen der Spezifikation ins BPMN schreiben. Das XML
 * bleibt sonst unverändert (Layout, IDs, alles andere).
 */
export function writeBpmn(xml: string, spec: ProcessSpec): WriteResult {
  const issues: WriteIssue[] = [];
  const engine: EngineId = spec.engine ?? 'c7';
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const defs = doc.documentElement;
  if (!defs || local(defs) !== 'definitions' || doc.getElementsByTagName('parsererror').length) {
    return { xml, issues: [{ stepId: '', where: 'BPMN', text: 'Das Diagramm ist kein lesbares BPMN — nichts geschrieben.' }] };
  }
  const prefix = defs.prefix ? `${defs.prefix}:` : '';
  const bpmnEl = (name: string) => doc.createElementNS(BPMN_NS, `${prefix}${name}`);

  // Namensräume der Engine sicherstellen — als echte Deklaration, sonst
  // wiederholt der Serializer sie an jedem neuen Element
  const declare = (prefix: string, uri: string) => {
    if (!defs.hasAttribute(`xmlns:${prefix}`)) defs.setAttributeNS(XMLNS_NS, `xmlns:${prefix}`, uri);
  };
  if (engine === 'c8') declare('zeebe', ZEEBE_NS);
  if (engine === 'c7') declare('camunda', CAMUNDA_NS);
  declare('xsi', XSI_NS);

  // alle Elemente mit ID
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

  for (const step of allSteps(spec.steps)) {
    const hasRows = (step.inputs?.length ?? 0) + (step.outputs?.length ?? 0) > 0;
    const el = byId.get(step.id);
    if (hasRows && !el) {
      if (active(step.inputs).length || active(step.outputs).length) {
        issues.push({ stepId: step.id, where: 'Schritt', text: 'steht nicht im Diagramm — Mappings nicht geschrieben.' });
      }
      continue;
    }
    if (el && hasRows) {
      const ext = ensureExt(el);
      const ins = active(step.inputs), outs = active(step.outputs);
      if (engine === 'c8') writeZeebe(doc, ext, ins, outs, step.id, issues);
      else if (local(el) === 'callActivity') writeCamundaInOut(doc, ext, ins, outs, step.id, issues);
      else writeCamundaIo(doc, ext, ins, outs, step.id, issues);
    }

    if (el) writeImplementation(doc, el, ensureExt, engine, step, spec.processId, issues);

    // Service: die Ausgaben werden von Hand gemappt, und der Worker weiss, welche Variablen es braucht
    if (el && step.kind === 'service') {
      const vars: string[] = [];
      for (const m of active(step.outputs)) {
        for (const v of referencedVariables(importExpression(m.expression))) if (!vars.includes(v)) vars.push(v);
      }
      // ohne Variablen: `NONE`, und die Ausgaben gehen nicht von Hand
      const list = vars.length ? vars.join(', ') : 'NONE';
      setControl(doc, ensureExt(el), engine, '_manualOutMapping', !vars.length ? undefined : engine === 'c8' ? '=true' : '#{true}');
      setControl(doc, ensureExt(el), engine, '_outputVariables', engine === 'c8' ? `=${feelString(list)}` : list);
    }

    // Mocks: der gewählte `_output…Mock` zeigt aufs Feld im InConfig. Die
    // Mock-Steuerung des Prozesses geht immer mit — das Feld kann leer sein
    if (el && (step.kind === 'service' || step.kind === 'call') && !isInitWorker(step, spec.processId)) {
      const ext = ensureExt(el);
      const call = step.kind === 'call';
      const kind = step.mockKind === 'service' && !isServiceWorker(step) ? undefined : step.mockKind;
      const pass = (name: string) => (engine === 'c8' ? `=${name}` : `#{execution.getVariable('${name}')}`);
      setControl(doc, ext, engine, '_outputMock', kind === 'output' ? pass(mockField(step.name)) : undefined, call);
      setControl(doc, ext, engine, '_outputServiceMock', kind === 'service' ? pass(mockField(step.name)) : undefined, call);
      setControl(doc, ext, engine, '_servicesMocked', pass('_servicesMocked'), call);
      setControl(doc, ext, engine, '_mockedWorkers', call ? pass('_mockedWorkers') : undefined, call);
      // wer den Prozess gestartet hat — der Teilprozess prüft dieselbe Identität
      setControl(doc, ext, engine, '_identityCorrelation', call ? pass('_identityCorrelation') : undefined, call);
    }

    // Bedingungen an den Zweigen — nur FEEL; ein alter JUEL-Text bleibt, wie er ist
    for (const b of step.branches ?? []) {
      if (b.isDefault || !b.condition) continue;
      const body = feelBody(b.condition);
      if (body == null) continue;
      const flow = byId.get(b.id);
      if (!flow || local(flow) !== 'sequenceFlow') continue;
      // unverändert seit dem Import → der alte Text bleibt wörtlich
      const before = firstNamed(flow, 'conditionExpression');
      if (before && importExpression(before.textContent ?? '').trim() === b.condition.trim()) continue;
      let text: string;
      if (engine === 'c8') text = `=${body}`;
      else {
        const r = feelToJuel(body);
        if (r.ok) text = `\${${r.juel}}`;
        else {
          text = b.condition;
          issues.push({ stepId: step.id, where: `Zweig «${b.label}»`, text: `nicht nach JUEL übersetzbar: ${r.reason}` });
        }
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

  // Der Business Key geht an jeden Teilprozess — auch ohne Mapping-Zeilen
  for (const el of byId.values()) {
    if (local(el) === 'callActivity') ensureBusinessKey(doc, ensureExt(el), engine);
  }

  // Die Steuerparameter (`_…`) stehen immer am Schluss — Eingaben bleiben vor Ausgaben
  for (const el of byId.values()) {
    const ext = firstNamed(el, 'extensionElements');
    if (ext) controlsLast(ext);
  }

  let out = new XMLSerializer().serializeToString(doc);
  // Die XML-Deklaration soll bleiben — und auf einer eigenen Zeile stehen
  const decl = /^<\?xml[^>]*\?>/.exec(xml)?.[0];
  if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
  out = out.replace(/^(<\?xml[^>]*\?>)(?!\n)/, '$1\n');
  return { xml: out, issues };
}

// ── Implementierung ──────────────────────────────────────────────────────────
/**
 * Topic bzw. gerufener Prozess — so, wie die Spezifikation sie kennt (wählt man
 * den Service, übernimmt der Schritt beides aus dem Katalog). Ein Task, der
 * erst in Orch Spec angelegt oder zum Service gemacht wurde, hätte sie sonst
 * nirgends im Diagramm, und die Engine wüsste nicht, was sie ausführen soll.
 *
 *   Camunda 7   camunda:type="external" camunda:topic="…"   bzw.  calledElement="…"
 *   Camunda 8   <zeebe:taskDefinition type="…" />           bzw.  <zeebe:calledElement processId="…" />
 *
 * Fehlt sie auch im Diagramm, wird das gemeldet.
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

  if (local(el) === 'serviceTask') {
    // der Init-Worker der Vorlage hört auf die Prozess-ID (Orchescala-Konvention)
    const topic = step.topic?.trim() || (el.getAttribute('id') === 'InitProcessTask' ? processId?.trim() : undefined);
    if (engine === 'c8') {
      if (topic) zeebeOrNew('taskDefinition').setAttribute('type', topic);
      else if (!zeebe('taskDefinition')?.getAttribute('type')) missing('Service Task ohne Job-Typ — im Schritt einen Service wählen.');
      return;
    }
    // eine andere Implementierung (Java-Klasse, Ausdruck) bleibt, wie sie ist
    if (['class', 'expression', 'delegateExpression'].some(a => attr(el, a))) return;
    if (topic) {
      el.setAttributeNS(CAMUNDA_NS, 'camunda:type', 'external');
      el.setAttributeNS(CAMUNDA_NS, 'camunda:topic', topic);
    } else if (!attr(el, 'topic')) missing('Service Task ohne Topic — im Schritt einen Service wählen.');
  }

  if (local(el) === 'callActivity') {
    const called = step.calledProcess?.trim();
    if (engine === 'c8') {
      // Orchescala: die Variablen des Teilprozesses kommen über die Ausgaben zurück, nicht alle
      if (called) zeebeOrNew('calledElement', { propagateAllChildVariables: 'false' }).setAttribute('processId', called);
      else if (!zeebe('calledElement')?.getAttribute('processId')) missing('Teilprozess ohne gerufenen Prozess — im Schritt einen Service wählen.');
      return;
    }
    if (called) el.setAttribute('calledElement', called);
    else if (!el.getAttribute('calledElement')) missing('Teilprozess ohne gerufenen Prozess — im Schritt einen Service wählen.');
  }
}

// ── Steuerparameter am Schritt ───────────────────────────────────────────────
/**
 * `_manualOutMapping` & Co. setzen (oder mit `undefined` entfernen) — Camunda 7
 * als lokale Variable bzw. am Teilprozess als `camunda:in`, Camunda 8 als Eingabe.
 */
function setControl(doc: Document, ext: Element, engine: EngineId, name: string, value: string | undefined, call = false) {
  if (engine === 'c7' && call) {
    for (const p of kids(ext)) if (local(p) === 'in' && attr(p, 'target') === name) removeEl(p);
    if (value === undefined) return;
    const p = doc.createElementNS(CAMUNDA_NS, 'camunda:in');
    p.setAttribute('sourceExpression', value);
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

/** Reihenfolge: fachliche Eingaben, `_…`-Eingaben, fachliche Ausgaben, `_…`-Ausgaben */
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
  // am Teilprozess (Camunda 7): `camunda:in` mit `_…` ans Ende
  const rest = kids(ext);
  const ins = rest.filter(p => local(p) === 'in' && isControl(p));
  const behind = ins.length && rest.slice(rest.indexOf(ins[0])).some(p => !ins.includes(p));
  if (behind) for (const p of ins) { removeEl(p); appendEl(ext, p); }
}

// ── Business Key an den Teilprozess ──────────────────────────────────────────
// Camunda 7 hat dafür `camunda:in businessKey`, in Camunda 8 ist der Business
// Key eine Variable und wird als Eingabe `businessKey` übergeben.
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
  // Steuerparameter aus dem alten Mapping behalten
  const keep = oldKids.filter(p => TECHNICAL.has(attr(p, 'target') ?? ''));
  if (old) removeEl(old);
  if (!ins.length && !outs.length && !keep.length) return;
  const io = doc.createElementNS(ZEEBE_NS, 'zeebe:ioMapping');
  const source = (m: Mapping, where: string): string => {
    const e = engineExpression(m.expression, 'c8');
    if (feelBody(m.expression) == null && /^[$#]\{/.test(m.expression.trim())) {
      issues.push({ stepId, where, text: `«${m.expression}» ist kein FEEL — Camunda 8 nimmt es als festen Text. Als «= …» schreiben.` });
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
  // die Kinder nachträglich einrücken — appendChild kennt keine Umbrüche
  const inner = kids(io);
  for (const p of inner) p.remove();
  for (const p of inner) appendEl(io, p);
}

// ── Camunda 7 ────────────────────────────────────────────────────────────────
/** FEEL → `${…}`; JUEL aus einem alten Import bleibt; nicht Übersetzbares wird gemeldet. */
function juelOf(m: Mapping, stepId: string, where: string, issues: WriteIssue[]): { text: string; plain?: string } {
  const body = feelBody(m.expression);
  if (body == null) return { text: m.expression };
  const r = feelToJuel(body);
  if (r.ok) return { text: `\${${r.juel}}`, ...(r.plain ? { plain: r.plain } : {}) };
  issues.push({ stepId, where, text: `nicht nach JUEL übersetzbar: ${r.reason} — FEEL steht unverändert im BPMN.` });
  return { text: m.expression };
}

function writeCamundaIo(doc: Document, ext: Element, ins: Mapping[], outs: Mapping[], stepId: string, issues: WriteIssue[]) {
  let io = firstNamed(ext, 'inputOutput');
  if (!io) {
    io = doc.createElementNS(CAMUNDA_NS, 'camunda:inputOutput');
    appendEl(ext, io);
  }
  // Steuerparameter bleiben, fachliche Zeilen werden ersetzt — ausser
  // Skripten, Listen und Maps: die beschreibt die Spezifikation nur
  // (`«groovy» …`), geschrieben werden sie nicht. Sie bleiben, solange
  // ihre Zeile noch da ist und den Wert nicht durch FEEL ersetzt hat.
  const keep = new Set<string>();
  for (const p of kids(io)) {
    const name = attr(p, 'name') ?? '';
    if (TECHNICAL.has(name)) continue;
    const tag = local(p) === 'inputParameter' ? 'in' : 'out';
    const row = (tag === 'in' ? ins : outs).find(m => m.name.trim() === name);
    if (row && !keep.has(`${tag}:${name}`) && (unchanged(p, row) || (isComplex(p) && (isScript(row) || feelBody(row.expression) == null)))) {
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
    p.textContent = juelOf(m, stepId, `Eingabe «${m.name}»`, issues).text;
    appendEl(io, p);
  }
  for (const m of outs) {
    if (keep.has(`out:${m.name.trim()}`) || scriptGone(m, `Ausgabe «${m.name}»`)) continue;
    const p = doc.createElementNS(CAMUNDA_NS, 'camunda:outputParameter');
    p.setAttribute('name', m.name.trim());
    p.textContent = juelOf(m, stepId, `Ausgabe «${m.name}»`, issues).text;
    appendEl(io, p);
  }
  if (!kids(io).length) removeEl(io);
}

function writeCamundaInOut(doc: Document, ext: Element, ins: Mapping[], outs: Mapping[], stepId: string, issues: WriteIssue[]) {
  // Ein Teilprozess kann neben `camunda:in/out` auch ein `inputOutput`
  // tragen — beides liest der Import als Mapping. Was dort steht, wird dort
  // gepflegt: Skripte bleiben, Text wird ersetzt; nur was es dort nicht
  // gibt, kommt als `camunda:in/out`.
  const io = firstNamed(ext, 'inputOutput');
  const ioParam = (tag: 'in' | 'out', name: string): Element | null =>
    io ? kids(io).find(p => local(p) === (tag === 'in' ? 'inputParameter' : 'outputParameter') && attr(p, 'name') === name) ?? null : null;
  // businessKey, `variables="all"` und Steuerparameter bleiben — und
  // Zeilen, die unverändert sind, wörtlich
  const kept = new Set<Mapping>();
  for (const p of kids(ext)) {
    const n = local(p);
    if (n !== 'in' && n !== 'out') continue;
    if (attr(p, 'businessKey') || attr(p, 'variables')) continue;
    if (TECHNICAL.has(attr(p, 'target') ?? '') || TECHNICAL.has(attr(p, 'source') ?? '')) continue;
    const row = (n === 'in' ? ins : outs).find(m => !kept.has(m) && (attr(p, 'target') ?? attr(p, 'targetVariable')) === m.name.trim() && unchanged(p, m));
    if (row) { kept.add(row); continue; }
    removeEl(p);
  }
  const put = (tag: 'in' | 'out', m: Mapping, where: string) => {
    if (kept.has(m)) return;
    const name = m.name.trim();
    const existing = ioParam(tag, name);
    // eine lokale Variable im `inputOutput`: unverändert bleibt sie, ein
    // Skript sowieso; ein geänderter Text wird dort ersetzt — es sei denn,
    // derselbe Name geht auch als `camunda:in` durch, dann ist das die Zeile
    const twice = (tag === 'in' ? ins : outs).filter(x => x.name.trim() === name).length > 1;
    if (existing && (unchanged(existing, m) || (isComplex(existing) && (isScript(m) || feelBody(m.expression) == null)))) return;
    if (isScript(m)) {
      issues.push({ stepId, where, text: 'ist ein Skript — die Spezifikation beschreibt es nur; im BPMN steht es nicht mehr. Dort pflegen.' });
      return;
    }
    if (existing && !twice) {
      for (const k of kids(existing)) k.remove();
      existing.textContent = juelOf(m, stepId, where, issues).text;
      return;
    }
    const p = doc.createElementNS(CAMUNDA_NS, `camunda:${tag}`);
    const j = juelOf(m, stepId, where, issues);
    // ein blosser Variablenpfad ist `source`, alles andere `sourceExpression`
    if (j.plain && !j.plain.includes('.') && !j.plain.includes('[')) p.setAttribute('source', j.plain);
    else p.setAttribute('sourceExpression', j.text);
    p.setAttribute('target', name);
    appendEl(ext, p);
  };
  for (const m of ins) put('in', m, `Eingabe «${m.name}»`);
  for (const m of outs) put('out', m, `Ausgabe «${m.name}»`);
}
