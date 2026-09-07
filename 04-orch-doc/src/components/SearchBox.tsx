// Search across every project API of every company - in the top bar, always at hand. Matches
// the worker topic (`valiant-fil-is-accountAndPortfolioV3.GetAccounts` - unique across all
// projects), the operation (`Worker: GetAccounts`), the process / tag, the project and the
// company; a hit opens the operation in the API view. Data: `<company>/search.json`, written by
// the site assembly from the projects' OpenApi.yml (see types.ts SearchEntry).
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchIndex } from '../data';
import { href } from '../router';
import type { SearchEntry, SiteIndex } from '../types';
import { KindChip, cls } from '../ui';
import { opKind } from './ApiDoc';

const MAX = 25;

export default function SearchBox({ site, isDark }: { site?: SiteIndex; isDark: boolean }) {
  const c = cls(isDark);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const companies = useMemo(() => site?.companies.map(co => co.id), [site]);
  const index = useSearchIndex(companies, open);

  const hits = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length || !index) return [];
    const text = (e: SearchEntry) => `${e.topic ?? e.path} ${e.operationId} ${e.tag} ${e.project} ${e.company}`.toLowerCase();
    const scored = index.flatMap(e => {
      const t = text(e);
      if (!terms.every(term => t.includes(term))) return [];
      // the topic / path first, then the operation id, then the rest
      const score = (e.topic ?? e.path).toLowerCase().includes(terms[0]) ? 0 : e.operationId.toLowerCase().includes(terms[0]) ? 1 : 2;
      return [{ e, score }];
    });
    return scored.sort((a, b) => a.score - b.score || a.e.operationId.localeCompare(b.e.operationId)).slice(0, MAX).map(s => s.e);
  }, [q, index]);

  useEffect(() => { setActive(0); }, [q]);
  // close on click outside; `/` focuses the search from anywhere
  useEffect(() => {
    const onDoc = (ev: MouseEvent) => { if (!boxRef.current?.contains(ev.target as Node)) setOpen(false); };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === '/' && !(ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement)) {
        ev.preventDefault(); inputRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  const go = (e: SearchEntry) => {
    window.location.hash = href.api(e.company, e.project, e.id);
    setOpen(false); setQ('');
    inputRef.current?.blur();
  };
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (ev.key === 'Enter' && hits[active]) go(hits[active]);
    else if (ev.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  return (
    <div ref={boxRef} className="relative w-56 md:w-72 xl:w-96 min-w-0 mr-1.5">
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${c.border} ${isDark ? 'bg-white/5' : 'bg-black/3'}`}>
        <Search size={12} className={`flex-shrink-0 ${c.muted}`} />
        <input ref={inputRef} value={q} placeholder="Search topics, workers, processes …  ( / )"
          onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          className={`flex-1 min-w-0 bg-transparent outline-none text-[11px] ${c.text} placeholder:${isDark ? 'text-white/30' : 'text-black/30'}`} />
        {q && <button onClick={() => { setQ(''); inputRef.current?.focus(); }} className={c.muted}><X size={11} /></button>}
      </div>
      {open && q && (
        <div className={`absolute left-0 right-0 top-full mt-1 rounded border shadow-lg overflow-hidden z-30 ${c.border} ${isDark ? 'bg-[#16171a]' : 'bg-white'}`}>
          {!index ? <p className={`px-3 py-2 text-[11px] ${c.muted}`}>Loading the search index …</p>
            : !hits.length ? <p className={`px-3 py-2 text-[11px] ${c.muted}`}>No operation matches “{q}”.</p>
            : (
              <ul className="max-h-[60vh] overflow-y-auto">
                {hits.map((e, i) => (
                  <li key={`${e.company}/${e.project}/${e.id}`}>
                    <button onMouseDown={ev => ev.preventDefault()} onClick={() => go(e)} onMouseEnter={() => setActive(i)}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${i === active ? (isDark ? 'bg-white/10' : 'bg-black/5') : ''}`}>
                      <KindChip kind={opKind(e.operationId)} isDark={isDark} />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[11px] font-semibold truncate ${c.text}`}>{e.operationId}</span>
                        <span className={`block text-[10px] truncate ${c.muted2}`}>{e.topic ?? e.path}</span>
                      </span>
                      <span className={`text-[10px] whitespace-nowrap ${c.muted}`}>{e.project}{site && site.companies.length > 1 ? ` · ${e.company}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}
