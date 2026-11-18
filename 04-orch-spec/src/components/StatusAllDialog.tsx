// One status for all parts of the specification: steps, classes and interactions.
//
// The dialog shows what carries which status today; the new status is picked
// and only applies on «Status setzen» — nothing is preselected, so an
// accidental Enter changes nothing. A click on a row of today's statuses
// filters the flow by it instead.
import { useEffect, useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { partCounts, partsText, partsToChange, partsWithoutStatus, partTotal, type PartCount } from '../status';
import { STATUSES, STATUS_META, type ProcessSpec, type Status } from '../types';
import { cls } from '../ui';

export default function StatusAllDialog({ spec, isDark, canEdit, onApply, onFilter, onClose }: {
  spec: ProcessSpec;
  isDark: boolean;
  /** without the right to edit, the dialog only shows the statuses */
  canEdit: boolean;
  onApply: (status: Status, changed: PartCount) => void;
  /** show the steps with this status in the flow */
  onFilter: (status: Status) => void;
  onClose: () => void;
}) {
  const c = cls(isDark);
  const [picked, setPicked] = useState<Status | null>(null);
  const counts = useMemo(() => partCounts(spec), [spec]);
  const present = STATUSES.filter(s => partTotal(counts[s]) > 0);
  const none = useMemo(() => partsWithoutStatus(spec), [spec]);
  const hasParts = present.length > 0 || partTotal(none) > 0;

  // what changes: everything that carries another status than the picked one, or none
  const changed = useMemo(() => (picked ? partsToChange(spec, picked) : null), [picked, spec]);
  const changes = changed ? partTotal(changed) : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chip = (s: Status) => `text-[10px] px-2 py-0.5 rounded border whitespace-nowrap ${isDark ? STATUS_META[s].dark : STATUS_META[s].light}`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="status-all-title"
        className={`max-w-md w-full max-h-[85vh] overflow-y-auto rounded-xl border p-5 ${c.border2} ${c.panelStrong}`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 id="status-all-title" className={`text-sm font-semibold ${c.text}`}>Status der Spezifikation</h3>
          <button onClick={onClose} title="Schliessen" className={`p-1 ${c.muted}`}><X size={14} /></button>
        </div>

        <p className={`text-[11px] leading-relaxed mb-2 ${c.muted}`}>
          Der Status der Spezifikation ist der kleinste Status ihrer Teile
          ({STATUSES.map(s => STATUS_META[s].label).join(' → ')}).
        </p>

        <div className={`text-[10px] uppercase tracking-wide mb-1 ${c.muted}`}>Heute</div>
        <div className="space-y-1 mb-4">
          {!hasParts && <div className={`text-[11px] ${c.muted}`}>Noch keine Teile mit Status.</div>}
          {present.map(s => (
            <button key={s} onClick={() => onFilter(s)} title={`«${STATUS_META[s].label}» im Ablauf zeigen`}
              className={`w-full flex items-center gap-2 text-left px-1.5 py-1 rounded ${c.hover}`}>
              <span className={chip(s)}>{STATUS_META[s].label}</span>
              <span className={`text-[11px] ${c.muted2}`}>{partsText(counts[s])}</span>
            </button>
          ))}
          {partTotal(none) > 0 && (
            <div className="flex items-center gap-2 px-1.5 py-1" title="Zählen nicht für den Status der Spezifikation">
              <span className={`text-[10px] px-2 py-0.5 rounded border border-dashed whitespace-nowrap ${c.border2} ${c.muted}`}>Ohne Status</span>
              <span className={`text-[11px] ${c.muted2}`}>{partsText(none)}</span>
            </div>
          )}
        </div>

        {canEdit && hasParts && (
          <>
            <div className={`text-[10px] uppercase tracking-wide mb-1.5 ${c.muted}`}>Für alle Teile setzen</div>
            <div role="radiogroup" aria-label="Neuer Status für alle Teile" className="flex flex-wrap gap-1.5 mb-3">
              {STATUSES.map(s => (
                <button key={s} role="radio" aria-checked={picked === s} onClick={() => setPicked(s)}
                  className={`${chip(s)} flex items-center gap-1 transition-opacity ${
                    picked === s ? 'ring-2 ring-offset-1 ring-current ' + (isDark ? 'ring-offset-[#16171a]' : 'ring-offset-white')
                      : picked ? 'opacity-40 hover:opacity-80' : 'hover:opacity-80'}`}>
                  {picked === s && <Check size={10} />}{STATUS_META[s].label}
                </button>
              ))}
            </div>
            <p className={`text-[11px] leading-relaxed min-h-[2.5em] ${c.muted2}`}>
              {!picked ? 'Status wählen — gesetzt wird erst mit der Bestätigung.'
                : changes && changed
                  ? <>{partsText(changed)} {changes === 1 ? 'bekommt' : 'bekommen'} «{STATUS_META[picked].label}».</>
                  : <>Alle Teile sind bereits «{STATUS_META[picked].label}».</>}
            </p>
          </>
        )}

        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className={`text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>{canEdit ? 'Abbrechen' : 'Schliessen'}</button>
          {canEdit && hasParts && (
            <button disabled={!picked || !changes || !changed} onClick={() => { if (picked && changed) onApply(picked, changed); }}
              className={`text-[11px] px-3 py-1.5 rounded font-semibold disabled:opacity-30 disabled:cursor-not-allowed ${c.btnPrimary}`}>
              {picked ? `Alle auf «${STATUS_META[picked].label}» setzen` : 'Status setzen'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
