// Der Auftritt der App (app.json `theme`): importieren - z.B. was der Skill orch-theme-from-site aus der
// Website der Bank gemacht hat - und von Hand anpassen. Mit einer kleinen Probe, wie es aussieht.
import { FileUp, ImagePlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cls } from '../../ui';
import type { Theme } from '../runtime/spec';
import {
  contrast, isFontPreset, isThemeColor, MAX_LOGO_BYTES, MIN_ON_PRIMARY_CONTRAST, parseThemeFile, svgDropsAttribute, svgDropsElement,
  syncedText, themeProblem, themeStyle,
} from '../runtime/theme';
import { cls as pageCls } from '../runtime/ui';
import { SelectField, TextField } from './fields';

const MAX_THEME_FILE_BYTES = 1024 * 1024;

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
  const clean = new TextEncoder().encode(new XMLSerializer().serializeToString(doc));
  return `data:image/svg+xml;base64,${btoa(Array.from(clean, (b) => String.fromCharCode(b)).join(''))}`;
}

/** base64 als UTF-8-Text - null, wenn es keins ist. */
export function decodeBase64(b64: string): string | null {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Der Entwurf nach dem Speichern von `saved`: weg, wenn er noch dasselbe ist - eine Änderung, die während
  * des Speicherns kam, bleibt ein Entwurf. */
export function draftAfterSave<T>(draft: { theme: T } | null, saved: T): { theme: T } | null {
  return draft && JSON.stringify(draft.theme ?? null) === JSON.stringify(saved ?? null) ? null : draft;
}

/** Eine Farbe - getippt bleibt sie hier, bis sie eine ist (ein halbes `#0b5` kommt nicht ins Theme). */
function ColorField({ isDark, label, value, onChange, disabled }: {
  isDark: boolean; label: string; value: string | undefined; onChange: (v: string | undefined) => void; disabled?: boolean;
}) {
  const c = cls(isDark);
  const [text, setText] = useState(value ?? '');
  // von aussen geändert (Farbwähler, Import, Vorgabe) - die Anzeige folgt; was man gerade tippt, bleibt
  useEffect(() => setText((t) => syncedText(t, value)), [value]);
  const valid = text === '' || isThemeColor(text.trim());
  return (
    <label className="block space-y-1">
      <span className={`text-[10px] ${c.muted2}`}>{label}</span>
      <span className="flex items-center gap-1.5">
        <input type="color" disabled={disabled} value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)} className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
        <input value={text} disabled={disabled} placeholder="Vorgabe" title={valid ? undefined : 'keine Farbe - #rrggbb, rgb(…), hsl(…)'}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            if (next.trim() === '') onChange(undefined);
            else if (isThemeColor(next.trim())) onChange(next.trim());
          }}
          className={`w-full font-mono text-[11px] px-2 py-1 rounded border outline-none ${c.input} ${valid ? '' : '!border-rose-500'}`} />
      </span>
    </label>
  );
}

export function ThemeEditor({ isDark, theme, onChange, canEdit }: {
  isDark: boolean; theme: Theme | undefined; onChange: (t: Theme | undefined) => void; canEdit: boolean;
}) {
  const c = cls(isDark);
  const t = theme ?? {};
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Theme>) => {
    const next = Object.fromEntries(Object.entries({ ...t, ...patch }).filter(([, v]) => v !== undefined && v !== '')) as Theme;
    onChange(Object.keys(next).length ? next : undefined);
  };
  // «eigener Stapel» bleibt gewählt, auch wenn das Feld leer ist oder genau «sans» darin steht
  const [custom, setCustom] = useState(() => !!t.font && !isFontPreset(t.font));
  // ein eigener Stapel, der erst nach dem Öffnen kommt (pages/app.json geladen): das Feld zeigen
  useEffect(() => { if (t.font && !isFontPreset(t.font)) setCustom(true); }, [t.font]);
  // auf dem Hintergrund, auf dem die Buttons liegen (wie themeStyle) - in beiden Modi: im Modus des Themes
  // auf seinem, im anderen auf dem z9nai-Hintergrund; der schlechtere zählt
  const { primary, onPrimary } = t;
  const onPrimaryContrast = primary && onPrimary
    ? Math.min(
      ...[t.background ?? (t.mode === 'dark' ? '#0e0f11' : '#f5f4f0'), t.mode === 'dark' ? '#f5f4f0' : '#0e0f11']
        .map((bg) => contrast(primary, onPrimary, bg) ?? 21),
    )
    : null;
  const preset = custom ? 'custom' : t.font && isFontPreset(t.font) ? t.font : '';

  const importFile = async (file: File) => {
    // ein Theme ist klein (das Logo bis 200 KB) - was viel grösser ist, ist keins
    if (file.size > MAX_THEME_FILE_BYTES) return setNote({ tone: 'error', text: 'Die Datei ist zu gross für ein Theme (bis 1 MB).' });
    const text = await file.text().catch(() => null);
    if (text === null) return setNote({ tone: 'error', text: 'Die Datei liess sich nicht lesen.' });
    const r = parseThemeFile(text);
    if ('error' in r) return setNote({ tone: 'error', text: r.error });
    // ein SVG-Logo aus der Datei gesäubert wie vom Skill - die Datei kann von irgendwo sein
    const logo = r.theme.logo && cleanLogo(r.theme.logo);
    if (r.theme.logo && !logo) return setNote({ tone: 'error', text: 'Das Logo der Datei ist kein lesbares SVG.' });
    setCustom(!!r.theme.font && !isFontPreset(r.theme.font));
    onChange(logo ? { ...r.theme, logo } : r.theme);
    setNote({ tone: 'ok', text: `Übernommen${r.name ? `: ${r.name}` : ''}${r.source ? ` (aus ${r.source})` : ''} - noch speichern.` });
  };
  const logoFile = (file: File) => {
    if (file.size > MAX_LOGO_BYTES) return setNote({ tone: 'error', text: 'Das Logo ist grösser als 200 KB.' });
    const reader = new FileReader();
    reader.onload = () => {
      const logo = cleanLogo(String(reader.result));
      if (!logo) return setNote({ tone: 'error', text: 'Das SVG lässt sich nicht lesen.' });
      // dieselbe Prüfung wie beim Lesen und Bauen - Typ und Grösse der data:-URI
      const problem = themeProblem({ logo });
      if (problem) setNote({ tone: 'error', text: problem });
      else set({ logo });
    };
    reader.onerror = () => setNote({ tone: 'error', text: 'Das Logo liess sich nicht lesen.' });
    reader.readAsDataURL(file);
  };

  // die Probe: dieselben Klassen wie der Renderer, mit den Variablen des Themes - in seinem Modus
  const sampleDark = t.mode === 'dark';
  const p = pageCls(sampleDark);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {canEdit && (
          <>
            <button type="button" onClick={() => importRef.current?.click()}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
              <FileUp size={12} /> Theme importieren (JSON)
            </button>
            <input ref={importRef} type="file" accept="application/json,.json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
            {theme && (
              <button type="button" onClick={() => { setCustom(false); onChange(undefined); setNote({ tone: 'ok', text: 'Zurück zum z9nai-Stil - noch speichern.' }); }}
                className={`flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
                <X size={12} /> Vorgabe
              </button>
            )}
          </>
        )}
        {note && <span className={`text-[10px] ${note.tone === 'error' ? 'text-rose-500' : 'text-emerald-600'}`}>{note.text}</span>}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <ColorField isDark={isDark} label="Primärfarbe - Buttons, Auswahl" value={t.primary} disabled={!canEdit} onChange={(primary) => set({ primary })} />
        <ColorField isDark={isDark} label="Text auf der Primärfarbe" value={t.onPrimary} disabled={!canEdit} onChange={(onPrimary) => set({ onPrimary })} />
        <ColorField isDark={isDark} label="Hintergrund" value={t.background} disabled={!canEdit} onChange={(background) => set({ background })} />
        <ColorField isDark={isDark} label="Flächen" value={t.surface} disabled={!canEdit} onChange={(surface) => set({ surface })} />
        <ColorField isDark={isDark} label="Text" value={t.text} disabled={!canEdit} onChange={(text) => set({ text })} />
        <SelectField isDark={isDark} label="Ecken" value={t.radius ?? ''} onChange={(radius) => set({ radius: (radius || undefined) as Theme['radius'] })}
          options={[{ value: '', label: 'Vorgabe' }, { value: 'none', label: 'eckig' }, { value: 'sm', label: 'klein' }, { value: 'md', label: 'mittel' }, { value: 'lg', label: 'gross' }, { value: 'xl', label: 'sehr rund' }]} />
        <SelectField isDark={isDark} label="Schrift" value={preset}
          onChange={(v) => {
            setCustom(v === 'custom');
            set({ font: v === 'custom' ? (t.font && !isFontPreset(t.font) ? t.font : 'Arial, sans-serif') : v || undefined });
          }}
          options={[{ value: '', label: 'Vorgabe (mono)' }, { value: 'sans', label: 'serifenlos' }, { value: 'serif', label: 'mit Serifen' }, { value: 'mono', label: 'mono' }, { value: 'custom', label: 'eigener Stapel …' }]} />
        <SelectField isDark={isDark} label="Modus" value={t.mode ?? ''} onChange={(mode) => set({ mode: (mode || undefined) as Theme['mode'] })}
          options={[{ value: '', label: 'Wahl des Benutzers' }, { value: 'light', label: 'hell' }, { value: 'dark', label: 'dunkel' }]} />
      </div>
      {onPrimaryContrast !== null && onPrimaryContrast < 4.5 && (
        <div className="text-[10px] text-amber-600">
          Text auf der Primärfarbe: Kontrast nur {onPrimaryContrast.toFixed(1)}:1 (WCAG: 4.5)
          {onPrimaryContrast < MIN_ON_PRIMARY_CONTRAST ? ' - die App nimmt dafür Schwarz oder Weiss.' : '.'}
        </div>
      )}
      {preset === 'custom' && (
        <TextField isDark={isDark} label="Schrift-Stapel" hint="Systemschriften - in der Bankenzone gibt es keine Webfonts von aussen" mono
          value={t.font} onChange={(font) => set({ font: font || undefined })} />
      )}

      <div className="flex items-center gap-3">
        <span className={`text-[10px] ${c.muted2}`}>Logo</span>
        {/* das Logo nur als <img>: ein SVG darin führt kein Skript aus und lädt nichts - nie inline einsetzen */}
        {t.logo ? <img src={t.logo} alt="" className="h-8 max-w-40 object-contain rounded border border-black/10 bg-white p-0.5" />
          : <span className={`text-[10px] ${c.muted}`}>keins (das Orchescala-Symbol)</span>}
        {canEdit && (
          <>
            <button type="button" onClick={() => logoRef.current?.click()} className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
              <ImagePlus size={11} /> wählen
            </button>
            {t.logo && <button type="button" onClick={() => set({ logo: undefined })} className={`text-[10px] ${c.muted2}`}>entfernen</button>}
            <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) logoFile(f); }} />
          </>
        )}
      </div>

      <div className={`rounded border p-3 space-y-2 ${p.bg} ${p.text}`} style={themeStyle(theme, sampleDark)}>
        <div className="flex items-center gap-2">
          {t.logo && <img src={t.logo} alt="" className="h-5 max-w-24 object-contain" />}
          <span className="text-sm font-bold">So sieht es aus</span>
        </div>
        <div className={`rounded-lg border p-2 text-xs ${p.border} ${p.panel}`}>Eine Fläche mit Text - und eine Auswahl:</div>
        <div className="flex gap-2">
          <span className={`rounded-lg border px-3 py-1.5 text-xs ${p.selected}`}>gewählt</span>
          <span className={`rounded-lg border px-3 py-1.5 text-xs ${p.border2}`}>frei</span>
          <span className={`rounded-lg px-4 py-1.5 text-xs font-bold ${p.btnPrimary}`}>Termin anfragen</span>
        </div>
      </div>
    </div>
  );
}
