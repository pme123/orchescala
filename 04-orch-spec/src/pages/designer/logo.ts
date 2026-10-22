// The logo of the theme: an SVG cleaned, and base64 as UTF-8 text back and forth - without React, testable
// in Node (cleanLogo needs the browser's DOMParser for cleaning).
import { svgDropsAttribute, svgDropsElement } from '../runtime/theme';

/** Reading and writing an SVG - in the browser its own (DOMParser, XMLSerializer). The tests run in
  * Node with linkedom: they do not check browserDom itself (namespaces, the shape of <parsererror>, the output)
  * - that is checked by hand in the browser. A broken SVG yields a document with <parsererror> there
  * (Chrome/WebKit: in an HTML document; Firefox: as the root) - cleanLogo catches both, with the selector
  * (any namespace) and because the root is not an <svg>. */
export type SvgDom = { parse: (text: string) => Document; serialize: (doc: Document) => string };

const browserDom: SvgDom = {
  parse: (text) => new DOMParser().parseFromString(text, 'image/svg+xml'),
  serialize: (doc) => new XMLSerializer().serializeToString(doc),
};

/** An SVG logo (data: URI) cleaned as by the skill (svgDropsElement/-Attribute) - other images as they
  * are. An SVG the parser cannot read is null; invalid UTF-8 in it is not (U+FFFD, decodeBase64).
  * `dom`: the browser's (another one for the tests). */
export function cleanLogo(uri: string, dom: SvgDom = browserDom): string | null {
  if (!uri.startsWith('data:image/svg+xml;base64,')) return uri;
  const text = decodeBase64(uri.slice(uri.indexOf(',') + 1));
  if (text === null || /<!(DOCTYPE|ENTITY)/i.test(text)) return null;
  const doc = dom.parse(text);
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') return null;
  for (const el of [...doc.querySelectorAll('*')]) {
    if (svgDropsElement(el.localName)) { el.remove(); continue; }
    for (const at of [...el.attributes]) if (svgDropsAttribute(at.name, at.value)) el.removeAttributeNode(at);
  }
  for (const at of [...doc.documentElement.attributes])
    if (svgDropsAttribute(at.name, at.value)) doc.documentElement.removeAttributeNode(at);
  return `data:image/svg+xml;base64,${encodeBase64(dom.serialize(doc))}`;
}

/** UTF-8 text as base64 - the counterpart of decodeBase64 (btoa alone only takes Latin-1). */
export function encodeBase64(text: string): string {
  return btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''));
}

/** base64 as UTF-8 text - null if atob cannot read it (it accepts spaces and a missing `=`).
  * Not strict: invalid UTF-8 becomes U+FFFD, as before. */
export function decodeBase64(b64: string): string | null {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}
