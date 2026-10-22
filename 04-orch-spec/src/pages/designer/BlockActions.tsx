// What can be done with a building block - the same actions in the header of the properties, on the preview
// and in the outline: move, duplicate, delete, change type, insert, into a section.
import { ArrowDown, ArrowUp, Copy, FolderInput, FolderOutput, Plus, Repeat2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Component } from '../runtime/spec';
import { cls } from '../../ui';
import { BLOCK_LABELS } from './BlockProps';
import { lostOnConvert, type Place } from './model';

export type BlockOps = {
  move: (by: -1 | 1) => void;
  duplicate: () => void;
  remove: () => void;
  convert: (type: Component['type']) => void;
  insert: (type: Component['type'], place: Place) => void;
  wrap: () => void;
  unwrap: () => void;
};

const TYPES = Object.keys(BLOCK_LABELS) as Component['type'][];

/** The shortcuts - in the tooltip of the buttons, so they can be found. */
const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Strg+';

export function BlockActions({ isDark, block, ops, compact }: {
  isDark: boolean; block: Component; ops: BlockOps; compact?: boolean;
}) {
  const c = cls(isDark);
  const [menu, setMenuState] = useState<null | 'type' | Place>(null);
  // upwards if there is no room below (the last rows of the outline, at the bottom of the preview)
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const setMenu = (next: null | 'type' | Place) => {
    if (next && !menu) setUp((box.current?.getBoundingClientRect().bottom ?? 0) > window.innerHeight - 280);
    setMenuState(next);
  };
  // a click beside it closes the menu; Esc too - before the designer (which would otherwise deselect the building block)
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenuState(null); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setMenuState(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc, true);
    };
  }, [menu]);
  const btn = (title: string, icon: React.ReactNode, onClick: () => void, label?: string) => (
    <button type="button" title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex items-center gap-1 rounded ${compact ? 'p-1' : 'px-1.5 py-1'} text-[10px] ${c.muted2} hover:text-sky-500 ${c.hover}`}>
      {icon}{!compact && label && <span>{label}</span>}
    </button>
  );
  const size = compact ? 11 : 12;
  const lost = lostOnConvert(block);
  return (
    <div ref={box} className="relative flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}
      // in the outline the buttons only appear on hover - their menu goes with them
      onMouseLeave={() => compact && setMenuState(null)}>
      {btn(`nach oben (⌥↑)`, <ArrowUp size={size} />, () => ops.move(-1))}
      {btn(`nach unten (⌥↓)`, <ArrowDown size={size} />, () => ops.move(1))}
      {btn(`verdoppeln (${MOD}D)`, <Copy size={size} />, ops.duplicate, compact ? undefined : 'Kopie')}
      {block.type === 'section' && block.body.length > 0
        // another type would lose the building blocks of the section - dissolve it first
        ? <span title="Ein Abschnitt mit Bausteinen - erst auflösen, dann den Typ wechseln"
            className={`flex items-center gap-1 ${compact ? 'p-1' : 'px-1.5 py-1'} text-[10px] opacity-35 ${c.muted2}`}>
            <Repeat2 size={size} />{!compact && 'Typ'}
          </span>
        : btn('Typ wechseln', <Repeat2 size={size} />, () => setMenu(menu === 'type' ? null : 'type'), compact ? undefined : 'Typ')}
      {btn('Baustein einfügen', <Plus size={size} />, () => setMenu(menu === 'after' ? null : 'after'), compact ? undefined : 'Einfügen')}
      {block.type === 'section'
        ? btn('Abschnitt auflösen - seine Bausteine bleiben', <FolderOutput size={size} />, ops.unwrap)
        : btn('in einen Abschnitt packen', <FolderInput size={size} />, ops.wrap)}
      {btn('löschen (Entf) - rückgängig mit ' + MOD + 'Z', <Trash2 size={size} />, ops.remove)}
      {menu && (
        <div className={`absolute right-0 z-30 w-56 max-h-72 overflow-y-auto rounded border shadow-lg ${up ? 'bottom-full mb-1' : 'top-full mt-1'} ${c.border2} ${c.panelStrong}`}>
          {menu === 'type' ? (
            <>
              <div className={`px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest ${c.muted}`}>Typ wechseln - Text und Bedingung bleiben</div>
              {lost && (
                <div className="px-3 pb-1.5 text-[10px] text-amber-600">
                  Geht verloren: {lost} - rückgängig mit {MOD}Z
                </div>
              )}
              {TYPES.map((t) => (
                <button key={t} type="button" disabled={t === block.type}
                  onClick={() => { ops.convert(t); setMenu(null); }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] disabled:opacity-40 ${c.hover}`}>
                  {BLOCK_LABELS[t]}{t === block.type ? ' (jetzt)' : ''}
                </button>
              ))}
            </>
          ) : (
            <>
              <div className={`flex gap-1 px-2 pt-2 pb-1`}>
                {(['before', 'after', ...(block.type === 'section' ? ['inside' as const] : [])] as Place[]).map((p) => (
                  <button key={p} type="button" onClick={() => setMenu(p)}
                    className={`flex-1 text-[10px] px-1.5 py-1 rounded border ${menu === p ? c.btnPrimary : c.btn}`}>
                    {p === 'before' ? 'davor' : p === 'after' ? 'danach' : 'hinein'}
                  </button>
                ))}
              </div>
              {TYPES.map((t) => (
                <button key={t} type="button" onClick={() => { ops.insert(t, menu as Place); setMenu(null); }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] ${c.hover}`}>
                  {BLOCK_LABELS[t]}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
