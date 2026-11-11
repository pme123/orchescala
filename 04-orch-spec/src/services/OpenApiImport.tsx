// Read an OpenAPI and tick the operations the collection takes.
//
// The collection covers the whole OpenAPI or a sub path (`/clients`) — the
// filter at the top, remembered with the collection. The operations are grouped
// by their sub path (see suggestApis); the new services all get the API of the collection.
//
// Each operation shows whether it is already there:
//   · «da» — in the collection (same operationId, or same method and path); it
//     stays as it is (with its In/Out and mappings) and cannot be ticked
//   · «ergänzt» — a service of the same name from the catalog, without request:
//     the operation completes it
//   · «⌁ Katalog» — a service with the same topic is known (domain catalog or
//     service catalog): it exists in a project already
//
// The OpenAPI a collection was imported from is kept next to it (`services/openapi/<slug>.yml`):
// the dialog opens with it, another file overrides it. A collection from before that keeps none
// finds the file of the same name in the project folder.
import { AlertTriangle, Check, FileUp, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ownFolders } from '../projectImport';
import { projectOpenApis } from './projectOpenApis';
import type { Model } from '../types';
import { cls } from '../ui';
import { API_NAME, serviceTopic } from './collection';
import { readOpenApiFile, type OpenApiFile } from './openApiFile';
import { useServices } from './store';
import { addOperations, inPathPrefix, isIncomplete, readApi, serviceOf, suggestApis, type ApiImport, type ApiOperation } from './openApiRest';
import type { ServiceCollectionSpec } from './types';
import { MethodChip } from './ui';

/** The topics the catalog knows — services of the domain and of the service catalog. */
export function catalogTopics(model: Model | null): Set<string> {
  const out = new Set<string>();
  for (const t of model?.domainTypes ?? []) if (t.topicName) out.add(t.topicName);
  for (const s of model?.services ?? []) { out.add(s.id); if (s.topic) out.add(s.topic); }
  return out;
}

export default function OpenApiImport({ spec, model, isDark, initial, onClose, onApply }: {
  spec: ServiceCollectionSpec;
  model: Model | null;
  isDark: boolean;
  /** a file already read — chosen when the collection was created */
  initial?: OpenApiFile;
  onClose: () => void;
  /** `adopted`: classes of the hierarchy the collection takes instead of its own (`Gender`) */
  /** the collection with the services — the types the hierarchy has are chosen after it (AdoptDialog) */
  onApply: (next: ServiceCollectionSpec, added: string[]) => void;
}) {
  const c = cls(isDark);
  const fileRef = useRef<HTMLInputElement>(null);
  const [api, setApi] = useState<ApiImport | null>(null);
  const [file, setFile] = useState('');
  /** the file shown - and where it comes from: kept with the collection, found in the project, or chosen now */
  const [current, setCurrent] = useState<{ o: OpenApiFile; origin: 'stored' | 'project' | 'chosen' } | null>(null);
  const { saveOpenApi, loadOpenApi } = useServices();
  /** a file the user chose - the kept one or the one of the project folder (read in the background) must not replace it */
  const chosen = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [prefix, setPrefix] = useState(spec.pathPrefix ?? '');
  const known = useMemo(() => catalogTopics(model), [model]);

  // the OpenAPIs of the project folder — the same folder the Abgleich reads
  const folders = useMemo(() => ownFolders(model, spec.project).map(p => p.name), [model, spec.project]);
  const [project, setProject] = useState<Awaited<ReturnType<typeof projectOpenApis>> | undefined>(undefined);
  const lookInProject = useCallback(async () => {
    try { setProject(await projectOpenApis(model, spec.project)); } catch { setProject(null); }
  }, [model, spec.project]);
  useEffect(() => { if (folders.length) void lookInProject(); }, [folders.length, lookInProject]);
  /** «Datei wählen» starts in the project folder where there is one — not in Downloads */
  const pickFile = async () => {
    const picker = (window as unknown as { showOpenFilePicker?: (o: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
    if (!picker || !project) { fileRef.current?.click(); return; }
    const [h] = await picker({
      startIn: project.dir,
      types: [{ description: 'OpenAPI', accept: { 'application/json': ['.json'], 'application/yaml': ['.yml', '.yaml'] } }],
    }).catch(() => [] as FileSystemFileHandle[]);
    if (h) await read(await h.getFile());
  };

  const open = (o: OpenApiFile, origin: 'stored' | 'project' | 'chosen') => {
    setFile(o.file);
    setApi(readApi(o.doc));
    setCurrent({ o, origin });
  };
  const read = async (f: File, origin: 'project' | 'chosen' = 'chosen') => {
    if (origin === 'chosen') chosen.current = true;
    else if (chosen.current) return;
    if (origin === 'chosen') { setError(''); setApi(null); setPicked(new Set()); }
    const r = await readOpenApiFile(f);
    // chosen while the project's file was read: that one is dropped
    if (origin === 'project' && chosen.current) return;
    if (r.ok) open(r.value, origin);
    else if (origin === 'chosen') setError(r.message);
  };
  // the file chosen at «Neue Collection» — read already, shown right away; otherwise the one the
  // collection keeps; without one the file of its name in the project folder (below)
  const [looked, setLooked] = useState(false);
  useEffect(() => {
    if (initial) { open(initial, 'chosen'); setLooked(true); return; }
    const stored = spec.source?.stored;
    if (!stored || !spec.source?.file) { setLooked(true); return; }
    let alive = true;
    // not readable (access revoked, file gone): as without one - the project folder is looked in next
    void loadOpenApi(stored, spec.source.file)
      .then(o => { if (alive && o && !chosen.current) open(o, 'stored'); })
      .catch(e => console.warn('[orch-spec] hinterlegtes OpenAPI nicht lesbar:', e))
      .finally(() => { if (alive) setLooked(true); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the dialog opens
  }, [initial]);
  useEffect(() => {
    const name = spec.source?.file;
    const there = looked && !current && name ? project?.files.find(f => f.name === name) : undefined;
    if (there) void there.file.getFile().then(f => read(f, 'project')).catch(e => console.warn('[orch-spec] OpenAPI im Projekt-Ordner nicht lesbar:', e));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- when the project folder or the stored file is read
  }, [looked, project]);

  // the sub path of each operation - the groups of the list
  const suggested = useMemo(() => api ? suggestApis(api.operations, { api: spec.api, apiVersion: spec.apiVersion }) : new Map(), [api, spec.api, spec.apiVersion]);
  /** the API of every new service: the one of the collection */
  const apiOfOp = (_op?: ApiOperation) => ({ api: spec.api, apiVersion: spec.apiVersion });

  const groups = useMemo(() => {
    if (!api) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const out = new Map<string, Array<{ op: ApiOperation; here?: ReturnType<typeof serviceOf>; completes?: ReturnType<typeof serviceOf> }>>();
    for (const op of api.operations) {
      if (!inPathPrefix(op.path, prefix)) continue;
      if (!words.every(w => `${op.method} ${op.path} ${op.name} ${op.summary ?? ''} ${op.tags.join(' ')}`.toLowerCase().includes(w))) continue;
      const found = serviceOf(spec, op);
      const completes = found && isIncomplete(found) ? found : undefined;
      const subPath = suggested.get(op.key)?.subPath ?? '/';
      out.set(subPath, [...(out.get(subPath) ?? []), { op, here: completes ? undefined : found, completes }]);
    }
    return [...out.entries()];
  }, [api, query, prefix, spec, suggested]);
  const selectable = groups.flatMap(([, rows]) => rows.filter(r => !r.here).map(r => r.op.key));
  const toggle = (keys: string[], on: boolean) => setPicked(p => { const n = new Set(p); for (const k of keys) { if (on) n.add(k); else n.delete(k); } return n; });
  /** the file shown is not the one the collection keeps - it is kept on «übernehmen» */
  const fresh = !!current && current.origin !== 'stored';
  const badApi = !API_NAME.test(spec.api);

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center pt-16" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className={`w-[60rem] max-w-[95vw] max-h-[82vh] flex flex-col rounded-lg border shadow-xl ${c.border2} ${c.panelStrong}`}>
        <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${c.border}`}>
          <FileUp size={14} className={c.muted2} />
          <span className={`text-xs font-semibold ${c.text}`}>OpenAPI importieren</span>
          {api && <span className={`text-[10px] ${c.muted}`}>{file} — {api.title}{api.version ? ` ${api.version}` : ''} · {api.operations.length} Operationen</span>}
          {current && current.origin !== 'chosen' && (
            <span title={current.origin === 'stored' ? `Bei der Collection hinterlegt (${spec.source?.stored}) — «Andere Datei …» übersteuert es` : 'Die Datei des letzten Imports, im Projekt-Ordner gefunden — wird beim Übernehmen hinterlegt'}
              className={`text-[9px] px-1.5 py-0.5 rounded border ${isDark ? 'border-teal-400/40 text-teal-300' : 'border-teal-600/40 text-teal-700'}`}>
              {current.origin === 'stored' ? 'hinterlegt' : 'aus dem Projekt-Ordner'}
            </span>
          )}
          <button onClick={onClose} className={`ml-auto p-1 rounded ${c.muted} ${c.hover}`}><X size={13} /></button>
        </div>

        <div className="px-4 py-3 space-y-2 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".yml,.yaml,.json" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
            <button onClick={() => void pickFile()} title={project ? `startet im Projekt-Ordner «${project.folder}»` : undefined}
              className={`text-[11px] px-2.5 py-1.5 rounded border whitespace-nowrap ${c.btn}`}>
              {api ? 'Andere Datei …' : looked ? 'OpenAPI-Datei wählen (.yml, .yaml, .json) …' : 'Hinterlegtes OpenAPI wird gelesen …'}
            </button>
            {api && (
              <>
                <label className={`flex items-center gap-1 px-2 py-1 rounded border ${c.border2}`} title="Nur dieser Teil der OpenAPI gehört zur Collection — leer: die ganze">
                  <span className={`text-[10px] ${c.muted}`}>Teilpfad</span>
                  <input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="/ (alles)"
                    className={`w-40 bg-transparent outline-none text-[11px] font-mono ${c.text}`} />
                </label>
                <div className={`flex items-center gap-1 px-2 py-1 rounded border ${c.border2} flex-1`}>
                  <Search size={11} className={c.muted} />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pfad, Name, Tag …"
                    className={`flex-1 bg-transparent outline-none text-[11px] ${c.text}`} />
                </div>
          {folders.length > 0 && (
            <div className="space-y-1">
              {project === undefined && <p className={`text-[10px] ${c.muted}`}>Projekt-Ordner «{folders.join('», «')}» wird gelesen …</p>}
              {project === null && (
                <p className={`text-[10px] ${c.muted}`}>
                  Projekt-Ordner «{folders.join('», «')}» nicht lesbar —{' '}
                  <button onClick={() => void lookInProject()} className="underline">Zugriff erlauben</button>
                </p>
              )}
              {project && (
                <>
                  <div className={`text-[10px] ${c.muted}`}>
                    {project.files.length ? <>OpenAPIs im Projekt-Ordner «{project.folder}»:</> : <>Keine OpenAPI im Projekt-Ordner «{project.folder}» — «Datei wählen» startet dort.</>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {project.files.map(f => (
                      <button key={f.path} onClick={async () => read(await f.file.getFile(), 'chosen')} title={f.path}
                        className={`text-[10px] font-mono px-2 py-1 rounded border ${file === f.name ? (isDark ? 'border-teal-400/60 bg-teal-400/10' : 'border-teal-600/60 bg-teal-600/10') : c.btn} ${f.generated ? 'opacity-60' : ''}`}>
                        {f.name}
                        <span className={`ml-1.5 ${c.muted}`}>{f.path.split('/').slice(0, f.generated ? 2 : 1).join('/')}{f.generated ? ' · generiert' : ''}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
              </>
            )}
          </div>
          {error && <p className="text-[11px] text-rose-500 flex items-center gap-1.5"><AlertTriangle size={11} /> {error}</p>}

          {api && (
            <>
              <div className={`flex items-center gap-3 text-[10px] ${c.muted}`}>
                <button className="hover:underline" onClick={() => toggle(selectable, true)}>alle sichtbaren</button>
                <button className="hover:underline" onClick={() => setPicked(new Set())}>keine</button>
                <span className="ml-auto">
                  <span className={isDark ? 'text-emerald-300' : 'text-emerald-700'}>✓ in der Collection</span>
                  {' · '}<span className={isDark ? 'text-sky-300' : 'text-sky-700'}>ergänzt (aus dem Katalog)</span>
                  {' · '}<span className={isDark ? 'text-teal-300' : 'text-teal-700'}>⌁ im Katalog</span>
                </span>
              </div>
              <div className={`flex-1 min-h-0 overflow-y-auto rounded border ${c.border2}`}>
                {groups.map(([subPath, rows]) => {
                  const keys = rows.filter(r => !r.here).map(r => r.op.key);
                  const all = keys.length > 0 && keys.every(k => picked.has(k));
                  return (
                    <div key={subPath}>
                      <div className={`sticky top-0 z-10 flex items-center gap-2 px-2 py-1 border-b ${c.border} ${c.panelStrong}`}>
                        <input type="checkbox" disabled={!keys.length} checked={all} onChange={() => toggle(keys, !all)} title="alle dieses Teilpfads" />
                        <span className={`text-[11px] font-mono font-semibold ${c.text}`}>{subPath}</span>
                        <span className={`text-[10px] ${c.muted}`}>{rows.length}</span>
                      </div>
                      {rows.map(({ op, here, completes }) => {
                        const topic = serviceTopic({ project: spec.project, ...apiOfOp(op) }, op);
                        return (
                          <label key={op.key}
                            className={`flex items-center gap-2 pl-6 pr-2 py-1 border-b last:border-b-0 ${c.border} ${here ? 'opacity-60' : `cursor-pointer ${c.hover}`}`}>
                            <input type="checkbox" disabled={!!here} checked={!!here || picked.has(op.key)} onChange={() => toggle([op.key], !picked.has(op.key))} />
                            <MethodChip method={op.method} isDark={isDark} />
                            <span className={`w-72 truncate text-[11px] font-mono ${c.text}`} title={op.path}>{op.path}</span>
                            <span className={`w-44 truncate text-[11px] font-mono ${c.muted2}`} title="Name des Services (Scala-Objekt)">{here?.name ?? completes?.name ?? op.name}</span>
                            <span className={`flex-1 truncate text-[10px] ${c.muted}`} title={op.description}>{op.summary}</span>
                            {op.deprecated && <span className={`text-[9px] ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>veraltet</span>}
                            {completes
                              ? <span title={`ergänzt «${completes.name}» aus dem Katalog um Methode, Pfad, Parameter und Body`} className={`text-[10px] ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>ergänzt</span>
                              : here
                                ? <span title={`schon in der Collection als «${here.name}»`} className={`text-[10px] flex items-center gap-0.5 ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}><Check size={10} /> da</span>
                                : known.has(topic)
                                  ? <span title={`${topic} ist im Katalog — gibt es schon in einem Projekt`} className={`text-[10px] ${isDark ? 'text-teal-300' : 'text-teal-700'}`}>⌁ Katalog</span>
                                  : <span className="w-8" />}
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
                {!groups.length && <p className={`p-3 text-[11px] ${c.muted}`}>Keine Operation passt zu Teilpfad und Suche.</p>}
              </div>
            </>
          )}
        </div>

        <div className={`flex items-center gap-2 px-4 py-2.5 border-t ${c.border}`}>
          <span className={`text-[10px] ${badApi ? 'text-rose-500' : c.muted}`}>
            {badApi ? `Die API der Collection «${spec.api}» ist kein gültiger Paketname (klein, camelCase, Ebenen mit «.») — in der Übersicht ändern.`
              : api ? `${picked.size} gewählt — je Operation ein Service mit In, Out und den ersten Mappings; Typen aus den Schemas${fresh ? ' · die Datei wird bei der Collection hinterlegt' : ''}` : 'OpenAPI 3 als YAML oder JSON'}
          </span>
          <button onClick={onClose} className={`ml-auto text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
          {/* a file that is not kept yet: also without operations - then only the file is kept */}
          <button disabled={!api || (!picked.size && !fresh) || badApi || saving}
            onClick={async () => {
              const r = picked.size ? addOperations(spec, api!, [...picked], apiOfOp) : { spec, added: [] as string[] };
              const pathPrefix = prefix.trim().replace(/\/+$/, '');
              // the file is kept with the collection - a new one replaces the one before
              setSaving(true);
              const stored = fresh && current ? await saveOpenApi(spec.slug, current.o, spec.source?.stored) : null;
              setSaving(false);
              if (fresh && !stored) setError('Das OpenAPI liess sich nicht bei der Collection hinterlegen — die Services werden trotzdem übernommen.');
              onApply({
                ...r.spec,
                source: { ...(r.spec.source ?? {}), file, ...(stored ? { stored } : {}) },
                ...(!spec.serviceLabel && api!.title ? { serviceLabel: api!.title } : {}),
                ...(pathPrefix ? { pathPrefix } : {}),
              }, r.added);
            }}
            className={`text-[11px] px-2.5 py-1.5 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}>
            {picked.size ? `${picked.size} übernehmen` : fresh ? 'OpenAPI hinterlegen' : 'übernehmen'}
          </button>
        </div>
      </div>
    </div>
  );
}
