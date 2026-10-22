// The look of an app (app.json `theme`) as CSS variables - for the app and the preview in the designer.
// The colour classes in ui.tsx read them, with the z9nai style as a fallback.
import type { CSSProperties } from 'react';
import type { Theme } from './spec';

export const FONTS: Record<string, string> = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
};

/** A short name of the fonts (sans, serif, mono) - own keys only, `toString` is not one. */
export const isFontPreset = (font: string): boolean => Object.hasOwn(FONTS, font);

/** What a colour field shows after a new value: what was typed, as long as it already means this value (e.g.
  * « #abc» or «#abc» on the way to «#abcdef») - otherwise the new value (colour picker, import, default). */
export const syncedText = (typed: string, value: string | undefined): string =>
  typed.trim() === (value ?? '') ? typed : value ?? '';

const RADIUS: Record<NonNullable<Theme['radius']>, string> = { none: '0px', sm: '4px', md: '8px', lg: '12px', xl: '18px' };

// exactly the forms CSS accepts: #rgb, #rgba, #rrggbb, #rrggbbaa; rgb()/rgba() and hsl()/hsla() with
// commas or spaces (and «/ alpha») - no «rgb(%%)», which would silently give no colour
const N = String.raw`\d{1,3}(?:\.\d+)?%?`;
const A = String.raw`(?:\d*\.)?\d+%?`;
const H = String.raw`-?\d{1,3}(?:\.\d+)?(?:deg)?`;
const P = String.raw`\d{1,3}(?:\.\d+)?%`;
const D = String.raw`\d{1,3}(?:\.\d+)?`;
const COLOR = new RegExp(
  '^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})' +
    // with commas (the old form): all three numbers or all three percentages - CSS does not accept them mixed
    `|rgba?\\(\\s*${D}\\s*,\\s*${D}\\s*,\\s*${D}\\s*(?:,\\s*${A}\\s*)?\\)` +
    `|rgba?\\(\\s*${P}\\s*,\\s*${P}\\s*,\\s*${P}\\s*(?:,\\s*${A}\\s*)?\\)` +
    `|rgba?\\(\\s*${N}\\s+${N}\\s+${N}\\s*(?:/\\s*${A}\\s*)?\\)` +
    `|hsla?\\(\\s*${H}\\s*,\\s*${P}\\s*,\\s*${P}\\s*(?:,\\s*${A}\\s*)?\\)` +
    `|hsla?\\(\\s*${H}\\s+${P}\\s+${P}\\s*(?:/\\s*${A}\\s*)?\\))$`,
  'i',
);

/** A colour as the theme accepts it (#rrggbb, rgb(…), hsl(…)). */
export const isThemeColor = (v: string): boolean => COLOR.test(v);

/** A parsed colour: red, green, blue (0…1) and the opacity (0…1). */
type ParsedColor = { rgb: number[]; alpha: number };

/** A theme colour parsed - null if it is not one. */
function parseColor(color: string): ParsedColor | null {
  if (!COLOR.test(color)) return null;
  const c = color.trim().toLowerCase();
  return c.startsWith('#') ? hexColor(c.slice(1)) : functionColor(c);
}

/** #rgb, #rgba, #rrggbb, #rrggbbaa (without the #). */
function hexColor(h: string): ParsedColor {
  const full = h.length <= 4 ? h.split('').map((x) => x + x).join('') : h;
  return {
    rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255),
    alpha: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

/** rgb(…)/rgba(…) or hsl(…)/hsla(…), with commas or spaces - checked by COLOR (parseColor): three
  * numbers are always present. */
function functionColor(c: string): ParsedColor {
  const nums = c.slice(c.indexOf('(') + 1, -1).split(/[\s,/]+/).filter(Boolean);
  const part = (v: string, max: number) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) / max);
  const alpha = nums[3] !== undefined ? Math.min(1, part(nums[3], 1)) : 1;
  if (c.startsWith('rgb')) return { rgb: nums.slice(0, 3).map((v) => Math.min(1, part(v, 255))), alpha };
  const hue = ((parseFloat(nums[0]) % 360) + 360) % 360;
  const [s, l] = [part(nums[1], 100), part(nums[2], 100)].map((v) => Math.min(1, v));
  const k = (n: number) => (n + hue / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { rgb: [f(0), f(8), f(4)], alpha };
}

/** Red, green, blue (0…1) of a theme colour as it looks on `over` (a semi-transparent colour
  * blended - like the skill's to_hex; without it on white) - null if it is not one. */
export function rgbOf(color: string, over: [number, number, number] = [1, 1, 1]): [number, number, number] | null {
  const c = parseColor(color);
  return c && (c.rgb.map((v, i) => c.alpha * v + (1 - c.alpha) * over[i]) as [number, number, number]);
}

/** The opacity of a theme colour (0…1) - null if it is not one. */
export const alphaOf = (color: string): number | null => parseColor(color)?.alpha ?? null;

/** The relative luminance per WCAG - like the skill's build_theme.py. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The contrast of two theme colours per WCAG (1…21): `a` on the background `over` (without: white), `b`
  * on top - null if either is not one. */
export function contrast(a: string, b: string, over?: string): number | null {
  const base = over === undefined ? undefined : rgbOf(over);
  if (base === null) return null; // a background that is not a colour - not silently white
  const x = rgbOf(a, base);
  const y = x && rgbOf(b, x);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Below this contrast the app uses black or white for the text on the primary colour (WCAG for
  * large text and controls) - the editor already warns below 4.5. */
export const MIN_ON_PRIMARY_CONTRAST = 3;

/** The text on a colour: black or white, whichever has the higher contrast (WCAG, like the skill). */
export function textOn(color: string, over?: string): '#000000' | '#ffffff' {
  const base = over === undefined ? undefined : rgbOf(over);
  const rgb = base === null ? null : rgbOf(color, base);
  if (!rgb) return '#ffffff';
  const l = luminance(rgb);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

// only what occurs in font names: letters, digits, spaces, comma, quotes,
// period, hyphen, underscore - nothing loads from outside (url(…), @import), nothing escapes CSS
const FONT_ALLOWED = /^[\p{L}\p{N}\s,"'._-]+$/u;

/** The logo at most this large (like a file in the logo field). */
export const MAX_LOGO_BYTES = 200 * 1024;

/** Valid base64 (standard alphabet, padded to a multiple of 4). */
const isBase64 = (s: string): boolean => s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);

/** The size of the image in a base64 data: URI - the decoded bytes, not the length of the text. */
export function dataUriBytes(uri: string): number {
  const b64 = uri.slice(uri.indexOf(',') + 1).replace(/\s/g, '');
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** What is wrong with a theme - null if it is fine. For the import and the build. */
export function themeProblem(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '«theme» ist kein Objekt';
  const t = raw as Record<string, unknown>;
  for (const k of ['primary', 'onPrimary', 'background', 'surface', 'text'])
    if (t[k] !== undefined && (typeof t[k] !== 'string' || !COLOR.test(t[k] as string))) return `«theme.${k}» ist keine Farbe (#rrggbb, rgb(…), hsl(…))`;
  if (t.font !== undefined && (typeof t.font !== 'string' || !FONT_ALLOWED.test(t.font))) return '«theme.font» ist kein Schrift-Stapel';
  // the page background is opaque - the app measures the contrast of the buttons on it
  if (typeof t.background === 'string' && (alphaOf(t.background) ?? 1) < 1)
    return '«theme.background» ist halb durchsichtig - der Hintergrund der Seite muss deckend sein';
  // own keys only - `toString` or `__proto__` are not corners
  if (t.radius !== undefined && !(typeof t.radius === 'string' && Object.hasOwn(RADIUS, t.radius))) return '«theme.radius» ist nicht none, sm, md, lg oder xl';
  if (t.mode !== undefined && t.mode !== 'light' && t.mode !== 'dark') return '«theme.mode» ist nicht light oder dark';
  if (t.logo !== undefined) {
    // an SVG is only safe as <img> (no script, nothing from outside) - never insert it inline
    if (typeof t.logo !== 'string' || !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(t.logo)) return '«theme.logo» ist keine data:-URI eines Bilds (PNG, JPEG, GIF, WebP, SVG)';
    if (!isBase64(t.logo.slice(t.logo.indexOf(',') + 1))) return '«theme.logo» ist kein gültiges base64';
    if (dataUriBytes(t.logo) > MAX_LOGO_BYTES) return '«theme.logo» ist grösser als 200 KB';
  }
  return null;
}

/** The CSS variables of a theme. Background, surfaces and text apply in the theme's mode (`mode`, without:
  * light) - if the user switches, the z9nai style applies there; primary colour, font and corners in both. */
export function themeStyle(theme: Theme | undefined, isDark: boolean): CSSProperties {
  if (!theme) return {};
  const v: Record<string, string> = {};
  if (theme.primary) {
    v['--orch-primary'] = theme.primary;
    // a custom text on the primary colour - only if it is readable; a semi-transparent
    // primary colour as it looks on the page background (the theme's, otherwise the z9nai style's)
    const page = ((theme.mode === 'dark') === isDark && theme.background) || (isDark ? '#0e0f11' : '#f5f4f0');
    const on = theme.onPrimary;
    const readable = on !== undefined && (contrast(theme.primary, on, page) ?? 0) >= MIN_ON_PRIMARY_CONTRAST;
    v['--orch-on-primary'] = readable ? on : textOn(theme.primary, page);
  }
  if ((theme.mode === 'dark') === isDark) {
    if (theme.background) v['--orch-bg'] = theme.background;
    if (theme.surface) v['--orch-surface'] = theme.surface;
    if (theme.text) v['--orch-text'] = theme.text;
  }
  if (theme.font) v['--orch-font'] = isFontPreset(theme.font) ? FONTS[theme.font] : theme.font;
  if (theme.radius && Object.hasOwn(RADIUS, theme.radius)) v['--orch-radius'] = RADIUS[theme.radius];
  // font and text also as a property: that way headings and texts inherit them even where no class
  // reads the variable (the preview in the designer, embedded)
  return { ...v, fontFamily: v['--orch-font'], color: v['--orch-text'] } as CSSProperties;
}

/** The keys of a theme (spec.ts `Theme`). */
const THEME_KEYS = ['primary', 'onPrimary', 'background', 'surface', 'text', 'font', 'radius', 'logo', 'mode'];

/** JSON as a value - null if it is not JSON (a `{ value }`, because `null` is JSON too). */
function parseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

/** A theme file: the theme itself or `{ kind: 'orch-theme', name, source, theme }` (from the skill). */
export function parseThemeFile(text: string): { theme: Theme; name?: string; source?: string } | { error: string } {
  const parsed = parseJson(text);
  if (!parsed) return { error: 'Die Datei ist kein JSON.' };
  const raw = parsed.value;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'Die Datei ist kein Theme.' };
  const r = raw as Record<string, unknown>;
  const wrapped = r.kind === 'orch-theme' || 'theme' in r;
  const theme = (wrapped ? r.theme : r) as Theme;
  // a theme file without a theme is not an empty theme - it would delete the current one
  if (wrapped && (typeof theme !== 'object' || theme === null || Array.isArray(theme))) return { error: 'Die Datei enthält kein Theme («theme» fehlt).' };
  // a theme without a wrapper: only its keys - any other JSON (e.g. a configuration, {}) is not one
  if (!wrapped) {
    const keys = Object.keys(r);
    const unknown = keys.filter((k) => !THEME_KEYS.includes(k));
    if (keys.length === 0) return { error: 'Die Datei ist ein leeres Objekt - kein Theme.' };
    if (unknown.length) return { error: `Die Datei ist kein Theme (unbekannt: ${unknown.slice(0, 3).join(', ')}).` };
  }
  const problem = themeProblem(theme);
  if (problem) return { error: problem };
  return { theme, name: typeof r.name === 'string' ? r.name : undefined, source: typeof r.source === 'string' ? r.source : undefined };
}

/** What gets stripped from an SVG logo - the rules like the skill's parse_svg, here for a logo that is imported
  * or uploaded (otherwise it would bypass the sanitising). A list of the known ways; the
  * guarantee is that the app shows the logo only as <img> - that executes nothing and loads nothing. */
const SVG_DROPPED = new Set(['script', 'foreignobject', 'style', 'set', 'animate', 'animatemotion', 'animatetransform', 'discard', 'image', 'feimage']);
export const svgDropsElement = (name: string): boolean => SVG_DROPPED.has(name.toLowerCase());
export function svgDropsAttribute(name: string, value: string): boolean {
  const local = name.toLowerCase().split(':').pop()!;
  return local.startsWith('on')
    || (local === 'href' && !value.startsWith('#'))
    || /url\(\s*['"]?(?!#)|@import|expression\(/i.test(value)
    || /^\s*(javascript|data|vbscript):/i.test(value);
}
