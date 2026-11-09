// The types the hierarchy has for a collection — each with a checkbox: checked, the class of the
// hierarchy is taken (the own type goes); unchecked, the collection keeps its own type.
// All are checked at first. Used by the preview of the Abgleich, after an OpenAPI import and by
// the button «Typen aus der Hierarchie übernehmen».
import { Layers } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Model } from '../types';
import { cls } from '../ui';
import { adoptHierarchyTypes, type Adopted } from './hierarchy';
import type { ServiceCollectionSpec } from './types';

/** `acme.crm.domain.clientMaster.schema.Gender` → `schema.Gender` */
const shortRef = (from: string) => from.split('.').slice(-2).join('.');

/**
 * The checkboxes of the found types.
 * @param candidates all the hierarchy offers — when nothing is kept
 * @param current    what is taken with the types kept now: a candidate missing here (and not kept)
 *                   matched only through a kept type — it stays the collection's own too
 */
export function AdoptList({ candidates, current, keep, onKeep, isDark }: {
  candidates: Adopted[]; current: Adopted[]; keep: ReadonlySet<string>;
  onKeep: (keep: Set<string>) => void; isDark: boolean;
}) {
  const c = cls(isDark);
  const now = new Map(current.map(a => [a.id, a]));
  // what only a kept type made possible may come back with another class: the one of now
  const rows = [...candidates.map(a => now.get(a.id) ?? a), ...current.filter(a => !candidates.some(x => x.id === a.id))];
  const toggle = (id: string) => {
    const next = new Set(keep);
    if (next.has(id)) next.delete(id); else next.add(id);
    onKeep(next);
  };
  const all = rows.every(a => !keep.has(a.id));
  return (
    <div className="space-y-1">
      <label className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest cursor-pointer ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>
        <input type="checkbox" checked={all} onChange={() => onKeep(all ? new Set(rows.map(a => a.id)) : new Set())} title="alle wählen bzw. keinen" />
        Aus der Hierarchie übernehmen · {current.length} von {rows.length}
      </label>
      <div className="space-y-0.5 pl-1">
        {rows.map(a => {
          const kept = keep.has(a.id);
          const follows = !kept && !now.has(a.id);
          return (
            <label key={a.id} className={`flex items-start gap-1.5 text-[11px] font-mono ${follows ? 'opacity-50' : 'cursor-pointer'} ${c.text}`}
              title={follows ? 'passt nur mit einem abgewählten Typ — bleibt ein eigener Typ' : kept ? 'bleibt ein eigener Typ der Collection' : `statt des eigenen Typs: ${a.from}`}>
              <input type="checkbox" className="mt-0.5" disabled={follows} checked={!kept && !follows} onChange={() => toggle(a.id)} />
              <span className="min-w-0">
                {a.renamed ? <>{a.name} <span className={c.muted}>→</span> {shortRef(a.from)}</> : shortRef(a.from)}
                {kept && <span className={`font-sans ${c.muted}`}> — eigener Typ</span>}
                {follows && <span className={`font-sans ${c.muted}`}> — hängt an einem abgewählten Typ</span>}
                {!kept && !follows && a.differs?.length ? <span className={`font-sans ${isDark ? 'text-amber-300' : 'text-amber-700'}`}> — andere Felder: {a.differs.join(', ')}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** The found types of a collection to choose — before they are taken. */
export function AdoptDialog({ base, model, isDark, intro, onCancel, onApply }: {
  base: ServiceCollectionSpec; model: Model | null; isDark: boolean; intro?: string;
  onCancel: () => void; onApply: (spec: ServiceCollectionSpec, adopted: Adopted[]) => void;
}) {
  const c = cls(isDark);
  const candidates = useMemo(() => adoptHierarchyTypes(base, model).adopted, [base, model]);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const h = useMemo(() => adoptHierarchyTypes(base, model, keep), [base, model, keep]);
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center pt-24" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className={`w-[36rem] max-w-[95vw] rounded-lg border shadow-xl p-4 space-y-3 ${c.border2} ${c.panelStrong}`}>
        <div className={`flex items-center gap-2 text-xs font-semibold ${c.text}`}><Layers size={13} /> Typen aus der Hierarchie</div>
        <p className={`text-[10px] ${c.muted}`}>
          {intro ? `${intro} ` : ''}Die Hierarchie hat diese Typen schon — gleicher Name oder gleiche Werte bzw. Felder. Gewählte werden von dort
          genommen, der eigene Typ fällt weg; abgewählte bleiben eigene Typen der Collection.
        </p>
        <div className="max-h-[50vh] overflow-y-auto">
          <AdoptList candidates={candidates} current={h.adopted} keep={keep} onKeep={setKeep} isDark={isDark} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className={`text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>{intro ? 'Keinen übernehmen' : 'Abbrechen'}</button>
          <button onClick={() => onApply(h.spec, h.adopted)} autoFocus
            className={`text-[11px] px-3 py-1.5 rounded border border-transparent ${c.btnPrimary}`}>
            {h.adopted.length ? `${h.adopted.length} übernehmen` : 'Alle als eigene Typen'}
          </button>
        </div>
      </div>
    </div>
  );
}
