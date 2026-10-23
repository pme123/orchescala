// Shared UI building blocks: color classes per mode and the status tags.
// Same look as orch-spec and arch-review.
import type { StatusColor, StatusDef } from './types';

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
  error: isDark ? 'text-rose-400' : 'text-rose-600',
});

// colors like the Confluence lozenges, in the app's style
export const STATUS_STYLE: Record<StatusColor, { light: string; dark: string; dot: string }> = {
  neutral: { light: 'bg-slate-100 text-slate-700 border-slate-300', dark: 'bg-slate-500/15 text-slate-300 border-slate-500/30', dot: 'bg-slate-400' },
  blue: { light: 'bg-sky-50 text-sky-700 border-sky-300', dark: 'bg-sky-500/15 text-sky-300 border-sky-500/30', dot: 'bg-sky-500' },
  green: { light: 'bg-emerald-50 text-emerald-700 border-emerald-300', dark: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-500' },
  yellow: { light: 'bg-amber-50 text-amber-700 border-amber-300', dark: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dot: 'bg-amber-500' },
  red: { light: 'bg-rose-50 text-rose-700 border-rose-300', dark: 'bg-rose-500/15 text-rose-300 border-rose-500/30', dot: 'bg-rose-500' },
  purple: { light: 'bg-violet-50 text-violet-700 border-violet-300', dark: 'bg-violet-500/15 text-violet-300 border-violet-500/30', dot: 'bg-violet-500' },
};

export const STATUS_COLORS = Object.keys(STATUS_STYLE) as StatusColor[];

export function statusDef(label: string, statuses: StatusDef[]): StatusDef {
  return statuses.find(s => s.label === label) ?? { label, color: 'neutral' };
}

export function StatusTag({ label, statuses, isDark, active, onClick, count, title }: {
  label: string; statuses: StatusDef[]; isDark: boolean;
  active?: boolean; onClick?: () => void; count?: number; title?: string;
}) {
  const d = statusDef(label, statuses);
  const st = STATUS_STYLE[d.color] ?? STATUS_STYLE.neutral;
  const base = `inline-flex items-center gap-1 text-[9px] font-semibold tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${isDark ? st.dark : st.light}`;
  const off = active === false ? 'opacity-40 grayscale hover:opacity-80' : '';
  const ring = active ? (isDark ? 'ring-1 ring-white/50' : 'ring-1 ring-black/40') : '';
  const body = <>{label}{count != null && <span className="opacity-60 font-normal">{count}</span>}</>;
  return onClick
    ? <button type="button" title={title} onClick={e => { e.stopPropagation(); onClick(); }} className={`${base} ${off} ${ring} cursor-pointer transition`}>{body}</button>
    : <span title={title} className={base}>{body}</span>;
}
