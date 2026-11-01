// A service orchestration: the flow as BPMN (the modeler of the processes), next to it
// what the selected element does — the service a service task calls and how its `In`
// is filled, the assignments of a script task, the conditions of an exclusive gateway.
// Without a selection: name, description, `In`, `Out`, how the `Out` is filled, and
// what is missing. Saved like a collection (autosave, version check).
import { AlertTriangle, ArrowLeft, FileCode2, Loader2, Plus, Workflow, X } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePermissions } from '../auth';
import FeelInput from '../components/FeelInput';
import type { BpmnHandle } from '../components/BpmnEditor';
import { StandaloneTypeEditor } from '../components/TypeBuilder';
import { fieldVariables } from '../feel';
import { useStore } from '../store';
import { STATUSES, STATUS_META, type Mapping, type Status, type Step, type TypeDef } from '../types';
import { cls } from '../ui';
import { nowIsoWithTimezone } from '../util';
import { collectionPackage, processFrame } from './collection';
import { MappingRow, NothingChoice, SaveBadge } from './CollectionView';
import { ScalaExport } from './CollectionExport';
import { helperCommandOf } from '../exporters';
import {
  allTypes, elseBranch, flatSteps, flowOf, orchestrationApi, orchestrationIssues, orchestrationTopic,
  resultName, serviceMembers, servicesByTopic, varFields, varsAt, type ServiceRef,
} from './orchestration';
import { orchestrationBundle, orchestrationTodos } from './scalaOrchestration';
import { useServices } from './store';
import { isCollection, isOrchestration, type OrchTask, type ServiceOrchestrationSpec, type ServiceSpec } from './types';

const BpmnEditor = lazy(() => import('../components/BpmnEditor'));

/** `./helper.scala processFromSpec orchspec:…` — format v2, written like a collection. */
export const orchestrationHelperCommand = (o: ServiceOrchestrationSpec, all: ServiceSpec[]): string =>
  helperCommandOf(JSON.stringify({ v: 2, kind: 'serviceOrchestration', scala: orchestrationBundle(o, all) }));

/** A mapping list with one expression changed — an empty one removes it. */
function upsert(list: Mapping[] | undefined, name: string, expression: string): Mapping[] | undefined {
  const rest = (list ?? []).filter(m => m.name !== name);
  const next = expression.trim() ? [...rest, { name, expression }] : rest;
  return next.length ? next : undefined;
}

export default function OrchestrationView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { isDark, model } = useStore();
  const { loadService, saveService, services } = useServices();
  const { canEdit } = usePermissions();
  const c = cls(isDark);
  const [spec, setSpec] = useState<ServiceOrchestrationSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'conflict' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const version = useRef<string | null>(null);
  const latest = useRef<ServiceOrchestrationSpec | null>(null);
  const bpmn = useRef<BpmnHandle | null>(null);

  useEffect(() => {
    let gone = false;
    loadService(slug)
      .then(r => {
        if (gone) return;
        if (!r) { setError(`services/${slug}.json gibt es nicht (mehr).`); return; }
        if (!isOrchestration(r.data)) { setError(`services/${slug}.json ist keine Orchestrierung.`); return; }
        version.current = r.version;
        latest.current = r.data;
        setSpec(r.data);
      })
      .catch(e => { if (!gone) setError(e instanceof Error ? e.message : String(e)); });
    return () => { gone = true; };
  }, [slug, loadService]);

  const update = useCallback((fn: (s: ServiceOrchestrationSpec) => ServiceOrchestrationSpec) => {
    if (!latest.current) return;
    const next = fn(latest.current);
    latest.current = next;
    setSpec(next);
    setSaveState('dirty');
  }, []);

  // autosave — as for a collection: one write at a time, what changes meanwhile goes with the next
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

  const all = useMemo(() => services.map(s => s.data), [services]);
  const collections = useMemo(() => all.filter(isCollection), [all]);
  const refs = useMemo(() => servicesByTopic(collections), [collections]);
  const bpmnXml = spec?.bpmn ?? '';
  const flow = useMemo(() => flowOf({ bpmn: bpmnXml }), [bpmnXml]);

  if (error) return <div className="p-6 text-xs text-rose-500 flex items-center gap-2"><AlertTriangle size={12} /> {error}</div>;
  if (!spec) return <div className={`p-6 text-xs ${c.muted} flex items-center gap-2`}><Loader2 size={12} className="animate-spin" /> Lade Orchestrierung …</div>;

  const types = allTypes(spec, collections);
  const step = selected ? flatSteps(flow.steps).find(s => s.id === selected) : undefined;
  const issues = orchestrationIssues(spec, refs);
  const patchTask = (id: string, patch: Partial<OrchTask>) =>
    update(o => ({ ...o, tasks: { ...o.tasks, [id]: { ...(o.tasks[id] ?? {}), ...patch } } }));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* head */}
      <div className={`flex items-center gap-3 px-3 py-2 border-b ${c.border}`}>
        <button onClick={onBack} title="Zurück zu den Services" className={`p-1 rounded ${c.muted} ${c.hover}`}><ArrowLeft size={14} /></button>
        <Workflow size={14} className={isDark ? 'text-violet-300' : 'text-violet-700'} />
        <div className="min-w-[10rem] flex-1">
          <input value={spec.title} disabled={!canEdit} onChange={e => update(o => ({ ...o, title: e.target.value }))}
            className={`w-full bg-transparent outline-none text-sm font-semibold ${c.text}`} />
          <div className={`text-[10px] font-mono truncate ${c.muted}`} title="Topic des CustomWorkers">{orchestrationTopic(spec)}</div>
        </div>
        <SaveBadge state={saveState} message={saveError} isDark={isDark} />
        <select value={spec.status} disabled={!canEdit} onChange={e => update(o => ({ ...o, status: e.target.value as Status }))}
          className={`text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
          {STATUSES.map(x => <option key={x} value={x}>{STATUS_META[x].label}</option>)}
        </select>
        <button onClick={() => setExportOpen(true)} title="Scala-Code des CustomTasks und seines Workers, und der Befehl für den Helper"
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-transparent ${c.btnPrimary}`}>
          <FileCode2 size={12} /> Export
        </button>
      </div>
      {saveState === 'conflict' && (
        <div className={`px-3 py-1.5 text-[11px] border-b ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
          Die Orchestrierung wurde inzwischen anderswo geändert — deine Änderungen sind NICHT gespeichert. Seite neu laden, um die andere Fassung zu sehen.
        </div>
      )}
      {exportOpen && (
        <ScalaExport title={spec.title} isDark={isDark} onClose={() => setExportOpen(false)}
          text={orchestrationBundle(spec, all, model)} todos={orchestrationTodos(spec, all, model)} fileName={`${spec.slug}.scala`}
          command={() => orchestrationHelperCommand(spec, all)}
          description={<>
            Ein CustomTask in <span className="font-mono">01-domain</span> und sein CustomWorker in <span className="font-mono">03-worker</span>,
            im Paket <span className="font-mono">{collectionPackage(orchestrationApi(spec))}</span>. Der Worker ruft die Services in
            <span className="font-mono"> runWorkZIO</span> auf. Der Helper legt an, was fehlt, vergleicht Bestehendes (überschreibt nie)
            und registriert den Worker in der WorkerApp und den Task in der API-Doku.
          </>} />
      )}

      <div className="flex flex-1 min-h-0">
        {/* the flow */}
        <div className="flex-1 min-w-0 relative">
          <Suspense fallback={<div className={`p-6 text-xs ${c.muted}`}>Lade Modeler …</div>}>
            <BpmnEditor xml={spec.bpmn} isDark={isDark} canEdit={canEdit}
              onChange={xml => update(o => ({ ...o, bpmn: xml }))}
              onSelect={id => setSelected(id)}
              onReady={h => { bpmn.current = h; }}
              onError={m => { setSaveState('error'); setSaveError(m); }} />
          </Suspense>
        </div>

        {/* what the selected element does — or the orchestration as a whole */}
        <div className={`w-[30rem] flex-shrink-0 border-l ${c.border} overflow-y-auto p-3 space-y-3`}>
          {step && step.kind !== 'start' && step.kind !== 'end' ? (
            <>
              <div className="flex items-center gap-2">
                <button onClick={() => { setSelected(null); bpmn.current?.select(null); }} className={`text-[10px] hover:underline ${c.muted}`}>← Übersicht</button>
                <span className={`text-[10px] uppercase tracking-widest ${c.muted}`}>{KIND_LABEL[step.kind === 'gateway' ? `gateway-${step.gatewayType}` : step.kind] ?? step.kind}</span>
              </div>
              <div className={`text-sm font-semibold ${c.text}`}>{step.name || step.id}</div>
              {step.kind === 'service' && (
                <ServiceTaskPanel step={step} spec={spec} refs={refs} types={types} steps={flow.steps} canEdit={canEdit} isDark={isDark}
                  onPatch={patch => patchTask(step.id, patch)} />
              )}
              {step.kind === 'script' && (
                <ScriptTaskPanel step={step} spec={spec} refs={refs} types={types} steps={flow.steps} canEdit={canEdit} isDark={isDark}
                  onPatch={patch => patchTask(step.id, patch)} />
              )}
              {step.kind === 'gateway' && step.gatewayType === 'exclusive' && (
                <ExclusivePanel step={step} spec={spec} refs={refs} types={types} steps={flow.steps} canEdit={canEdit} isDark={isDark}
                  onCondition={(id, value) => update(o => {
                    const next = { ...(o.conditions ?? {}) };
                    if (value.trim()) next[id] = value; else delete next[id];
                    return { ...o, conditions: Object.keys(next).length ? next : undefined };
                  })} />
              )}
              {step.kind === 'gateway' && step.gatewayType === 'parallel' && (
                <p className={`text-[11px] ${c.muted}`}>
                  Die Zweige laufen gleichzeitig (<span className="font-mono">fork</span> / <span className="font-mono">join</span>); danach
                  sind die Ergebnisse aller Zweige bekannt.
                </p>
              )}
              {!['service', 'script', 'gateway'].includes(step.kind) && (
                <p className="text-[11px] text-rose-500">Eine Orchestrierung kennt nur Service- und Script-Tasks und parallele oder exklusive Gateways.</p>
              )}
            </>
          ) : (
            <Overview spec={spec} refs={refs} types={types} collections={collections} steps={flow.steps} issues={issues} flowError={flow.error}
              canEdit={canEdit} isDark={isDark} update={update}
              onSelect={id => { setSelected(id); bpmn.current?.select(id); }} />
          )}
        </div>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  service: 'Service-Task', script: 'Script-Task', 'gateway-exclusive': 'Exklusives Gateway', 'gateway-parallel': 'Paralleles Gateway',
};

interface PanelProps {
  step: Step;
  spec: ServiceOrchestrationSpec;
  refs: Map<string, ServiceRef>;
  types: TypeDef[];
  steps: Step[];
  canEdit: boolean;
  isDark: boolean;
}

/** The variables known before the step — as the FEEL editor shows them. */
function useVarsAt(props: Pick<PanelProps, 'spec' | 'steps' | 'refs' | 'types'>, stepId?: string) {
  const { model } = useStore();
  const { spec, steps, refs, types } = props;
  return useMemo(() => fieldVariables(varFields(varsAt(spec, steps, refs, stepId)), 'Orchestrierung', types, model),
    [spec, steps, refs, types, model, stepId]);
}

function ServiceTaskPanel({ step, spec, refs, types, steps, canEdit, isDark, onPatch }: PanelProps & { onPatch: (patch: Partial<OrchTask>) => void }) {
  const c = cls(isDark);
  const task = spec.tasks[step.id];
  const ref = task?.service ? refs.get(task.service) : undefined;
  const vars = useVarsAt({ spec, steps, refs, types }, step.id);
  const { in: inType, out: outType } = ref ? serviceMembers(ref) : { in: undefined, out: undefined };
  const input = `text-[11px] px-2 py-1 rounded border outline-none ${c.input}`;
  // the services by collection and API
  const groups = useMemo(() => {
    const out = new Map<string, ServiceRef[]>();
    for (const r of refs.values()) {
      const key = `${r.collection.title || r.collection.slug} · ${r.service.api} v${r.service.apiVersion}`;
      out.set(key, [...(out.get(key) ?? []), r]);
    }
    return [...out.entries()];
  }, [refs]);
  return (
    <div className="space-y-3">
      <label className="block space-y-0.5">
        <span className={`text-[10px] ${c.muted}`}>Service — aus den Collections</span>
        <select value={task?.service ?? ''} disabled={!canEdit} className={`w-full font-mono ${input}`}
          onChange={e => onPatch({ service: e.target.value || undefined, inputs: undefined })}>
          <option value="">— Service wählen —</option>
          {task?.service && !ref && <option value={task.service}>{task.service} (in keiner Collection)</option>}
          {groups.map(([label, list]) => (
            <optgroup key={label} label={label}>
              {list.map(r => <option key={r.topic} value={r.topic}>{r.service.name} — {r.service.method} {r.service.path}</option>)}
            </optgroup>
          ))}
        </select>
        {!refs.size && <span className={`text-[10px] ${c.muted}`}>Noch keine Collection — zuerst die Services importieren.</span>}
      </label>
      {ref && (
        <>
          {ref.service.description && <p className={`text-[10px] ${c.muted}`}>{ref.service.description.split('\n')[0]}</p>}
          <div className="space-y-1">
            <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>
              <span className="font-mono normal-case tracking-normal">{ref.service.name}.In</span> — woher jedes Feld kommt
            </div>
            {ref.service.noIn ? <p className={`text-[10px] ${c.muted}`}>NoInput — der Service braucht nichts.</p>
              : inType?.kind === 'enum' ? <p className={`text-[10px] ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>Das In ist ein ADT — den Fall wählt der Code (TODO im Export).</p>
                : (inType?.fields ?? []).filter(f => f.name).map(f => {
                  const m = (task?.inputs ?? []).find(x => x.name === f.name);
                  const same = vars.some(v => v.name === f.name);
                  return (
                    <MappingRow key={f.id} target={f} types={types} value={m?.expression ?? ''} placeholder={same ? `= ${f.name}` : '= …'}
                      vars={vars} canEdit={canEdit} isDark={isDark} required={!f.optional && !same}
                      missingText={`Pflichtfeld ohne Wert — ${ref.service.name} braucht es (im Export ein TODO).`}
                      onChange={expression => onPatch({ inputs: upsert(task?.inputs, f.name, expression) })} />
                  );
                })}
          </div>
          <label className="flex items-center gap-2">
            <span className={`text-[10px] ${c.muted}`}>Ergebnis heisst</span>
            <input value={task?.result ?? ''} disabled={!canEdit || !!ref.service.noOut} placeholder={resultName(undefined, ref)}
              onChange={e => onPatch({ result: e.target.value.trim() || undefined })} className={`w-40 font-mono ${input}`} />
            <span className={`text-[10px] font-mono truncate ${c.muted}`}>
              {ref.service.noOut ? 'NoOutput' : (outType?.fields ?? []).map(f => f.name).join(', ')}
            </span>
          </label>
        </>
      )}
    </div>
  );
}

function ScriptTaskPanel({ step, spec, refs, types, steps, canEdit, isDark, onPatch }: PanelProps & { onPatch: (patch: Partial<OrchTask>) => void }) {
  const c = cls(isDark);
  const task = spec.tasks[step.id];
  const vars = useVarsAt({ spec, steps, refs, types }, step.id);
  const list = task?.assignments ?? [];
  const set = (i: number, patch: Partial<Mapping>) => onPatch({ assignments: list.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  const input = `text-[11px] px-2 py-1 rounded border outline-none ${c.input}`;
  return (
    <div className="space-y-2">
      <p className={`text-[10px] ${c.muted}`}>Zuweisungen in FEEL — danach unter ihrem Namen bekannt.</p>
      {list.map((a, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <input value={a.name} disabled={!canEdit} onChange={e => set(i, { name: e.target.value.trim() })} placeholder="name"
            className={`w-32 font-mono ${input}`} />
          <span className={`mt-1 text-[11px] ${c.muted}`}>=</span>
          <div className="flex-1 min-w-0">
            <FeelInput value={a.expression} onChange={expression => set(i, { expression })} variables={vars} isDark={isDark} disabled={!canEdit} placeholder="= …" size="md" />
          </div>
          {canEdit && <button onClick={() => onPatch({ assignments: list.filter((_, k) => k !== i) })} className={`mt-0.5 p-1 rounded ${c.muted} hover:text-rose-500`}><X size={11} /></button>}
        </div>
      ))}
      {canEdit && (
        <button onClick={() => onPatch({ assignments: [...list, { name: '', expression: '' }] })}
          className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}><Plus size={10} /> Zuweisung</button>
      )}
    </div>
  );
}

function ExclusivePanel({ step, spec, refs, types, steps, canEdit, isDark, onCondition }: PanelProps & { onCondition: (branchId: string, value: string) => void }) {
  const c = cls(isDark);
  const vars = useVarsAt({ spec, steps, refs, types }, step.id);
  const fallback = elseBranch(spec, step);
  return (
    <div className="space-y-2">
      <p className={`text-[10px] ${c.muted}`}>
        Je Zweig eine Bedingung in FEEL (<span className="font-mono">= client.segment = 3</span>). Der Standardfluss — oder der eine
        Zweig ohne Bedingung — ist das <span className="font-mono">else</span>. Was ein Zweig liefert, ist danach optional.
      </p>
      {(step.branches ?? []).map(b => (
        <div key={b.id} className="space-y-0.5">
          <div className={`text-[11px] ${c.text}`}>→ {b.label || b.id}{b === fallback && <span className={`ml-1.5 text-[10px] ${c.muted}`}>else</span>}</div>
          {b !== fallback && (
            <FeelInput value={spec.conditions?.[b.id] ?? b.condition ?? ''} onChange={v => onCondition(b.id, v)} variables={vars} isDark={isDark}
              disabled={!canEdit} placeholder="= …" size="md" />
          )}
        </div>
      ))}
      {!(step.branches ?? []).length && <p className={`text-[10px] ${c.muted}`}>Noch keine Zweige.</p>}
    </div>
  );
}

function Overview({ spec, refs, types, collections, steps, issues, flowError, canEdit, isDark, update, onSelect }: {
  spec: ServiceOrchestrationSpec; refs: Map<string, ServiceRef>; types: TypeDef[]; collections: ServiceSpec[]; steps: Step[];
  issues: string[]; flowError?: string; canEdit: boolean; isDark: boolean;
  update: (fn: (s: ServiceOrchestrationSpec) => ServiceOrchestrationSpec) => void;
  onSelect: (id: string) => void;
}) {
  const { model } = useStore();
  const c = cls(isDark);
  const input = `w-full text-[11px] px-2 py-1 rounded border outline-none ${c.input}`;
  const own = new Set(spec.types.map(t => t.id));
  // the class builder sees the types of the collections too — what it changes there is not taken over
  const frame = processFrame(spec, collectionPackage(orchestrationApi(spec)), types);
  const onTypes = (next: TypeDef[]) => update(o => ({ ...o, types: next.filter(t => own.has(t.id) || !types.some(x => x.id === t.id)) }));
  const inType = spec.types.find(t => t.id === spec.inTypeId);
  const outType = spec.types.find(t => t.id === spec.outTypeId);
  const endVars = useMemo(() => fieldVariables(varFields(varsAt(spec, steps, refs)), 'Orchestrierung', types, model), [spec, steps, refs, types, model]);
  const tasks = flatSteps(steps).filter(s => s.kind === 'service' || s.kind === 'script');
  return (
    <div className="space-y-3">
      <label className="block space-y-0.5">
        <span className={`text-[10px] ${c.muted}`}>Name — das Objekt des CustomTasks, letzter Teil des Topics</span>
        <input className={`${input} font-mono`} disabled={!canEdit} value={spec.name} onChange={e => update(o => ({ ...o, name: e.target.value.trim() }))} />
      </label>
      <label className="block space-y-0.5">
        <span className={`text-[10px] ${c.muted}`}>Beschreibung (descr)</span>
        <textarea className={`${input} resize-y`} rows={3} disabled={!canEdit} value={spec.description ?? ''}
          onChange={e => update(o => ({ ...o, description: e.target.value || undefined }))} placeholder="Was die Orchestrierung tut" />
      </label>

      {(flowError || issues.length > 0) && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
          {issues.map((i, k) => <div key={k}>{i}</div>)}
        </div>
      )}

      <div className="space-y-1">
        <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Schritte</div>
        {tasks.map(s => {
          const task = spec.tasks[s.id];
          const ref = task?.service ? refs.get(task.service) : undefined;
          return (
            <button key={s.id} onClick={() => onSelect(s.id)} className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left ${c.hover}`}>
              <span className={`w-20 text-[9px] uppercase tracking-wider ${c.muted}`}>{s.kind === 'service' ? 'Service' : 'Script'}</span>
              <span className={`flex-1 truncate text-[11px] ${c.text}`}>{s.name || s.id}</span>
              <span className={`truncate text-[10px] font-mono ${ref || s.kind === 'script' ? c.muted : 'text-amber-600'}`}>
                {s.kind === 'service' ? (ref ? `${ref.service.name} → ${resultName(task, ref)}` : 'kein Service') : (task?.assignments ?? []).map(a => a.name).join(', ')}
              </span>
            </button>
          );
        })}
        {!tasks.length && <p className={`text-[10px] ${c.muted}`}>Im Diagramm Service- und Script-Tasks anlegen.</p>}
      </div>

      <div className="space-y-1">
        <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>In — was der Worker bekommt</div>
        <NothingChoice nothing={!!spec.noIn} cls="case class In" none="type In = NoInput" noneHint="braucht nichts"
          canEdit={canEdit} isDark={isDark} onChange={noIn => update(o => ({ ...o, noIn: noIn || undefined }))} />
        {!spec.noIn && inType && <StandaloneTypeEditor type={inType} spec={frame} isDark={isDark} canEdit={canEdit} model={model} fixed onTypes={onTypes} onOpenType={() => {}} />}
      </div>

      <div className="space-y-1">
        <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Out — was der Worker zurückgibt</div>
        <NothingChoice nothing={!!spec.noOut} cls="case class Out" none="type Out = NoOutput" noneHint="gibt nichts zurück"
          canEdit={canEdit} isDark={isDark} onChange={noOut => update(o => ({ ...o, noOut: noOut || undefined }))} />
        {!spec.noOut && outType && (
          <>
            <StandaloneTypeEditor type={outType} spec={frame} isDark={isDark} canEdit={canEdit} model={model} fixed onTypes={onTypes} onOpenType={() => {}} />
            <div className={`text-[10px] ${c.muted}`}>Je Feld des Out, woher es kommt — FEEL auf das In und die Ergebnisse</div>
            {(outType.fields ?? []).filter(f => f.name).map(f => {
              const m = (spec.outMappings ?? []).find(x => x.name === f.name);
              const same = endVars.some(v => v.name === f.name);
              return (
                <MappingRow key={f.id} target={f} types={types} value={m?.expression ?? ''} placeholder={same ? `= ${f.name}` : '= …'}
                  vars={endVars} canEdit={canEdit} isDark={isDark} required={!same}
                  onChange={expression => update(o => ({ ...o, outMappings: upsert(o.outMappings, f.name, expression) }))} />
              );
            })}
          </>
        )}
      </div>
      <p className={`text-[10px] ${c.muted}`}>{collections.length} Collection{collections.length === 1 ? '' : 's'} mit {refs.size} Services zur Auswahl.</p>
    </div>
  );
}
