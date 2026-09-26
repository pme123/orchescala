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

import type { EngineId, Mapping, ProcessSpec } from './types';
import { TECHNICAL, allSteps } from './bpmn';
import { engineExpression, feelBody, feelToJuel } from './feelJuel';

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
      el.insertBefore(ext, el.firstChild);
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

    // Bedingungen an den Zweigen — nur FEEL; ein alter JUEL-Text bleibt, wie er ist
    for (const b of step.branches ?? []) {
      if (b.isDefault || !b.condition) continue;
      const body = feelBody(b.condition);
      if (body == null) continue;
      const flow = byId.get(b.id);
      if (!flow || local(flow) !== 'sequenceFlow') continue;
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
        const ext = firstNamed(flow, 'extensionElements');
        flow.insertBefore(cond, ext ? ext.nextSibling : flow.firstChild);
      }
      cond.textContent = text;
    }
  }

  let out = new XMLSerializer().serializeToString(doc);
  // Die XML-Deklaration soll bleiben — und auf einer eigenen Zeile stehen
  const decl = /^<\?xml[^>]*\?>/.exec(xml)?.[0];
  if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
  out = out.replace(/^(<\?xml[^>]*\?>)(?!\n)/, '$1\n');
  return { xml: out, issues };
}

// ── Camunda 8 ────────────────────────────────────────────────────────────────
function writeZeebe(doc: Document, ext: Element, ins: Mapping[], outs: Mapping[], stepId: string, issues: WriteIssue[]) {
  const old = firstNamed(ext, 'ioMapping');
  // Steuerparameter aus dem alten Mapping behalten
  const keep = old ? kids(old).filter(p => TECHNICAL.has(attr(p, 'target') ?? '')) : [];
  old?.remove();
  if (!ins.length && !outs.length && !keep.length) return;
  const io = doc.createElementNS(ZEEBE_NS, 'zeebe:ioMapping');
  const source = (m: Mapping, where: string): string => {
    const e = engineExpression(m.expression, 'c8');
    if (feelBody(m.expression) == null && /^[$#]\{/.test(m.expression.trim())) {
      issues.push({ stepId, where, text: `«${m.expression}» ist kein FEEL — Camunda 8 nimmt es als festen Text. Als «= …» schreiben.` });
    }
    return e.text;
  };
  for (const m of ins) {
    const p = doc.createElementNS(ZEEBE_NS, 'zeebe:input');
    p.setAttribute('source', source(m, `Eingabe «${m.name}»`));
    p.setAttribute('target', m.name.trim());
    io.appendChild(p);
  }
  for (const p of keep) if (local(p) === 'input') io.appendChild(p);
  for (const m of outs) {
    const p = doc.createElementNS(ZEEBE_NS, 'zeebe:output');
    p.setAttribute('source', source(m, `Ausgabe «${m.name}»`));
    p.setAttribute('target', m.name.trim());
    io.appendChild(p);
  }
  for (const p of keep) if (local(p) === 'output') io.appendChild(p);
  ext.appendChild(io);
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
    ext.appendChild(io);
  }
  // Steuerparameter bleiben, fachliche Zeilen werden ersetzt
  for (const p of kids(io)) {
    if (!TECHNICAL.has(attr(p, 'name') ?? '')) p.remove();
  }
  for (const m of ins) {
    const p = doc.createElementNS(CAMUNDA_NS, 'camunda:inputParameter');
    p.setAttribute('name', m.name.trim());
    p.textContent = juelOf(m, stepId, `Eingabe «${m.name}»`, issues).text;
    io.appendChild(p);
  }
  for (const m of outs) {
    const p = doc.createElementNS(CAMUNDA_NS, 'camunda:outputParameter');
    p.setAttribute('name', m.name.trim());
    p.textContent = juelOf(m, stepId, `Ausgabe «${m.name}»`, issues).text;
    io.appendChild(p);
  }
  if (!kids(io).length) io.remove();
}

function writeCamundaInOut(doc: Document, ext: Element, ins: Mapping[], outs: Mapping[], stepId: string, issues: WriteIssue[]) {
  // businessKey, `variables="all"` und Steuerparameter bleiben
  for (const p of kids(ext)) {
    const n = local(p);
    if (n !== 'in' && n !== 'out') continue;
    if (attr(p, 'businessKey') || attr(p, 'variables')) continue;
    if (TECHNICAL.has(attr(p, 'target') ?? '') || TECHNICAL.has(attr(p, 'source') ?? '')) continue;
    p.remove();
  }
  const put = (tag: 'in' | 'out', m: Mapping, where: string) => {
    const p = doc.createElementNS(CAMUNDA_NS, `camunda:${tag}`);
    const j = juelOf(m, stepId, where, issues);
    // ein blosser Variablenpfad ist `source`, alles andere `sourceExpression`
    if (j.plain && !j.plain.includes('.') && !j.plain.includes('[')) p.setAttribute('source', j.plain);
    else p.setAttribute('sourceExpression', j.text);
    p.setAttribute('target', m.name.trim());
    ext.appendChild(p);
  };
  for (const m of ins) put('in', m, `Eingabe «${m.name}»`);
  for (const m of outs) put('out', m, `Ausgabe «${m.name}»`);
}
