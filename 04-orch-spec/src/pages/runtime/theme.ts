// Der Auftritt einer App (app.json `theme`) als CSS-Variablen - für die App und die Vorschau im Designer.
// Die Farbklassen in ui.tsx lesen sie, mit dem z9nai-Stil als Rückfall.
import type { CSSProperties } from 'react';
import type { Theme } from './spec';

export const FONTS: Record<string, string> = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
};

/** Ein Kürzel der Schriften (sans, serif, mono) - nur eigene Schlüssel, `toString` ist keins. */
export const isFontPreset = (font: string): boolean => Object.hasOwn(FONTS, font);

/** Was ein Farbfeld nach einem neuen Wert zeigt: das Getippte, solange es diesen Wert schon meint (z.B.
  * « #abc» oder «#abc» auf dem Weg zu «#abcdef») - sonst den neuen Wert (Farbwähler, Import, Vorgabe). */
export const syncedText = (typed: string, value: string | undefined): string =>
  typed.trim() === (value ?? '') ? typed : value ?? '';

const RADIUS: Record<NonNullable<Theme['radius']>, string> = { none: '0px', sm: '4px', md: '8px', lg: '12px', xl: '18px' };

// genau die Formen, die CSS nimmt: #rgb, #rgba, #rrggbb, #rrggbbaa; rgb()/rgba() und hsl()/hsla() mit
// Kommas oder Leerzeichen (und «/ alpha») - kein «rgb(%%)», das still keine Farbe gäbe
const N = String.raw`\d{1,3}(?:\.\d+)?%?`;
const A = String.raw`(?:\d*\.)?\d+%?`;
const H = String.raw`-?\d{1,3}(?:\.\d+)?(?:deg)?`;
const P = String.raw`\d{1,3}(?:\.\d+)?%`;
const D = String.raw`\d{1,3}(?:\.\d+)?`;
const COLOR = new RegExp(
  '^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})' +
    // mit Kommas (die alte Form): alle drei Zahlen oder alle drei Prozent - gemischt nimmt CSS es nicht
    `|rgba?\\(\\s*${D}\\s*,\\s*${D}\\s*,\\s*${D}\\s*(?:,\\s*${A}\\s*)?\\)` +
    `|rgba?\\(\\s*${P}\\s*,\\s*${P}\\s*,\\s*${P}\\s*(?:,\\s*${A}\\s*)?\\)` +
    `|rgba?\\(\\s*${N}\\s+${N}\\s+${N}\\s*(?:/\\s*${A}\\s*)?\\)` +
    `|hsla?\\(\\s*${H}\\s*,\\s*${P}\\s*,\\s*${P}\\s*(?:,\\s*${A}\\s*)?\\)` +
    `|hsla?\\(\\s*${H}\\s+${P}\\s+${P}\\s*(?:/\\s*${A}\\s*)?\\))$`,
  'i',
);

/** Eine Farbe, wie das Theme sie nimmt (#rrggbb, rgb(…), hsl(…)). */
export const isThemeColor = (v: string): boolean => COLOR.test(v);

/** Rot, Grün, Blau (0…1) einer Theme-Farbe, wie sie auf `over` aussieht (eine halb durchsichtige Farbe
  * gemischt - wie to_hex des Skills; ohne Angabe auf Weiss) - null, wenn es keine ist. */
function parseColor(color: string): { rgb: number[]; alpha: number } | null {
  if (!COLOR.test(color)) return null;
  const c = color.trim().toLowerCase();
  let rgb: number[];
  let alpha = 1;
  if (c.startsWith('#')) {
    const h = c.slice(1);
    const full = h.length <= 4 ? h.split('').map((x) => x + x).join('') : h;
    rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    if (full.length === 8) alpha = parseInt(full.slice(6, 8), 16) / 255;
  } else {
    const nums = c.slice(c.indexOf('(') + 1, -1).split(/[\s,/]+/).filter(Boolean);
    const part = (v: string, max: number) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) / max);
    if (nums[3] !== undefined) alpha = Math.min(1, part(nums[3], 1));
    if (c.startsWith('rgb')) rgb = nums.slice(0, 3).map((v) => Math.min(1, part(v, 255)));
    else {
      const hue = ((parseFloat(nums[0]) % 360) + 360) % 360;
      const [s, l] = [part(nums[1], 100), part(nums[2], 100)].map((v) => Math.min(1, v));
      const k = (n: number) => (n + hue / 30) % 12;
      const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
      rgb = [f(0), f(8), f(4)];
    }
  }
  return { rgb, alpha };
}

export function rgbOf(color: string, over: [number, number, number] = [1, 1, 1]): [number, number, number] | null {
  const c = parseColor(color);
  return c && (c.rgb.map((v, i) => c.alpha * v + (1 - c.alpha) * over[i]) as [number, number, number]);
}

/** Die Deckkraft einer Theme-Farbe (0…1) - null, wenn es keine ist. */
export const alphaOf = (color: string): number | null => parseColor(color)?.alpha ?? null;

/** Die relative Leuchtdichte nach WCAG - wie build_theme.py des Skills. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Der Kontrast zweier Theme-Farben nach WCAG (1…21): `a` auf dem Hintergrund `over` (ohne: Weiss), `b`
  * darauf - null, wenn eine keine ist. */
export function contrast(a: string, b: string, over?: string): number | null {
  const x = rgbOf(a, (over && rgbOf(over)) || undefined);
  const y = x && rgbOf(b, x);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Unter diesem Kontrast nimmt die App für den Text auf der Primärfarbe Schwarz oder Weiss (WCAG für
  * grosse Schrift und Bedienelemente) - der Editor warnt schon unter 4.5. */
export const MIN_ON_PRIMARY_CONTRAST = 3;

/** Der Text auf einer Farbe: Schwarz oder Weiss, was den grösseren Kontrast hat (WCAG, wie der Skill). */
export function textOn(color: string, over?: string): '#000000' | '#ffffff' {
  const rgb = rgbOf(color, (over && rgbOf(over)) || undefined);
  if (!rgb) return '#ffffff';
  const l = luminance(rgb);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

// nur, was in Namen von Schriften vorkommt: Buchstaben, Ziffern, Leerzeichen, Komma, Anführungszeichen,
// Punkt, Bindestrich, Unterstrich - nichts lädt von aussen (url(…), @import), nichts maskiert CSS
const FONT_ALLOWED = /^[\p{L}\p{N}\s,"'._-]+$/u;

/** Das Logo höchstens so gross (wie eine Datei im Logo-Feld). */
export const MAX_LOGO_BYTES = 200 * 1024;

/** Gültiges base64 (Standard-Alphabet, aufgefüllt auf ein Vielfaches von 4). */
const isBase64 = (s: string): boolean => s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);

/** Die Grösse des Bilds in einer base64-data:-URI - die dekodierten Bytes, nicht die Länge des Texts. */
export function dataUriBytes(uri: string): number {
  const b64 = uri.slice(uri.indexOf(',') + 1).replace(/\s/g, '');
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Was an einem Theme nicht stimmt - null, wenn es passt. Für den Import und den Build. */
export function themeProblem(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '«theme» ist kein Objekt';
  const t = raw as Record<string, unknown>;
  for (const k of ['primary', 'onPrimary', 'background', 'surface', 'text'])
    if (t[k] !== undefined && (typeof t[k] !== 'string' || !COLOR.test(t[k] as string))) return `«theme.${k}» ist keine Farbe (#rrggbb, rgb(…), hsl(…))`;
  if (t.font !== undefined && (typeof t.font !== 'string' || !FONT_ALLOWED.test(t.font))) return '«theme.font» ist kein Schrift-Stapel';
  // der Hintergrund der Seite ist deckend - auf ihm misst die App den Kontrast der Buttons
  if (typeof t.background === 'string' && (alphaOf(t.background) ?? 1) < 1)
    return '«theme.background» ist halb durchsichtig - der Hintergrund der Seite muss deckend sein';
  // nur eigene Schlüssel - `toString` oder `__proto__` sind keine Ecken
  if (t.radius !== undefined && !(typeof t.radius === 'string' && Object.hasOwn(RADIUS, t.radius))) return '«theme.radius» ist nicht none, sm, md, lg oder xl';
  if (t.mode !== undefined && t.mode !== 'light' && t.mode !== 'dark') return '«theme.mode» ist nicht light oder dark';
  if (t.logo !== undefined) {
    // ein SVG ist nur als <img> sicher (kein Skript, nichts von aussen) - nie inline einsetzen
    if (typeof t.logo !== 'string' || !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(t.logo)) return '«theme.logo» ist keine data:-URI eines Bilds (PNG, JPEG, GIF, WebP, SVG)';
    if (!isBase64(t.logo.slice(t.logo.indexOf(',') + 1))) return '«theme.logo» ist kein gültiges base64';
    if (dataUriBytes(t.logo) > MAX_LOGO_BYTES) return '«theme.logo» ist grösser als 200 KB';
  }
  return null;
}

/** Die CSS-Variablen eines Themes. Hintergrund, Flächen und Text gelten im Modus des Themes (`mode`, ohne:
  * hell) - schaltet der Benutzer um, gilt dort der z9nai-Stil; Primärfarbe, Schrift und Ecken in beiden. */
export function themeStyle(theme: Theme | undefined, isDark: boolean): CSSProperties {
  if (!theme) return {};
  const v: Record<string, string> = {};
  if (theme.primary) {
    v['--orch-primary'] = theme.primary;
    // ein eigener Text auf der Primärfarbe - nur, wenn man ihn lesen kann; eine halb durchsichtige
    // Primärfarbe so, wie sie auf dem Hintergrund der Seite aussieht (dem des Themes, sonst dem z9nai-Stil)
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
  // Schrift und Text auch als Eigenschaft: so erben sie Überschriften und Texte auch dort, wo keine Klasse
  // die Variable liest (die Vorschau im Designer, eingebettet)
  return { ...v, fontFamily: v['--orch-font'], color: v['--orch-text'] } as CSSProperties;
}

/** Die Schlüssel eines Themes (spec.ts `Theme`). */
const THEME_KEYS = ['primary', 'onPrimary', 'background', 'surface', 'text', 'font', 'radius', 'logo', 'mode'];

/** Eine Theme-Datei: das Theme selbst oder `{ kind: 'orch-theme', name, source, theme }` (vom Skill). */
export function parseThemeFile(text: string): { theme: Theme; name?: string; source?: string } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'Die Datei ist kein JSON.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'Die Datei ist kein Theme.' };
  const r = raw as Record<string, unknown>;
  const wrapped = r.kind === 'orch-theme' || 'theme' in r;
  const theme = (wrapped ? r.theme : r) as Theme;
  // eine Theme-Datei ohne Theme ist kein leeres Theme - sie würde das aktuelle löschen
  if (wrapped && (typeof theme !== 'object' || theme === null || Array.isArray(theme))) return { error: 'Die Datei enthält kein Theme («theme» fehlt).' };
  // ein Theme ohne Hülle: nur seine Schlüssel - ein anderes JSON (z.B. eine Konfiguration, {}) ist keins
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
