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

// ── One form for a whole document ───────────────────────────────────────────────
// The merge from Orch Spec (Orchescala's `processFromSpec --merge`) compares three versions of a
// BPMN or DMN: the spec before, after and the code. The Modeler, Orch Spec in the browser and
// Orch Spec in Node write the same diagram differently - indentation, attribute order, `<a/>` or
// `<a></a>`. Formatted with `formatXml` they differ only where the content does.
//
// Without a DOM - a small scanner over the text: the same bytes in the browser and in Node, and
// what is not markup stays as it was (values of attributes, texts, CDATA, comments).

type XmlNode =
  | { kind: 'el'; name: string; attrs: Array<[string, string]>; children: XmlNode[]; inner: string }
  | { kind: 'text'; raw: string }
  | { kind: 'other'; raw: string };

/** Attribute order: namespaces (by prefix), `id`, `name`, then the rest by name. */
function attrRank([name]: [string, string]): string {
  if (name === 'xmlns' || name.startsWith('xmlns:')) return `0${name}`;
  if (name === 'id') return '1';
  if (name === 'name') return '2';
  return `3${name}`;
}

/** The value of an attribute as it was written - in double quotes. */
const quoted = (raw: string, quote: string) => (quote === '"' ? raw : raw.replace(/"/g, '&quot;'));

function parseXml(xml: string): { prolog: XmlNode[]; root: XmlNode & { kind: 'el' } } {
  let i = 0;
  /** where the last closing tag began - the end of the element's content */
  let closeAt = 0;
  const fail = (what: string): never => { throw new Error(`${what} at ${i}`); };
  const until = (end: string) => {
    const at = xml.indexOf(end, i);
    if (at < 0) fail(`no ${end}`);
    const raw = xml.slice(i, at + end.length);
    i = at + end.length;
    return raw;
  };
  const nodes = (closing: string | null): XmlNode[] => {
    const out: XmlNode[] = [];
    while (i < xml.length) {
      if (xml.startsWith('</', i)) {
        closeAt = i;
        const end = xml.indexOf('>', i);
        const name = xml.slice(i + 2, end).trim();
        if (name !== closing) fail(`</${name}> instead of </${closing}>`);
        i = end + 1;
        return out;
      }
      if (xml.startsWith('<!--', i)) out.push({ kind: 'other', raw: until('-->') });
      else if (xml.startsWith('<![CDATA[', i)) out.push({ kind: 'text', raw: until(']]>') });
      else if (xml.startsWith('<?', i)) out.push({ kind: 'other', raw: until('?>') });
      else if (xml.startsWith('<!', i)) out.push({ kind: 'other', raw: until('>') });
      else if (xml[i] === '<') out.push(element());
      else {
        const at = xml.indexOf('<', i);
        const end = at < 0 ? xml.length : at;
        out.push({ kind: 'text', raw: xml.slice(i, end) });
        i = end;
      }
    }
    if (closing !== null) fail(`no </${closing}>`);
    return out;
  };
  const element = (): XmlNode & { kind: 'el' } => {
    i++; // <
    const name = /^[^\s/>]+/.exec(xml.slice(i))?.[0] ?? fail('no element name');
    i += name.length;
    const attrs: Array<[string, string]> = [];
    for (;;) {
      while (/\s/.test(xml[i] ?? '')) i++;
      if (xml.startsWith('/>', i)) { i += 2; return { kind: 'el', name, attrs, children: [], inner: '' }; }
      if (xml[i] === '>') break;
      const m = /^([^\s=/>]+)\s*=\s*(["'])/.exec(xml.slice(i)) ?? fail('no attribute');
      i += m[0].length;
      const end = xml.indexOf(m[2], i);
      if (end < 0) fail('no end of the attribute');
      attrs.push([m[1], quoted(xml.slice(i, end), m[2])]);
      i = end + 1;
    }
    i++; // >
    const start = i;
    const children = nodes(name);
    return { kind: 'el', name, attrs, children, inner: xml.slice(start, closeAt) };
  };
  const all = nodes(null);
  const roots = all.filter((n): n is XmlNode & { kind: 'el' } => n.kind === 'el');
  if (roots.length !== 1 || all.some(n => n.kind === 'text' && n.raw.trim())) fail('not one root element');
  const at = all.indexOf(roots[0]);
  if (all.slice(at + 1).some(n => n.kind !== 'text')) fail('something after the root element');
  return { prolog: all.slice(0, at).filter(n => n.kind !== 'text'), root: roots[0] };
}

/**
 * The document in one form: one element per line, indented by two, the attributes in a fixed
 * order (`attrRank`), an empty element as `<a />`. An element with text (a condition, a script,
 * a DMN cell) keeps its content exactly as it is. Not readable as XML: returned as it is.
 */
export function formatXml(xml: string): string {
  let doc: ReturnType<typeof parseXml>;
  try { doc = parseXml(xml.replace(/^﻿/, '').replace(/\r\n?/g, '\n')); } catch { return xml; }
  const out: string[] = [];
  const open = (el: XmlNode & { kind: 'el' }) =>
    `<${el.name}${[...el.attrs].sort((a, b) => (attrRank(a) < attrRank(b) ? -1 : attrRank(a) > attrRank(b) ? 1 : 0))
      .map(([k, v]) => ` ${k}="${v}"`).join('')}`;
  const write = (n: XmlNode, depth: number) => {
    const pad = '  '.repeat(depth);
    if (n.kind === 'other') { out.push(pad + n.raw.trim()); return; }
    if (n.kind === 'text') { if (n.raw.trim()) out.push(pad + n.raw.trim()); return; }
    const text = n.children.some(c => c.kind === 'text' && c.raw.trim());
    if (!n.children.some(c => c.kind !== 'text' || c.raw.trim())) {
      // nothing but blanks: empty - unless the blanks are on one line, then they are the value
      out.push(n.inner && !n.inner.includes('\n') ? `${pad}${open(n)}>${n.inner}</${n.name}>` : `${pad}${open(n)} />`);
    } else if (text) out.push(`${pad}${open(n)}>${n.inner}</${n.name}>`);
    else {
      out.push(`${pad}${open(n)}>`);
      for (const c of n.children) write(c, depth + 1);
      out.push(`${pad}</${n.name}>`);
    }
  };
  // the declaration in one form - the browser writes `UTF-8`, linkedom `utf-8`
  for (const p of doc.prolog) {
    if (p.kind !== 'other') continue;
    out.push(p.raw.startsWith('<?xml ') ? '<?xml version="1.0" encoding="UTF-8"?>' : p.raw.trim());
  }
  write(doc.root, 0);
  return `${out.filter(l => l !== '').join('\n')}\n`;
}
