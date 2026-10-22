// The lists of the specifications - processes, pages (and later more kinds, e.g. services) - share their
// head: a search, the epics as a filter, the sorting, and the groups per project. What only one kind has
// (the status of a process) comes in as an extra filter. The epic filter is one for all lists: whoever
// works on an epic sees its processes and its pages.
import { ArrowUpDown, Flag, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { epicsOf } from '../epics';
import type { EpicDef, Model } from '../types';
import { cls, epicTone } from '../ui';

/** What the head needs to know of an entry of a list. */
export type ListEntry = {
  title: string;
  /** what the search finds besides the title: IDs, path, slug … */
  terms: string[];
  project?: string;
  epics?: string[];
  /** ISO time of the last change - without it, there is no sorting by it */
  updatedAt?: string;
};

export type SortBy = 'title' | 'updated';
export const NO_PROJECT = 'ohne Projekt';

/** The entries that match the search (all words, also in project and epic names) and the epic, sorted. */
export function filterEntries<T>(items: T[], entry: (t: T) => ListEntry, f: { query: string; epic: string | null; sortBy: SortBy }, model: Model | null): T[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = (e: ListEntry) => [e.title, ...e.terms, e.project ?? '', ...epicsOf({ epics: e.epics }, model).map((x) => x.name)].join(' ').toLowerCase();
  const kept = items.filter((t) => {
    const e = entry(t);
    return words.every((w) => text(e).includes(w)) && (!f.epic || !!e.epics?.includes(f.epic));
  });
  return f.sortBy === 'updated'
    ? [...kept].sort((a, b) => (entry(b).updatedAt ?? '').localeCompare(entry(a).updatedAt ?? ''))
    : kept;
}

/** The entries per project, in the order of their first entry. */
export function groupByProject<T>(items: T[], project: (t: T) => string | undefined): (readonly [string, T[]])[] {
  const keys = [...new Set(items.map((t) => project(t) || NO_PROJECT))];
  return keys.map((k) => [k, items.filter((t) => (project(t) || NO_PROJECT) === k)] as const);
}

/** The epics offered as filter: all open ones, plus closed ones as long as an entry carries them. */
export function epicChoices<T>(items: T[], entry: (t: T) => ListEntry, model: Model | null): (EpicDef & { n: number })[] {
  return (model?.epics ?? [])
    .map((e) => ({ ...e, n: items.filter((t) => entry(t).epics?.includes(e.id)).length }))
    .filter((e) => !e.closed || e.n > 0);
}

const EPIC_FILTER_KEY = 'orch-spec.epicFilter';

/** The state of the head of a list - search and sorting per list, the epic for all lists. */
export function useSpecList<T>(items: T[], entry: (t: T) => ListEntry, model: Model | null, extra?: (t: T) => boolean) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('title');
  const [epic, setEpic] = useState<string | null>(() => { try { return localStorage.getItem(EPIC_FILTER_KEY); } catch { return null; } });
  useEffect(() => {
    try {
      if (epic) localStorage.setItem(EPIC_FILTER_KEY, epic);
      else localStorage.removeItem(EPIC_FILTER_KEY);
    } catch { /* without storage the filter only applies until leaving */ }
  }, [epic]);
  const epics = useMemo(() => epicChoices(items, entry, model), [items, entry, model]);
  // a remembered epic that no longer exists does not filter into nothing
  const activeEpic = epic && epics.some((e) => e.id === epic) ? epic : null;
  const visible = useMemo(
    () => filterEntries(extra ? items.filter(extra) : items, entry, { query, epic: activeEpic, sortBy }, model),
    [items, entry, extra, query, activeEpic, sortBy, model],
  );
  const groups = useMemo(() => groupByProject(visible, (t) => entry(t).project), [visible, entry]);
  return {
    query, setQuery, sortBy, setSortBy, epic: activeEpic, setEpic, epics, visible, groups,
    /** is a filter of the head active (not the extra one - its owner knows) */
    filtered: !!query.trim() || !!activeEpic,
    reset: () => { setQuery(''); setEpic(null); },
    sortable: items.some((t) => !!entry(t).updatedAt),
  };
}

export type SpecListState = ReturnType<typeof useSpecList>;

/** The head of a list: search, the extra filters of the kind, the epics, the sorting. */
export function SpecListHead({ isDark, list, placeholder, noun, children }: {
  isDark: boolean; list: SpecListState; placeholder: string;
  /** «Prozesse», «Seiten» - for the tooltips */
  noun: string;
  /** the filters only this kind has (status …) */
  children?: React.ReactNode;
}) {
  const c = cls(isDark);
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <div className={`flex items-center gap-1 px-2 py-1 rounded border ${c.border2} min-w-[16rem]`}>
        <Search size={11} className={c.muted} />
        <input value={list.query} onChange={(e) => list.setQuery(e.target.value)} placeholder={placeholder}
          className={`flex-1 min-w-0 bg-transparent outline-none text-[11px] ${c.text}`} />
        {list.query && <button onClick={() => list.setQuery('')} className={c.muted}><X size={10} /></button>}
      </div>
      {children}
      {list.epics.length > 0 && (
        <span className={`flex items-center gap-1 flex-wrap pl-2 border-l ${c.border2}`}>
          <Flag size={10} className={c.muted} />
          {list.epics.map((e) => (
            <button key={e.id} onClick={() => list.setEpic(list.epic === e.id ? null : e.id)}
              title={`Nur ${noun} im Epic «${e.name}»${e.description ? ` — ${e.description}` : ''}${e.closed ? ' (abgeschlossen)' : ''}`}
              className={`text-[9px] px-1.5 py-0.5 rounded border transition-opacity ${epicTone(isDark)} ${
                e.closed ? 'border-dashed' : ''} ${list.epic && list.epic !== e.id ? 'opacity-30' : ''} ${
                list.epic === e.id ? 'ring-1 ring-current' : ''}`}>
              {e.name} {e.n}
            </button>
          ))}
        </span>
      )}
      {list.sortable && (
        <button onClick={() => list.setSortBy(list.sortBy === 'title' ? 'updated' : 'title')}
          title="Sortierung wechseln"
          className={`ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
          <ArrowUpDown size={10} /> {list.sortBy === 'title' ? 'nach Titel' : 'zuletzt geändert'}
        </button>
      )}
    </div>
  );
}

/** The groups of a list: one bracket per project with its head - only if there is more than one. */
export function ProjectGroups<T>({ isDark, groups, noun, render }: {
  isDark: boolean; groups: (readonly [string, T[]])[];
  /** singular and plural: ['Seite', 'Seiten'] */
  noun: [string, string];
  render: (item: T) => React.ReactNode;
}) {
  const c = cls(isDark);
  return (
    <div className="space-y-4">
      {groups.map(([project, items]) => (
        <div key={project} className={groups.length > 1 ? `pl-3 border-l-2 ${isDark ? 'border-slate-500/40' : 'border-slate-300'}` : ''}>
          {groups.length > 1 && (
            <div className="flex items-baseline gap-2 mb-1.5 px-1">
              <span className={`text-sm font-mono font-bold ${c.muted2}`}>{project}</span>
              <span className={`text-[10px] uppercase tracking-widest ${c.muted}`}>{items.length} {items.length === 1 ? noun[0] : noun[1]}</span>
            </div>
          )}
          <div className="space-y-1.5">{items.map(render)}</div>
        </div>
      ))}
    </div>
  );
}
