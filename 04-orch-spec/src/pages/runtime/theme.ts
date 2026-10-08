// Der Auftritt einer App (app.json `theme`) als CSS-Variablen - für die App und die Vorschau im Designer.
// Die Farbklassen in ui.tsx lesen sie, mit dem z9nai-Stil als Rückfall.
import type { CSSProperties } from 'react';
import type { Theme } from './spec';

export const FONTS: Record<string, string> = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
};

const RADIUS: Record<NonNullable<Theme['radius']>, string> = { none: '0px', sm: '4px', md: '8px', lg: '12px', xl: '18px' };

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;

/** Eine Farbe, wie das Theme sie nimmt (#rrggbb, rgb(…), hsl(…)). */
export const isThemeColor = (v: string): boolean => COLOR.test(v);

/** Ist die Farbe hell? Für den Text auf ihr - nur #rgb / #rrggbb, sonst «dunkel». */
function isLight(color: string): boolean {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})/i)?.[1];
  if (!hex) return false;
  const full = hex.length === 3 ? hex.split('').map((h) => h + h).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

/** Was an einem Theme nicht stimmt - null, wenn es passt. Für den Import und den Build. */
export function themeProblem(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '«theme» ist kein Objekt';
  const t = raw as Record<string, unknown>;
  for (const k of ['primary', 'onPrimary', 'background', 'surface', 'text'])
    if (t[k] !== undefined && (typeof t[k] !== 'string' || !COLOR.test(t[k] as string))) return `«theme.${k}» ist keine Farbe (#rrggbb, rgb(…), hsl(…))`;
  if (t.font !== undefined && (typeof t.font !== 'string' || /[;{}<>]/.test(t.font))) return '«theme.font» ist kein Schrift-Stapel';
  // nur eigene Schlüssel - `toString` oder `__proto__` sind keine Ecken
  if (t.radius !== undefined && !(typeof t.radius === 'string' && Object.hasOwn(RADIUS, t.radius))) return '«theme.radius» ist nicht none, sm, md, lg oder xl';
  if (t.mode !== undefined && t.mode !== 'light' && t.mode !== 'dark') return '«theme.mode» ist nicht light oder dark';
  if (t.logo !== undefined) {
    if (typeof t.logo !== 'string' || !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(t.logo)) return '«theme.logo» ist keine data:-URI eines Bilds (PNG, JPEG, GIF, WebP, SVG)';
    if (t.logo.length > (200 * 1024 * 4) / 3) return '«theme.logo» ist grösser als 200 KB';
  }
  return null;
}

/** Die CSS-Variablen eines Themes - die Farben gelten im hellen Modus, Primärfarbe, Schrift und Ecken in beiden. */
export function themeStyle(theme: Theme | undefined, isDark: boolean): CSSProperties {
  if (!theme) return {};
  const v: Record<string, string> = {};
  if (theme.primary) {
    v['--orch-primary'] = theme.primary;
    v['--orch-on-primary'] = theme.onPrimary ?? (isLight(theme.primary) ? '#000000' : '#ffffff');
  }
  if (!isDark) {
    if (theme.background) v['--orch-bg'] = theme.background;
    if (theme.surface) v['--orch-surface'] = theme.surface;
    if (theme.text) v['--orch-text'] = theme.text;
  }
  if (theme.font) v['--orch-font'] = FONTS[theme.font] ?? theme.font;
  if (theme.radius && Object.hasOwn(RADIUS, theme.radius)) v['--orch-radius'] = RADIUS[theme.radius];
  return { ...v, fontFamily: v['--orch-font'] } as CSSProperties;
}

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
  const theme = (r.kind === 'orch-theme' || 'theme' in r ? r.theme : r) as Theme;
  const problem = themeProblem(theme);
  if (problem) return { error: problem };
  return { theme, name: typeof r.name === 'string' ? r.name : undefined, source: typeof r.source === 'string' ? r.source : undefined };
}
