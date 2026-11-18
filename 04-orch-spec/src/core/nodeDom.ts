// The DOM of the browser in Node - for the tools that write BPMN (spec2export), the tests and the
// studio (src/core needs DOMParser and XMLSerializer on globalThis, the browser has them). Without a
// parser of its own: the host passes one in (in orch-spec's tools and tests linkedom, see
// tools/lib/nodeDom.ts) - so the package does not depend on it.
//
// linkedom parses XML without namespaces (namespaceURI, getAttributeNS …) — the
// engine converter needs them (camunda: / zeebe:). It is enough to
// resolve them from the xmlns declarations of the ancestors, as the browser does.
// It changes linkedom's prototypes globally — harmless in a tool, and in the tests
// because `node --test` runs each test file in its own process.
/** A DOMParser like the browser's - linkedom's in Node. */
export type DomParserClass = new () => { parseFromString(text: string, type: string): unknown };

const XMLNS = 'http://www.w3.org/2000/xmlns/';

type El = Element & { __ns?: string | null };

const prefixOf = (qname: string) => (qname.includes(':') ? qname.split(':')[0] : '');
const localOf = (qname: string) => (qname.includes(':') ? qname.split(':')[1] : qname);

function lookup(start: Node | null, prefix: string): string | null {
  if (prefix === 'xmlns') return XMLNS;
  for (let n = start as El | null; n && typeof n.getAttribute === 'function'; n = n.parentNode as El | null) {
    const v = n.getAttribute(prefix ? `xmlns:${prefix}` : 'xmlns');
    if (v) return v;
  }
  return null;
}

/** Owner of a property somewhere up the prototype chain */
function protoWith(obj: object, prop: string): object {
  for (let p = Object.getPrototypeOf(obj); p; p = Object.getPrototypeOf(p)) {
    if (Object.prototype.hasOwnProperty.call(p, prop)) return p;
  }
  return Object.getPrototypeOf(obj);
}

/** The parsers whose prototypes have the namespaces - each one once. */
const patched = new WeakSet<DomParserClass>();

export function installXmlNamespaces(DOMParser: DomParserClass) {
  if (patched.has(DOMParser)) return;
  patched.add(DOMParser);
  const doc = new DOMParser().parseFromString('<a xmlns:x="u" x:c="1"><x:b/></a>', 'text/xml') as unknown as Document;
  const el = doc.documentElement;
  const elementProto = protoWith(el, 'getAttribute');
  const attrProto = Object.getPrototypeOf(el.attributes[0]);
  const docProto = protoWith(doc, 'createElement');

  Object.defineProperty(elementProto, 'namespaceURI', {
    configurable: true,
    get(this: El) { return this.__ns !== undefined ? this.__ns : lookup(this, prefixOf(this.tagName)); },
    set(this: El, ns: string | null) { if (ns) this.__ns = ns; },
  });
  Object.defineProperty(elementProto, 'prefix', {
    configurable: true,
    get(this: El) { return prefixOf(this.tagName) || null; },
    set() { /* from the name */ },
  });
  Object.assign(elementProto, {
    getAttributeNS(this: El, ns: string | null, name: string) {
      if (!ns) return this.getAttribute(name);
      for (const a of Array.from(this.attributes)) {
        if (localOf(a.name) === name && prefixOf(a.name) && lookup(this, prefixOf(a.name)) === ns) return a.value;
      }
      return null;
    },
    setAttributeNS(this: El, _ns: string | null, qname: string, value: string) { this.setAttribute(qname, value); },
    removeAttributeNode(this: El, a: Attr) { this.removeAttribute(a.name); return a; },
  });
  Object.defineProperty(attrProto, 'namespaceURI', {
    configurable: true,
    get(this: Attr) {
      if (this.name === 'xmlns') return XMLNS;
      const p = prefixOf(this.name);
      return p ? lookup(this.ownerElement, p) : null;
    },
    set() { /* from the name */ },
  });
  Object.defineProperty(attrProto, 'localName', {
    configurable: true,
    get(this: Attr) { return localOf(this.name); },
    set() { /* from the name */ },
  });
  Object.assign(docProto, {
    createElementNS(this: Document, ns: string | null, qname: string) {
      const e = this.createElement(qname) as El;
      e.__ns = ns;
      return e;
    },
  });
}

/** DOMParser (the one passed in), XMLSerializer and the namespaces - what src/core needs from the
  * browser. A DOMParser that is there already (the browser's) stays. */
export function installNodeDom(DOMParser: DomParserClass) {
  const g = globalThis as unknown as Record<string, unknown>;
  g.DOMParser ??= DOMParser;
  g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };
  // the namespaces for the parser in use only - one that was there already (a browser's, a host's)
  // is complete and stays as it is
  if (g.DOMParser === DOMParser) installXmlNamespaces(DOMParser);
}
