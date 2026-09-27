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

