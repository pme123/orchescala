// The counter: «occurred again». A click counts +1 and counts as an
// update — the error moves up in the list.
//
// Every click is its own +1. The store queues them per error (also across the
// list's and the drawer's button), so fast clicks are all written; one that
// fails does not cancel the others and is shown at the button.
import { useEffect, useRef, useState } from 'react';
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

  const inFlight = useRef(0);
  const click = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    inFlight.current++;
    setBusy(true); setErr('');
    try {
      const r = await countError(id);
      if (r.ok) { setBump(b => b + 1); onCounted?.(); }
      else setErr(r.message);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      // never stuck in «busy», whatever happened
      if (--inFlight.current === 0) setBusy(false);
    }
  };

  // the hint below the button goes away again
  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(''), 8000);
    return () => clearTimeout(t);
  }, [err]);

  const lg = size === 'lg';
  const tone = isDark
    ? 'border-white/15 text-white/80 hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-200'
    : 'border-black/15 text-black/80 hover:border-amber-500 hover:bg-amber-50 hover:text-amber-800';

  return (
    <span className="relative flex-shrink-0">
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
    {err && (
      <span role="alert" title={err} onClick={ev => ev.stopPropagation()}
        className={`absolute left-1/2 -translate-x-1/2 top-full mt-1 z-10 whitespace-nowrap text-[9px] px-1.5 py-0.5 rounded border shadow
          ${isDark ? 'bg-rose-950 text-rose-200 border-rose-500/50' : 'bg-rose-50 text-rose-700 border-rose-300'}`}>
        nicht gezählt
      </span>
    )}
    </span>
  );
}
