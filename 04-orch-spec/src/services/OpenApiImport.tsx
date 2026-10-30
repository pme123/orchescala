// Read an OpenAPI and tick the operations the collection takes.
//
// The collection covers the whole OpenAPI or a sub path (`/clients`) — the
// filter at the top, remembered with the collection. The operations are grouped
// by the sub path that names their API (see suggestApis): per group the API and
// its version, as the new services get them (`client v1`, `crm v2`).
//
// Each operation shows whether it is already there:
//   · «da» — in the collection (same operationId, or same method and path); it
//     stays as it is (with its In/Out and mappings) and cannot be ticked
//   · «ergänzt» — a service of the same name from the catalog, without request:
//     the operation completes it
//   · «⌁ Katalog» — a service with the same topic is known (domain catalog or
//     service catalog): it exists in a project already
import { AlertTriangle, Check, FileUp, Search, X } from 'lucide-react';
import { load } from 'js-yaml';
import { useMemo, useRef, useState } from 'react';
import type { Model } from '../types';
import { cls } from '../ui';
import { API_NAME, apiOf, sameApi, serviceTopic } from './collection';
import { addOperations, apiProblem, inPathPrefix, isIncomplete, readApi, serviceOf, suggestApis, type ApiImport, type ApiOperation } from './openApiRest';
import type { ServiceCollectionSpec } from './types';
import { MethodChip } from './ui';

/** The topics the catalog knows — services of the domain and of the service catalog. */
export function catalogTopics(model: Model | null): Set<string> {
  const out = new Set<string>();
  for (const t of model?.domainTypes ?? []) if (t.topicName) out.add(t.topicName);
  for (const s of model?.services ?? []) { out.add(s.id); if (s.topic) out.add(s.topic); }
  return out;
}

type ApiChoice = { api: string; apiVersion: number };

export default function OpenApiImport({ spec, model, isDark, onClose, onApply }: {
  spec: ServiceCollectionSpec;
  model: Model | null;
  isDark: boolean;
  onClose: () => void;
  onApply: (next: ServiceCollectionSpec, added: string[]) => void;
}) {
  const c = cls(isDark);
  const fileRef = useRef<HTMLInputElement>(null);
  const [api, setApi] = useState<ApiImport | null>(null);
  const [file, setFile] = useState('');
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [prefix, setPrefix] = useState(spec.pathPrefix ?? '');
  /** the API per sub path, as the user changed it */
  const [apis, setApis] = useState<Record<string, ApiChoice>>({});
  const known = useMemo(() => catalogTopics(model), [model]);

  const read = async (f: File) => {
    setError(''); setApi(null); setPicked(new Set()); setApis({});
    let doc: unknown;
    try {
      const text = await f.text();
      doc = /\.json$/i.test(f.name) ? JSON.parse(text) : load(text);
    } catch (e) {
      setError(`«${f.name}» ist nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const problem = apiProblem(doc);
    if (problem) { setError(`«${f.name}»: ${problem}`); return; }
    setFile(f.name);
    setApi(readApi(doc));
  };

  // the suggestion per operation: an existing service under the same sub path gives its API
  const suggested = useMemo(() => api ? suggestApis(api.operations, { api: spec.api, apiVersion: spec.apiVersion }) : new Map(), [api, spec.api, spec.apiVersion]);
  const choiceFor = (subPath: string, fallback: ApiChoice): ApiChoice => {
    if (apis[subPath]) return apis[subPath];
    const there = spec.services.find(s => s.path && inPathPrefix(s.path, subPath));
    return there ? { api: apiOf(spec, there).api, apiVersion: apiOf(spec, there).apiVersion } : fallback;
  };
  const apiOfOp = (op: ApiOperation): ApiChoice => {
    const s = suggested.get(op.key);
    return s ? choiceFor(s.subPath, { api: s.api, apiVersion: s.apiVersion }) : { api: spec.api, apiVersion: spec.apiVersion };
  };

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
  const badApi = groups.some(([, rows]) => rows.some(r => picked.has(r.op.key) && !API_NAME.test(apiOfOp(r.op).api)));

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center pt-16" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className={`w-[60rem] max-w-[95vw] max-h-[82vh] flex flex-col rounded-lg border shadow-xl ${c.border2} ${c.panelStrong}`}>
        <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${c.border}`}>
          <FileUp size={14} className={c.muted2} />
          <span className={`text-xs font-semibold ${c.text}`}>OpenAPI importieren</span>
          {api && <span className={`text-[10px] ${c.muted}`}>{file} — {api.title}{api.version ? ` ${api.version}` : ''} · {api.operations.length} Operationen</span>}
          <button onClick={onClose} className={`ml-auto p-1 rounded ${c.muted} ${c.hover}`}><X size={13} /></button>
        </div>

        <div className="px-4 py-3 space-y-2 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".yml,.yaml,.json" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} className={`text-[11px] px-2.5 py-1.5 rounded border whitespace-nowrap ${c.btn}`}>
              {api ? 'Andere Datei …' : 'OpenAPI-Datei wählen (.yml, .yaml, .json) …'}
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
                  const choice = apiOfOp(rows[0].op);
                  const keys = rows.filter(r => !r.here).map(r => r.op.key);
                  const all = keys.length > 0 && keys.every(k => picked.has(k));
                  const setChoice = (patch: Partial<ApiChoice>) => setApis(a => ({ ...a, [subPath]: { ...choice, ...patch } }));
                  const mixed = spec.services.some(s => s.path && inPathPrefix(s.path, subPath) && !sameApi(apiOf(spec, s), choice));
                  return (
                    <div key={subPath}>
                      <div className={`sticky top-0 z-10 flex items-center gap-2 px-2 py-1 border-b ${c.border} ${c.panelStrong}`}>
                        <input type="checkbox" disabled={!keys.length} checked={all} onChange={() => toggle(keys, !all)} title="alle dieses Teilpfads" />
                        <span className={`text-[11px] font-mono font-semibold ${c.text}`}>{subPath}</span>
                        <span className={`text-[10px] ${c.muted}`}>{rows.length}</span>
                        <span className={`ml-auto text-[10px] ${c.muted}`} title="API (Paket) und Version der neuen Services dieses Teilpfads">API</span>
                        <input value={choice.api} onChange={e => setChoice({ api: e.target.value.trim() })}
                          className={`w-32 px-1.5 py-0.5 rounded border text-[11px] font-mono outline-none ${API_NAME.test(choice.api) ? c.input : 'border-rose-400 text-rose-500'}`} />
                        <span className={`text-[10px] ${c.muted}`}>v</span>
                        <input type="number" min={1} value={choice.apiVersion} onChange={e => setChoice({ apiVersion: Math.max(1, Number(e.target.value) || 1) })}
                          className={`w-12 px-1.5 py-0.5 rounded border text-[11px] font-mono outline-none ${c.input}`} />
                        {mixed && <span title="In der Collection haben Services dieses Teilpfads eine andere API" className={isDark ? 'text-amber-300' : 'text-amber-600'}><AlertTriangle size={10} /></span>}
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
            {badApi ? 'Eine API ist kein gültiger Paketname (klein, camelCase).'
              : api ? `${picked.size} gewählt — je Operation ein Service mit In, Out und den ersten Mappings; Typen aus den Schemas` : 'OpenAPI 3 als YAML oder JSON'}
          </span>
          <button onClick={onClose} className={`ml-auto text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
          <button disabled={!api || !picked.size || badApi}
            onClick={() => {
              const r = addOperations(spec, api!, [...picked], apiOfOp);
              const pathPrefix = prefix.trim().replace(/\/+$/, '');
              onApply({
                ...r.spec,
                source: { ...(r.spec.source ?? {}), file },
                ...(!spec.serviceLabel && api!.title ? { serviceLabel: api!.title } : {}),
                ...(pathPrefix ? { pathPrefix } : {}),
              }, r.added);
            }}
            className={`text-[11px] px-2.5 py-1.5 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}>
            {picked.size || ''} übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
