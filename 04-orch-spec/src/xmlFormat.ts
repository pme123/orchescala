// Indentation when writing into the BPMN — shared by the export of the
// mappings (bpmnWrite.ts) and the insertion of patterns (patterns.ts).
//
// After writing, the XML should look like before: a removed element
// takes its line break with it, a new one gets the indentation of its
// siblings. Otherwise empty lines remain and appended elements stick
// to the end — and every diff in the repository becomes unreadable.
export const isWs = (n: Node | null): n is Text => !!n && n.nodeType === 3 && !(n.textContent ?? '').trim();

/** indentation of an element: the characters after the last line break before it */
export function indentOf(el: Element): string {
  const prev = el.previousSibling;
  if (isWs(prev)) { const t = prev.textContent ?? ''; return t.slice(t.lastIndexOf('\n') + 1); }
  return '';
}

/** remove an element together with the line break before it */
export function removeEl(el: Element) {
  const prev = el.previousSibling;
  if (isWs(prev)) prev.remove();
  el.remove();
}

/** append an element as the last child — with line break and indentation like its siblings */
export function appendEl(parent: Element, el: Element) {
  const doc = parent.ownerDocument;
  const first = Array.from(parent.children)[0];
  const indent = first ? indentOf(first) : `${indentOf(parent)}  `;
  const last = parent.lastChild;
  if (isWs(last)) last.remove();          // the line break before the closing tag
  parent.appendChild(doc.createTextNode(`\n${indent}`));
  parent.appendChild(el);
  parent.appendChild(doc.createTextNode(`\n${indentOf(parent)}`));
}

/** insert an element as the first child — indented like its siblings */
export function prependEl(parent: Element, el: Element) {
  const doc = parent.ownerDocument;
  const first = Array.from(parent.children)[0];
  if (!first) { appendEl(parent, el); return; }
  const indent = indentOf(first);
  const anchor = isWs(first.previousSibling) ? first.previousSibling : first;
  parent.insertBefore(doc.createTextNode(`\n${indent}`), anchor);
  parent.insertBefore(el, anchor);
}


// ── Order according to the BPMN schema ─────────────────────────────────────────
// Camunda 7 validates the BPMN against the XSD: the children of an element come in
// a fixed order. The Modeler writes them that way, but writing without it
// (pattern, export) appends: an event definition from the
// pattern BPMN would end up before `outgoing`, a new boundary event after the
// artifacts — «ENGINE-09005 Could not parse BPMN process».

const BPMN_MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMN_DI = 'http://www.omg.org/spec/BPMN/20100524/DI';
const nameOf = (el: Element) => (el.localName || el.tagName).split(':').pop() ?? '';
/** namespace of an element — also where the DOM does not know it (linkedom): via its prefix */
function nsOf(el: Element): string | null {
  const ns = el.namespaceURI;
  if (ns && ns !== 'http://www.w3.org/1999/xhtml') return ns;
  const tag = el.tagName, i = tag.indexOf(':');
  const attr = i >= 0 ? `xmlns:${tag.slice(0, i)}` : 'xmlns';
  for (let e: Element | null = el; e; e = e.parentElement) {
    const a = e.getAttribute(attr);
    if (a) return a;
  }
  return null;
}
const FLOW_CONTAINERS = new Set(['process', 'subProcess', 'transaction', 'adHocSubProcess']);
const ARTIFACTS = new Set(['association', 'textAnnotation', 'group']);
/** rank per child — equal rank keeps its order; without an entry 15 (flow, event definitions …) */
const RANK: Record<string, number> = {
  documentation: 0, extensionElements: 1, auditing: 2, monitoring: 3, categoryValueRef: 4,
  incoming: 5, outgoing: 6, ioSpecification: 7, property: 8, dataInputAssociation: 9, dataOutputAssociation: 10,
  resourceRole: 11, performer: 11, humanPerformer: 11, potentialOwner: 11,
  standardLoopCharacteristics: 12, multiInstanceLoopCharacteristics: 12, laneSet: 13,
};

function rankOf(parent: Element, el: Element): number {
  const p = nameOf(parent), n = nameOf(el);
  if (p === 'definitions') {
    if (nsOf(el) === BPMN_DI) return 30;                  // BPMNDiagram at the end
    return n === 'import' ? 0 : n === 'extension' ? 1 : n === 'relationship' ? 31 : 15;
  }
  if (nsOf(el) !== BPMN_MODEL) return 15;
  if (FLOW_CONTAINERS.has(p)) {
    if (ARTIFACTS.has(n)) return 20;
    // in the process, roles, correlation and `supports` come after the artifacts
    if (p === 'process') {
      if (n === 'resourceRole' || n === 'performer' || n === 'humanPerformer' || n === 'potentialOwner') return 21;
      if (n === 'correlationSubscription') return 22;
      if (n === 'supports') return 23;
    }
  }
  return RANK[n] ?? 15;
}

/** Put the children of all BPMN elements into the order of the schema — otherwise everything stays as it is. */
export function orderBpmn(doc: Document) {
  const visit = (parent: Element) => {
    const kids = Array.from(parent.children);
    if (nsOf(parent) === BPMN_MODEL && kids.length > 1) {
      const ranked = kids.map((el, i) => ({ el, i, r: rankOf(parent, el) }));
      const sorted = [...ranked].sort((a, b) => a.r - b.r || a.i - b.i);
      if (sorted.some((x, i) => x.el !== kids[i])) {
        // per element, whatever comes before it (comments) — it moves along
        const units = sorted.map(({ el }) => {
          const pre: Node[] = [];
          for (let n = el.previousSibling; n && n.nodeType !== 1; n = n.previousSibling) if (!isWs(n)) pre.unshift(n);
          return { el, pre };
        });
        for (const u of units) { for (const n of u.pre) n.parentNode?.removeChild(n); removeEl(u.el); }
        for (const u of units) {
          for (const n of u.pre) parent.insertBefore(n, parent.lastChild && isWs(parent.lastChild) ? parent.lastChild : null);
          appendEl(parent, u.el);
        }
      }
    }
    for (const c of Array.from(parent.children)) {
      // the BPMN schema does not apply in the extensions (camunda:, zeebe:)
      if (nameOf(c) !== 'extensionElements') visit(c);
    }
  };
  visit(doc.documentElement);
}
