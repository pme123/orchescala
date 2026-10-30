// A service collection: on the left its services and the types of the API, on
// the right the chosen service — the request (parameters, body), its `In`, the
// response and its `Out`, and between them the mappings in FEEL:
//
//   In ──(parameters, body)──▶ request          response ──(Out mappings)──▶ Out
//
// Saved automatically like a process (version/ETag, a change elsewhere is a
// conflict and nothing is overwritten).
import { AlertTriangle, ArrowLeft, Boxes, Braces, Check, FileCode2, FileUp, ListOrdered, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePermissions } from '../auth';
import { useConfirm } from '../components/Confirm';
import FeelInput from '../components/FeelInput';
import { StandaloneTypeEditor } from '../components/TypeBuilder';
import { checkFeel, expectedFor, fieldVariables, isFeel, type VarNode } from '../feel';
import { useStore } from '../store';
import { parseDomainRef } from '../serviceTypes';
import { SCALA_TYPES, STATUSES, STATUS_META, type Field, type Mapping, type Status, type TypeDef } from '../types';
import { StatusChip, cls } from '../ui';
import { nowIsoWithTimezone, uid } from '../util';
import {
  API_NAME, apiList, apiOf, apisOf, basePathParams, collectionPackage, collectionStatus, collectionTrait, inPathBase, membersOf, normalPathBase, processFrame, sameApi,
  serviceIssues, serviceTopic, suggestPathBase, withoutService, workerPath,
} from './collection';
import OpenApiImport from './OpenApiImport';
import { catalogProjects, syncWithCatalog, type CatalogSync } from './catalogCollections';
import CollectionExport from './CollectionExport';
import { MethodChip } from './ui';
import { useServices } from './store';
import { HTTP_METHODS, type BodyRef, type CollectionService, type HttpMethod, type ParamIn, type RequestParam, type ServiceCollectionSpec } from './types';

type Selection = { kind: 'overview' } | { kind: 'service'; id: string } | { kind: 'type'; id: string };

export default function CollectionView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { isDark, model } = useStore();
  const { loadService, saveService } = useServices();
  const { canEdit } = usePermissions();
  const c = cls(isDark);
  const [spec, setSpec] = useState<ServiceCollectionSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'conflict' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [selection, setSelection] = useState<Selection>({ kind: 'overview' });
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /** the Abgleich to look at before it applies */
  const [syncPreview, setSyncPreview] = useState<CatalogSync | null>(null);
  const catalogProjectNames = useMemo(() => new Set(catalogProjects(model).map(p => p.project)), [model]);
  /** what the last Abgleich did (or that there was nothing to do) */
  const [syncNote, setSyncNote] = useState('');
  const version = useRef<string | null>(null);
  // the last state set — several changes in one event build on each other
  const latest = useRef<ServiceCollectionSpec | null>(null);

  useEffect(() => {
    let gone = false;
    loadService(slug)
      .then(r => {
        if (gone) return;
        if (!r) { setError(`services/${slug}.json gibt es nicht (mehr).`); return; }
        version.current = r.version;
        latest.current = r.data;
        setSpec(r.data);
        if (r.data.services[0]) setSelection({ kind: 'service', id: r.data.services[0].id });
      })
      .catch(e => { if (!gone) setError(e instanceof Error ? e.message : String(e)); });
    return () => { gone = true; };
  }, [slug, loadService]);

  const update = useCallback((fn: (s: ServiceCollectionSpec) => ServiceCollectionSpec) => {
    if (!latest.current) return;
    const next = fn(latest.current);
    latest.current = next;
    setSpec(next);
    setSaveState('dirty');
  }, []);

  // autosave — a moment after the last change; one write at a time, what changes
  // meanwhile goes with the next one (otherwise it would conflict with its own version)
  const inFlight = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (saveState !== 'dirty' || !canEdit || inFlight.current) return;
    const t = setTimeout(async () => {
      const sent = latest.current;
      if (!sent || !version.current) return;
      const data = { ...sent, updatedAt: nowIsoWithTimezone() };
      inFlight.current = true;
      setSaveState('saving');
      const r = await saveService(data, version.current);
      inFlight.current = false;
      if (r.status === 'saved') {
        version.current = r.version;
        if (latest.current === sent) { latest.current = data; setSaveState('saved'); }
        else { setSaveState('dirty'); setTick(n => n + 1); }
      } else if (r.status === 'conflict') setSaveState('conflict');
      else { setSaveState('error'); setSaveError(r.message); }
    }, 800);
    return () => clearTimeout(t);
  }, [spec, saveState, canEdit, saveService, tick]);

  if (error) return <div className="p-6 text-xs text-rose-500 flex items-center gap-2"><AlertTriangle size={12} /> {error}</div>;
  if (!spec) return <div className={`p-6 text-xs ${c.muted} flex items-center gap-2`}><Loader2 size={12} className="animate-spin" /> Lade Collection …</div>;

  const service = selection.kind === 'service' ? spec.services.find(s => s.id === selection.id) : undefined;
  const type = selection.kind === 'type' ? spec.types.find(t => t.id === selection.id) : undefined;
  const schemaTypes = spec.types.filter(t => !t.interactionId);
  const patchService = (id: string, patch: Partial<CollectionService>) =>
    update(s => ({ ...s, services: s.services.map(x => (x.id === id ? { ...x, ...patch } : x)) }));

  // Abgleich with the catalog: what changes is shown first, nothing is deleted without asking
  const canSync = catalogProjectNames.has(spec.project);
  const runSync = () => {
    setSyncNote('');
    const r = latest.current && syncWithCatalog(latest.current, model);
    if (!r) { setSyncNote('Der Katalog kennt das Projekt nicht.'); return; }
    if (!r.added.length && !r.updated.length && !r.addedTypes.length && !r.removed.length) { setSyncNote('Abgleich: wie im Katalog'); return; }
    setSyncPreview(r);
  };
  const applySync = (r: CatalogSync) => {
    update(() => r.spec);
    setSyncPreview(null);
    const parts = [[r.added.length, 'neu'], [r.updated.length, 'aktualisiert'], [r.addedTypes.length, 'neue Typen'], [r.removed.length, 'entfernt']] as const;
    setSyncNote(`Abgleich: ${parts.filter(([n]) => n).map(([n, what]) => `${n} ${what}`).join(', ')}`);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* head */}
      <div className={`flex items-center gap-3 px-3 py-2 border-b ${c.border}`}>
        <button onClick={onBack} title="Zurück zu den Services" className={`p-1 rounded ${c.muted} ${c.hover}`}><ArrowLeft size={14} /></button>
        <Boxes size={14} className={isDark ? 'text-teal-300' : 'text-teal-700'} />
        <div className="min-w-[10rem] flex-1">
          <input value={spec.title} disabled={!canEdit} onChange={e => update(s => ({ ...s, title: e.target.value }))}
            className={`w-full bg-transparent outline-none text-sm font-semibold ${c.text}`} />
          <div className={`text-[10px] font-mono truncate ${c.muted}`}>{spec.project}{spec.pathPrefix ? ` · ${spec.pathPrefix}` : ''}{spec.services.length ? ` · ${apiList(spec)}` : ''}</div>
        </div>
        <SaveBadge state={saveState} message={saveError} isDark={isDark} />
        <StatusChip status={collectionStatus(spec)} isDark={isDark} title="tiefster Status der Services" />
        {syncNote && <span className={`text-[10px] truncate max-w-[14rem] cursor-pointer ${c.muted}`} title={`${syncNote} — ausblenden`} onClick={() => setSyncNote('')}>{syncNote}</span>}
        {canEdit && canSync && (
          <button onClick={runSync} title="Services, Anfrage und Typen mit dem Katalog abgleichen — ohne die Collection neu anzulegen"
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
            <RefreshCw size={12} /> Abgleich mit Katalog
          </button>
        )}
        {canEdit && (
          <button onClick={() => setImportOpen(true)}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
            <FileUp size={12} /> OpenAPI importieren
          </button>
        )}
        <button onClick={() => setExportOpen(true)} disabled={!spec.services.length}
          title="Scala-Code der Services und der Befehl für den Helper"
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}>
          <FileCode2 size={12} /> Export
        </button>
      </div>
      {saveState === 'conflict' && (
        <div className={`px-3 py-1.5 text-[11px] border-b ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
          Die Collection wurde inzwischen anderswo geändert — deine Änderungen sind NICHT gespeichert. Seite neu laden, um die andere Fassung zu sehen.
        </div>
      )}

      {syncPreview && <SyncPreview sync={syncPreview} isDark={isDark} onCancel={() => setSyncPreview(null)} onApply={() => applySync(syncPreview)} />}
      {exportOpen && <CollectionExport spec={spec} model={model} isDark={isDark} onClose={() => setExportOpen(false)} />}
      {importOpen && (
        <OpenApiImport spec={spec} model={model} isDark={isDark} onClose={() => setImportOpen(false)}
          onApply={(next, added) => {
            update(() => next);
            setImportOpen(false);
            const first = next.services.find(s => s.name === added[0]);
            if (first) setSelection({ kind: 'service', id: first.id });
          }} />
      )}

      <div className="flex flex-1 min-h-0">
        {/* services and types */}
        <div className={`w-80 flex-shrink-0 border-r ${c.border} overflow-y-auto p-2 space-y-3`}>
          <button onClick={() => setSelection({ kind: 'overview' })}
            className={`w-full text-left px-2 py-1 rounded text-[11px] ${c.hover} ${selection.kind === 'overview' ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''} ${c.text}`}>
            Übersicht
          </button>
          <div>
            <div className={`flex items-center text-[9px] uppercase tracking-widest px-2 py-1 ${c.muted}`}>
              <span className="flex-1">Services · {spec.services.length}</span>
              {canEdit && (
                <button title="Service von Hand anlegen" onClick={() => {
                  const svc = blankService(spec);
                  update(s => ({ ...s, services: [...s.services, svc.service], types: [...s.types, ...svc.types] }));
                  setSelection({ kind: 'service', id: svc.service.id });
                }} className={`p-0.5 rounded ${c.hover}`}><Plus size={11} /></button>
              )}
            </div>
            {!spec.services.length && (
              <p className={`px-2 text-[10px] ${c.muted}`}>Noch keine — «OpenAPI importieren» und die gewünschten Operationen ankreuzen.</p>
            )}
            {apisOf(spec).map(a => (
              <div key={`${a.api}.${a.apiVersion}`} className="mb-1">
                <div className={`px-2 pt-1 text-[9px] font-mono ${c.muted}`} title={collectionPackage(a)}>{collectionTrait(a)} · {collectionPackage(a)}</div>
            {spec.services.filter(s => sameApi(apiOf(spec, s), a)).map(s => {
              const issues = serviceIssues(spec, s);
              return (
                <button key={s.id} onClick={() => setSelection({ kind: 'service', id: s.id })}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${c.hover} ${service?.id === s.id ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
                  <MethodChip method={s.method} isDark={isDark} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[11px] font-mono font-semibold ${c.text}`}>{s.name}</span>
                    <span className={`block truncate text-[9px] font-mono ${c.muted}`}>{s.path}</span>
                  </span>
                  {issues.length > 0 && <span title={issues.join('\n')}><AlertTriangle size={10} className={isDark ? 'text-amber-300' : 'text-amber-600'} /></span>}
                  <StatusChip status={s.status} isDark={isDark} muted={s.status === 'implemented'} />
                </button>
              );
            })}
              </div>
            ))}
          </div>
          <div>
            <div className={`flex items-center text-[9px] uppercase tracking-widest px-2 py-1 ${c.muted}`}>
              <span className="flex-1">Typen der API · {schemaTypes.length}</span>
              {canEdit && (
                <button title="Klasse anlegen" onClick={() => {
                  const id = uid('t');
                  update(s => ({ ...s, types: [...s.types, { id, name: 'NeueKlasse', kind: 'case', status: 'draft', fields: [{ id: uid('f'), name: '', type: 'String' }] }] }));
                  setSelection({ kind: 'type', id });
                }} className={`p-0.5 rounded ${c.hover}`}><Plus size={11} /></button>
              )}
            </div>
            {schemaTypes.map(t => (
              <button key={t.id} onClick={() => setSelection({ kind: 'type', id: t.id })}
                className={`w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-left ${c.hover} ${type?.id === t.id ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
                {t.kind === 'enum' ? <ListOrdered size={11} className={c.muted} /> : <Braces size={11} className={c.muted} />}
                <span className={`flex-1 truncate text-[11px] font-mono ${c.text}`}>{t.name}</span>
                <span className={`text-[9px] ${c.muted}`}>{t.kind === 'enum' ? (t.values ?? []).length : (t.fields ?? []).length}</span>
              </button>
            ))}
          </div>
        </div>

        {/* the chosen service, type or the overview */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {service ? (
            <ServiceEditor key={service.id} spec={spec} service={service} canEdit={canEdit}
              onPatch={patch => patchService(service.id, patch)}
              onTypes={types => update(s => ({ ...s, types }))}
              onOpenType={id => setSelection({ kind: 'type', id })}
              onRemove={() => { update(s => withoutService(s, service.id)); setSelection({ kind: 'overview' }); }} />
          ) : type ? (
            <StandaloneTypeEditor key={type.id} type={type} spec={processFrame(spec)} isDark={isDark} canEdit={canEdit} model={model}
              onTypes={types => update(s => ({ ...s, types }))}
              onOpenType={id => setSelection({ kind: 'type', id })} />
          ) : (
            <Overview spec={spec} canEdit={canEdit} onChange={patch => update(s => ({ ...s, ...patch }))} />
          )}
        </div>
      </div>
    </div>
  );
}

function SaveBadge({ state, message, isDark }: { state: string; message: string; isDark: boolean }) {
  const c = cls(isDark);
  if (state === 'saving' || state === 'dirty') return <span className={`text-[10px] flex items-center gap-1 ${c.muted}`}><Loader2 size={10} className="animate-spin" /> speichert …</span>;
  if (state === 'error') return <span title={message} className="text-[10px] text-rose-500 flex items-center gap-1"><AlertTriangle size={10} /> nicht gespeichert</span>;
  if (state === 'conflict') return <span className="text-[10px] text-rose-500 flex items-center gap-1"><AlertTriangle size={10} /> Konflikt</span>;
  return <span className={`text-[10px] flex items-center gap-1 ${c.muted}`}><Check size={10} /> gespeichert</span>;
}

/** A new service by hand — `GET /`, an empty In and Out. */
function blankService(spec: ServiceCollectionSpec): { service: CollectionService; types: TypeDef[] } {
  const id = uid('svc');
  let name = 'NeuerService', i = 2;
  while (spec.services.some(s => s.name === name)) name = `NeuerService${i++}`;
  const inType: TypeDef = { id: uid('t'), name: 'In', kind: 'case', status: 'draft', interactionId: id, fields: [] };
  const outType: TypeDef = { id: uid('t'), name: 'Out', kind: 'case', status: 'draft', interactionId: id, fields: [] };
  return {
    service: { id, name, api: spec.api, apiVersion: spec.apiVersion, status: 'draft', method: 'GET', path: '/', params: [], inTypeId: inType.id, outTypeId: outType.id },
    types: [inType, outType],
  };
}

function Overview({ spec, canEdit, onChange }: { spec: ServiceCollectionSpec; canEdit: boolean; onChange: (patch: Partial<ServiceCollectionSpec>) => void }) {
  const { isDark } = useStore();
  const c = cls(isDark);
  const input = `w-full text-[11px] px-2 py-1 rounded border outline-none ${c.input}`;
  const suggested = useMemo(() => suggestPathBase(spec), [spec]);
  return (
    <div className="p-4 space-y-3 max-w-3xl">
      <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Collection</div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Info label="Projekt" value={spec.project} isDark={isDark} />
        <Info label="APIs" value={apiList(spec) || `${spec.api} v${spec.apiVersion}`} isDark={isDark} />
        <Info label="Status" value={STATUS_META[collectionStatus(spec)].label} isDark={isDark} />
      </div>
      <label className="block space-y-0.5">
        <span className={`text-[10px] ${c.muted}`}>Service-Bezeichnung (<span className="font-mono">serviceLabel</span> — steht in der Beschreibung jedes Services)</span>
        <input className={input} disabled={!canEdit} value={spec.serviceLabel ?? ''} placeholder={spec.source?.title || spec.title}
          onChange={e => onChange({ serviceLabel: e.target.value || undefined })} />
      </label>
      <label className="block space-y-0.5">
        <span className={`text-[10px] ${c.muted}`}>Basis-URL (<span className="font-mono">serviceBasePath</span> — wo die API läuft; aus <span className="font-mono">servers</span> der OpenAPI)</span>
        <input className={`${input} font-mono`} disabled={!canEdit} value={spec.source?.basePath ?? ''} placeholder="https://api.example.com/v1"
          onChange={e => onChange({ source: { ...(spec.source ?? {}), basePath: e.target.value || undefined } })} />
      </label>
      <div className="space-y-0.5">
        <span className={`text-[10px] ${c.muted}`}>
          Basispfad der Firma — der Anfang jedes Pfads, den die Firma schon im <span className="font-mono">serviceBasePath</span> hat
          (<span className="font-mono">…/banks/$bankNumber</span>); seine Platzhalter sind keine Parameter der Services
        </span>
        <div className="flex items-center gap-2">
          <input className={`${input} font-mono`} disabled={!canEdit} value={spec.pathBase ?? ''} placeholder={suggested || '/banks/{bankNumber}'}
            onChange={e => onChange({ pathBase: e.target.value || undefined })} />
          {canEdit && suggested && suggested !== normalPathBase(spec.pathBase) && (
            <button onClick={() => onChange({ pathBase: suggested })} title="aus den Pfaden: was alle teilen, bis zum letzten Platzhalter, den kein In hat"
              className={`text-[10px] px-2 py-1 rounded border whitespace-nowrap ${c.btn}`}>{suggested} übernehmen</button>
          )}
        </div>
      </div>
      <label className="block space-y-0.5">
        <span className={`text-[10px] ${c.muted}`}>Beschreibung</span>
        <textarea className={`${input} resize-y`} rows={4} disabled={!canEdit} value={spec.description ?? ''}
          onChange={e => onChange({ description: e.target.value || undefined })} placeholder="Wofür diese API da ist" />
      </label>
      {spec.source?.file && (
        <p className={`text-[10px] ${c.muted}`}>Zuletzt importiert: <span className="font-mono">{spec.source.file}</span>{spec.source.title ? ` — ${spec.source.title}` : ''}{spec.source.version ? ` ${spec.source.version}` : ''}</p>
      )}
    </div>
  );
}

/** What the Abgleich with the catalog changes — before it applies. */
function SyncPreview({ sync, isDark, onCancel, onApply }: { sync: CatalogSync; isDark: boolean; onCancel: () => void; onApply: () => void }) {
  const c = cls(isDark);
  const groups: [string, string[], string][] = [
    ['Neue Services', sync.added, isDark ? 'text-emerald-300' : 'text-emerald-700'],
    ['Aktualisiert', sync.updated, isDark ? 'text-sky-300' : 'text-sky-700'],
    ['Neue Typen der API', sync.addedTypes, isDark ? 'text-emerald-300' : 'text-emerald-700'],
    ['Entfernt — CustomWorker, kein REST-Service', sync.removed, 'text-rose-500'],
  ];
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center pt-24" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className={`w-[36rem] max-w-[95vw] rounded-lg border shadow-xl p-4 space-y-3 ${c.border2} ${c.panelStrong}`}>
        <div className={`flex items-center gap-2 text-xs font-semibold ${c.text}`}><RefreshCw size={13} /> Mit dem Katalog abgleichen</div>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {groups.filter(([, names]) => names.length).map(([label, names, tone]) => (
            <div key={label}>
              <div className={`text-[10px] uppercase tracking-widest ${tone}`}>{label} · {names.length}</div>
              <div className={`text-[11px] font-mono ${c.text}`}>{names.join(', ')}</div>
            </div>
          ))}
        </div>
        <p className={`text-[10px] ${c.muted}`}>
          Was die Domain kennt, gilt: Methode, Pfad, Bodies, die Felder von In und Out, die Typen der API. Was nur die Collection hat,
          bleibt: Mappings, eigene Felder, Query und Header aus einer OpenAPI, Status und Beschreibung.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className={`text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
          <button onClick={onApply} autoFocus className={`text-[11px] px-3 py-1.5 rounded border border-transparent ${c.btnPrimary}`}>Abgleichen</button>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  const c = cls(isDark);
  return (
    <div className={`rounded border px-2 py-1 ${c.border2}`}>
      <div className={`text-[9px] uppercase tracking-widest ${c.muted}`}>{label}</div>
      <div className={`font-mono ${c.text}`}>{value}</div>
    </div>
  );
}

// ── one service ─────────────────────────────────────────────────────────────

const PARAM_IN: Record<ParamIn, string> = { path: 'Pfad', query: 'Query', header: 'Header' };

function ServiceEditor({ spec, service: s, canEdit, onPatch, onTypes, onOpenType, onRemove }: {
  spec: ServiceCollectionSpec;
  service: CollectionService;
  canEdit: boolean;
  onPatch: (patch: Partial<CollectionService>) => void;
  onTypes: (types: TypeDef[]) => void;
  onOpenType: (id: string) => void;
  onRemove: () => void;
}) {
  const { isDark, model } = useStore();
  const confirm = useConfirm();
  const c = cls(isDark);
  const frame = useMemo(() => processFrame(spec), [spec]);
  const { in: inType, out: outType } = membersOf(spec, s);
  const issues = serviceIssues(spec, s);
  const input = `text-[11px] px-2 py-1 rounded border outline-none ${c.input}`;

  // what the mappings of the request read: the fields of the In
  const inVars = useMemo(() => fieldVariables(inType?.fields ?? [], 'In', spec.types, model), [inType, spec.types, model]);
  // what the Out mappings read: the body of the response, its headers, the In
  const outVars = useMemo((): VarNode[] => {
    const vars: VarNode[] = [];
    if (s.serviceOut) {
      vars.push(...fieldVariables([{ id: 'body', name: 'body', type: s.serviceOut.type, collection: s.serviceOut.collection, optional: s.serviceOut.optional, description: 'Body der Antwort (ServiceOut)' }], 'Antwort', spec.types, model));
    }
    vars.push({
      name: 'headers', type: 'context', label: 'Headers', source: 'Antwort', description: 'Header der Antwort (Namen klein)',
      children: (s.responseHeaders ?? []).map(h => ({ name: h, type: 'string' as const, label: 'String', source: 'Header', optional: true })),
    });
    return [...vars, ...inVars];
  }, [s.serviceOut, s.responseHeaders, spec.types, model, inVars]);

  const bodyType = s.serviceIn && !s.serviceIn.collection ? spec.types.find(t => t.id === s.serviceIn!.type && t.kind === 'case') : undefined;

  const fromBase = basePathParams(spec, s);
  /** the parameters of one kind — with their place in `params`, and a button for another one */
  const params = (where: ParamIn, none?: string) => {
    const rows = s.params.map((p, i) => [p, i] as const).filter(([p]) => p.in === where);
    const remove = (i: number) => onPatch({ params: s.params.filter((_, k) => k !== i) });
    return (
      <div className="space-y-1">
        {rows.map(([p, i]) => where === 'path' && fromBase.has(p.name) ? (
          <div key={i} className="flex items-center gap-1.5 opacity-60">
            <span className={`w-14 text-[9px] uppercase tracking-wider ${c.muted}`}>{PARAM_IN[p.in]}</span>
            <span className={`w-40 px-2 font-mono text-[11px] ${c.text}`}>{p.name}</span>
            <span className={`flex-1 text-[10px] ${c.muted}`}>aus dem <span className="font-mono">serviceBasePath</span> (Basispfad der Collection)</span>
            {canEdit && <button onClick={() => remove(i)} title="Parameter entfernen" className={`p-1 rounded ${c.muted} hover:text-rose-500`}><X size={11} /></button>}
          </div>
        ) : (
          <ParamRow key={i} param={p} spec={spec} vars={inVars} canEdit={canEdit} isDark={isDark}
            onChange={patch => setParam(i, patch)} onRemove={() => remove(i)} />
        ))}
        {!rows.length && none && <p className={`text-[10px] font-mono ${c.muted}`}>{none}</p>}
        {canEdit && (
          <button onClick={() => onPatch({ params: [...s.params, { name: '', in: where, type: 'String', expression: '', ...(where === 'path' ? { required: true } : {}) }] })}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}><Plus size={10} /> {PARAM_IN[where]}</button>
        )}
      </div>
    );
  };
  const setParam = (i: number, patch: Partial<RequestParam>) => onPatch({ params: s.params.map((p, k) => (k === i ? { ...p, ...patch } : p)) });

  return (
    <div className="p-4 space-y-4 max-w-5xl">
      {/* head */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Service Task</div>
          <input value={s.name} disabled={!canEdit} onChange={e => onPatch({ name: e.target.value.trim() })}
            className={`w-full bg-transparent outline-none text-sm font-semibold font-mono ${c.text}`} />
          <div className={`text-[10px] font-mono ${c.muted}`} title="Topic des Workers — auch die Kennung im Service-Katalog">{serviceTopic(apiOf(spec, s), s)}</div>
        </div>
        <label className={`flex items-center gap-1 text-[10px] ${c.muted}`} title={`API (Paket ${collectionPackage(apiOf(spec, s))}) und Version des Services`}>
          API
          <input value={s.api} disabled={!canEdit} onChange={e => onPatch({ api: e.target.value.trim() })}
            className={`w-28 font-mono ${input} ${API_NAME.test(s.api) ? '' : 'text-rose-500'}`} />
          v
          <input type="number" min={1} value={s.apiVersion} disabled={!canEdit} onChange={e => onPatch({ apiVersion: Math.max(1, Number(e.target.value) || 1) })}
            className={`w-14 font-mono ${input}`} />
        </label>
        <select value={s.status} disabled={!canEdit} onChange={e => onPatch({ status: e.target.value as Status })} className={input}>
          {STATUSES.map(x => <option key={x} value={x}>{STATUS_META[x].label}</option>)}
        </select>
        {canEdit && (
          <button title="Service entfernen" onClick={async () => { if (await confirm({ title: `Service «${s.name}» entfernen?` })) onRemove(); }}
            className={`p-1.5 rounded border ${c.btn}`}><Trash2 size={12} /></button>
        )}
      </div>
      {issues.length > 0 && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
          {issues.map((i, k) => <div key={k}>{i}</div>)}
        </div>
      )}
      <textarea value={s.description ?? ''} disabled={!canEdit} rows={2} placeholder="Was der Service tut (descr)"
        onChange={e => onPatch({ description: e.target.value || undefined })}
        className={`w-full resize-y ${input}`} />

      {/* the ServiceWorkerDsl in the order the worker runs: In → request → ServiceIn … ServiceOut → Out */}
      <Section title="In" hint="case class In — was der Prozess dem Service gibt; die Variablen dazu ergänzen" isDark={isDark}>
        {inType
          ? <StandaloneTypeEditor type={inType} spec={frame} isDark={isDark} canEdit={canEdit} model={model} fixed onTypes={onTypes} onOpenType={onOpenType} />
          : <p className={`text-[11px] ${c.muted}`}>kein In</p>}
      </Section>

      <Section title="apiUri(in)" hint="method und Pfad — die Pfad-Parameter aus dem In" isDark={isDark}>
        <div className="flex items-center gap-2">
          <select value={s.method} disabled={!canEdit} onChange={e => onPatch({ method: e.target.value as HttpMethod })} className={`${input} font-mono`}>
            {HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input value={s.path} disabled={!canEdit} onChange={e => onPatch({ path: e.target.value })} className={`flex-1 font-mono ${input}`} placeholder="/clients/{clientKey}" />
        </div>
        {inPathBase(spec, s.path) && (
          <p className={`text-[10px] ${c.muted}`} title="Übersicht der Collection → Basispfad">
            <span className="font-mono">{normalPathBase(spec.pathBase)}</span> setzt die Firma im <span className="font-mono">serviceBasePath</span> —
            der Worker hängt nur <span className={`font-mono ${c.text}`}>{workerPath(spec, s.path) || '/'}</span> an.
          </p>
        )}
        {params('path')}
      </Section>

      <Section title="querySegments(in)" hint="Query-Parameter aus dem In" isDark={isDark}>
        {params('query', 'keine — Seq.empty')}
      </Section>

      <Section title="inputHeaders(in)" hint="Header der Anfrage aus dem In" isDark={isDark}>
        {params('header', 'keine — Map.empty')}
      </Section>

      <Section title="inputMapper(in): ServiceIn" hint="der Body der Anfrage aus dem In" isDark={isDark}>
        <BodyPicker label="type ServiceIn" none="kein Body — NoInput" value={s.serviceIn} spec={spec} canEdit={canEdit} isDark={isDark}
          onChange={serviceIn => onPatch({ serviceIn })} onOpenType={onOpenType} />
        {bodyType && (
          <div className="space-y-1 pl-3">
            <div className={`text-[10px] ${c.muted}`}>Felder des ServiceIn — Wert aus dem In (FEEL); leer heisst: das gleichnamige Feld des In</div>
            {(bodyType.fields ?? []).filter(f => f.name).map(f => {
              const m = (s.bodyMappings ?? []).find(x => x.name === f.name);
              return (
                <MappingRow key={f.id} target={f} types={spec.types} value={m?.expression ?? ''} placeholder={`= ${f.name}`}
                  vars={inVars} canEdit={canEdit} isDark={isDark}
                  onChange={expression => onPatch({ bodyMappings: upsert(s.bodyMappings, f.name, expression) })} />
              );
            })}
          </div>
        )}
      </Section>

      <Section title="ServiceOut" hint="die Antwort der API — Body, Status und Header (ServiceResponse)" isDark={isDark}>
        <BodyPicker label="type ServiceOut" none="kein Body — NoOutput" value={s.serviceOut} spec={spec} canEdit={canEdit} isDark={isDark} allowOptional
          onChange={serviceOut => onPatch({ serviceOut })} onOpenType={onOpenType} />
        <div className="flex items-center gap-2 text-[11px]">
          <span className={c.muted}>Status</span>
          <input type="number" value={s.responseStatus ?? 200} disabled={!canEdit} onChange={e => onPatch({ responseStatus: Number(e.target.value) || undefined })}
            className={`w-20 font-mono ${input}`} />
          <span className={c.muted}>Header</span>
          <input value={(s.responseHeaders ?? []).join(', ')} disabled={!canEdit} placeholder="etag, location"
            onChange={e => onPatch({ responseHeaders: e.target.value.split(',').map(h => h.trim().toLowerCase()).filter(Boolean) })}
            className={`flex-1 font-mono ${input}`} />
        </div>
      </Section>

      <Section title="outputMapper(serviceOut, in): Out" hint="je Feld des Out, woher es kommt — FEEL auf body, headers und das In" isDark={isDark}>
        {outType && (outType.fields ?? []).some(f => f.name)
          ? (outType.fields ?? []).filter(f => f.name).map(f => {
              const m = (s.outMappings ?? []).find(x => x.name === f.name);
              return (
                <MappingRow key={f.id} target={f} types={spec.types} value={m?.expression ?? ''} placeholder="= body.…"
                  vars={outVars} canEdit={canEdit} isDark={isDark} required
                  onChange={expression => onPatch({ outMappings: upsert(s.outMappings, f.name, expression) })} />
              );
            })
          : <p className={`text-[10px] ${c.muted}`}>Das Out hat keine Felder — <span className="font-mono">NoOutput</span>, kein outputMapper.</p>}
      </Section>

      <Section title="Out" hint="case class Out — was der Prozess vom Service bekommt" isDark={isDark}>
        {outType
          ? <StandaloneTypeEditor type={outType} spec={frame} isDark={isDark} canEdit={canEdit} model={model} fixed onTypes={onTypes} onOpenType={onOpenType} />
          : <p className={`text-[11px] ${c.muted}`}>kein Out</p>}
      </Section>
    </div>
  );
}

/** set the expression of a mapping — empty removes it */
function upsert(list: Mapping[] | undefined, name: string, expression: string): Mapping[] | undefined {
  const rest = (list ?? []).filter(m => m.name !== name);
  const next = expression.trim() ? [...rest, { name, expression }] : rest;
  return next.length ? next : undefined;
}

function Section({ title, hint, isDark, children }: { title: string; hint: string; isDark: boolean; children: React.ReactNode }) {
  const c = cls(isDark);
  return (
    <div className={`rounded border ${c.border2}`}>
      <div className={`px-3 py-1.5 border-b ${c.border} flex items-baseline gap-2`}>
        <span className={`text-[11px] font-mono font-semibold whitespace-nowrap ${c.text}`}>{title}</span>
        <span className={`text-[10px] ${c.muted}`}>{hint}</span>
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

/** the choices for a type: the scalars and the own types of the API */
function TypeSelect({ value, spec, disabled, className, onChange }: {
  value: string; spec: ServiceCollectionSpec; disabled?: boolean; className: string; onChange: (v: string) => void;
}) {
  const { model } = useStore();
  const own = spec.types.filter(t => !t.interactionId);
  const known = (SCALA_TYPES as readonly string[]).includes(value) || own.some(t => t.id === value);
  // a type of the domain (`dom:<id>`, from the catalog): its name — the project has it already
  const dom = parseDomainRef(value);
  const label = dom ? `${model?.domainTypes?.find(t => t.id === dom)?.name ?? dom.split('.').pop()} (Domain)` : value;
  return (
    <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={className} title={dom ?? undefined}>
      {!known && <option value={value}>{label}</option>}
      <optgroup label="einfach">{SCALA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</optgroup>
      {own.length > 0 && <optgroup label="Typen der API">{own.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
    </select>
  );
}

function BodyPicker({ label, none, value, spec, canEdit, isDark, allowOptional, onChange, onOpenType }: {
  label: string; none: string; value: BodyRef | undefined; spec: ServiceCollectionSpec; canEdit: boolean; isDark: boolean;
  allowOptional?: boolean;
  onChange: (v: BodyRef | undefined) => void; onOpenType: (id: string) => void;
}) {
  const c = cls(isDark);
  const input = `text-[11px] px-2 py-1 rounded border outline-none ${c.input}`;
  const own = value ? spec.types.find(t => t.id === value.type) : undefined;
  return (
    <div className="flex items-center gap-2 text-[11px] flex-wrap">
      <span className={`w-28 ${c.muted}`}>{label}</span>
      <select value={value ? 'yes' : 'no'} disabled={!canEdit} className={input}
        onChange={e => onChange(e.target.value === 'yes' ? { type: spec.types.find(t => !t.interactionId)?.id ?? 'String' } : undefined)}>
        <option value="no">{none}</option>
        <option value="yes">mit Body</option>
      </select>
      {value && (
        <>
          <TypeSelect value={value.type} spec={spec} disabled={!canEdit} className={`font-mono ${input}`} onChange={type => onChange({ ...value, type })} />
          <label className={`flex items-center gap-1 ${c.muted2}`}>
            <input type="checkbox" checked={!!value.collection} disabled={!canEdit} onChange={e => onChange({ ...value, collection: e.target.checked || undefined })} /> Liste
          </label>
          {allowOptional && (
            <label className={`flex items-center gap-1 ${c.muted2}`} title="Die API antwortet auch ohne Body (z. B. ein POST mit 201 und nur Location)">
              <input type="checkbox" checked={!!value.optional} disabled={!canEdit} onChange={e => onChange({ ...value, optional: e.target.checked || undefined })} /> optional
            </label>
          )}
          {own && <button onClick={() => onOpenType(own.id)} className={`text-[10px] hover:underline ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>{own.name} öffnen →</button>}
        </>
      )}
    </div>
  );
}

function ParamRow({ param: p, spec, vars, canEdit, isDark, onChange, onRemove }: {
  param: RequestParam; spec: ServiceCollectionSpec; vars: VarNode[]; canEdit: boolean; isDark: boolean;
  onChange: (patch: Partial<RequestParam>) => void; onRemove: () => void;
}) {
  const { model } = useStore();
  const c = cls(isDark);
  const input = `text-[11px] px-2 py-1 rounded border outline-none ${c.input}`;
  const target: Field = { id: 'p', name: p.name, type: p.type, collection: p.collection, optional: !p.required };
  const check = isFeel(p.expression) ? checkFeel(p.expression, vars, expectedFor(target, spec.types, model)) : null;
  const err = check?.issues.find(i => i.level === 'error') ?? check?.issues[0];
  return (
    <div className={`flex items-start gap-1.5 ${p.disabled ? 'opacity-50' : ''}`}>
      <span className={`w-14 mt-1 text-[9px] uppercase tracking-wider ${c.muted}`}>{PARAM_IN[p.in]}</span>
      <input value={p.name} disabled={!canEdit} onChange={e => onChange({ name: e.target.value.trim() })} title={p.description}
        className={`w-40 font-mono ${input}`} placeholder="name" />
      <TypeSelect value={p.type} spec={spec} disabled={!canEdit} className={`w-32 font-mono ${input}`} onChange={type => onChange({ type })} />
      <label className={`mt-1 flex items-center gap-1 text-[10px] ${c.muted2}`} title="Pflicht — sonst Option im In">
        <input type="checkbox" checked={!!p.required} disabled={!canEdit || p.in === 'path'} onChange={e => onChange({ required: e.target.checked || undefined })} /> Pflicht
      </label>
      <div className="flex-1 min-w-0">
        <FeelInput value={p.expression} onChange={expression => onChange({ expression })} variables={vars} isDark={isDark} disabled={!canEdit || p.disabled}
          placeholder="= feldImIn" size="md" />
        {err && <div className={`text-[10px] ${err.level === 'error' ? 'text-rose-500' : (isDark ? 'text-amber-300' : 'text-amber-700')}`}>{err.text}</div>}
      </div>
      {!p.required && canEdit && (
        <button onClick={() => onChange({ disabled: p.disabled ? undefined : true })} title={p.disabled ? 'wieder senden' : 'nicht senden'}
          className={`mt-0.5 text-[10px] px-1.5 py-1 rounded border ${c.btn}`}>{p.disabled ? 'aus' : 'an'}</button>
      )}
      {canEdit && <button onClick={onRemove} title="Parameter entfernen" className={`mt-0.5 p-1 rounded ${c.muted} hover:text-rose-500`}><X size={11} /></button>}
    </div>
  );
}

function MappingRow({ target, types, value, placeholder, vars, canEdit, isDark, required, onChange }: {
  target: Field; types: TypeDef[]; value: string; placeholder: string; vars: VarNode[]; canEdit: boolean; isDark: boolean;
  /** the field needs a value (an Out field) — empty is a finding */
  required?: boolean;
  onChange: (v: string) => void;
}) {
  const { model } = useStore();
  const c = cls(isDark);
  const check = value.trim() && isFeel(value) ? checkFeel(value, vars, expectedFor(target, types, model)) : null;
  const err = check?.issues.find(i => i.level === 'error') ?? check?.issues[0];
  const missing = required && !value.trim() && !target.optional;
  return (
    <div className="flex items-start gap-2">
      <span className={`w-40 mt-1 text-[11px] font-mono truncate ${c.text}`} title={target.description}>{target.name}</span>
      <div className="flex-1 min-w-0">
        <FeelInput value={value} onChange={onChange} variables={vars} isDark={isDark} disabled={!canEdit} placeholder={placeholder} size="md" />
        {err && <div className={`text-[10px] ${err.level === 'error' ? 'text-rose-500' : (isDark ? 'text-amber-300' : 'text-amber-700')}`}>{err.text}</div>}
        {missing && <div className={`text-[10px] ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>Pflichtfeld ohne Wert — der Worker kann das Out nicht bauen.</div>}
      </div>
    </div>
  );
}
