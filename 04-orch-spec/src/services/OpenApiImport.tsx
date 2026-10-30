// Read an OpenAPI and tick the operations the collection takes.
//
// Each operation shows whether it is already there:
//   · «in der Collection» — same operationId, or same method and path; it
//     stays as it is (with its In/Out and mappings) and cannot be ticked
//   · «im Katalog» — a service with the same topic is known (domain catalog
//     or service catalog): it exists in a project already; ticking it takes
//     it into this collection anyway (e.g. to describe it here from now on)
import { AlertTriangle, Check, FileUp, Search, X } from 'lucide-react';
import { load } from 'js-yaml';
import { useMemo, useRef, useState } from 'react';
import type { Model } from '../types';
import { cls } from '../ui';
import { serviceTopic } from './collection';
import { MethodChip } from './ui';
import { addOperations, apiProblem, isIncomplete, readApi, serviceOf, type ApiImport } from './openApiRest';
import type { ServiceCollectionSpec } from './types';

/** The topics the catalog knows — services of the domain and of the service catalog. */
export function catalogTopics(model: Model | null): Set<string> {
  const out = new Set<string>();
  for (const t of model?.domainTypes ?? []) if (t.topicName) out.add(t.topicName);
  for (const s of model?.services ?? []) { out.add(s.id); if (s.topic) out.add(s.topic); }
  return out;
}

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
  const known = useMemo(() => catalogTopics(model), [model]);

  const read = async (f: File) => {
    setError(''); setApi(null); setPicked(new Set());
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

  const rows = useMemo(() => {
    if (!api) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return api.operations
      .map(op => {
        const found = serviceOf(spec, op);
        // a service from the catalog without request: the operation completes it
        const completes = found && isIncomplete(found) ? found : undefined;
        return { op, here: completes ? undefined : found, completes, inCatalog: known.has(serviceTopic(spec, op)) };
      })
      .filter(({ op }) => words.every(w => `${op.method} ${op.path} ${op.name} ${op.summary ?? ''} ${op.tags.join(' ')}`.toLowerCase().includes(w)));
  }, [api, query, spec, known]);
  const selectable = rows.filter(r => !r.here);
  const toggle = (key: string) => setPicked(p => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center pt-16" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className={`w-[56rem] max-w-[95vw] max-h-[80vh] flex flex-col rounded-lg border shadow-xl ${c.border2} ${isDark ? 'bg-[#16171a]' : 'bg-white'}`}>
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
            <button onClick={() => fileRef.current?.click()} className={`text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
              {api ? 'Andere Datei …' : 'OpenAPI-Datei wählen (.yml, .yaml, .json) …'}
            </button>
            {api && (
              <div className={`flex items-center gap-1 px-2 py-1 rounded border ${c.border2} flex-1`}>
                <Search size={11} className={c.muted} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pfad, Name, Tag …"
                  className={`flex-1 bg-transparent outline-none text-[11px] ${c.text}`} />
              </div>
            )}
          </div>
          {error && <p className="text-[11px] text-rose-500 flex items-center gap-1.5"><AlertTriangle size={11} /> {error}</p>}

          {api && (
            <>
              <div className={`flex items-center gap-3 text-[10px] ${c.muted}`}>
                <button className="hover:underline" onClick={() => setPicked(new Set(selectable.map(r => r.op.key)))}>alle sichtbaren</button>
                <button className="hover:underline" onClick={() => setPicked(new Set())}>keine</button>
                <span className="ml-auto">
                  <span className={isDark ? 'text-emerald-300' : 'text-emerald-700'}>✓ in der Collection</span>
                  {' · '}
                  <span className={isDark ? 'text-teal-300' : 'text-teal-700'}>⌁ im Katalog</span>
                </span>
              </div>
              <div className={`flex-1 min-h-0 overflow-y-auto rounded border ${c.border2}`}>
                {rows.map(({ op, here, completes, inCatalog }) => (
                  <label key={op.key}
                    className={`flex items-center gap-2 px-2 py-1 border-b last:border-b-0 ${c.border} ${here ? 'opacity-60' : `cursor-pointer ${c.hover}`}`}>
                    <input type="checkbox" disabled={!!here} checked={!!here || picked.has(op.key)} onChange={() => toggle(op.key)} />
                    <MethodChip method={op.method} isDark={isDark} />
                    <span className={`w-72 truncate text-[11px] font-mono ${c.text}`} title={op.path}>{op.path}</span>
                    <span className={`w-48 truncate text-[11px] font-mono ${c.muted2}`} title="Name des Services (Scala-Objekt)">{here?.name ?? op.name}</span>
                    <span className={`flex-1 truncate text-[10px] ${c.muted}`} title={op.description}>{op.summary}</span>
                    {op.deprecated && <span className={`text-[9px] ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>veraltet</span>}
                    {completes
                      ? <span title={`ergänzt «${completes.name}» aus dem Katalog um Methode, Pfad, Parameter und Body`} className={`text-[10px] ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>ergänzt</span>
                      : here
                      ? <span title={`schon in der Collection als «${here.name}»`} className={`text-[10px] flex items-center gap-0.5 ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}><Check size={10} /> da</span>
                      : inCatalog
                        ? <span title={`${serviceTopic(spec, op)} ist im Katalog — gibt es schon in einem Projekt`} className={`text-[10px] ${isDark ? 'text-teal-300' : 'text-teal-700'}`}>⌁ Katalog</span>
                        : <span className="w-8" />}
                  </label>
                ))}
                {!rows.length && <p className={`p-3 text-[11px] ${c.muted}`}>Keine Operation passt zur Suche.</p>}
              </div>
            </>
          )}
        </div>

        <div className={`flex items-center gap-2 px-4 py-2.5 border-t ${c.border}`}>
          <span className={`text-[10px] ${c.muted}`}>
            {api ? `${picked.size} gewählt — je Operation ein Service mit In, Out und den ersten Mappings; Typen aus den Schemas` : 'OpenAPI 3 als YAML oder JSON'}
          </span>
          <button onClick={onClose} className={`ml-auto text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
          <button disabled={!api || !picked.size}
            onClick={() => {
              const r = addOperations(spec, api!, [...picked]);
              onApply({ ...r.spec, source: { ...(r.spec.source ?? {}), file }, ...(!spec.serviceLabel && api!.title ? { serviceLabel: api!.title } : {}) }, r.added);
            }}
            className={`text-[11px] px-2.5 py-1.5 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}>
            {picked.size || ''} übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
