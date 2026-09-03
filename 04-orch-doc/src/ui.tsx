// Shared building blocks: mode-dependent classes, chips and small helpers.
// Same vocabulary as orch-spec — monospace, neutral surfaces, tinted chips.
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CatalogKind } from './types';

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
  btnActive: isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10',
  link: isDark ? 'text-sky-300 hover:text-sky-200' : 'text-sky-800 hover:text-sky-600',
});

/** Pastel project colour from the Orchescala config; `white` means "no colour". */
export function projectStyle(color: string | undefined, isDark: boolean): React.CSSProperties {
  if (!color || color === 'white') return {};
  // In dark mode the pastel is used as a tint on a dark surface, not as a fill.
  return isDark
    ? { background: `color-mix(in srgb, ${color} 18%, transparent)`, borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }
    : { background: color, borderColor: `color-mix(in srgb, ${color} 60%, black 12%)` };
}

/** Group colours come as CSS names (purple, blue …) — lighten them on dark surfaces. */
export const groupColor = (color: string, isDark: boolean) => isDark ? `color-mix(in srgb, ${color} 55%, white)` : color;

export function ProjectChip({ name, color, isDark, href, version, title, size = 'sm', active, onClick }: {
  name: string; color?: string; isDark: boolean; href?: string; version?: string; title?: string;
  size?: 'sm' | 'md'; active?: boolean; onClick?: () => void;
}) {
  const c = cls(isDark);
  const base = `inline-flex items-center gap-1.5 rounded border whitespace-nowrap transition-colors ${
    size === 'md' ? 'text-[11px] px-2.5 py-1' : 'text-[10px] px-2 py-0.5'} ${c.border2} ${
    active ? (isDark ? 'ring-2 ring-white/40' : 'ring-2 ring-black/30') : ''} ${href || onClick ? c.hover + ' cursor-pointer' : ''}`;
  const inner = <>
    <span className="font-semibold">{name}</span>
    {version && <span className="opacity-60">{version}</span>}
  </>;
  const style = projectStyle(color, isDark);
  if (href) return <a href={href} title={title} className={base} style={style} onClick={onClick}>{inner}</a>;
  return <span title={title} className={base} style={style} onClick={onClick}>{inner}</span>;
}

export const KIND_META: Record<CatalogKind, { label: string; dark: string; light: string }> = {
  Bpmn:     { label: 'Process',   dark: 'bg-violet-500/15 text-violet-300 border-violet-500/30', light: 'bg-violet-50 text-violet-700 border-violet-300' },
  Worker:   { label: 'Worker',    dark: 'bg-sky-500/15 text-sky-300 border-sky-500/30',          light: 'bg-sky-50 text-sky-700 border-sky-300' },
  Message:  { label: 'Message',   dark: 'bg-amber-500/15 text-amber-300 border-amber-500/30',    light: 'bg-amber-50 text-amber-700 border-amber-300' },
  Signal:   { label: 'Signal',    dark: 'bg-orange-500/15 text-orange-300 border-orange-500/30', light: 'bg-orange-50 text-orange-700 border-orange-300' },
  UserTask: { label: 'User Task', dark: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', light: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  Dmn:      { label: 'Decision',  dark: 'bg-teal-500/15 text-teal-300 border-teal-500/30',       light: 'bg-teal-50 text-teal-700 border-teal-300' },
  Timer:    { label: 'Timer',     dark: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30', light: 'bg-indigo-50 text-indigo-700 border-indigo-300' },
  Other:    { label: 'Other',     dark: 'bg-slate-500/15 text-slate-300 border-slate-500/30',    light: 'bg-slate-100 text-slate-700 border-slate-300' },
};

export function KindChip({ kind, isDark, onClick, active }: { kind: CatalogKind; isDark: boolean; onClick?: () => void; active?: boolean }) {
  const m = KIND_META[kind];
  const c = `text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${isDark ? m.dark : m.light} ${active ? 'ring-2 ring-current/30' : ''}`;
  return onClick ? <button onClick={onClick} className={`${c} cursor-pointer`}>{m.label}</button> : <span className={c}>{m.label}</span>;
}

/** new / patched / unchanged in this release */
export function ReleaseStatus({ status, isDark }: { status: 'new' | 'patched' | 'unchanged'; isDark: boolean }) {
  if (status === 'unchanged') return null;
  const s = status === 'new'
    ? isDark ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-300'
    : isDark ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-300';
  return <span className={`text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${s}`}>{status === 'new' ? 'new' : 'patched'}</span>;
}

export function Section({ title, children, isDark, right, id }: { title: ReactNode; children: ReactNode; isDark: boolean; right?: ReactNode; id?: string }) {
  const c = cls(isDark);
  return (
    <section id={id} className="mb-8 scroll-mt-4">
      <div className={`flex items-center gap-3 mb-3 pb-1.5 border-b ${c.border}`}>
        <h2 className={`text-[11px] font-bold uppercase tracking-widest ${c.muted2}`}>{title}</h2>
        {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, isDark, className = '', style }: { children: ReactNode; isDark: boolean; className?: string; style?: React.CSSProperties }) {
  const c = cls(isDark);
  return <div style={style} className={`rounded-lg border ${c.border} ${c.panelStrong} ${className}`}>{children}</div>;
}

export function ExtLink({ href, children, isDark, className = '' }: { href: string; children: ReactNode; isDark: boolean; className?: string }) {
  const c = cls(isDark);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 ${c.link} ${className}`}>
      {children}<ExternalLink size={9} className="opacity-60" />
    </a>
  );
}

export function Empty({ children, isDark }: { children: ReactNode; isDark: boolean }) {
  return <p className={`text-[11px] italic ${cls(isDark).muted}`}>{children}</p>;
}

/** Page title with optional meta line underneath */
export function PageTitle({ title, meta, isDark, right }: { title: ReactNode; meta?: ReactNode; isDark: boolean; right?: ReactNode }) {
  const c = cls(isDark);
  return (
    <div className="flex items-start gap-4 mb-6">
      <div className="min-w-0">
        <h1 className={`text-lg font-bold tracking-tight ${c.text}`}>{title}</h1>
        {meta && <div className={`text-[11px] mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 ${c.muted}`}>{meta}</div>}
      </div>
      {right && <div className="ml-auto flex items-center gap-2 flex-shrink-0">{right}</div>}
    </div>
  );
}
