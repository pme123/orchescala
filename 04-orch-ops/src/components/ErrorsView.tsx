// Main page: all recurring errors.
//
// Search across all fields (several terms = all must occur), status as tags
// for filtering, process selection, sorting by last update (default) or by
// biggest count. Search, filters and sorting live in the address — a copied
// link shows the same selection.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, ArrowDownWideNarrow, Download, FilePlus2, RefreshCw, Search, X } from 'lucide-react';
import { useStore, type ErrorItem } from '../store';
import { usePermissions } from '../auth';
import { StatusTag, cls, statusDef } from '../ui';
import { extractLinks } from '../markdown';
import { highlight, matches, snippet, terms } from '../search';
import { fmtRelative, fmtTimestamp } from '../util';
import CountButton from './CountButton';
import type { ErrorEntry } from '../types';
import { downloadCsv } from '../csv';

export type SortKey = 'updated' | 'count';

export interface ListState { q: string; status: string[]; process: string; sort: SortKey; archived: boolean }

const ACTION_LABEL: Record<NonNullable<ErrorEntry['lastAction']>, string> = {
  created: 'erfasst', edited: 'bearbeitet', counted: 'gezählt', imported: 'importiert',
};

function sortItems(items: ErrorItem[], sort: SortKey): ErrorItem[] {
  const t = (e: ErrorEntry) => new Date(e.updatedAt).getTime() || 0;
  const bySeq = (a: ErrorEntry, b: ErrorEntry) => (a.seq ?? 1e9) - (b.seq ?? 1e9);
  return [...items].sort((A, B) => {
    const a = A.data, b = B.data;
    if (sort === 'count') return b.count - a.count || t(b) - t(a) || bySeq(a, b);
    return t(b) - t(a) || bySeq(a, b);
  });
}

function Hl({ text, ts }: { text: string; ts: string[] }) {
  return <>{highlight(text, ts).map((p, i) => (p.hit ? <mark key={i}>{p.s}</mark> : <span key={i}>{p.s}</span>))}</>;
}

export default function ErrorsView({ state, setState, onOpen, onNew }: {
  state: ListState;
  setState: (s: ListState) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { isDark, errors, model, loading, refreshErrors, lastRefresh, refreshProblems } = useStore();
  const { canEdit } = usePermissions();
  const c = cls(isDark);
  const statuses = model?.statuses ?? [];
  const searchRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  // «/» jumps into the search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tgt.tagName)) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ts = useMemo(() => terms(state.q), [state.q]);
  const pool = useMemo(() => errors.filter(e => state.archived ? e.data.archived : !e.data.archived), [errors, state.archived]);
  const archivedCount = useMemo(() => errors.filter(e => e.data.archived).length, [errors]);

  // hits without status filter — the numbers on the tags come from these
  const searched = useMemo(() => pool.filter(e => matches(e.data, ts) && (!state.process || e.data.process === state.process)), [pool, ts, state.process]);
  const shown = useMemo(() => sortItems(
    searched.filter(e => !state.status.length || state.status.some(s => e.data.status.includes(s))), state.sort,
  ), [searched, state.status, state.sort]);

  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    searched.forEach(e => e.data.status.forEach(s => m.set(s, (m.get(s) ?? 0) + 1)));
    return m;
  }, [searched]);
  // tags: the configured ones first, then whatever else occurs in the data
  const tagLabels = useMemo(() => {
    const known = statuses.map(s => s.label);
    const extra = [...new Set(pool.flatMap(e => e.data.status))].filter(s => !known.includes(s)).sort();
    return [...known, ...extra];
  }, [statuses, pool]);

  const processes = useMemo(() => {
    const m = new Map<string, number>();
    pool.forEach(e => { if (e.data.process) m.set(e.data.process, (m.get(e.data.process) ?? 0) + 1); });
    return [...m].sort((a, b) => a[0].localeCompare(b[0], 'de'));
  }, [pool]);

  const openCount = pool.filter(e => !e.data.status.length || e.data.status.some(s => !statusDef(s, statuses).done)).length;
  const totalCount = pool.reduce((n, e) => n + e.data.count, 0);
  const filtered = !!(state.q || state.status.length || state.process);

  const toggleStatus = (s: string) =>
    setState({ ...state, status: state.status.includes(s) ? state.status.filter(x => x !== s) : [...state.status, s] });

  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      {/* Title */}
      <div className="flex items-end gap-4 mb-4 flex-wrap">
        <div className="min-w-0">
          <h1 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>
            {state.archived ? 'Archivierte Fehler' : 'Wiederkehrende Fehler'}
          </h1>
          <p className={`text-[11px] mt-1 ${c.muted}`}>
            {pool.length} Fehler · {openCount} nicht gelöst · {totalCount} Vorkommnisse gesamt
            {lastRefresh && <> · aktualisiert {fmtRelative(new Date(lastRefresh).toISOString(), now)}</>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => void refreshErrors()} title="Neu einlesen (passiert sonst jede Minute)"
            className={`p-2 rounded border ${c.btn}`}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => downloadCsv(shown.map(e => e.data), filtered ? 'fehler-auswahl' : 'fehler')}
            title="Die angezeigten Fehler als CSV (Excel)" className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
            <Download size={12} /> CSV
          </button>
          {canEdit && !state.archived && (
            <button onClick={onNew} className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded font-semibold ${c.btnPrimary}`}>
              <FilePlus2 size={12} /> Neuer Fehler
            </button>
          )}
        </div>
      </div>

      {/* files the last refresh could not read — they keep their last known state */}
      {refreshProblems.length > 0 && (
        <div role="alert" className={`flex items-start gap-2 rounded border px-3 py-2 mb-3 text-[11px] ${isDark ? 'border-amber-500/40 bg-amber-500/5 text-amber-200' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
          <AlertTriangle size={13} className="flex-shrink-0 mt-px" />
          <div className="min-w-0">
            {refreshProblems.length === 1 && !refreshProblems[0].endsWith('.json')
              ? refreshProblems[0]
              : <>Nicht lesbar ({refreshProblems.length}) — gezeigt wird der letzte bekannte Stand: <span className="font-mono break-all">{refreshProblems.join(', ')}</span></>}
          </div>
        </div>
      )}

      {/* Search + sorting */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[16rem]">
          <Search size={12} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${c.muted}`} />
          <input ref={searchRef} value={state.q} onChange={e => setState({ ...state, q: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape') setState({ ...state, q: '' }); }}
            placeholder="Suchen in allen Feldern — Prozess, Fehlermeldung, Workaround, Ticket …  ( / )"
            className={`w-full text-[11px] pl-7 pr-7 py-2 rounded border outline-none ${c.input}`} />
          {state.q && (
            <button onClick={() => setState({ ...state, q: '' })} title="Suche leeren"
              className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 ${c.muted}`}><X size={12} /></button>
          )}
        </div>
        <select value={state.process} onChange={e => setState({ ...state, process: e.target.value })}
          title="Nach Prozess filtern"
          className={`text-[11px] px-2 py-2 rounded border outline-none max-w-[16rem] ${c.input}`}>
          <option value="">Alle Prozesse</option>
          {processes.map(([p, n]) => <option key={p} value={p}>{p} ({n})</option>)}
        </select>
        <div className={`flex items-center rounded border overflow-hidden ${c.border2}`} title="Sortierung">
          <span className={`pl-2 pr-1 ${c.muted}`}><ArrowDownWideNarrow size={12} /></span>
          {([['updated', 'Letztes Update'], ['count', 'Grösster Count']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setState({ ...state, sort: k })}
              className={`text-[11px] px-2.5 py-2 transition-colors ${state.sort === k
                ? (isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-black')
                : `${c.muted2} ${c.hover}`}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Status tags */}
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        <span className={`text-[10px] uppercase tracking-wider mr-1 ${c.muted}`}>Status</span>
        {tagLabels.map(s => (
          <StatusTag key={s} label={s} statuses={statuses} isDark={isDark} count={statusCounts.get(s) ?? 0}
            active={state.status.length ? state.status.includes(s) : undefined}
            onClick={() => toggleStatus(s)} title={state.status.includes(s) ? 'Filter entfernen' : 'Nur diesen Status zeigen (mehrere möglich)'} />
        ))}
        {filtered && (
          <button onClick={() => setState({ ...state, q: '', status: [], process: '' })}
            className={`text-[10px] ml-1 hover:underline ${c.muted}`}>Filter zurücksetzen</button>
        )}
        {(archivedCount > 0 || state.archived) && (
          <button onClick={() => setState({ ...state, archived: !state.archived })}
            className={`ml-auto flex items-center gap-1 text-[10px] hover:underline ${c.muted}`}>
            <Archive size={11} /> {state.archived ? 'Zurück zur Liste' : `Archiv (${archivedCount})`}
          </button>
        )}
      </div>

      {/* List */}
      {!shown.length ? (
        <div className={`rounded-lg border p-10 text-center text-[11px] ${c.border} ${c.panel} ${c.muted}`}>
          {loading && !errors.length ? 'Lade Fehler …'
            : filtered ? 'Keine Treffer — Suche oder Filter anpassen.'
              : state.archived ? 'Nichts archiviert.'
                : <>Noch keine Fehler erfasst.{canEdit && <> Oben «Neuer Fehler» — oder im Admin die Confluence-Seite importieren.</>}</>}
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map(({ data: e }) => {
            const done = e.status.length > 0 && e.status.every(s => statusDef(s, statuses).done);
            const links = extractLinks(e.ticket);
            const ticketText = !links.length && e.ticket.trim() && e.ticket.trim().length < 40 ? e.ticket.trim() : '';
            const snip = snippet(e, ts);
            return (
              <li key={e.id}>
                <div role="button" tabIndex={0} onClick={() => onOpen(e.id)}
                  onKeyDown={ev => { if (ev.key === 'Enter') onOpen(e.id); }}
                  className={`flex gap-3 items-start rounded-lg border p-3 cursor-pointer transition-colors outline-none
                    ${c.border2} ${isDark ? 'bg-[#141518] hover:border-white/30 focus:border-white/40' : 'bg-white hover:border-black/30 focus:border-black/40'}
                    ${done ? 'opacity-70' : ''}`}>
                  <CountButton id={e.id} count={e.count} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className={`text-[12px] font-semibold leading-snug ${c.text}`}><Hl text={e.title || '(ohne Kurzbeschrieb)'} ts={ts} /></span>
                      <span className="flex gap-1 flex-wrap pt-px">
                        {e.status.map(s => <StatusTag key={s} label={s} statuses={statuses} isDark={isDark} />)}
                      </span>
                    </div>
                    <div className={`text-[11px] mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap ${c.muted2}`}>
                      <span className="font-semibold"><Hl text={e.process || '—'} ts={ts} /></span>
                      {e.activity && <span>Aktivität: <Hl text={e.activity} ts={ts} /></span>}
                      {links.map(l => (
                        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" onClick={ev => ev.stopPropagation()}
                          className="underline underline-offset-2 hover:opacity-70"><Hl text={l.text} ts={ts} /></a>
                      ))}
                      {ticketText && <span>Ticket: <Hl text={ticketText} ts={ts} /></span>}
                    </div>
                    {snip && (
                      <div className={`text-[10.5px] mt-1.5 truncate ${c.muted}`}>
                        <span className="uppercase tracking-wider text-[9px] mr-1.5">{snip.field}</span><Hl text={snip.text} ts={ts} />
                      </div>
                    )}
                  </div>
                  <div className={`text-right text-[10px] flex-shrink-0 hidden sm:block ${c.muted}`} title={fmtTimestamp(e.updatedAt)}>
                    <div>{ACTION_LABEL[e.lastAction ?? 'edited']} {fmtRelative(e.updatedAt, now)}</div>
                    {e.updatedBy && <div className="truncate max-w-[10rem]">{e.updatedBy}</div>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > 0 && filtered && (
        <p className={`text-[10px] mt-3 ${c.muted}`}>{shown.length} von {pool.length} Fehlern</p>
      )}
    </div>
  );
}
