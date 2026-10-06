// Einrückung beim Schreiben ins BPMN — gemeinsam für den Export der
// Mappings (bpmnWrite.ts) und das Einfügen von Pattern (patterns.ts).
//
// Das XML soll nach dem Schreiben aussehen wie vorher: ein entferntes Element
// nimmt seinen Zeilenumbruch mit, ein neues bekommt die Einrückung seiner
// Geschwister. Sonst bleiben leere Zeilen und angehängte Elemente kleben
// am Ende — und jeder Diff im Repository wird unlesbar.
export const isWs = (n: Node | null): n is Text => !!n && n.nodeType === 3 && !(n.textContent ?? '').trim();

/** Einrückung eines Elements: die Zeichen nach dem letzten Umbruch davor */
export function indentOf(el: Element): string {
  const prev = el.previousSibling;
  if (isWs(prev)) { const t = prev.textContent ?? ''; return t.slice(t.lastIndexOf('\n') + 1); }
  return '';
}

/** Element samt dem Zeilenumbruch davor entfernen */
export function removeEl(el: Element) {
  const prev = el.previousSibling;
  if (isWs(prev)) prev.remove();
  el.remove();
}

/** Element als letztes Kind anhängen — mit Umbruch und Einrückung wie seine Geschwister */
export function appendEl(parent: Element, el: Element) {
  const doc = parent.ownerDocument;
  const first = Array.from(parent.children)[0];
  const indent = first ? indentOf(first) : `${indentOf(parent)}  `;
  const last = parent.lastChild;
  if (isWs(last)) last.remove();          // der Umbruch vor dem schliessenden Tag
  parent.appendChild(doc.createTextNode(`\n${indent}`));
  parent.appendChild(el);
  parent.appendChild(doc.createTextNode(`\n${indentOf(parent)}`));
}

/** Element als erstes Kind einfügen — eingerückt wie die Geschwister */
export function prependEl(parent: Element, el: Element) {
  const doc = parent.ownerDocument;
  const first = Array.from(parent.children)[0];
  if (!first) { appendEl(parent, el); return; }
  const indent = indentOf(first);
  const anchor = isWs(first.previousSibling) ? first.previousSibling : first;
  parent.insertBefore(doc.createTextNode(`\n${indent}`), anchor);
  parent.insertBefore(el, anchor);
}


// ── Reihenfolge nach dem BPMN-Schema ─────────────────────────────────────────
// Camunda 7 prüft das BPMN gegen das XSD: die Kinder eines Elements stehen in
// fester Reihenfolge. Der Modeler schreibt sie so, das Schreiben ohne ihn
// (Pattern, Export) hängt aber an: eine Ereignis-Definition aus dem
// Pattern-BPMN stünde vor `outgoing`, ein neues Boundary-Ereignis nach den
// Artefakten — «ENGINE-09005 Could not parse BPMN process».

const BPMN_MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMN_DI = 'http://www.omg.org/spec/BPMN/20100524/DI';
const nameOf = (el: Element) => (el.localName || el.tagName).split(':').pop() ?? '';
/** Namensraum eines Elements — auch, wo das DOM ihn nicht kennt (linkedom): über sein Präfix */
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
/** Rang je Kind — gleicher Rang behält seine Reihenfolge; ohne Eintrag 15 (Ablauf, Ereignis-Definitionen …) */
const RANK: Record<string, number> = {
  documentation: 0, extensionElements: 1, auditing: 2, monitoring: 3, categoryValueRef: 4,
  incoming: 5, outgoing: 6, ioSpecification: 7, property: 8, dataInputAssociation: 9, dataOutputAssociation: 10,
  resourceRole: 11, performer: 11, humanPerformer: 11, potentialOwner: 11,
  standardLoopCharacteristics: 12, multiInstanceLoopCharacteristics: 12, laneSet: 13,
};

function rankOf(parent: Element, el: Element): number {
  const p = nameOf(parent), n = nameOf(el);
  if (p === 'definitions') {
    if (nsOf(el) === BPMN_DI) return 30;                  // BPMNDiagram am Schluss
    return n === 'import' ? 0 : n === 'extension' ? 1 : n === 'relationship' ? 31 : 15;
  }
  if (nsOf(el) !== BPMN_MODEL) return 15;
  if (FLOW_CONTAINERS.has(p)) {
    if (ARTIFACTS.has(n)) return 20;
    // im Prozess stehen Rollen, Korrelation und `supports` nach den Artefakten
    if (p === 'process') {
      if (n === 'resourceRole' || n === 'performer' || n === 'humanPerformer' || n === 'potentialOwner') return 21;
      if (n === 'correlationSubscription') return 22;
      if (n === 'supports') return 23;
    }
  }
  return RANK[n] ?? 15;
}

/** Die Kinder aller BPMN-Elemente in die Reihenfolge des Schemas — sonst bleibt alles, wie es ist. */
export function orderBpmn(doc: Document) {
  const visit = (parent: Element) => {
    const kids = Array.from(parent.children);
    if (nsOf(parent) === BPMN_MODEL && kids.length > 1) {
      const ranked = kids.map((el, i) => ({ el, i, r: rankOf(parent, el) }));
      const sorted = [...ranked].sort((a, b) => a.r - b.r || a.i - b.i);
      if (sorted.some((x, i) => x.el !== kids[i])) {
        // je Element, was davor steht (Kommentare) — es wandert mit
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
      // in den Erweiterungen (camunda:, zeebe:) gilt das BPMN-Schema nicht
      if (nameOf(c) !== 'extensionElements') visit(c);
    }
  };
  visit(doc.documentElement);
}
