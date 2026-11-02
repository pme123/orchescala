// Import an existing collection:
//   · from the catalog — a project whose services exist already, with the APIs
//     to take (all, or some of them — see catalogCollections.ts)
//   · from a file — a collection of another folder (`services/<slug>.json`)
import { AlertTriangle, Boxes, ChevronDown, ChevronRight, FileJson, Library, Search, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { Model } from '../types';
import { cls } from '../ui';
import { collectionPackage, collectionSlug, serviceTopic } from './collection';
import { catalogProjects, catalogTitle, collectionFromCatalog, describedTopics, withProjectDomain, type CatalogApi, type CatalogProject } from './catalogCollections';
import { findDomainFor, serviceProjectTarget } from '../projectImport';
import { serviceProblem } from './store';
import type { ServiceCollectionSpec } from './types';

const topicOf = (a: CatalogApi, name: string) => serviceTopic(a, { name });

export default function CollectionImport({ model, existing, isDark, onClose, onCreate }: {
  model: Model | null;
  /** the collections in services/ — APIs described there already are marked */
  existing: ServiceCollectionSpec[];
  isDark: boolean;
  onClose: () => void;
  onCreate: (spec: ServiceCollectionSpec) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const c = cls(isDark);
  const projects = useMemo(() => catalogProjects(model), [model]);
  const described = useMemo(() => describedTopics(existing), [existing]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  /** per project the chosen APIs (prefix) — without a choice: all not yet described */
  const [chosen, setChosen] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState('');
  /** per project the name as the user changed it — otherwise from the chosen APIs */
  const [titles, setTitles] = useState<Record<string, string>>({});
  const slugs = useMemo(() => new Set(existing.map(e => e.slug)), [existing]);
  const [busy, setBusy] = useState('');
  /** what the search does right now — `Ordner acme-crm wird gelesen …` */
  const [busyText, setBusyText] = useState('');
  /** where the last import took the domain from */
  const [source, setSource] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = projects.filter(p => words.every(w =>
    `${p.project} ${p.group ?? ''} ${p.apis.map(a => `${a.prefix} ${a.services.map(s => s.name).join(' ')}`).join(' ')}`.toLowerCase().includes(w)));

  /** where an API is described already — the collection of its first described service */
  const describedIn = (a: CatalogApi) => a.services.map(s => described.get(topicOf(a, TOPIC_NAME(s.topic ?? s.id)))).find(Boolean);
  const choiceOf = (p: CatalogProject) => chosen[p.project] ?? new Set(p.apis.filter(a => !describedIn(a)).map(a => a.prefix));
  const toggle = (p: CatalogProject, prefix: string) => setChosen(prev => {
    const next = new Set(choiceOf(p));
    if (next.has(prefix)) next.delete(prefix); else next.add(prefix);
    return { ...prev, [p.project]: next };
  });

  const create = async (spec: ServiceCollectionSpec, key: string) => {
    setBusy(key); setError('');
    if (slugs.has(spec.slug)) { setError(`services/${spec.slug}.json gibt es schon — einen anderen Namen wählen.`); setBusy(''); return; }
    try {
      const r = await onCreate(spec);
      if (!r.ok) setError(r.message);
    } finally { setBusy(''); }
  };

  /**
   * As «Aus BPMN» for a process: the domain from the own project folder (current), otherwise
   * the catalog — the list itself shows what the catalog knows.
   */
  const fromDomain = async (p: CatalogProject, picked: CatalogApi[], title: string) => {
    setBusy(p.project); setError('');
    try {
      const hit = await findDomainFor(serviceProjectTarget(p.project), model, setBusyText);
      const m = hit && hit.source !== 'Katalog' ? withProjectDomain(model, hit.domain) : model;
      const fresh = catalogProjects(m).find(x => x.project === p.project) ?? p;
      const apis = fresh.apis.filter(a => picked.some(x => x.prefix === a.prefix));
      setSource(hit?.source ?? 'Katalog');
      await create(collectionFromCatalog(fresh, apis.length ? apis : picked, m, title), p.project);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy('');
    } finally { setBusyText(''); }
  };

  const fromFile = async (f: File) => {
    let data: unknown;
    try { data = JSON.parse(await f.text()); }
    catch (e) { setError(`«${f.name}» ist kein JSON: ${e instanceof Error ? e.message : String(e)}`); return; }
    const problem = serviceProblem(data);
    if (problem) { setError(`«${f.name}» ist keine Collection: ${problem}`); return; }
    await create(data as ServiceCollectionSpec, f.name);
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center pt-16" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className={`w-[52rem] max-w-[95vw] max-h-[80vh] flex flex-col rounded-lg border shadow-xl ${c.border2} ${c.panelStrong}`}>
        <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${c.border}`}>
          <Library size={14} className={c.muted2} />
          <span className={`text-xs font-semibold ${c.text}`}>Bestehende Collection importieren</span>
          <button onClick={onClose} className={`ml-auto p-1 rounded ${c.muted} ${c.hover}`}><X size={13} /></button>
        </div>
        <div className="px-4 py-3 space-y-2 flex-1 min-h-0 flex flex-col">
          <p className={`text-[10px] ${c.muted}`}>
            Ein Projekt, dessen Services es schon gibt — alle seine APIs oder eine Auswahl. Gelesen wird wie bei «Aus BPMN»: der
            Projekt-Ordner (Admin → Katalog → Projekt-Ordner), sonst der <b>Katalog</b>. Aus dem ServiceTask
            kommen In, Out, Methode, Pfad, Bodies und die Typen der API; der Basispfad der Firma (<span className="font-mono">/banks/{'{bankNumber}'}</span>)
            wird erkannt. Query und Header kennt der Katalog nicht: eine danach importierte OpenAPI ergänzt sie (gleicher Name).
          </p>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 px-2 py-1 rounded border flex-1 ${c.border2}`}>
              <Search size={11} className={c.muted} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Projekt, API, Service …" autoFocus
                className={`flex-1 bg-transparent outline-none text-[11px] ${c.text}`} />
            </div>
            <input ref={fileRef} type="file" accept=".json" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void fromFile(f); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} title="Eine Collection aus einem anderen Ordner (services/<name>.json)"
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
              <FileJson size={12} /> Aus Datei …
            </button>
          </div>
          {error && <p className="text-[11px] text-rose-500 flex items-center gap-1.5"><AlertTriangle size={11} /> {error}</p>}
          {busyText && <p className={`text-[10px] ${c.muted}`}>{busyText}</p>}
          {source && !busy && !error && <p className={`text-[10px] ${c.muted}`}>Domain aus {source}</p>}
          <div className={`flex-1 min-h-0 overflow-y-auto rounded border ${c.border2}`}>
            {!projects.length && <p className={`p-3 text-[11px] ${c.muted}`}>Der Katalog kennt keine Service-Worker (Topic <span className="font-mono">projekt-apiV1.Name</span>) — Admin → Katalog.</p>}
            {projects.length > 0 && !visible.length && <p className={`p-3 text-[11px] ${c.muted}`}>Kein Projekt passt zur Suche.</p>}
            {visible.map(p => {
              const isOpen = open === p.project || (visible.length === 1);
              const choice = choiceOf(p);
              const picked = p.apis.filter(a => choice.has(a.prefix));
              const n = picked.reduce((sum, a) => sum + a.services.length, 0);
              // the name follows the choice: the project for all APIs, otherwise project and APIs
              const title = titles[p.project] ?? catalogTitle(p, picked);
              const slug = collectionSlug({ project: p.project, title });
              const taken = slugs.has(slug);
              return (
                <div key={p.project} className={`border-b last:border-b-0 ${c.border}`}>
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <button onClick={() => setOpen(isOpen ? null : p.project)} className={`p-0.5 rounded ${c.muted} ${c.hover}`}>
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    <Boxes size={13} className={isDark ? 'text-teal-300' : 'text-teal-700'} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-[11px] font-semibold truncate ${c.text}`}>{p.group || p.project} <span className={`font-mono font-normal ${c.muted}`}>{p.project}</span></div>
                      <div className={`text-[10px] truncate ${c.muted}`}>
                        {p.apis.length} API{p.apis.length === 1 ? '' : 's'}: {p.apis.map(a => `${a.api} v${a.apiVersion}`).join(', ')}
                      </div>
                    </div>
                    <button disabled={!!busy || !picked.length || !title.trim() || taken}
                      title={!picked.length ? 'keine API gewählt'
                        : taken ? `services/${slug}.json gibt es schon — einen anderen Namen wählen`
                          : `«${title}» — ${picked.length} API(s), ${n} Services als eine Collection (services/${slug}.json)`}
                      onClick={() => void fromDomain(p, picked, title)}
                      className={`text-[11px] px-2.5 py-1 rounded border border-transparent whitespace-nowrap disabled:opacity-40 ${c.btnPrimary}`}>
                      {busy === p.project ? '…' : `${n} übernehmen`}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="pl-12 pr-3 pb-2 space-y-0.5">
                      {p.apis.map(a => {
                        const where = describedIn(a);
                        return (
                          <label key={a.prefix} className={`flex items-center gap-2 text-[11px] cursor-pointer ${c.hover} rounded px-1`}>
                            <input type="checkbox" checked={choice.has(a.prefix)} onChange={() => toggle(p, a.prefix)} />
                            <span className={`w-40 font-mono ${c.text}`}>{a.api} v{a.apiVersion}</span>
                            <span className={`w-64 truncate font-mono text-[10px] ${c.muted}`}>{collectionPackage(a)}</span>
                            <span className={`flex-1 truncate text-[10px] ${c.muted}`} title={a.services.map(s => s.name).join(', ')}>
                              {a.services.length}: {a.services.map(s => s.name).join(', ')}
                            </span>
                            {where && <span className={`text-[10px] whitespace-nowrap ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`} title="Services dieser API sind schon in einer Collection beschrieben">✓ in «{where}»</span>}
                          </label>
                        );
                      })}
                      <div className="flex items-center gap-2 pt-1.5 pl-1">
                        <span className={`text-[10px] ${c.muted}`}>Name</span>
                        <input value={title} onChange={e => setTitles(t => ({ ...t, [p.project]: e.target.value }))}
                          className={`w-72 px-1.5 py-0.5 rounded border text-[11px] outline-none ${c.input}`} />
                        {titles[p.project] !== undefined && (
                          <button onClick={() => setTitles(({ [p.project]: _drop, ...rest }) => rest)} title="wieder aus den gewählten APIs"
                            className={`text-[10px] hover:underline ${c.muted}`}>zurücksetzen</button>
                        )}
                        <span className={`text-[10px] font-mono truncate ${taken ? 'text-rose-500' : c.muted}`}>
                          services/{slug}.json{taken ? ' gibt es schon' : ''}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** the object name at the end of a topic (`acme-crm-clientV1.GetClient` → `GetClient`) */
const TOPIC_NAME = (topic: string) => topic.slice(topic.lastIndexOf('.') + 1);
