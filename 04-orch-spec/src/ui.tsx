// Gemeinsame Bausteine der Oberfläche: Farbklassen je Modus, Status-Chip und
// die Symbole je Schritt-Art. Bewusst klein gehalten — die Views bleiben lesbar.
import {
  GripVertical,
  Play, Square, Cog, User, GitBranch, Boxes, Send, Inbox, Table2, Code2, Hand,
  CornerDownRight, Zap, Repeat, ShieldCheck, Split, Merge, Unlink, Puzzle, Flag,
} from 'lucide-react';
import { useRef } from 'react';
import { STATUS_META, type Status, type Step, type StepKind } from './types';

export const cls = (isDark: boolean) => ({
  bg: isDark ? 'bg-[#0e0f11]' : 'bg-[#f5f4f0]',
  panel: isDark ? 'bg-white/2' : 'bg-black/2',
  panelStrong: isDark ? 'bg-[#16171a]' : 'bg-white',
  top: isDark ? 'bg-[#0c0d0f]' : 'bg-[#eae9e5]',
  border: isDark ? 'border-white/8' : 'border-black/8',
  border2: isDark ? 'border-white/15' : 'border-black/15',
  text: isDark ? 'text-white' : 'text-black',
  muted: isDark ? 'text-white/40' : 'text-black/40',
  muted2: isDark ? 'text-white/60' : 'text-black/60',
  hover: isDark ? 'hover:bg-white/5' : 'hover:bg-black/5',
  input: isDark
    ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30'
    : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30',
  btn: isDark
    ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white'
    : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black',
  btnPrimary: isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80',
});

export const STEP_ICON: Record<StepKind, typeof Cog> = {
  start: Play, end: Square, service: Cog, user: User, call: Boxes, send: Send, receive: Inbox,
  rule: Table2, script: Code2, manual: Hand, subprocess: Boxes, gateway: GitBranch,
  event: Zap, goto: CornerDownRight,
};

export const KIND_LABEL: Record<StepKind, string> = {
  start: 'Start', end: 'Ende', service: 'Service', user: 'Benutzeraufgabe', call: 'Teilprozess',
  send: 'Senden', receive: 'Empfangen', rule: 'Entscheidung', script: 'Skript', manual: 'Manuell',
  subprocess: 'Subprozess', gateway: 'Verzweigung', event: 'Ereignis', goto: 'Verweis',
};

export function StatusChip({ status, isDark, onClick, title, muted }: {
  status: Status; isDark: boolean; onClick?: () => void; title?: string;
  /** leise — für den Status, der die Regel ist, damit die Abweichungen herausstechen */
  muted?: boolean;
}) {
  const m = STATUS_META[status];
  const c = `text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${isDark ? m.dark : m.light} ${muted ? 'opacity-50' : ''}`;
  return onClick
    ? <button onClick={e => { e.stopPropagation(); onClick(); }} title={title ?? 'Status ändern'} className={`${c} cursor-pointer`}>{m.label}</button>
    : <span title={title} className={c}>{m.label}</span>;
}

export function LoopChip({ step, isDark }: { step: Step; isDark: boolean }) {
  if (!step.loop) return null;
  const parts = [step.loop.condition, step.loop.maxAttempts && `max ${step.loop.maxAttempts}`, step.loop.waitFor]
    .filter(Boolean).join(' · ');
  return (
    <span title={`Wiederholung: ${parts}`}
      className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
        isDark ? 'bg-violet-500/15 text-violet-300 border-violet-500/30' : 'bg-violet-50 text-violet-700 border-violet-300'}`}>
      <Repeat size={9} /> Schleife
    </span>
  );
}

// Blöcke, die an keinem Sequenzfluss hängen: Ereignis-Subprozesse und
// Link-Ziele ohne erkennbares Gegenstück. Sie stehen am Ende des Ablaufs.
export function BlockChip({ step, isDark }: { step: Step; isDark: boolean }) {
  // ein eigener Block bekommt im Baum eine Klammer — der Chip bleibt dem Ereignis-Subprozess
  if (!step.eventSubprocess) return null;
  const label = step.eventSubprocess ? 'Ereignis-Subprozess' : 'eigener Block';
  const title = step.eventSubprocess
    ? 'Subprozess, der durch ein Ereignis ausgelöst wird'
    : 'Hängt an keinem Sequenzfluss — z. B. Ziel eines Link-Ereignisses';
  return (
    <span title={title}
      className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
        isDark ? 'bg-slate-500/15 text-slate-300 border-slate-500/30' : 'bg-slate-100 text-slate-700 border-slate-300'}`}>
      <Unlink size={9} /> {label}
    </span>
  );
}

/** Farbe der Pattern — dieselbe im Baum, im Panel und im Admin */
export const patternTone = (isDark: boolean) =>
  isDark ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300' : 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800';

export const epicTone = (isDark: boolean) =>
  isDark ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' : 'border-indigo-300 bg-indigo-50 text-indigo-800';

/** Ein Epic am Prozess — abgeschlossene gestrichelt und blasser */
export function EpicChip({ name, closed, isDark, title, children }: {
  name: string; closed?: boolean; isDark: boolean; title?: string; children?: React.ReactNode;
}) {
  return (
    <span title={title ?? (closed ? `${name} — abgeschlossen` : name)}
      className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap max-w-[14rem] ${epicTone(isDark)} ${
        closed ? 'border-dashed opacity-60' : ''}`}>
      <Flag size={9} className="flex-shrink-0" /><span className="truncate">{name}</span>{children}
    </span>
  );
}

/** Ein Pattern an einem Schritt: Name, Werte im Tooltip */
export function PatternChip({ name, params, isDark, title }: { name: string; params?: Record<string, string>; isDark: boolean; title?: string }) {
  const werte = Object.entries(params ?? {}).filter(([, v]) => v !== '');
  return (
    <span title={title ?? [`Pattern «${name}»`, ...werte.map(([k, v]) => `${k} = ${v}`)].join('\n')}
      className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap truncate max-w-[14rem] ${patternTone(isDark)}`}>
      <Puzzle size={9} className="flex-shrink-0" />{name}
    </span>
  );
}

/**
 * Die beim Import erkannten Pattern: je Pattern ein Chip mit Anzahl, im
 * Tooltip die Stellen. Ohne Definitionen im Admin wird nichts erkannt —
 * das steht dann da, statt einer leeren Zeile.
 */
export function PatternSummary({ items, nameOf, hasDefs, isDark }: {
  items: Array<{ id: string; where: string[] }>; nameOf: (id: string) => string; hasDefs: boolean; isDark: boolean;
}) {
  const muted = isDark ? 'text-white/40' : 'text-black/40';
  if (!hasDefs) return <p className={`text-[10px] ${muted}`}>Pattern: keine definiert (Admin → Pattern) — nichts erkannt.</p>;
  if (!items.length) return <p className={`text-[10px] ${muted}`}>Pattern: keine erkannt.</p>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`text-[10px] mr-0.5 ${muted}`}>Pattern erkannt:</span>
      {items.map(p => (
        <PatternChip key={p.id} isDark={isDark} name={`${nameOf(p.id)}${p.where.length > 1 ? ` ×${p.where.length}` : ''}`}
          title={[`Pattern «${nameOf(p.id)}»`, ...p.where.map(w => `· ${w}`)].join('\n')} />
      ))}
    </div>
  );
}

export function ErrorChip({ n, isDark }: { n: number; isDark: boolean }) {
  return (
    <span title={`${n} behandelte Fehler`}
      className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
        isDark ? 'bg-white/5 text-white/60 border-white/15' : 'bg-black/[0.03] text-black/60 border-black/15'}`}>
      <ShieldCheck size={9} /> {n}
    </span>
  );
}

// Farbe des Verzweigungs-Strichs — macht parallele Zweige auf einen Blick
// unterscheidbar (der wichtigste visuelle Unterschied zur Confluence-Tabelle).
export const BRANCH_COLORS = [
  { dark: 'border-sky-500/50 text-sky-300',       light: 'border-sky-400 text-sky-700' },
  { dark: 'border-emerald-500/50 text-emerald-300', light: 'border-emerald-400 text-emerald-700' },
  { dark: 'border-fuchsia-500/50 text-fuchsia-300', light: 'border-fuchsia-400 text-fuchsia-700' },
  { dark: 'border-orange-500/50 text-orange-300', light: 'border-orange-400 text-orange-700' },
  { dark: 'border-teal-500/50 text-teal-300',     light: 'border-teal-400 text-teal-700' },
];

export const GATEWAY_ICON = { exclusive: Split, parallel: Merge, inclusive: Split, eventBased: Zap };

/**
 * Griff an der linken Kante eines Panels: ziehen ändert die Breite
 * (zwischen `min` und `max`). Das Panel braucht `relative`.
 */
export function PanelWidthHandle({ isDark, width, onWidth, min = 320, max = 800 }: {
  isDark: boolean; width: number; onWidth: (w: number) => void; min?: number; max?: number;
}) {
  const c = cls(isDark);
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      onPointerDown={e => {
        start.current = { x: e.clientX, w: width };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (!start.current) return;
        onWidth(Math.min(max, Math.max(min, start.current.w - (e.clientX - start.current.x))));
      }}
      onPointerUp={e => {
        start.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }}
      title="Breite ziehen"
      className={`absolute top-0 bottom-0 -left-1 w-2 cursor-col-resize z-10 select-none touch-none flex items-center justify-center ${c.muted} hover:opacity-100 opacity-40`}>
      <GripVertical size={12} />
    </div>
  );
}
