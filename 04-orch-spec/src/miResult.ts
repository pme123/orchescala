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
//                                                 variable, so nobody overwrites anybody —
//                                                 and `results_n` (`nrOfInstances`)
//   camunda:asyncAfter="true" at the loop         the usual guard against OptimisticLocking
//                                                 at the join: at `multiInstanceLoopCharacteristics`
//                                                 it applies to each inner instance (at the
//                                                 activity it would apply to the body)
//   take listener on the way out (once)           collects `results_0 … results_(n-1)` into
//                                                 `results` and removes the helpers
// The scripts carry a mark with the FEEL — the import and the engine conversion read
// the construct back from it. A second mark line names what the generator added
// (`loopAsyncAfter`, the locals), so that taking the result away removes exactly that.

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
/** what the generator added: `// orch-spec:mi-added loopAsyncAfter locals=aId,bId` */
export const MI_ADDED_MARK = '// orch-spec:mi-added ';

/** words of Groovy and Java — no name for a process variable that scripts and JUEL read */
const RESERVED = new Set([
  'abstract', 'as', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
  'const', 'continue', 'def', 'default', 'do', 'double', 'else', 'enum', 'extends', 'false',
  'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'in', 'instanceof',
  'int', 'interface', 'long', 'native', 'new', 'null', 'package', 'private', 'protected', 'public',
  'return', 'short', 'static', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
  'trait', 'transient', 'true', 'try', 'var', 'void', 'volatile', 'while', 'execution',
  'loopCounter', 'nrOfInstances', 'nrOfActiveInstances', 'nrOfCompletedInstances',
]);

/**
 * Why a list name does not work — or null. It goes into the generated scripts as is
 * (a plain identifier), and its helpers are `<name>_0 …` and `<name>_n`: a name that
 * ends like a helper could meet the helpers of another list.
 */
export function resultNameIssue(name: string | undefined): string | null {
  const n = name?.trim() ?? '';
  if (!/^[A-Za-z_]\w*$/.test(n)) return 'kein gültiger Variablenname (Buchstaben, Ziffern und _, nicht mit einer Ziffer vorne)';
  if (RESERVED.has(n)) return 'ein reserviertes Wort';
  if (/_(n|\d+)$/.test(n)) return 'endet wie die Zwischenwerte (_n, _0 …)';
  return null;
}
export const isResultName = (name: string | undefined): boolean => resultNameIssue(name) === null;

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
 * `inside` (what the steps in the instance set): only those — a variable the entry
 * reads from the process stays readable, a local would hide it behind null.
 */
export function resultLocals(mi: Pick<MultiInstanceSpec, 'element' | 'result'>, inside?: Iterable<string>): string[] {
  const element = mi.result?.element?.trim();
  if (!element) return [];
  const only = inside ? new Set(inside) : null;
  return [...new Set(referencedVariables(`= ${element}`))]
    .filter(n => n !== mi.element?.trim() && !ENGINE_VARS.has(n) && (!only || only.has(n)));
}

/** a usable result — a valid name and an expression */
export const hasResult = (r: MultiInstanceResult | undefined): r is MultiInstanceResult =>
  isResultName(r?.collection) && !!r?.element?.trim();

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
  const line = scriptOf(marked).split('\n')[0].slice(MI_RESULT_MARK.length).trim();
  // an entry over several lines comes JSON-encoded (`results =json "{\n…}"`)
  const json = /^([A-Za-z_]\w*)\s*=json\s+(".*")$/.exec(line);
  if (json) {
    try { return { collection: json[1], element: JSON.parse(json[2]) as string }; } catch { return undefined; }
  }
  const m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(line);
  return m ? { collection: m[1], element: m[2].trim() } : undefined;
}

const asyncAfterOf = (el: Element) => el.getAttributeNS(CAMUNDA_NS, 'asyncAfter') || el.getAttribute('camunda:asyncAfter');

/** What the generator added, from the mark line of the end listener */
function addedBy(listener: Element): { loopAsync: boolean; elAsync: boolean; locals: string[] } {
  const line = scriptOf(listener).split('\n').find(l => l.startsWith(MI_ADDED_MARK));
  const words = line ? line.slice(MI_ADDED_MARK.length).trim().split(/\s+/) : [];
  const locals = words.find(w => w.startsWith('locals='))?.slice('locals='.length).split(',').filter(Boolean) ?? [];
  // `asyncAfter`: at the activity, as first written — `loopAsyncAfter`: at the loop
  return { loopAsync: words.includes('loopAsyncAfter'), elAsync: words.includes('asyncAfter'), locals };
}

/**
 * Remove the C7 construct: the listeners, and what the generator added at the element
 * (`asyncAfter`, the empty locals) — a value set by hand stays.
 */
export function removeC7MiResult(el: Element) {
  removeCollectors(el);
  for (const l of markedListeners(el, MI_RESULT_MARK)) {
    const added = addedBy(l);
    removeEl(l);
    const mi = firstNamed(el, 'multiInstanceLoopCharacteristics');
    for (const [on, holder] of [[added.elAsync, el], [added.loopAsync, mi]] as const) {
      if (on && holder && asyncAfterOf(holder) === 'true') {
        holder.removeAttributeNS(CAMUNDA_NS, 'asyncAfter');
        holder.removeAttribute('camunda:asyncAfter');
      }
    }
    const ext = firstNamed(el, 'extensionElements');
    const io = ext ? firstNamed(ext, 'inputOutput') : null;
    if (io) {
      for (const p of kids(io)) {
        const empty = !(p.textContent ?? '').trim() && !p.children.length;
        if (local(p) === 'inputParameter' && empty && added.locals.includes(p.getAttribute('name') ?? '')) removeEl(p);
      }
      if (!kids(io).length) removeEl(io);
    }
    if (ext && !kids(ext).length) removeEl(ext);
  }
}

/**
 * The collecting listeners around the element: those on its outgoing flows, and on any
 * flow next to it whose source does not collect that list (any more) — a flow moved to
 * another source in the modeler, or the multi-instance gone. Otherwise such a listener
 * would set the list at the wrong place.
 */
function removeCollectors(el: Element) {
  const id = el.getAttribute('id');
  const parent = el.parentElement;
  if (!parent) return;
  const nameOf = (l: Element) => scriptOf(l).split('\n')[0].slice(MI_COLLECT_MARK.length).trim();
  const collects = (source: Element | undefined, name: string) =>
    !!source && markedListeners(source, MI_RESULT_MARK).some(l => scriptOf(l).slice(MI_RESULT_MARK.length).startsWith(`${name} =`));
  const siblings = kids(parent);
  for (const f of siblings.filter(c => local(c) === 'sequenceFlow')) {
    const sourceId = f.getAttribute('sourceRef');
    const source = siblings.find(c => c.getAttribute('id') === sourceId);
    const stale = markedListeners(f, MI_COLLECT_MARK).filter(l => sourceId === id || !collects(source, nameOf(l)));
    for (const l of stale) removeEl(l);
    const ext = firstNamed(f, 'extensionElements');
    if (stale.length && ext && !kids(ext).length) removeEl(ext);
  }
}

/**
 * Remove the C8 construct: `outputCollection` / `outputElement`, and the `=null` locals
 * of what the entry read. Returns the names of the locals that were there.
 */
export function removeC8MiResult(mi: Element, el?: Element): string[] {
  const ext = firstNamed(mi, 'extensionElements');
  const zb = ext ? firstNamed(ext, 'loopCharacteristics') : null;
  const old = el ? readMiResult(el, mi) : undefined;
  zb?.removeAttribute('outputCollection');
  zb?.removeAttribute('outputElement');
  if (!el || !old) return [];
  const names = new Set(resultLocals({ element: zb?.getAttribute('inputElement') ?? undefined, result: old }));
  const elExt = firstNamed(el, 'extensionElements');
  const io = elExt ? firstNamed(elExt, 'ioMapping') : null;
  const removed: string[] = [];
  for (const p of io ? kids(io) : []) {
    const target = p.getAttribute('target') ?? '';
    if (local(p) === 'input' && names.has(target) && /^=\s*null$/.test((p.getAttribute('source') ?? '').trim())) {
      removeEl(p);
      removed.push(target);
    }
  }
  if (io && !kids(io).length) removeEl(io);
  if (elExt && !kids(elExt).length) removeEl(elExt);
  return removed;
}

/** The first line of the end listener: the entry as it is — over several lines JSON-encoded */
const markLine = (name: string, element: string): string => {
  const e = element.trim();
  return e.includes('\n') ? `${MI_RESULT_MARK}${name} =json ${JSON.stringify(e)}` : `${MI_RESULT_MARK}${name} = ${e}`;
};

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
export function writeMiResult(doc: Document, el: Element, mi: Element, engine: EngineId, spec: MultiInstanceSpec, issue: (text: string) => void, inside?: Iterable<string>) {
  const result = hasResult(spec.result) ? spec.result : undefined;
  if (engine === 'c8') {
    removeC8MiResult(mi, el);
    if (!result) return;
    const miExt = ensureExt(doc, mi);
    let zb = firstNamed(miExt, 'loopCharacteristics');
    if (!zb) { zb = doc.createElementNS(ZEEBE_NS, 'zeebe:loopCharacteristics'); appendEl(miExt, zb); }
    zb.setAttribute('outputCollection', result.collection.trim());
    zb.setAttribute('outputElement', `=${result.element.trim()}`);
    // local per inner instance: `=null → aId` — input mappings of a multi-instance act per instance
    const locals = resultLocals(spec, inside);
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
  if (!coll?.ok) { issue('Ohne lesbare Sammlung lassen sich die Ergebnisse nicht einsammeln — die Sammlung als Variable oder Pfad angeben.'); return; }
  // without a way out nothing would collect — then nothing is written, not half of it
  const flows = outgoing(el);
  if (!flows.length) { issue(`Kein ausgehender Sequenzfluss — «${name}» wird nicht eingesammelt, nichts geschrieben.`); return; }
  const ext = ensureExt(doc, el);

  // local per inner instance: an empty input parameter
  let io = firstNamed(ext, 'inputOutput');
  const addedLocals: string[] = [];
  for (const v of resultLocals(spec, inside)) {
    if (!io) { io = doc.createElementNS(CAMUNDA_NS, 'camunda:inputOutput'); prependEl(ext, io); }
    if (kids(io).some(c => local(c) === 'inputParameter' && c.getAttribute('name') === v)) continue;
    const p = doc.createElementNS(CAMUNDA_NS, 'camunda:inputParameter');
    p.setAttribute('name', v);
    const firstOut = kids(io).find(c => local(c) === 'outputParameter') ?? null;
    if (firstOut) io.insertBefore(p, firstOut); else appendEl(io, p);
    addedLocals.push(v);
  }
  // the join of parallel instances: after each one a transaction of its own
  // the inner instances, each in a transaction of its own after it (not the body)
  const addedAsync = asyncAfterOf(mi) !== 'true';
  if (addedAsync) mi.setAttributeNS(CAMUNDA_NS, 'camunda:asyncAfter', 'true');
  const added = [...(addedAsync ? ['loopAsyncAfter'] : []), ...(addedLocals.length ? [`locals=${addedLocals.join(',')}`] : [])];

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
    markLine(name, result.element),
    ...(added.length ? [`${MI_ADDED_MARK}${added.join(' ')}`] : []),
    ...(value.reads ? [GROOVY_READ_HELPER()] : []),
    `execution.getProcessInstance().setVariable('${name}_' + execution.getVariable('loopCounter'), org.camunda.spin.Spin.JSON(groovy.json.JsonOutput.toJson(${value.expr})))`,
    // how many to collect — from the engine, not from the collection, which may have changed;
    // written by the first instance only, so that the instances do not update one variable
    `if (execution.getVariable('loopCounter') == 0) execution.getProcessInstance().setVariable('${name}_n', execution.getVariable('nrOfInstances'))`,
  ]));
  // once, on the way out: collect in the order of the collection, remove the helpers.
  // Each outgoing flow carries it; when several are taken, the first one collects —
  // the others find the count gone and leave the list as it is. No count at all and an
  // empty collection: no instance ran, each taken flow sets the empty list.
  for (const f of flows) {
    appendEl(ensureExt(doc, f), listener('take', [
      `${MI_COLLECT_MARK}${name}`,
      GROOVY_READ_HELPER(),
      `def n = execution.getVariable('${name}_n')`,
      'if (n == null) {',
      `  def items = ${coll.expr}`,
      '  if (items != null && items.size() > 0) return',
      '  n = 0',
      '}',
      `def list = (0..<n).collect { v('${name}_' + it) }`,
      `(0..<n).each { execution.removeVariable('${name}_' + it) }`,
      `execution.removeVariable('${name}_n')`,
      `execution.setVariable('${name}', org.camunda.spin.Spin.JSON(groovy.json.JsonOutput.toJson(list)))`,
    ]));
  }
}
