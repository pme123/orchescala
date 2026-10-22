// Building blocks of the admin view: section card with header and state,
// state chip, save row with feedback.
//
// Every card says at the top what it is and how it stands («aktiv», «aus»,
// «nicht eingerichtet»); the explanation is one sentence, the rest expands via
// «mehr». The feedback after saving is a chip next to the
// button and disappears by itself — an error stays.
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cls } from '../ui';

export type AdminTone = 'ok' | 'off' | 'warn' | 'error';

/** State of a section — in the status bar and in the card header. */
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
 * Section card: header with icon, title and state; one line of
 * explanation, more on click; below it the content.
 */
export function AdminSection({ id, icon, title, state, hint, more, isDark, action, children }: {
  id: string;
  icon: React.ReactNode;
  title: string;
  state?: React.ReactNode;
  /** one sentence, always visible */
  hint: React.ReactNode;
  /** the rest — expands via «mehr» */
  more?: React.ReactNode;
  isDark: boolean;
  /** on the right in the header, e.g. a switch */
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

/** Feedback that disappears by itself — an error stays. */
export function useFlash(): [Flash | null, (f: Flash | null) => void] {
  const [flash, setFlash] = useState<Flash | null>(null);
  useEffect(() => {
    if (!flash?.ok) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);
  return [flash, setFlash];
}

/** Result of `saveModel` as feedback. */
export const flashOf = (res: { ok: true } | { ok: false; message: string }, okText = 'Gespeichert'): Flash =>
  res.ok ? { ok: true, text: okText } : { ok: false, text: res.message };

/** Save on the right, the feedback as a chip next to it; room for more on the left. */
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

/** Switch «an/aus» — for the header of a section; toggles and saves immediately. */
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

/** Field label — in text colour, like the subheadings in the step panel. */
export function FieldLabel({ children, isDark, hint }: { children: React.ReactNode; isDark: boolean; hint?: string }) {
  const c = cls(isDark);
  return (
    <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.text}`}>
      {children}{hint && <span className={`ml-1.5 normal-case tracking-normal ${c.muted}`}>{hint}</span>}
    </label>
  );
}
