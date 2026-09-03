// Detailspalte: alles zu einem Schritt — fachlich oben, technisch darunter.
//
// Hier hängt auch die **Service-Auswahl mit vorbereitetem Mapping**: ein
// Klick auf einen Katalog-Eintrag setzt Topic und übernimmt die Ein-/Ausgaben
// des element-templates als Vorlage; bereits gepflegte Bedeutungen bleiben.
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ExternalLink, GitFork, Plus, Repeat, Search, Trash2, Workflow, X, Zap } from 'lucide-react';
import { marked } from 'marked';
import type { Interaction, Mapping, Model, ProcessSpec, ServiceDef, Status, Step, TypeDef } from '../types';
import { INTERACTION_META, STATUSES, STATUS_META } from '../types';
import { catalogEntry, createMemberType, interactionKind, suggestName } from '../interactions';
import { KIND_LABEL, cls } from '../ui';
import { allSteps } from '../bpmn';
import Comments from './Comments';
import { canComment, orphanThreads, processTarget, stepTarget, targetLabel, threadsFor } from '../comments';
import { splitPrefix } from '../stepIds';
import { uid } from '../util';

interface Props {
  /** Name für neue Kommentare */
  author: string;
  /** Kommentar-Faden, auf dem die Navigation steht */
  highlight?: string;
  step: Step | null;
  spec: ProcessSpec;
  isDark: boolean;
  canEdit: boolean;
  model: Model | null;
  onPatch: (id: string, patch: Partial<Step>) => void;
  /** nach dem Umbenennen die ID nach Konvention nachziehen (beim Verlassen des Felds) */
  onSyncId?: (id: string) => void;
  onClose: () => void;
  onGoto: (id: string) => void;
  onSpecChange: (spec: ProcessSpec) => void;
  /** in den Klassenbauer springen und dort diesen Typ zeigen */
  onEditType: (typeId: string) => void;
  /** alle bekannten `company-projekt`-Prefixe (Katalog + Spezifikationen) */
  projectPrefixes?: string[];
  /** Firma/Projekt wechseln — zieht alle `{company}-{project}-*`-IDs nach */
  onRenameProject?: (newPrefix: string) => void;
}

// Breite, Rand und Hintergrund kommen von der rechten Spalte — hier nur Inhalt.
export default function StepDetail(p: Props) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {p.step ? <StepPanel {...p} step={p.step} /> : <SpecPanel {...p} />}
    </div>
  );
}

// ── Prozess-Ebene (kein Schritt gewählt) ─────────────────────────────────────
function SpecPanel({ spec, author, highlight, isDark, canEdit, onSpecChange, projectPrefixes, onRenameProject }: Props) {
  const c = cls(isDark);
  // Fäden, deren Schritt oder Typ es nicht mehr gibt — sie hätten sonst
  // keinen Ort mehr und blieben für immer offen.
  const verwaist = useMemo(
    () => orphanThreads(spec,
      new Set(allSteps(spec.steps).map(s => s.id)),
      new Set((spec.types ?? []).map(t => t.id))),
    [spec]);
  return (
    <div className="p-4 space-y-4">
      <h2 className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Prozess</h2>
      {onRenameProject && (
        <ProjectPicker spec={spec} isDark={isDark} canEdit={canEdit}
          prefixes={projectPrefixes ?? []} onRename={onRenameProject} />
      )}
      <Field label="Ausgangslage / Ziel (Markdown)" isDark={isDark}>
        <textarea value={spec.description ?? ''} disabled={!canEdit}
          onChange={e => onSpecChange({ ...spec, description: e.target.value })}
          rows={6} placeholder="Worum geht es fachlich?"
          className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />
      </Field>
      <Field label="Time to Live (Tage)" isDark={isDark}>
        <input value={spec.timeToLive ?? ''} disabled={!canEdit}
          onChange={e => onSpecChange({ ...spec, timeToLive: e.target.value || undefined })}
          placeholder="z. B. 60 — wie lange die Historie aufbewahrt wird"
          className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
      </Field>
      <Field label="Quelle (z. B. Confluence-Seite)" isDark={isDark}>
        <input value={spec.sourceUrl ?? ''} disabled={!canEdit}
          onChange={e => onSpecChange({ ...spec, sourceUrl: e.target.value })}
          placeholder="https://confluence…"
          className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
      </Field>
      <div>
        <h3 className={`text-[10px] uppercase tracking-widest mb-2 ${c.muted}`}>Prozessvariablen</h3>
        <VariableList spec={spec} isDark={isDark} canEdit={canEdit} onChange={onSpecChange} />
      </div>
      <Comments spec={spec} target={processTarget} author={author} isDark={isDark}
        canEdit={canEdit} onChange={onSpecChange} title="Kommentare zum Prozess" highlight={highlight} />
      {!!verwaist.length && (
        <Comments spec={spec} target="" author={author} isDark={isDark}
          canEdit={canEdit} onChange={onSpecChange} threads={verwaist}
          title={`Kommentare ohne Element (${verwaist.length})`} highlight={highlight} />
      )}
      <p className={`text-[10px] leading-relaxed ${c.muted}`}>
        Einen Schritt im Ablauf anklicken, um ihn zu beschreiben, den Service zu wählen
        oder den Status zu setzen.
      </p>
    </div>
  );
}

// Firma und Projekt des Prozesses — die Auswahl kommt aus dem Katalog
// (model.projects) und den vorhandenen Spezifikationen. Ein Wechsel zieht
// alle `{company}-{project}-*`-IDs nach, in der Spezifikation wie im BPMN.
function ProjectPicker({ spec, isDark, canEdit, prefixes, onRename }: {
  spec: ProcessSpec; isDark: boolean; canEdit: boolean;
  prefixes: string[]; onRename: (newPrefix: string) => void;
}) {
  const c = cls(isDark);
  const aktuell = spec.project ?? '';
  const { company: firma, project: projekt } = splitPrefix(aktuell);
  if (!firma || !projekt) return null;
  const companies = [...new Set([firma, ...prefixes.map(p => splitPrefix(p).company)])].filter(Boolean);
  const projekte = [...new Set([projekt, ...prefixes
    .filter(p => splitPrefix(p).company === firma)
    .map(p => splitPrefix(p).project)])].filter(Boolean);
  return (
    <Field label="Firma und Projekt" isDark={isDark}>
      <div className="flex gap-1.5">
        <select value={firma} disabled={!canEdit}
          onChange={e => onRename(`${e.target.value}-${projekt}`)}
          className={`w-28 text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`}>
          {companies.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={projekt} disabled={!canEdit}
          onChange={e => onRename(`${firma}-${e.target.value}`)}
          className={`flex-1 min-w-0 text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`}>
          {projekte.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <p className={`text-[10px] mt-1 ${c.muted}`}>
        Ein Wechsel benennt alle IDs «{aktuell}-…» um — Prozess-ID, Topics, Entscheidungen, Nachrichten.
      </p>
    </Field>
  );
}

function VariableList({ spec, isDark, canEdit, onChange }: { spec: ProcessSpec; isDark: boolean; canEdit: boolean; onChange: (s: ProcessSpec) => void }) {
  const c = cls(isDark);
  const vars = spec.variables ?? [];
  const set = (i: number, patch: Partial<(typeof vars)[number]>) =>
    onChange({ ...spec, variables: vars.map((v, k) => (k === i ? { ...v, ...patch } : v)) });
  return (
    <div className="space-y-1">
      {vars.map((v, i) => (
        <div key={i} className="flex gap-1">
          <input value={v.name} disabled={!canEdit} onChange={e => set(i, { name: e.target.value })}
            className={`w-28 text-[10px] px-1.5 py-1 rounded border outline-none font-mono ${c.input}`} />
          <input value={v.description ?? ''} disabled={!canEdit} onChange={e => set(i, { description: e.target.value })}
            placeholder="Bedeutung"
            className={`flex-1 text-[10px] px-1.5 py-1 rounded border outline-none ${c.input}`} />
          {canEdit && (
            <button onClick={() => onChange({ ...spec, variables: vars.filter((_, k) => k !== i) })}
              className={`p-1 ${c.muted}`}><X size={10} /></button>
          )}
        </div>
      ))}
      {canEdit && (
        <button onClick={() => onChange({ ...spec, variables: [...vars, { name: '', description: '' }] })}
          className={`text-[10px] ${c.muted} hover:underline`}>+ Variable</button>
      )}
    </div>
  );
}

// ── Schritt-Ebene ────────────────────────────────────────────────────────────
function StepPanel({ step, spec, author, highlight, isDark, canEdit, model, onPatch, onSyncId, onClose, onGoto, onSpecChange, onEditType }: Props & { step: Step }) {
  const c = cls(isDark);
  const [preview, setPreview] = useState(false);
  // Ein aus dem BPMN gelesener Schritt trägt oft kein Template, aber ein
  // Topic — und im OpenAPI-Katalog **ist** das Topic die Kennung. Deshalb
  // beide Wege probieren, sonst bleibt der Eintrag ungenutzt.
  const service = catalogEntry(step, model);

  // Woran sich das Mapping messen lässt: die Klasse der Interaktion, sonst der
  // Katalog-Eintrag. Gibt es beides nicht, ist das Mapping frei.
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id) ?? null;
  const classFields = (list: 'inputs' | 'outputs'): string[] | null => {
    const id = list === 'inputs' ? ia?.inTypeId : ia?.outTypeId;
    const t = id ? (spec.types ?? []).find(x => x.id === id) : null;
    if (!t) return null;
    return (t.fields ?? []).map(f => f.name).filter(Boolean);
  };
  const reference = (list: 'inputs' | 'outputs'): { names: string[]; quelle: 'Modell' | 'Katalog' } | null => {
    const fromClass = classFields(list);
    if (fromClass) return { names: fromClass, quelle: 'Modell' };
    const params = (list === 'inputs' ? service?.inputs : service?.outputs) ?? [];
    return params.length ? { names: params.map(p => p.name), quelle: 'Katalog' } : null;
  };

  const setMapping = (list: 'inputs' | 'outputs', i: number, patch: Partial<Mapping>) =>
    onPatch(step.id, { [list]: (step[list] ?? []).map((m, k) => (k === i ? { ...m, ...patch } : m)) });
  const addMapping = (list: 'inputs' | 'outputs') =>
    onPatch(step.id, { [list]: [...(step[list] ?? []), { name: '', expression: '' }] });
  /** Fehlende Zeilen aus Modell bzw. Katalog ergänzen. */
  const fillFromCatalog = (list: 'inputs' | 'outputs') => {
    const have = new Set((step[list] ?? []).map(m => m.name));
    const ref = reference(list);
    if (!ref) return;
    const descr = new Map(((list === 'inputs' ? service?.inputs : service?.outputs) ?? []).map(p => [p.name, p.description]));
    const add = ref.names.filter(n => !have.has(n)).map(name => ({
      name,
      expression: `#{${name}}`,
      ...(descr.get(name) ? { description: descr.get(name) } : {}),
    }));
    if (add.length) onPatch(step.id, { [list]: [...(step[list] ?? []), ...add] });
  };
  const removeMapping = (list: 'inputs' | 'outputs', i: number) =>
    onPatch(step.id, { [list]: (step[list] ?? []).filter((_, k) => k !== i) });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>{KIND_LABEL[step.kind]}</div>
          <input value={step.name} disabled={!canEdit} onChange={e => onPatch(step.id, { name: e.target.value })}
            onBlur={() => onSyncId?.(step.id)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className={`w-full bg-transparent outline-none text-xs font-semibold ${c.text}`} />
          <div className={`text-[9px] font-mono mt-0.5 ${c.muted}`}>{step.id}</div>
        </div>
        <button onClick={onClose} className={`p-1 ${c.muted}`}><X size={12} /></button>
      </div>

      <select value={step.status} disabled={!canEdit}
        onChange={e => onPatch(step.id, { status: e.target.value as Status })}
        className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none ${c.input}`}>
        {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
      </select>

      {/* Fachliche Beschreibung */}
      <Field label="Fachliche Beschreibung (Markdown)" isDark={isDark}
        action={step.description ? <button onClick={() => setPreview(!preview)} className={`text-[9px] ${c.muted} hover:underline`}>
          {preview ? 'bearbeiten' : 'Vorschau'}</button> : undefined}>
        {preview && step.description
          ? <div className="md px-2 py-1.5" dangerouslySetInnerHTML={{ __html: marked.parse(step.description) as string }} />
          : <textarea value={step.description ?? ''} disabled={!canEdit} rows={4}
              onChange={e => onPatch(step.id, { description: e.target.value })}
              placeholder="Was passiert hier fachlich? Was ist die Regel?"
              className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />}
      </Field>

      <Field label="Offene Frage" isDark={isDark}>
        <textarea value={step.open ?? ''} disabled={!canEdit} rows={2}
          onChange={e => onPatch(step.id, { open: e.target.value })}
          placeholder="Was ist fachlich noch zu klären?"
          className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />
      </Field>

      {step.kind === 'user' && (
        <div>
          <h3 className={`text-[10px] uppercase tracking-widest mb-1 ${c.muted}`}>Zuständigkeit</h3>
          <div className="space-y-1">
            <input value={step.candidateGroups ?? ''} disabled={!canEdit}
              onChange={e => onPatch(step.id, { candidateGroups: e.target.value || undefined })}
              placeholder="Gruppen, die die Aufgabe sehen (candidateGroups)"
              className={`w-full text-[10px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />
            <input value={step.assignee ?? ''} disabled={!canEdit}
              onChange={e => onPatch(step.id, { assignee: e.target.value || undefined })}
              placeholder="direkt zugeteilt an (assignee)"
              className={`w-full text-[10px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />
          </div>
        </div>
      )}

      {(canComment(step) || !!threadsFor(spec, stepTarget(step.id)).length) && (
        <Comments spec={spec} target={stepTarget(step.id)} author={author} isDark={isDark}
          canEdit={canEdit} onChange={onSpecChange}
          title={`Kommentare · ${targetLabel(step)}`} highlight={highlight} />
      )}

      {/* Schleife */}
      {step.loop && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-violet-500/30 bg-violet-500/10 text-violet-300' : 'border-violet-300 bg-violet-50 text-violet-700'}`}>
          <div className="flex items-center gap-1.5 font-semibold"><Repeat size={10} /> Wiederholung</div>
          <div className="mt-1">{step.loop.condition}</div>
          {step.loop.maxAttempts && <div>höchstens <span className="font-mono">{step.loop.maxAttempts}</span> Versuche</div>}
          {step.loop.waitFor && <div className="font-mono">{step.loop.waitFor}</div>}
        </div>
      )}

      {/* Service-Auswahl mit vorbereitetem Mapping */}
      {(step.kind === 'service' || step.kind === 'call' || step.kind === 'send' || step.kind === 'rule') && (
        <ServicePicker step={step} model={model} isDark={isDark} canEdit={canEdit} onPatch={onPatch} current={service} />
      )}

      {step.calledProcess && (
        <Row label="Ruft Prozess" isDark={isDark}><span className="font-mono">{step.calledProcess}</span></Row>
      )}
      {step.eventKind && step.eventKind !== 'none' && (
        <Row label="Ereignis" isDark={isDark}>
          <span className="flex items-center gap-1"><Zap size={10} /> {step.eventKind} {step.eventDirection === 'throw' ? '(werfend)' : '(fangend)'}</span>
        </Row>
      )}

      <InteractionClasses step={step} spec={spec} isDark={isDark} canEdit={canEdit} entry={service} model={model}
        onSpecChange={onSpecChange} onEditType={onEditType} />

      <MappingTable title="Eingaben" list="inputs" step={step} isDark={isDark} canEdit={canEdit} service={service}
        reference={reference('inputs')}
        onChange={setMapping} onAdd={addMapping} onRemove={removeMapping} onFill={fillFromCatalog} />
      <MappingTable title="Ausgaben" list="outputs" step={step} isDark={isDark} canEdit={canEdit} service={service}
        reference={reference('outputs')}
        onChange={setMapping} onAdd={addMapping} onRemove={removeMapping} onFill={fillFromCatalog} />

      {(!!step.errors?.length || (canEdit && (step.kind === 'service' || step.kind === 'call'))) && (
        <div>
          <div className="flex items-baseline gap-2 mb-1">
            <h3 className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Behandelte Fehler</h3>
            {canEdit && (
              <button
                onClick={() => onPatch(step.id, { errors: [...(step.errors ?? []), { code: 'neuer-fehler', declared: true }] })}
                className={`ml-auto text-[10px] ${c.muted} hover:underline`}>
                + Fehler
              </button>
            )}
          </div>
          <div className="space-y-1">
            {(step.errors ?? []).map((e, i) => {
              const setErr = (patch: Partial<typeof e>) =>
                onPatch(step.id, { errors: (step.errors ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x)) });
              return (
                <div key={i} className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border ${
                  e.side
                    ? (isDark ? 'border-indigo-500/30 bg-indigo-500/10' : 'border-indigo-300 bg-indigo-50')
                    : (isDark ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-300 bg-amber-50')}`}>
                  {e.side ? <GitFork size={10} className="flex-shrink-0" /> : <AlertTriangle size={10} className="flex-shrink-0" />}
                  <input value={e.code} disabled={!canEdit || (e.boundary && !e.declared)}
                    onChange={ev => setErr({ code: ev.target.value })}
                    title={e.boundary && !e.declared ? 'Kommt vom Boundary-Event im Diagramm' : undefined}
                    placeholder="Fehlercode, z. B. validation-failed"
                    className={`flex-1 min-w-0 text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input}`} />
                  {e.interrupting === false && <span className={`text-[9px] ${c.muted}`}>nicht unterbrechend</span>}
                  {!!e.steps?.length && (
                    <button onClick={() => onGoto(e.steps![0].id)} className={`text-[9px] ${c.muted} hover:underline`}>Pfad →</button>
                  )}
                  {canEdit && !e.boundary && (
                    <button onClick={() => onPatch(step.id, { errors: (step.errors ?? []).filter((_, k) => k !== i) })}
                      title="Fehler entfernen" className={`p-0.5 ${c.muted}`}><Trash2 size={10} /></button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!!step.branches?.length && (
        <div>
          <h3 className={`text-[10px] uppercase tracking-widest mb-1 ${c.muted}`}>Zweige</h3>
          <div className="space-y-1">
            {step.branches.map((b, i) => {
              const setBranch = (patch: Partial<typeof b>) =>
                onPatch(step.id, { branches: (step.branches ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x)) });
              return (
                <div key={b.id} className={`px-2 py-1.5 rounded border space-y-1 ${c.border2}`}>
                  <div className="flex items-center gap-1.5">
                    <input value={b.label} disabled={!canEdit}
                      onChange={e => setBranch({ label: e.target.value })}
                      placeholder="Beschriftung"
                      className={`w-28 text-[10px] px-1.5 py-0.5 rounded border outline-none ${c.input}`} />
                    {b.isDefault && <span className={`text-[9px] ${c.muted}`}>Standardzweig</span>}
                  </div>
                  <input value={b.condition ?? ''} disabled={!canEdit || b.isDefault}
                    onChange={e => setBranch({ condition: e.target.value || undefined })}
                    placeholder={b.isDefault ? 'Standardzweig — keine Bedingung' : 'Bedingung, z. B. ${severalMatches}'}
                    className={`w-full text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input}`} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step.mock && (
        <Field label="Mock (Beispielantwort)" isDark={isDark}>
          <pre className={`text-[10px] px-2 py-1.5 rounded border overflow-x-auto ${c.border2} ${c.muted2}`}>{step.mock}</pre>
        </Field>
      )}

      <Field label="Technische Notiz" isDark={isDark}>
        <textarea value={step.notes ?? ''} disabled={!canEdit} rows={2}
          onChange={e => onPatch(step.id, { notes: e.target.value })}
          className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />
      </Field>
    </div>
  );
}

// ── Klassen einer Interaktion ────────────────────────────────────────────────
//
// Eine Benutzeraufgabe (wie ein eigener Worker oder ein Signal) hat neben dem
// Mapping eigene Klassen: `In` und `Out` mit beschriebenen Feldern — genau wie
// der Prozess. Hier stehen sie am Schritt; bearbeitet werden sie im
// Datenmodell, wo auch die Typen gewählt werden.
function InteractionClasses({ step, spec, isDark, canEdit, entry, model, onSpecChange, onEditType }: {
  step: Step; spec: ProcessSpec; isDark: boolean; canEdit: boolean;
  entry: ServiceDef | null;
  model: Model | null;
  onSpecChange: (spec: ProcessSpec) => void;
  onEditType: (typeId: string) => void;
}) {
  const c = cls(isDark);
  const kind = step.id === spec.steps.find(s => s.kind === 'start')?.id
    ? null
    : interactionKind(step, spec.processId ?? '');
  if (!kind) return null;

  const interactions = spec.interactions ?? [];
  const ia = interactions.find(i => i.stepId === step.id) ?? null;
  const meta = INTERACTION_META[kind];
  const types = spec.types ?? [];

  const create = () => {
    const neu: Interaction = {
      id: uid('ia'), stepId: step.id, kind,
      name: suggestName(step, kind, spec.processId ?? '', model),
      key: kind === 'userTask' ? step.id : step.topic ?? step.name,
      ...(step.description ? { descr: step.description } : {}),
      status: 'draft',
    };
    onSpecChange({ ...spec, interactions: [...interactions, neu] });
  };

  const openMember = (member: 'In' | 'Out') => {
    if (!ia) return;
    const key = member === 'In' ? 'inTypeId' : 'outTypeId';
    const existing = ia[key] as string | undefined;
    if (existing && types.some(t => t.id === existing)) { onEditType(existing); return; }
    const t: TypeDef = createMemberType(ia, member, entry, model);
    onSpecChange({
      ...spec,
      types: [...types, t],
      interactions: interactions.map(i => (i.id === ia.id ? { ...i, [key]: t.id } : i)),
    });
    onEditType(t.id);
  };

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <h3 className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Klassen</h3>
        <span className={`text-[9px] ${c.muted}`}>{meta.label}</span>
      </div>

      {!ia ? (
        <button onClick={create} disabled={!canEdit}
          title={`Eigenes Objekt mit In${meta.hasOut ? ' und Out' : ''} anlegen`}
          className={`w-full flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
          <Workflow size={11} /> Als {meta.label} beschreiben
        </button>
      ) : (
        <div className="space-y-1">
          <div className={`text-[10px] font-mono ${c.muted2}`}>{ia.name}</div>
          {(['In', 'Out'] as const).filter(m => m === 'In' || meta.hasOut).map(m => {
            const t = types.find(x => x.id === (m === 'In' ? ia.inTypeId : ia.outTypeId));
            const known = ((m === 'In' ? entry?.inputs : entry?.outputs) ?? []).length;
            return (
              <button key={m} onClick={() => openMember(m)} disabled={!canEdit && !t}
                className={`w-full px-2 py-1.5 rounded border text-left ${c.border2} ${c.hover}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[11px] font-mono ${c.text}`}>{m}</span>
                  <span className={`text-[10px] ${c.muted}`}>
                    {t ? `${t.fields?.length ?? 0} Felder` : known ? `${known} aus dem Katalog übernehmen` : 'anlegen'}
                  </span>
                  {t ? <ExternalLink size={10} className={`ml-auto ${c.muted}`} /> : <Plus size={10} className={`ml-auto ${c.muted}`} />}
                </div>
                {!!t?.fields?.length && (
                  <div className={`text-[9px] font-mono truncate mt-0.5 ${c.muted}`}>
                    {t.fields.map(f => f.name).filter(Boolean).join(', ')}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Service-Katalog ──────────────────────────────────────────────────────────
function ServicePicker({ step, model, isDark, canEdit, onPatch, current }: {
  step: Step; model: Model | null; isDark: boolean; canEdit: boolean; current: ServiceDef | null;
  onPatch: (id: string, patch: Partial<Step>) => void;
}) {
  const c = cls(isDark);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Nur passende Einträge anbieten: Service-Task → Worker (kind 'service'),
  // Call Activity → Prozesse ('call'), Senden → Signale/Nachrichten ('send'),
  // Entscheidung → NUR DMNs ('rule', keine Services). Einträge ohne kind
  // (Altbestand) zählen als Worker.
  const wanted = step.kind === 'call' ? 'call' : step.kind === 'send' ? 'send' : step.kind === 'rule' ? 'rule' : 'service';
  const pool = useMemo(
    () => (model?.services ?? []).filter(s => (s.kind ?? 'service') === wanted),
    [model, wanted],
  );
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? pool.filter(s => `${s.id} ${s.name} ${s.group ?? ''} ${s.description ?? ''}`.toLowerCase().includes(needle))
      : pool;
    return list.slice(0, 60);
  }, [pool, q]);

  // Vorbereitetes Mapping übernehmen — vorhandene Bedeutungen bleiben erhalten
  const apply = (svc: ServiceDef) => {
    const keep = (list: Mapping[] | undefined) => new Map((list ?? []).map(m => [m.name, m]));
    const oldIn = keep(step.inputs), oldOut = keep(step.outputs);
    onPatch(step.id, {
      serviceId: svc.id,
      ...(svc.topic ? { topic: svc.topic } : {}),
      ...(svc.calledProcess ? { calledProcess: svc.calledProcess } : {}),
      // Was schon erfasst war, bleibt: Ausdruck, Bedeutung und die Abwahl
      inputs: (svc.inputs ?? []).map(pm => ({
        name: pm.name,
        expression: oldIn.get(pm.name)?.expression ?? pm.expression ?? '',
        ...(oldIn.get(pm.name)?.description ?? pm.description ? { description: oldIn.get(pm.name)?.description ?? pm.description } : {}),
        ...(oldIn.get(pm.name)?.disabled ? { disabled: true } : {}),
      })),
      outputs: (svc.outputs ?? []).map(pm => ({
        name: pm.name,
        expression: oldOut.get(pm.name)?.expression ?? pm.expression ?? '',
        ...(oldOut.get(pm.name)?.description ? { description: oldOut.get(pm.name)!.description } : {}),
        ...(oldOut.get(pm.name)?.disabled ? { disabled: true } : {}),
      })),
      ...(svc.handledErrors?.length
        ? { errors: [...(step.errors ?? []), ...svc.handledErrors.filter(code => !(step.errors ?? []).some(e => e.code === code)).map(code => ({ code }))] }
        : {}),
      status: 'changed' as Status,
    });
    setOpen(false); setQ('');
  };

  return (
    <div>
      <h3 className={`text-[10px] uppercase tracking-widest mb-1 ${c.muted}`}>Service</h3>
      <button disabled={!canEdit} onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 30); }}
        className={`w-full flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border text-left ${c.border2} ${canEdit ? c.hover : ''}`}>
        <span className={`flex-1 truncate font-mono ${current ? c.text : c.muted}`}>
          {step.serviceId ?? (step.topic ? `Topic: ${step.topic}` : 'kein Service gewählt')}
        </span>
        {canEdit && <ChevronDown size={12} className={c.muted} />}
      </button>
      {current?.description && <p className={`text-[10px] mt-1 ${c.muted}`}>{current.description.split('\n')[0]}</p>}

      {open && (
        <div className={`mt-1 rounded border ${c.border2} ${c.panelStrong}`}>
          <div className={`flex items-center gap-1.5 px-2 py-1.5 border-b ${c.border}`}>
            <Search size={11} className={c.muted} />
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              placeholder={`${pool.length} ${wanted === 'call' ? 'Prozesse' : wanted === 'send' ? 'Signale/Nachrichten' : wanted === 'rule' ? 'Entscheidungen (DMN)' : 'Services'} durchsuchen …`}
              className={`flex-1 bg-transparent outline-none text-[11px] ${c.text}`} />
            <button onClick={() => setOpen(false)} className={c.muted}><X size={11} /></button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {hits.map(s => (
              <button key={s.id} onClick={() => apply(s)}
                className={`w-full text-left px-2 py-1.5 border-b last:border-b-0 ${c.border} ${c.hover}`}>
                <div className={`text-[11px] truncate ${c.text}`}>{s.name}</div>
                <div className={`text-[9px] font-mono truncate ${c.muted}`}>{s.id}</div>
                <div className={`text-[9px] ${c.muted}`}>
                  {(s.inputs?.length ?? 0)} Eingaben · {(s.outputs?.length ?? 0)} Ausgaben
                  {s.handledErrors?.length ? ` · ${s.handledErrors.length} Fehler` : ''}
                </div>
              </button>
            ))}
            {!hits.length && <div className={`px-2 py-3 text-[10px] ${c.muted}`}>Nichts gefunden. Katalog im Admin befüllen.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── kleine Bausteine ─────────────────────────────────────────────────────────
// Ein- und Ausgaben eines Schritts: bearbeitbar, und jede Zeile lässt sich
// **abwählen**. Ein Katalog-Service bringt alles mit, was er kann — was dieser
// Prozess nicht braucht, wird deaktiviert statt gelöscht. So bleibt sichtbar,
// was möglich wäre, und ein erneuter Abgleich stellt es nicht wieder her.
function MappingTable({ title, list, step, isDark, canEdit, service, reference, onChange, onAdd, onRemove, onFill }: {
  title: string; list: 'inputs' | 'outputs'; step: Step; isDark: boolean; canEdit: boolean;
  /** Katalog-Eintrag — liefert die Bedeutung, wo der Schritt keine eigene hat */
  service: ServiceDef | null;
  /** was das Datenmodell bzw. der Katalog kennt — daran misst sich das Mapping */
  reference: { names: string[]; quelle: 'Modell' | 'Katalog' } | null;
  onChange: (list: 'inputs' | 'outputs', i: number, patch: Partial<Mapping>) => void;
  onAdd: (list: 'inputs' | 'outputs') => void;
  onRemove: (list: 'inputs' | 'outputs', i: number) => void;
  onFill: (list: 'inputs' | 'outputs') => void;
}) {
  const c = cls(isDark);
  const rows = step[list] ?? [];
  const active = rows.filter(m => !m.disabled).length;
  // Der Katalog kennt die Bedeutung der Felder (aus den OpenAPI-Schemas).
  // Wo der Schritt keine eigene hat, steht sie als Vorschlag im Feld — sie
  // wird nicht mitgespeichert, solange niemand sie übernimmt.
  const fromCatalog = new Map((service?.[list] ?? []).map(p => [p.name, p.description]));
  const vorhanden = new Set(rows.map(m => m.name));
  const bekannt = reference ? new Set(reference.names) : null;
  const fehlend = reference ? reference.names.filter(n => !vorhanden.has(n)).length : 0;
  // Zeilen, die es im Datenmodell nicht (mehr) gibt — die Abweichung gehört
  // dort behoben, nicht hier weggelöscht.
  const verwaist = bekannt ? rows.filter(m => m.name && !bekannt.has(m.name)).length : 0;
  if (!rows.length && !canEdit) return null;

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <h3 className={`text-[10px] uppercase tracking-widest ${c.muted}`}>{title}</h3>
        {!!rows.length && (
          <span className={`text-[9px] ${c.muted}`}>
            {active === rows.length ? rows.length : `${active} von ${rows.length}`}
          </span>
        )}
        {canEdit && (
          <div className="ml-auto flex items-center gap-2">
            {fehlend > 0 && (
              <button onClick={() => onFill(list)}
                title={`${fehlend} Feld(er) aus dem ${reference?.quelle} übernehmen`}
                className={`text-[10px] ${c.muted} hover:underline`}>
                + {fehlend} aus {reference?.quelle}
              </button>
            )}
            {!reference && (
              <button onClick={() => onAdd(list)} className={`text-[10px] ${c.muted} hover:underline`}>
                + Feld
              </button>
            )}
          </div>
        )}
      </div>
      {!!verwaist && (
        <p className={`text-[10px] mb-1 ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
          {verwaist} Zeile{verwaist === 1 ? '' : 'n'} ohne Entsprechung im {reference?.quelle}.
        </p>
      )}
      <div className="space-y-1">
        {rows.map((m, i) => {
          const off = !!m.disabled;
          const fehlt = !!bekannt && !!m.name && !bekannt.has(m.name);
          return (
            <div key={`${m.name}-${i}`}
              title={fehlt ? `«${m.name}» steht nicht (mehr) im ${reference?.quelle} — dort ergänzen oder hier abwählen.` : undefined}
              className={`px-2 py-1.5 rounded border ${
                fehlt ? (isDark ? 'border-rose-500/50 bg-rose-500/5' : 'border-rose-400 bg-rose-50') : c.border2
              } ${off ? 'opacity-45' : ''}`}>
              <div className="flex items-center gap-1.5">
                <input type="checkbox" checked={!off} disabled={!canEdit}
                  title={off ? 'kommt in diesem Prozess nicht vor' : 'wird verwendet — abwählen, wenn nicht gebraucht'}
                  onChange={e => onChange(list, i, { disabled: e.target.checked ? undefined : true })}
                  className="flex-shrink-0" />
                <input value={m.name} disabled={!canEdit || off}
                  onChange={e => onChange(list, i, { name: e.target.value })}
                  placeholder="name"
                  className={`w-32 text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input} ${off ? 'line-through' : ''}`} />
                <input value={m.expression} disabled={!canEdit || off}
                  onChange={e => onChange(list, i, { expression: e.target.value })}
                  placeholder={list === 'inputs' ? 'Ausdruck / Variable' : 'Quelle'}
                  title={m.expression}
                  className={`flex-1 min-w-0 text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input}`} />
                {fehlt && <AlertTriangle size={10} className={`flex-shrink-0 ${isDark ? 'text-rose-400' : 'text-rose-600'}`} />}
                {canEdit && !reference && (
                  <button onClick={() => onRemove(list, i)} title="Zeile entfernen"
                    className={`p-0.5 flex-shrink-0 ${c.muted}`}><Trash2 size={10} /></button>
                )}
              </div>
              <input value={m.description ?? ''} disabled={!canEdit || off}
                onChange={e => onChange(list, i, { description: e.target.value || undefined })}
                placeholder={fromCatalog.get(m.name) || 'fachliche Bedeutung'}
                title={fromCatalog.get(m.name) ? `laut Katalog: ${fromCatalog.get(m.name)}` : undefined}
                className={`mt-1 w-full text-[10px] px-1.5 py-0.5 rounded border outline-none ${c.input}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children, isDark, action }: { label: string; children: React.ReactNode; isDark: boolean; action?: React.ReactNode }) {
  const c = cls(isDark);
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h3 className={`text-[10px] uppercase tracking-widest ${c.muted}`}>{label}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children, isDark }: { label: string; children: React.ReactNode; isDark: boolean }) {
  const c = cls(isDark);
  return (
    <div className="flex items-baseline gap-2 text-[10px]">
      <span className={`${c.muted} w-24 flex-shrink-0`}>{label}</span>
      <span className={`${c.muted2} truncate`}>{children}</span>
    </div>
  );
}
