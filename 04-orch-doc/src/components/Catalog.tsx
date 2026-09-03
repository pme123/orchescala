// Searchable catalog of everything deployed: processes, workers, messages,
// signals, user tasks — grouped by project, filtered by text and kind.
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDerived } from '../data';
import { href } from '../router';
import type { CatalogKind, CompanyDocs } from '../types';
import { Card, Empty, KIND_META, KindChip, PageTitle, ProjectChip, cls } from '../ui';

const KINDS: CatalogKind[] = ['Bpmn', 'Worker', 'Message', 'Signal', 'UserTask', 'Dmn', 'Timer', 'Other'];

export default function Catalog({ docs, isDark, query }: { docs: CompanyDocs; isDark: boolean; query: string }) {
  const c = cls(isDark);
  const { byName, catalogProject } = useDerived(docs);
  // the initial query may be a kind label (from the overview tiles)
  const initialKind = KINDS.find(k => KIND_META[k].label === query);
  const [q, setQ] = useState(initialKind ? '' : query);
  const [kinds, setKinds] = useState<Set<CatalogKind>>(new Set(initialKind ? [initialKind] : []));
  useEffect(() => { const k = KINDS.find(x => KIND_META[x].label === query); if (k) { setKinds(new Set([k])); setQ(''); } else setQ(query); }, [query]);

  // catalog URLs point at the Redoc page — route them to the in-app API view
  const apiHref = (url: string) => {
    const m = url.match(/\/([\w-]+)\/OpenApi\.html#operation\/(.+)$/);
    return m ? href.api(docs.company, m[1], decodeURIComponent(m[2])) : undefined;
  };
  const all = useMemo(() => docs.catalog.flatMap(p => p.entries.map(e => ({ ...e, title: p.title, project: catalogProject(e.url) }))), [docs, catalogProject]);
  const counts = useMemo(() => { const m = new Map<CatalogKind, number>(); all.forEach(e => m.set(e.kind, (m.get(e.kind) ?? 0) + 1)); return m; }, [all]);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = all.filter(e => (!kinds.size || kinds.has(e.kind)) &&
    terms.every(t => e.name.toLowerCase().includes(t) || e.title.toLowerCase().includes(t) || (e.project ?? '').includes(t)));
  const grouped = docs.catalog.map(p => ({ title: p.title, entries: hits.filter(h => h.title === p.title) })).filter(g => g.entries.length);
  const toggleKind = (k: CatalogKind) => setKinds(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div>
      <PageTitle isDark={isDark} title="Catalog" meta={<span>{all.length} entries in {docs.catalog.length} projects — what is actually deployed</span>} />

      <div className="flex flex-wrap items-center gap-2 mb-4 sticky top-0 z-10 py-2 -my-2 backdrop-blur-sm">
        <div className="relative flex-1 min-w-[16rem]">
          <Search size={12} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${c.muted}`} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search processes, workers, projects …" autoFocus
            className={`w-full text-[11px] pl-7 pr-7 py-1.5 rounded border outline-none ${c.input}`} />
          {q && <button onClick={() => setQ('')} className={`absolute right-2 top-1/2 -translate-y-1/2 ${c.muted}`}><X size={11} /></button>}
        </div>
        <div className="flex flex-wrap gap-1">
          {KINDS.filter(k => counts.get(k)).map(k => (
            <button key={k} onClick={() => toggleKind(k)} className="flex items-center gap-1">
              <KindChip kind={k} isDark={isDark} active={kinds.has(k)} />
              <span className={`text-[9px] ${c.muted}`}>{counts.get(k)}</span>
            </button>
          ))}
        </div>
        <span className={`text-[10px] ${c.muted}`}>{hits.length} hits</span>
      </div>

      {!grouped.length && <Empty isDark={isDark}>Nothing matches.</Empty>}
      <div className="space-y-4">
        {grouped.map(g => {
          const projectName = g.entries[0].project;
          const p = projectName ? byName.get(projectName) : undefined;
          return (
            <Card key={g.title} isDark={isDark} className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <h2 className={`text-[11px] font-bold ${c.text}`}>{g.title}</h2>
                {p && <ProjectChip name={p.name} color={p.color} isDark={isDark} href={p.hasDependencies ? href.dependencies(docs.company, p.name) : undefined} />}
                <span className={`text-[10px] ml-auto ${c.muted}`}>{g.entries.length}</span>
              </div>
              <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                {g.entries.map(e => (
                  <li key={e.url}>
                    <a href={apiHref(e.url) ?? e.url} target={apiHref(e.url) ? undefined : '_blank'} rel="noopener noreferrer"
                      className={`flex items-center gap-2 text-[11px] px-1.5 py-0.5 rounded ${c.hover}`} title={`${e.kind}: ${e.name}`}>
                      <KindChip kind={e.kind} isDark={isDark} />
                      <span className="truncate">{e.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
