// Das Logo des Themes: ein SVG gesäubert, und base64 als UTF-8-Text hin und zurück - ohne React, in Node
// testbar (cleanLogo braucht zum Säubern den DOMParser des Browsers).
import { svgDropsAttribute, svgDropsElement } from '../runtime/theme';

/** Ein SVG-Logo (data:-URI) gesäubert wie vom Skill (svgDropsElement/-Attribute) - andere Bilder, wie sie
  * sind. Im Browser, mit seinem Parser; ein SVG, das er nicht liest, ist null. */
export function cleanLogo(uri: string): string | null {
  if (!uri.startsWith('data:image/svg+xml;base64,')) return uri;
  const text = decodeBase64(uri.slice(uri.indexOf(',') + 1));
  if (text === null || /<!(DOCTYPE|ENTITY)/i.test(text)) return null;
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') return null;
  for (const el of [...doc.querySelectorAll('*')]) {
    if (svgDropsElement(el.localName)) { el.remove(); continue; }
    for (const at of [...el.attributes]) if (svgDropsAttribute(at.name, at.value)) el.removeAttributeNode(at);
  }
  for (const at of [...doc.documentElement.attributes])
    if (svgDropsAttribute(at.name, at.value)) doc.documentElement.removeAttributeNode(at);
  return `data:image/svg+xml;base64,${encodeBase64(new XMLSerializer().serializeToString(doc))}`;
}

/** UTF-8-Text als base64 - das Gegenstück zu decodeBase64 (btoa allein nimmt nur Latin-1). */
export function encodeBase64(text: string): string {
  return btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''));
}

/** base64 als UTF-8-Text - null, wenn es kein base64 ist. Nicht streng: ungültiges UTF-8 wird zu U+FFFD,
  * wie bisher. */
export function decodeBase64(b64: string): string | null {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}
