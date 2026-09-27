// Bausteine der Admin-Ansicht: Bereichskarte mit Kopfzeile und Zustand,
// Zustands-Chip, Speichern-Zeile mit Rückmeldung.
//
// Jede Karte sagt oben, was sie ist und wie es steht («aktiv», «aus»,
// «nicht eingerichtet»); die Erklärung ist ein Satz, der Rest klappt über
// «mehr» auf. Die Rückmeldung nach dem Speichern ist ein Chip neben dem
// Knopf und verschwindet von selbst — ein Fehler bleibt stehen.
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cls } from '../ui';

export type AdminTone = 'ok' | 'off' | 'warn' | 'error';

/** Zustand eines Bereichs — in der Statusleiste und im Kartenkopf. */
export function StateChip({ tone, label, isDark, title }: { tone: AdminTone; label: string; isDark: boolean; title?: string }) {
  const cls_ = tone === 'ok'
    ? (isDark ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-800')
    : tone === 'warn'
      ? (isDark ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800')
      : tone === 'error'
        ? (isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700')
        : (isDark ? 'border-white/15 text-white/50' : 'border-black/15 text-black/50');
  return (
    <span title={title} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${cls_}`}>
      {tone === 'ok' && <Check size={9} />}
      {(tone === 'warn' || tone === 'error') && <AlertTriangle size={9} />}
      {label}
    </span>
  );
}

/**
 * Bereichskarte: Kopfzeile mit Zeichen, Titel und Zustand; eine Zeile
 * Erklärung, mehr auf Klick; darunter der Inhalt.
 */
export function AdminSection({ id, icon, title, state, hint, more, isDark, action, children }: {
  id: string;
  icon: React.ReactNode;
  title: string;
  state?: React.ReactNode;
  /** ein Satz, immer sichtbar */
  hint: React.ReactNode;
  /** der Rest — klappt über «mehr» auf */
  more?: React.ReactNode;
  isDark: boolean;
  /** rechts in der Kopfzeile, z. B. ein Schalter */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = cls(isDark);
  const [open, setOpen] = useState(false);
  return (
    <section id={id} className={`rounded-lg border scroll-mt-4 ${c.border2} ${c.panel}`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${c.border}`}>
        <span className={c.muted2}>{icon}</span>
        <h2 className={`text-xs font-semibold ${c.text}`}>{title}</h2>
        {state}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="px-4 py-3 space-y-3">
        <p className={`text-[11px] leading-relaxed ${c.muted}`}>
          {hint}
          {more && (
            <button onClick={() => setOpen(!open)} className={`ml-1.5 inline-flex items-center gap-0.5 hover:underline ${c.muted2}`}>
              {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}{open ? 'weniger' : 'mehr'}
            </button>
          )}
        </p>
        {more && open && <div className={`text-[11px] leading-relaxed ${c.muted}`}>{more}</div>}
        {children}
      </div>
    </section>
  );
}

export interface Flash { ok: boolean; text: string }

/** Rückmeldung, die von selbst verschwindet — ein Fehler bleibt. */
export function useFlash(): [Flash | null, (f: Flash | null) => void] {
  const [flash, setFlash] = useState<Flash | null>(null);
  useEffect(() => {
    if (!flash?.ok) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);
  return [flash, setFlash];
}

/** Ergebnis von `saveModel` als Rückmeldung. */
export const flashOf = (res: { ok: true } | { ok: false; message: string }, okText = 'Gespeichert'): Flash =>
  res.ok ? { ok: true, text: okText } : { ok: false, text: res.message };

/** Speichern rechts, die Rückmeldung als Chip daneben; links Platz für Weiteres. */
export function SaveRow({ onSave, flash, isDark, label = 'Speichern', disabled, children }: {
  onSave: () => void; flash: Flash | null; isDark: boolean; label?: string; disabled?: boolean; children?: React.ReactNode;
}) {
  const c = cls(isDark);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {children}
      <span className="ml-auto flex items-center gap-2">
        {flash && <StateChip tone={flash.ok ? 'ok' : 'error'} label={flash.text} isDark={isDark} />}
        <button onClick={onSave} disabled={disabled}
          className={`text-[11px] px-3 py-1.5 rounded font-semibold disabled:opacity-40 ${c.btnPrimary}`}>{label}</button>
      </span>
    </div>
  );
}

/** Schalter «an/aus» — für die Kopfzeile eines Bereichs; schaltet und speichert sofort. */
export function Switch({ on, onChange, isDark, label, disabled }: {
  on: boolean; onChange: (v: boolean) => void; isDark: boolean; label?: string; disabled?: boolean;
}) {
  const c = cls(isDark);
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      title={on ? 'Ausschalten' : 'Einschalten'}
      className={`flex items-center gap-2 text-[11px] disabled:opacity-40 ${c.muted2}`}>
      {label && <span>{label}</span>}
      <span className={`relative inline-block w-8 h-[18px] rounded-full transition-colors ${
        on ? (isDark ? 'bg-emerald-500' : 'bg-emerald-600') : (isDark ? 'bg-white/20' : 'bg-black/20')}`}>
        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${on ? 'left-[16px]' : 'left-[2px]'}`} />
      </span>
      <span className={`w-6 ${on ? (isDark ? 'text-emerald-300' : 'text-emerald-700') : c.muted}`}>{on ? 'an' : 'aus'}</span>
    </button>
  );
}

/** Feldbeschriftung — in Textfarbe, wie die Zwischentitel im Schritt-Panel. */
export function FieldLabel({ children, isDark, hint }: { children: React.ReactNode; isDark: boolean; hint?: string }) {
  const c = cls(isDark);
  return (
    <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.text}`}>
      {children}{hint && <span className={`ml-1.5 normal-case tracking-normal ${c.muted}`}>{hint}</span>}
    </label>
  );
}
