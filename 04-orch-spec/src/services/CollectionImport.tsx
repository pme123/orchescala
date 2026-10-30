// Import an existing collection:
//   · from the catalog — an API whose services a project already has
//     (grouped by the prefix of their topic, see catalogCollections.ts)
//   · from a file — a collection of another folder (`services/<slug>.json`)
import { AlertTriangle, Boxes, Check, FileJson, Library, Search, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { Model } from '../types';
import { cls } from '../ui';
import { collectionPackage } from './collection';
import { catalogApis, collectionFromCatalog, collectionOf } from './catalogCollections';
import { serviceProblem } from './store';
import type { ServiceCollectionSpec } from './types';

export default function CollectionImport({ model, existing, isDark, onClose, onCreate }: {
  model: Model | null;
  /** the slugs in services/ — an API that is there already is marked */
  existing: string[];
  isDark: boolean;
  onClose: () => void;
  onCreate: (spec: ServiceCollectionSpec) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const c = cls(isDark);
  const apis = useMemo(() => catalogApis(model), [model]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = apis.filter(a => words.every(w => `${a.prefix} ${a.group ?? ''} ${a.services.map(s => s.name).join(' ')}`.toLowerCase().includes(w)));

  const create = async (spec: ServiceCollectionSpec, key: string) => {
    setBusy(key); setError('');
    try {
      const r = await onCreate(spec);
      if (!r.ok) setError(r.message);
    } finally { setBusy(''); }
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
            Aus dem <b>Katalog</b>: eine API, deren Services es in einem Projekt schon gibt — mit In und Out aus der Domain.
            Methode und Pfad kennt der Katalog nicht: eine danach importierte OpenAPI ergänzt sie (gleicher Name).
          </p>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 px-2 py-1 rounded border flex-1 ${c.border2}`}>
              <Search size={11} className={c.muted} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="API, Projekt, Service …" autoFocus
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
          <div className={`flex-1 min-h-0 overflow-y-auto rounded border ${c.border2}`}>
            {!apis.length && <p className={`p-3 text-[11px] ${c.muted}`}>Der Katalog kennt keine Service-Worker (Topic <span className="font-mono">projekt-apiV1.Name</span>) — Admin → Katalog.</p>}
            {apis.length > 0 && !visible.length && <p className={`p-3 text-[11px] ${c.muted}`}>Keine API passt zur Suche.</p>}
            {visible.map(a => {
              const there = collectionOf(a, existing);
              return (
                <div key={a.prefix} className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 ${c.border}`}>
                  <Boxes size={13} className={isDark ? 'text-teal-300' : 'text-teal-700'} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-[11px] font-mono font-semibold truncate ${c.text}`}>{a.prefix}</div>
                    <div className={`text-[10px] truncate ${c.muted}`} title={a.services.map(s => s.name).join(', ')}>
                      {a.group ? `${a.group} · ` : ''}{collectionPackage(a)} · {a.services.length} Service{a.services.length === 1 ? '' : 's'}: {a.services.map(s => s.name).join(', ')}
                    </div>
                  </div>
                  {there
                    ? <span className={`text-[10px] flex items-center gap-0.5 ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}><Check size={10} /> schon da</span>
                    : (
                      <button disabled={!!busy} onClick={() => void create(collectionFromCatalog(a, model), a.prefix)}
                        className={`text-[11px] px-2.5 py-1 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}>
                        {busy === a.prefix ? '…' : 'Übernehmen'}
                      </button>
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
