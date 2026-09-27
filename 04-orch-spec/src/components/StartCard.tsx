// Die Startkarte: eine Form für alles, was vor der Arbeit kommt — Speicher
// wählen, anmelden, warten, ein Fehler. Oben die Wortmarke (oder der Kunde,
// sobald das Modell da ist), ein Zeichen in einem runden Feld, ein Titel,
// ein Satz, die Aktionen, unten klein die Fussnote.
import { AlertTriangle, X } from 'lucide-react';
import { GUID_RE } from '../auth';
import { cls } from '../ui';
import type { Model } from '../types';

export type StartTone = 'neutral' | 'blue' | 'red';

export function StartCard({ isDark, model, icon, tone = 'neutral', title, lead, children, footnote, wide }: {
  isDark: boolean;
  model?: Model | null;
  icon: React.ReactNode;
  tone?: StartTone;
  title: string;
  lead?: React.ReactNode;
  children?: React.ReactNode;
  footnote?: React.ReactNode;
  /** breiter — für zwei Optionen nebeneinander */
  wide?: boolean;
}) {
  const c = cls(isDark);
  const badge = tone === 'blue'
    ? (isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-700')
    : tone === 'red'
      ? (isDark ? 'bg-rose-500/15 text-rose-300' : 'bg-rose-50 text-rose-700')
      : (isDark ? 'bg-white/8 text-white/60' : 'bg-black/6 text-black/60');
  const frame = tone === 'red'
    ? (isDark ? 'border-rose-500/30' : 'border-rose-300')
    : c.border2;
  return (
    <div className="h-full flex items-start sm:items-center justify-center p-6 pt-12 sm:pt-6">
      <div className={`${wide ? 'max-w-2xl' : 'max-w-md'} w-full rounded-xl border ${frame} ${c.panelStrong}`}>
        {/* Wortmarke */}
        <div className={`flex items-center justify-center gap-2 px-6 py-3 border-b ${c.border}`}>
          {model?.logo && <img src={model.logo} alt="" className="h-5 max-w-[7rem] object-contain" />}
          <span className={`text-[11px] font-bold tracking-widest ${isDark ? 'text-white/70' : 'text-black/70'}`}>
            {model?.company || 'Orch Spec'}
          </span>
          <span className={`text-[10px] tracking-widest ${c.muted}`}>· Prozess-Spezifikationen</span>
        </div>
        <div className="px-6 py-6 text-center">
          <span className={`mx-auto mb-3 w-11 h-11 rounded-full flex items-center justify-center ${badge}`}>{icon}</span>
          <h1 className={`text-sm font-semibold ${c.text}`}>{title}</h1>
          {lead && <p className={`text-xs leading-relaxed mt-1.5 ${c.muted2}`}>{lead}</p>}
          {children && <div className="mt-5 text-left">{children}</div>}
          {footnote && <p className={`text-[10px] leading-relaxed mt-5 ${c.muted}`}>{footnote}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Eine Option auf der Startkarte — Speicherort, Konto. Hervorgehoben, wenn
 * sie gemerkt ist; dann steht «zuletzt» mit dem Namen darüber.
 */
export function StartOption({ isDark, icon, title, text, remembered, primary, secondary }: {
  isDark: boolean;
  icon: React.ReactNode;
  title: string;
  text: React.ReactNode;
  /** Name des gemerkten Eintrags */
  remembered?: string | null;
  /** der Knopf — als Hauptknopf, wenn gemerkt oder `primary.strong` */
  primary: { label: string; onClick: () => void; disabled?: boolean; strong?: boolean; title?: string };
  /** kleiner Link darunter, z. B. «anderen wählen» */
  secondary?: { label: string; onClick: () => void };
}) {
  const c = cls(isDark);
  const strong = !!remembered || !!primary.strong;
  return (
    <div className={`flex flex-col rounded-lg border p-4 ${remembered
      ? (isDark ? 'border-blue-500/40 bg-blue-500/5' : 'border-blue-300 bg-blue-50/40')
      : c.border2}`}>
      <div className="flex items-center gap-2">
        <span className={c.muted2}>{icon}</span>
        <span className={`text-xs font-semibold ${c.text}`}>{title}</span>
        {remembered && (
          <span title={remembered}
            className={`ml-auto inline-flex items-center gap-1 text-[9px] px-1.5 py-px rounded border truncate max-w-[9rem] ${
              isDark ? 'border-blue-500/40 text-blue-300' : 'border-blue-300 text-blue-700'}`}>
            zuletzt: <span className="truncate">{remembered}</span>
          </span>
        )}
      </div>
      <p className={`text-[10px] leading-relaxed mt-1.5 flex-1 ${c.muted}`}>{text}</p>
      <button onClick={primary.onClick} disabled={primary.disabled} title={primary.title}
        className={`mt-3 w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded transition-colors disabled:opacity-40 ${
          strong ? `font-semibold ${c.btnPrimary}` : `border ${c.btn}`}`}>
        {icon} {primary.label}
      </button>
      {secondary && (
        <button onClick={secondary.onClick} className={`mt-1.5 text-[10px] ${c.muted} hover:underline`}>{secondary.label}</button>
      )}
    </div>
  );
}

/** Das Microsoft-Zeichen: vier Quadrate — für den Anmelde-Knopf. */
export function MicrosoftMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true" className="flex-shrink-0">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

/** Kürzel aus dem Namen: erster Buchstabe von Vor- und Nachname. */
export function initialsOf(name: string): string {
  const parts = name.trim().replace(/\([^)]*\)/g, '').split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Dialog vor der Arbeit: Kopf mit Zeichen, Titel und Schliessen, ein Satz,
 * die Felder, ein Fehler als roter Chip, unten Abbrechen und der Hauptknopf.
 */
export function StartDialog({ isDark, icon, title, lead, error, busy, onClose, primary, children }: {
  isDark: boolean;
  icon: React.ReactNode;
  title: string;
  lead?: React.ReactNode;
  error?: string;
  busy?: boolean;
  onClose: () => void;
  primary: { label: string; icon?: React.ReactNode; onClick: () => void; disabled?: boolean };
  children: React.ReactNode;
}) {
  const c = cls(isDark);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className={`max-w-lg w-full rounded-xl border ${c.border2} ${c.panelStrong}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center gap-2 px-5 py-3 border-b ${c.border}`}>
          <span className={c.muted2}>{icon}</span>
          <h3 className={`text-sm font-semibold flex-1 ${c.text}`}>{title}</h3>
          <button onClick={onClose} disabled={busy} title="Schliessen" className={`p-1 rounded ${c.muted} hover:opacity-100 disabled:opacity-30`}>
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {lead && <p className={`text-[11px] leading-relaxed ${c.muted}`}>{lead}</p>}
          {children}
          {error && (
            <p className={`inline-flex items-start gap-1.5 text-[11px] px-2 py-1 rounded border ${isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> <span>{error}</span>
            </p>
          )}
        </div>
        <div className={`flex items-center gap-2 px-5 py-3 border-t ${c.border}`}>
          <button onClick={onClose} disabled={busy} className={`text-xs px-3 py-2 rounded border transition-colors disabled:opacity-40 ${c.btn}`}>
            Abbrechen
          </button>
          <button onClick={primary.onClick} disabled={primary.disabled}
            className={`ml-auto flex items-center gap-1.5 text-xs px-4 py-2 rounded font-semibold transition-colors disabled:opacity-40 ${c.btnPrimary}`}>
            {primary.icon} {primary.label}
          </button>
        </div>
      </div>
    </div>
  );
}

/** GUID-Feld mit Prüfung beim Tippen — wie in der Admin-Ansicht. */
export function GuidField({ isDark, label, value, onChange, autoFocus }: {
  isDark: boolean; label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean;
}) {
  const c = cls(isDark);
  const bad = value.trim() !== '' && !GUID_RE.test(value.trim());
  return (
    <div>
      <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.text}`}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} autoFocus={autoFocus} spellCheck={false}
        placeholder="00000000-0000-0000-0000-000000000000"
        className={`w-full text-xs px-3 py-2 rounded border outline-none font-mono transition-colors ${c.input} ${
          bad ? (isDark ? 'border-rose-500/60 focus:border-rose-400' : 'border-rose-400 focus:border-rose-500') : ''}`} />
      {bad && <p className={`text-[10px] mt-1 ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>Keine GUID — erwartet werden 8-4-4-4-12 Hexziffern, wie im Azure-Portal unter «Übersicht».</p>}
    </div>
  );
}
