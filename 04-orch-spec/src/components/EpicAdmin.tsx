// Admin: Epics — Klammern über mehrere Prozesse, z. B. ein Change.
//
// Anlegen, umbenennen, abschliessen und löschen darf nur ein Admin (die
// Liste liegt in der model.json); zuordnen kann am Prozess, wer bearbeitet.
// Die ID entsteht beim Anlegen aus dem Namen und bleibt — ein Umbenennen
// ändert nur die Anzeige, die Spezifikationen tragen weiter dieselbe ID.
//
// Abschliessen statt löschen: ein abgeschlossenes Epic lässt sich nicht mehr
// zuweisen, bleibt aber am Prozess sichtbar und in der Übersicht filterbar.
import { useState } from 'react';
import { ExternalLink, Flag, Plus, Trash2 } from 'lucide-react';
import type { EpicDef, Model, ProcessSpec } from '../types';
import { newEpicId } from '../epics';
import { EpicChip, cls } from '../ui';
import { AdminSection, SaveRow, flashOf, useFlash, type AdminTone } from './adminUi';
import { useConfirm } from './Confirm';

type Save = (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;

/** Zustand für Statusleiste und Kartenkopf */
export function epicState(model: Model): { tone: AdminTone; label: string; detail?: string } {
  const all = model.epics ?? [];
  if (!all.length) return { tone: 'off', label: 'keine', detail: 'noch keine Epics angelegt' };
  const open = all.filter(e => !e.closed);
  return {
    tone: 'ok',
    label: `${open.length} offen`,
    detail: `${open.map(e => e.name).join(', ') || '—'}${all.length > open.length ? ` · ${all.length - open.length} abgeschlossen` : ''}`,
  };
}

export default function EpicAdmin({ model, specs, isDark, onSave, state }: {
  model: Model; specs: ProcessSpec[]; isDark: boolean; onSave: Save; state: React.ReactNode;
}) {
  const c = cls(isDark);
  const confirm = useConfirm();
  const [draft, setDraft] = useState<EpicDef[]>(model.epics ?? []);
  const [neu, setNeu] = useState('');
  const [flash, setFlash] = useFlash();
  const uses = (id: string) => specs.filter(s => s.epics?.includes(id)).length;
  const set = (id: string, patch: Partial<EpicDef>) => {
    setDraft(d => d.map(e => (e.id === id ? { ...e, ...patch } : e)));
    setFlash(null);
  };

  const hinzufuegen = () => {
    const name = neu.trim();
    if (!name) return;
    // auch IDs gelöschter Epics, die noch in Spezifikationen stehen, sind vergeben
    const taken = [...draft.map(e => e.id), ...specs.flatMap(s => s.epics ?? [])];
    setDraft(d => [...d, { id: newEpicId(name, taken), name }]);
    setNeu('');
    setFlash(null);
  };

  const loeschen = async (e: EpicDef) => {
    const n = uses(e.id);
    const ok = await confirm({
      title: `Epic «${e.name}» löschen?`,
      ...(n ? { text: `${n} Prozess${n === 1 ? ' trägt' : 'e tragen'} es. Dort wird es nicht mehr gezeigt — «abgeschlossen» behält die Zuordnung.` } : {}),
    });
    if (ok) { setDraft(d => d.filter(x => x.id !== e.id)); setFlash(null); }
  };

  const speichern = async () => {
    const cleaned = draft.map(e => ({
      ...e,
      name: e.name.trim() || e.id,
      description: e.description?.trim() || undefined,
      url: e.url?.trim() || undefined,
      closed: e.closed || undefined,
    }));
    const res = await onSave({ ...model, epics: cleaned.length ? cleaned : undefined });
    if (res.ok) setDraft(cleaned);
    setFlash(flashOf(res));
  };

  return (
    <AdminSection id="epics" icon={<Flag size={13} />} title="Epics" isDark={isDark} state={state}
      hint="Klammern über mehrere Prozesse, z. B. ein Change — am Prozess zuzuordnen, in der Übersicht zu filtern."
      more={<>Ein Prozess kann in beliebig vielen Epics stehen. Die ID entsteht beim Anlegen aus dem Namen und
        bleibt; umbenennen ändert nur die Anzeige. <b>Abgeschlossen</b> heisst: nicht mehr zuweisbar, aber am
        Prozess und im Filter noch da. Löschen entfernt das Epic nur hier — in den Spezifikationen bleibt die
        ID stehen, wird aber nicht mehr gezeigt.</>}>
      <div className="space-y-2">
        {draft.map(e => {
          const n = uses(e.id);
          return (
            <div key={e.id} className={`rounded-lg border px-3 py-2 space-y-1.5 ${c.border2} ${e.closed ? 'opacity-70' : ''}`}>
              <div className="flex items-center gap-2">
                <EpicChip name={e.name || e.id} closed={e.closed} isDark={isDark} />
                <span className={`text-[10px] font-mono ${c.muted}`}>{e.id}</span>
                <span className={`text-[10px] ${c.muted}`}>· {n} Prozess{n === 1 ? '' : 'e'}</span>
                <label className={`ml-auto flex items-center gap-1 text-[10px] ${c.muted2}`}
                  title="Nicht mehr zuweisbar — bleibt am Prozess und im Filter">
                  <input type="checkbox" checked={!!e.closed} onChange={ev => set(e.id, { closed: ev.target.checked })} />
                  abgeschlossen
                </label>
                <button onClick={() => void loeschen(e)} title="Epic löschen"
                  className={`p-1 rounded ${c.muted} hover:text-rose-500`}>
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[14rem_1fr_1fr] gap-1.5">
                <input value={e.name} onChange={ev => set(e.id, { name: ev.target.value })} placeholder="Name"
                  className={`text-[11px] px-2 py-1 rounded border outline-none ${c.input}`} />
                <input value={e.description ?? ''} onChange={ev => set(e.id, { description: ev.target.value })} placeholder="Worum es geht"
                  className={`text-[11px] px-2 py-1 rounded border outline-none ${c.input}`} />
                <div className="flex items-center gap-1">
                  <input value={e.url ?? ''} onChange={ev => set(e.id, { url: ev.target.value })} placeholder="https://… (z. B. Jira-Epic)"
                    spellCheck={false}
                    className={`flex-1 min-w-0 text-[11px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />
                  {e.url?.trim() && (
                    <a href={e.url.trim()} target="_blank" rel="noopener noreferrer" title="Link öffnen" className={c.muted}>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!draft.length && <p className={`text-[11px] ${c.muted}`}>Noch keine Epics.</p>}
        <SaveRow onSave={() => void speichern()} flash={flash} isDark={isDark}>
          <input value={neu} onChange={e => setNeu(e.target.value)} placeholder="Neues Epic, z. B. Change XY"
            onKeyDown={e => { if (e.key === 'Enter') hinzufuegen(); }}
            className={`w-56 text-[11px] px-2 py-1.5 rounded border outline-none ${c.input}`} />
          <button onClick={hinzufuegen} disabled={!neu.trim()}
            className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
            <Plus size={12} /> Hinzufügen
          </button>
        </SaveRow>
      </div>
    </AdminSection>
  );
}
