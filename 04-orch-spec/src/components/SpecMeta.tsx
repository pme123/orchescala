// What a process and a page have alike: the epics they contribute to and the company/project they
// belong to. The process view (StepDetail) and the page designer use the same pickers.
import { ExternalLink, X } from 'lucide-react';
import { epicsOf } from '../epics';
import { splitPrefix } from '../stepIds';
import type { Model } from '../types';
import { EpicChip, cls } from '../ui';

/** The epics of a process or a page - only an admin creates them (Admin → Epics), here they are only
  * assigned. Closed ones stay, but are not added anew. */
export function EpicChips({ ids, model, isDark, canEdit, onChange }: {
  ids: string[] | undefined; model: Model | null; isDark: boolean; canEdit: boolean;
  /** the new list - undefined if empty */
  onChange: (ids: string[] | undefined) => void;
}) {
  const c = cls(isDark);
  const all = model?.epics ?? [];
  const mine = epicsOf({ epics: ids }, model);
  const offen = all.filter(e => !e.closed && !mine.some(m => m.id === e.id));
  const set = (next: string[]) => onChange(next.length ? next : undefined);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {mine.map(e => (
        <EpicChip key={e.id} name={e.name} closed={e.closed} isDark={isDark}
          title={[e.name, e.description, e.closed ? 'abgeschlossen' : ''].filter(Boolean).join(' — ')}>
          {e.url && (
            <a href={e.url} target="_blank" rel="noopener noreferrer" title="Epic öffnen" className="opacity-70 hover:opacity-100">
              <ExternalLink size={9} />
            </a>
          )}
          {canEdit && (
            <button onClick={() => set((ids ?? []).filter(x => x !== e.id))} title="Aus dem Epic nehmen"
              className="opacity-70 hover:opacity-100"><X size={9} /></button>
          )}
        </EpicChip>
      ))}
      {canEdit && offen.length > 0 && (
        <select value="" onChange={e => { if (e.target.value) set([...(ids ?? []).filter(x => x !== e.target.value), e.target.value]); }}
          className={`text-[10px] px-1.5 py-0.5 rounded border outline-none ${c.input}`}>
          <option value="">+ Epic</option>
          {offen.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      )}
      {!mine.length && (!canEdit || !offen.length) && (
        <span className={`text-[10px] ${c.muted}`}>
          {all.some(e => !e.closed) ? 'keinem Epic zugeordnet' : 'Noch keine offenen Epics — ein Admin legt sie unter Admin → Epics an.'}
        </span>
      )}
    </div>
  );
}

/** Company and project of a page - the choice comes from the catalog and the processes (knownPrefixes).
  * Unlike a process nothing is renamed: a page has no IDs with the prefix. */
export function ProjectSelect({ value, prefixes, preferred, isDark, canEdit, onChange }: {
  value: string | undefined; prefixes: string[]; isDark: boolean; canEdit: boolean;
  /** the project to take first when a company is chosen - e.g. that of the processes in the same folder */
  preferred?: string;
  onChange: (prefix: string | undefined) => void;
}) {
  const c = cls(isDark);
  const { company, project } = splitPrefix(value ?? '');
  const companies = [...new Set([company, ...prefixes.map(p => splitPrefix(p).company)])].filter(Boolean);
  const projects = [...new Set([project, ...prefixes.filter(p => splitPrefix(p).company === company).map(p => splitPrefix(p).project)])].filter(Boolean);
  const select = `text-[11px] px-2 py-1.5 rounded border outline-none font-mono disabled:opacity-60 ${c.input}`;
  return (
    <div className="flex gap-1.5">
      <select value={company} disabled={!canEdit} className={`w-28 ${select}`}
        onChange={e => {
          const next = e.target.value;
          // the preferred project of the company, otherwise its first - or none
          const first = (preferred && splitPrefix(preferred).company === next ? preferred : undefined)
            ?? prefixes.find(p => splitPrefix(p).company === next);
          onChange(next ? first ?? undefined : undefined);
        }}>
        <option value="">–</option>
        {companies.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
      <select value={project} disabled={!canEdit || !company} className={`flex-1 min-w-0 ${select}`}
        onChange={e => onChange(e.target.value ? `${company}-${e.target.value}` : undefined)}>
        <option value="">–</option>
        {projects.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  );
}
