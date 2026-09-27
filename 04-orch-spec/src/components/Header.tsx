// Bausteine der Kopfzeile: ein Knopf im Geist-Stil (unter 900 px nur das
// Zeichen, der Text im Tooltip) und der Konto-Chip mit Kürzel, Name und
// Rolle — Abmelden erscheint beim Überfahren.
import { ChevronRight, LogOut, ShieldCheck } from 'lucide-react';
import { LEVEL_LABELS, type AccessLevel, type AuthUser } from '../auth';
import { cls } from '../ui';
import { initialsOf } from './StartCard';

export function HeaderButton({ isDark, icon, label, title, active, onClick, href }: {
  isDark: boolean; icon: React.ReactNode; label: string; title?: string; active?: boolean;
  onClick?: () => void; href?: string;
}) {
  const c = cls(isDark);
  const className = `flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border transition-colors max-w-[12rem] ${
    active ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10') : c.btn}`;
  const inner = <>{icon}<span className="hidden min-[900px]:inline truncate">{label}</span></>;
  return href
    ? <a href={href} title={title ?? label} className={className}>{inner}</a>
    : <button onClick={onClick} title={title ?? label} className={className}>{inner}</button>;
}

const LEVEL_TONE: Record<AccessLevel, (isDark: boolean) => string> = {
  admin: d => (d ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-800'),
  reviewer: d => (d ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' : 'border-blue-300 bg-blue-50 text-blue-700'),
  viewer: d => (d ? 'border-white/15 text-white/50' : 'border-black/15 text-black/50'),
  none: d => (d ? 'border-rose-500/40 text-rose-300' : 'border-rose-300 text-rose-700'),
};

const LEVEL_SHORT: Record<AccessLevel, string> = { admin: 'Admin', reviewer: 'Reviewer', viewer: 'Viewer', none: 'keine Rolle' };

export function AccountChip({ isDark, user, level, onLogout }: {
  isDark: boolean; user: AuthUser; level: AccessLevel; onLogout: () => void;
}) {
  const c = cls(isDark);
  return (
    <span className={`group/acct flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded border ${c.border2}`}
      title={`${user.name} · ${user.email}\n${LEVEL_LABELS[level]}`}>
      <span className={`inline-flex items-center justify-center min-w-[22px] h-[18px] px-1 rounded-full text-[9px] font-bold border flex-shrink-0 ${
        isDark ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'bg-blue-50 text-blue-700 border-blue-300'}`}>
        {initialsOf(user.name)}
      </span>
      <span className={`hidden min-[900px]:inline text-[11px] truncate max-w-[10rem] ${c.muted2}`}>{user.name}</span>
      <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-px rounded border ${LEVEL_TONE[level](isDark)}`}>
        {level === 'admin' && <ShieldCheck size={9} />}{LEVEL_SHORT[level]}
      </span>
      <button onClick={onLogout} title="Abmelden"
        className={`p-0.5 rounded transition-all w-0 opacity-0 overflow-hidden group-hover/acct:w-auto group-hover/acct:opacity-100 focus:w-auto focus:opacity-100 ${c.muted} hover:opacity-100`}>
        <LogOut size={12} />
      </button>
    </span>
  );
}

/** Der Ort in der Kopfzeile: «Prozesse › Titel». Glieder mit onClick führen zurück. */
export function Breadcrumb({ isDark, items }: { isDark: boolean; items: Array<{ label: string; onClick?: () => void }> }) {
  const c = cls(isDark);
  return (
    <span className="flex items-center gap-1 min-w-0 text-[11px]">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          <ChevronRight size={11} className={`flex-shrink-0 ${c.muted}`} />
          {it.onClick
            ? <button onClick={it.onClick} className={`truncate hover:underline ${c.muted2}`}>{it.label}</button>
            : <span className={`truncate max-w-[16rem] ${i === items.length - 1 ? c.text : c.muted2}`} title={it.label}>{it.label}</span>}
        </span>
      ))}
    </span>
  );
}
