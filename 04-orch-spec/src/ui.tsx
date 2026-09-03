// Gemeinsame Bausteine der Oberfläche: Farbklassen je Modus, Status-Chip und
// die Symbole je Schritt-Art. Bewusst klein gehalten — die Views bleiben lesbar.
import {
  Play, Square, Cog, User, GitBranch, Boxes, Send, Inbox, Table2, Code2, Hand,
  CornerDownRight, Zap, Repeat, AlertTriangle, Split, Merge, Unlink,
} from 'lucide-react';
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

export function StatusChip({ status, isDark, onClick, title }: {
  status: Status; isDark: boolean; onClick?: () => void; title?: string;
}) {
  const m = STATUS_META[status];
  const c = `text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${isDark ? m.dark : m.light}`;
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
  if (!step.orphan && !step.eventSubprocess) return null;
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

export function ErrorChip({ n, isDark }: { n: number; isDark: boolean }) {
  return (
    <span title={`${n} behandelte Fehler`}
      className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
        isDark ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-300'}`}>
      <AlertTriangle size={9} /> {n}
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
