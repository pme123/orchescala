// Was man mit einem Baustein tun kann - dieselben Aktionen im Kopf der Eigenschaften, an der Vorschau
// und in der Gliederung: verschieben, verdoppeln, löschen, Typ wechseln, einfügen, in einen Abschnitt.
import { ArrowDown, ArrowUp, Copy, FolderInput, FolderOutput, Plus, Repeat2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Component } from '../runtime/spec';
import { cls } from '../../ui';
import { BLOCK_LABELS } from './BlockProps';
import type { Place } from './model';

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

/** Die Kürzel - im Tooltip der Knöpfe, damit man sie findet. */
const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Strg+';

export function BlockActions({ isDark, block, ops, compact }: {
  isDark: boolean; block: Component; ops: BlockOps; compact?: boolean;
}) {
  const c = cls(isDark);
  const [menu, setMenu] = useState<null | 'type' | Place>(null);
  const box = useRef<HTMLDivElement>(null);
  // ein Klick daneben schliesst das Menü
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  const btn = (title: string, icon: React.ReactNode, onClick: () => void, label?: string) => (
    <button type="button" title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex items-center gap-1 rounded ${compact ? 'p-1' : 'px-1.5 py-1'} text-[10px] ${c.muted2} hover:text-sky-500 ${c.hover}`}>
      {icon}{!compact && label && <span>{label}</span>}
    </button>
  );
  const size = compact ? 11 : 12;
  return (
    <div ref={box} className="relative flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {btn(`nach oben (⌥↑)`, <ArrowUp size={size} />, () => ops.move(-1))}
      {btn(`nach unten (⌥↓)`, <ArrowDown size={size} />, () => ops.move(1))}
      {btn(`verdoppeln (${MOD}D)`, <Copy size={size} />, ops.duplicate, compact ? undefined : 'Kopie')}
      {btn('Typ wechseln', <Repeat2 size={size} />, () => setMenu(menu === 'type' ? null : 'type'), compact ? undefined : 'Typ')}
      {btn('Baustein einfügen', <Plus size={size} />, () => setMenu(menu === 'after' ? null : 'after'), compact ? undefined : 'Einfügen')}
      {block.type === 'section'
        ? btn('Abschnitt auflösen - seine Bausteine bleiben', <FolderOutput size={size} />, ops.unwrap)
        : btn('in einen Abschnitt packen', <FolderInput size={size} />, ops.wrap)}
      {btn('löschen (Entf) - rückgängig mit ' + MOD + 'Z', <Trash2 size={size} />, ops.remove)}
      {menu && (
        <div className={`absolute right-0 top-full z-30 mt-1 w-56 rounded border shadow-lg ${c.border2} ${c.panelStrong}`}>
          {menu === 'type' ? (
            <>
              <div className={`px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest ${c.muted}`}>Typ wechseln - Text und Bedingung bleiben</div>
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
