// The counter: «occurred again». A click counts +1 and counts as an
// update — the error moves up in the list.
import { useRef, useState } from 'react';
import { Tally5 } from 'lucide-react';
import { useStore } from '../store';
import { usePermissions } from '../auth';

export default function CountButton({ id, count, size = 'md', onCounted }: {
  id: string; count: number; size?: 'md' | 'lg'; onCounted?: () => void;
}) {
  const { isDark, countError } = useStore();
  const { canEdit } = usePermissions();
  const [busy, setBusy] = useState(false);
  const [bump, setBump] = useState(0);
  const [err, setErr] = useState('');

  // Clicks while a count is in progress are not lost: they are collected
  // and written one after the other.
  const pending = useRef(0);
  const running = useRef(false);
  const click = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    pending.current++;
    if (running.current) return;
    running.current = true; setBusy(true); setErr('');
    while (pending.current > 0) {
      pending.current--;
      const r = await countError(id);
      if (r.ok) { setBump(b => b + 1); onCounted?.(); }
      else { setErr(r.message); pending.current = 0; }
    }
    running.current = false; setBusy(false);
  };

  const lg = size === 'lg';
  const tone = isDark
    ? 'border-white/15 text-white/80 hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-200'
    : 'border-black/15 text-black/80 hover:border-amber-500 hover:bg-amber-50 hover:text-amber-800';

  return (
    <button type="button" onClick={click} disabled={!canEdit}
      title={err || (canEdit ? `Erneut aufgetreten — Zähler +1 (aktuell ${count})` : `${count}× aufgetreten`)}
      aria-label={`Zähler: ${count}. Klicken zählt +1`}
      className={`group flex flex-col items-center justify-center rounded-lg border transition-colors select-none flex-shrink-0
        ${lg ? 'w-20 h-20 gap-1' : 'w-14 h-14 gap-0.5'} ${tone} ${busy ? 'opacity-80' : ''} ${err ? (isDark ? 'border-rose-500/60' : 'border-rose-400') : ''}
        disabled:cursor-default`}>
      <span key={bump} className={`font-bold tabular-nums leading-none ${lg ? 'text-2xl' : 'text-lg'} ${bump ? 'bump' : ''}`}>{count}</span>
      <span className={`flex items-center gap-0.5 leading-none ${lg ? 'text-[10px]' : 'text-[9px]'} ${isDark ? 'text-white/40' : 'text-black/40'} ${canEdit ? 'group-hover:text-inherit' : ''}`}>
        <Tally5 size={lg ? 12 : 10} />{canEdit ? '+1' : '×'}
      </span>
    </button>
  );
}
