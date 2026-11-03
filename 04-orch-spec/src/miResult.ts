// Results of a multi-instance as one list (`MultiInstanceResult`).
//
// Camunda 8 — natively:
//   <zeebe:loopCharacteristics … outputCollection="results" outputElement="={aId: aId}" />
//   <zeebe:input source="=null" target="aId" />   local per inner instance, so that what
//                                                 the instance sets stays in it
// Camunda 7 — generated, no `outputCollection` there:
//   <camunda:inputParameter name="aId" />         local per inner instance
//   end listener (per instance)                   writes `results_<loopCounter>` onto the
//                                                 process instance — each instance its own
//                                                 variable, so nobody overwrites anybody
//   camunda:asyncAfter="true"                     the usual guard against OptimisticLocking
//                                                 at the join of the instances
//   take listener on the way out (once)           collects `results_0 … results_(n-1)` into
//                                                 `results` and removes the helpers
// The scripts carry a mark with the FEEL — the import and the engine conversion read
// the construct back from it.

import type { EngineId, MultiInstanceResult, MultiInstanceSpec } from './types';
import { referencedVariables } from './feel.ts';
import { GROOVY_READ_HELPER, feelToGroovyValue } from './feelJuel.ts';
import { appendEl, prependEl, removeEl } from './xmlFormat.ts';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';

/** mark of the end listener per instance: `// orch-spec:mi-result results = {aId: aId}` */
export const MI_RESULT_MARK = '// orch-spec:mi-result ';
/** mark of the listener that collects: `// orch-spec:mi-collect results` */
export const MI_COLLECT_MARK = '// orch-spec:mi-collect ';

const local = (el: Element): string => {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};
const kids = (el: Element) => Array.from(el.children);
const firstNamed = (el: Element, name: string): Element | null => kids(el).find(c => local(c) === name) ?? null;
const prefixOf = (el: Element) => (el.tagName.includes(':') ? `${el.tagName.split(':')[0]}:` : '');

/** engine variables of a multi-instance — never local */
const ENGINE_VARS = new Set(['loopCounter', 'nrOfInstances', 'nrOfActiveInstances', 'nrOfCompletedInstances']);

/**
 * The variables made local per inner instance: what the result reads — except the
 * element of the collection and the engine's own. What an instance sets (the outputs of
 * the steps in it) then stays in it and reaches the result, not the process.
 */
export function resultLocals(mi: Pick<MultiInstanceSpec, 'element' | 'result'>): string[] {
  const element = mi.result?.element?.trim();
  if (!element) return [];
  return [...new Set(referencedVariables(`= ${element}`))]
    .filter(n => n !== mi.element?.trim() && !ENGINE_VARS.has(n));
}

/** a usable result — name and expression set */
export const hasResult = (r: MultiInstanceResult | undefined): r is MultiInstanceResult =>
  !!r?.collection?.trim() && !!r.element?.trim();

/** The script of a listener — its text, if it is one */
const scriptOf = (listener: Element): string => {
  const sc = firstNamed(listener, 'script');
  return (sc?.textContent ?? '').trim();
};

/** The C7 end listener per instance (or the collecting one) of the construct */
function markedListeners(owner: Element, mark: string): Element[] {
  const ext = firstNamed(owner, 'extensionElements');
  return ext ? kids(ext).filter(c => local(c) === 'executionListener' && scriptOf(c).startsWith(mark)) : [];
}

/** The flows leaving the element — siblings in the same process or subprocess */
function outgoing(el: Element): Element[] {
  const id = el.getAttribute('id');
  const parent = el.parentElement;
  return id && parent ? kids(parent).filter(c => local(c) === 'sequenceFlow' && c.getAttribute('sourceRef') === id) : [];
}

/** Read the construct back: Camunda 8 from the loop, Camunda 7 from the mark of its listener. */
export function readMiResult(el: Element, mi: Element): MultiInstanceResult | undefined {
  const ext = firstNamed(mi, 'extensionElements');
  const zb = ext ? firstNamed(ext, 'loopCharacteristics') : null;
  const coll = zb?.getAttribute('outputCollection')?.trim();
  const elem = zb?.getAttribute('outputElement')?.trim();
  if (coll && elem) return { collection: coll, element: elem.replace(/^=\s*/, '') };
  const marked = markedListeners(el, MI_RESULT_MARK)[0];
  if (!marked) return undefined;
  const line = scriptOf(marked).split('\n')[0].slice(MI_RESULT_MARK.length);
  const m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(line.trim());
  return m ? { collection: m[1], element: m[2].trim() } : undefined;
}

/** Remove the C7 construct (listeners) — the locals and `asyncAfter` stay, they do no harm */
export function removeC7MiResult(el: Element) {
  for (const l of markedListeners(el, MI_RESULT_MARK)) removeEl(l);
  for (const f of outgoing(el)) for (const l of markedListeners(f, MI_COLLECT_MARK)) removeEl(l);
}

/** Remove the C8 construct (`outputCollection` / `outputElement`) */
export function removeC8MiResult(mi: Element) {
  const ext = firstNamed(mi, 'extensionElements');
  const zb = ext ? firstNamed(ext, 'loopCharacteristics') : null;
  zb?.removeAttribute('outputCollection');
  zb?.removeAttribute('outputElement');
}

function ensureExt(doc: Document, owner: Element): Element {
  let ext = firstNamed(owner, 'extensionElements');
  if (!ext) {
    ext = doc.createElementNS(BPMN_NS, `${prefixOf(owner)}extensionElements`);
    prependEl(owner, ext);
  }
  return ext;
}

/**
 * Write the construct for the engine — or take it out, if the step has no result (any
 * more). `issue` gets what cannot be translated.
 */
export function writeMiResult(doc: Document, el: Element, mi: Element, engine: EngineId, spec: MultiInstanceSpec, issue: (text: string) => void) {
  const result = hasResult(spec.result) ? spec.result : undefined;
  if (engine === 'c8') {
    if (!result) { removeC8MiResult(mi); return; }
    const miExt = ensureExt(doc, mi);
    let zb = firstNamed(miExt, 'loopCharacteristics');
    if (!zb) { zb = doc.createElementNS(ZEEBE_NS, 'zeebe:loopCharacteristics'); appendEl(miExt, zb); }
    zb.setAttribute('outputCollection', result.collection.trim());
    zb.setAttribute('outputElement', `=${result.element.trim()}`);
    // local per inner instance: `=null → aId` — input mappings of a multi-instance act per instance
    const locals = resultLocals(spec);
    if (!locals.length) return;
    const ext = ensureExt(doc, el);
    let io = firstNamed(ext, 'ioMapping');
    if (!io) { io = doc.createElementNS(ZEEBE_NS, 'zeebe:ioMapping'); appendEl(ext, io); }
    const firstOut = kids(io).find(c => local(c) === 'output') ?? null;
    for (const name of locals) {
      if (kids(io).some(c => local(c) === 'input' && c.getAttribute('target') === name)) continue;
      const p = doc.createElementNS(ZEEBE_NS, 'zeebe:input');
      p.setAttribute('source', '=null');
      p.setAttribute('target', name);
      if (firstOut) io.insertBefore(p, firstOut); else appendEl(io, p);
    }
    return;
  }

  removeC7MiResult(el);
  if (!result) return;
  const name = result.collection.trim();
  const value = feelToGroovyValue(result.element);
  if (!value.ok) { issue(`Eintrag je Element nicht nach Groovy übersetzbar: ${value.reason}`); return; }
  const coll = spec.collection?.trim() ? feelToGroovyValue(spec.collection) : null;
  if (!coll?.ok) { issue('ohne lesbare Sammlung lassen sich die Ergebnisse nicht einsammeln — die Sammlung als Variable oder Pfad angeben.'); return; }
  const ext = ensureExt(doc, el);

  // local per inner instance: an empty input parameter
  let io = firstNamed(ext, 'inputOutput');
  for (const v of resultLocals(spec)) {
    if (!io) { io = doc.createElementNS(CAMUNDA_NS, 'camunda:inputOutput'); prependEl(ext, io); }
    if (kids(io).some(c => local(c) === 'inputParameter' && c.getAttribute('name') === v)) continue;
    const p = doc.createElementNS(CAMUNDA_NS, 'camunda:inputParameter');
    p.setAttribute('name', v);
    const firstOut = kids(io).find(c => local(c) === 'outputParameter') ?? null;
    if (firstOut) io.insertBefore(p, firstOut); else appendEl(io, p);
  }

  // per instance: its own variable on the process instance
  const listener = (event: string, lines: string[]) => {
    const l = doc.createElementNS(CAMUNDA_NS, 'camunda:executionListener');
    l.setAttribute('event', event);
    const sc = doc.createElementNS(CAMUNDA_NS, 'camunda:script');
    sc.setAttribute('scriptFormat', 'groovy');
    sc.textContent = lines.join('\n');
    appendEl(l, sc);
    return l;
  };
  appendEl(ext, listener('end', [
    `${MI_RESULT_MARK}${name} = ${result.element.trim().replace(/\s*\n\s*/g, ' ')}`,
    ...(value.reads ? [GROOVY_READ_HELPER()] : []),
    `execution.getProcessInstance().setVariable('${name}_' + execution.getVariable('loopCounter'), org.camunda.spin.Spin.JSON(groovy.json.JsonOutput.toJson(${value.expr})))`,
  ]));
  // the join of parallel instances: after each one a transaction of its own
  el.setAttributeNS(CAMUNDA_NS, 'camunda:asyncAfter', 'true');

  // once, on the way out: collect in the order of the collection, remove the helpers
  const flows = outgoing(el);
  if (!flows.length) issue(`kein ausgehender Sequenzfluss — «${name}» wird nicht eingesammelt.`);
  for (const f of flows) {
    appendEl(ensureExt(doc, f), listener('take', [
      `${MI_COLLECT_MARK}${name}`,
      GROOVY_READ_HELPER(),
      `def items = ${coll.expr}`,
      'def n = items == null ? 0 : items.size()',
      `def list = (0..<n).collect { v('${name}_' + it) }`,
      `(0..<n).each { execution.removeVariable('${name}_' + it) }`,
      `execution.setVariable('${name}', org.camunda.spin.Spin.JSON(groovy.json.JsonOutput.toJson(list)))`,
    ]));
  }
}
