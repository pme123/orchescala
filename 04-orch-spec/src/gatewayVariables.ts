// A variable set on a gateway (a retry counter `count + 1`) in the export for Camunda 7.
//
// Inside Orch Spec it is an output of the gateway step, and the diagram keeps it as
// `camunda:inputOutput`. Camunda 7 rejects that on a gateway (ENGINE-09005): only the
// export turns it into a listener `${execution.setVariable("count", …)}` — the
// specification and the stored diagram stay as they are. (A conversion from Camunda 8
// does the same, see engineConvert.)
//
// The listener runs on `start`: the conditions of the gateway already see the new value.
// Only a join of a parallel or inclusive gateway takes `end` — once, not once per branch.
// A variable is read with `execution.getVariable`: a counter that is still missing is
// null, and null counts as 0 in JUEL arithmetic — `${count}` would throw.

import type { ProcessSpec, Step } from './types';
import type { WriteIssue, WriteResult } from './bpmnWrite.ts';
import { allSteps } from './bpmn.ts';
import { C7_LABEL } from './engineLabels.ts';
import { feelBody, feelToJuel, type JuelOptions } from './feelJuel.ts';
import { appendEl, orderBpmn, prependEl, removeEl } from './xmlFormat.ts';

const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';

const local = (el: Element): string => {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};
const kids = (el: Element) => Array.from(el.children);

const isGateway = (el: Element): boolean => local(el).endsWith('Gateway');

/** `start`, or `end` at a join of a parallel or inclusive gateway (see above) */
function listenerEvent(el: Element): 'start' | 'end' {
  const id = el.getAttribute('id');
  const incoming = kids(el.parentElement ?? el).filter(k => local(k) === 'sequenceFlow' && k.getAttribute('targetRef') === id).length;
  return (local(el) === 'parallelGateway' || local(el) === 'inclusiveGateway') && incoming > 1 ? 'end' : 'start';
}

/** The variable of a listener expression that is exactly one `execution.setVariable("x", …)` — null for anything else */
function assignedVariable(expression: string): string | null {
  const head = /^\s*\$\{\s*execution\.setVariable\(\s*(["'])([A-Za-z_][\w.-]*)\1\s*,/.exec(expression);
  if (!head) return null;
  let depth = 1, quote = '';
  for (let i = head[0].length; i < expression.length; i++) {
    const ch = expression[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return /^\s*\}\s*$/.test(expression.slice(i + 1)) ? head[2] : null;
  }
  return null;
}

/** `--` must not appear in an XML comment, nor may it end with `-` */
const commentSafe = (text: string) => text.replace(/-(?=-)/g, '- ').replace(/-$/, '- ');

/**
 * The export for Camunda 7: the outputs of a gateway as `setVariable` listeners, its
 * inputs left out (a gateway has no local scope — a comment and an issue). The value
 * comes from the row of the specification (FEEL → JUEL, null-safe); without a row,
 * from the diagram as it stands. Without any inputOutput on a gateway the XML comes back unchanged.
 */
export function gatewayOutputsAsListeners(xml: string, spec: ProcessSpec, juel: JuelOptions = {}): WriteResult {
  const issues: WriteIssue[] = [];
  if (!xml.includes('inputOutput')) return { xml, issues };
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const defs = doc.documentElement;
  if (!defs || doc.getElementsByTagName('parsererror').length) return { xml, issues };
  const steps = new Map<string, Step>(allSteps(spec.steps).map(s => [s.id, s]));
  const all = (el: Element): Element[] => kids(el).flatMap(k => [k, ...all(k)]);
  let changed = false;

  for (const el of all(defs).filter(isGateway)) {
    const ext = kids(el).find(k => local(k) === 'extensionElements');
    const io = ext ? kids(ext).find(k => local(k) === 'inputOutput' && k.namespaceURI === CAMUNDA_NS) : undefined;
    if (!ext || !io) continue;
    changed = true;
    const stepId = el.getAttribute('id') ?? '';
    const comment = (text: string) => prependEl(el, doc.createComment(` ${C7_LABEL}, nicht übernommen: ${commentSafe(text)} `) as unknown as Element);
    const listeners = new Map(kids(ext).filter(k => local(k) === 'executionListener')
      .flatMap(l => { const n = assignedVariable(l.getAttribute('expression') ?? ''); return n ? [[n, l] as const] : []; }));
    const event = listenerEvent(el);
    const set: string[] = [];

    for (const p of kids(io).filter(k => local(k) === 'outputParameter')) {
      const name = p.getAttribute('name') ?? '';
      const row = steps.get(stepId)?.outputs?.find(m => m.name.trim() === name);
      let value: string | null = null;
      if (row) {
        const body = feelBody(row.expression);
        if (body == null) value = JSON.stringify(row.expression);
        else {
          const r = feelToJuel(body, { ...juel, allOptional: true });
          if (r.ok) value = r.juel;
          else issues.push({ stepId, where: `Ausgabe «${name}»`, text: `nicht nach JUEL übersetzbar: ${r.reason} — am Gateway nicht gesetzt.` });
        }
      } else if (!kids(p).length) {
        // not from the specification: the JUEL of the diagram as it is
        const text = (p.textContent ?? '').trim();
        value = /^\$\{([\s\S]*)\}$/.exec(text)?.[1].trim() ?? JSON.stringify(text);
      } else {
        issues.push({ stepId, where: `Ausgabe «${name}»`, text: 'ein Skript als Ausgabe am Gateway — nicht übernommen, von Hand als Listener umsetzen.' });
      }
      if (value == null) { comment(`camunda:outputParameter name="${name}"`); continue; }
      const expression = `\${execution.setVariable(${JSON.stringify(name)}, ${value})}`;
      const old = listeners.get(name);
      if (old) old.setAttribute('expression', expression);
      else {
        const l = doc.createElementNS(CAMUNDA_NS, 'camunda:executionListener');
        l.setAttribute('expression', expression);
        l.setAttribute('event', event);
        appendEl(ext, l);
      }
      set.push(name);
    }
    const ins = kids(io).filter(k => local(k) === 'inputParameter').map(p => p.getAttribute('name') ?? '');
    for (const name of ins) comment(`camunda:inputParameter name="${name}"`);
    if (ins.length) issues.push({ stepId, where: 'Mapping', text: `Eingabe ${ins.map(n => `«${n}»`).join(', ')} nicht übernommen — ein Gateway hat in ${C7_LABEL} keine lokalen Variablen.` });
    if (set.length) issues.push({ stepId, where: 'Mapping', text: `Ausgabe ${set.map(n => `«${n}»`).join(', ')} als ${event === 'end' ? 'End' : 'Start'}-Listener — ${C7_LABEL} erlaubt am Gateway kein Output-Mapping.` });
    removeEl(io);
    if (!kids(ext).length) removeEl(ext);
  }

  if (!changed) return { xml, issues };
  orderBpmn(doc);
  let out = new XMLSerializer().serializeToString(doc);
  const decl = /^<\?xml[^>]*\?>/.exec(xml)?.[0];
  if (decl && !out.startsWith('<?xml')) out = `${decl}\n${out}`;
  return { xml: out.replace(/^(<\?xml[^>]*\?>)(?!\n)/, '$1\n'), issues };
}
