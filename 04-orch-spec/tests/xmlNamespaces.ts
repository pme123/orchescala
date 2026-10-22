// linkedom parses XML without namespaces (namespaceURI, getAttributeNS …) — the
// engine converter needs them (camunda: / zeebe:). For the tests it is enough to
// resolve them from the xmlns declarations of the ancestors, as the browser does.
// It changes linkedom's prototypes globally — harmless, because `node --test`
// runs each test file in its own process.
import { DOMParser } from 'linkedom';

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

let installed = false;

export function installXmlNamespaces() {
  if (installed) return;
  installed = true;
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
