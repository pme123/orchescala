// Detail column: everything about one step — business on top, technical below.
//
// This is also where the **service selection with prepared mapping** lives: a
// click on a catalog entry sets the topic and takes over the inputs/outputs
// of the element template as a template; meanings already maintained stay.
import { useEffect, useMemo, useRef, useState } from 'react';
import { C7_LABEL, C8_LABEL } from '../engineLabels';
import { AlertTriangle, AppWindow, ArrowUpRight, Asterisk, ShieldCheck, Braces, ChevronDown, ChevronRight, ExternalLink, GitFork, List, ListOrdered, Plug, Plus, Puzzle, Repeat, Search, Trash2, Unlink, Workflow, X, Zap } from 'lucide-react';
import type { AppliedPattern, DomainType, EngineId, Field, Interaction, Mapping, Model, PatternDef, ProcessSpec, ServiceDef, ServiceParam, Status, Step, TimerSpec, TypeDef } from '../types';
import { INTERACTION_META, STATUSES, STATUS_META } from '../types';
import { catalogEntry, createMemberType, foreignOrigin, interactionKind, interactionOrigin, suggestName, withOrigin } from '../interactions';
import { packageOf } from '../scala';
import { EpicChip, KIND_LABEL, cls, patternTone } from '../ui';
import { EpicChips } from './SpecMeta';
import { PROCESS_TARGET, allPatterns, changeBuiltinPattern, patternMappings, paramText, patternParamsFor, patternsFor, processPatterns, stepTags } from '../patterns';
import { GENERAL_VARIABLES, blockIndex, boundaryLabel, isEventBoundary, blockStart, isInitWorker, isServiceWorker, mockFieldOf, mockRef, timerVariable } from '../bpmn';
import { FEEL_TYPE_LABEL, checkFeel, conditionExpected, domainInputNames, domainRequired, expectedFor, inConfigField, inConfigWarning, expectedFromDomain, isFeel, multiInstanceScopes, processVariables, resultVariables, stepDomainMember, withMultiInstance, type ExpectedType, type FeelCheck, type FeelIssue, type VarNode } from '../feel';
import { NEW_REGEX, handledErrorIssue, isScriptValue, newErrorCode, regexIssue, scriptWarning, stepFindings, timerFindings, timerKinds } from '../findings';
import { feelBody, feelSyntaxOk, feelToGroovy, feelToJuel, isJsonLiteral } from '../feelJuel';
import { feelIfPossible, importExpression, isJuel } from '../juelFeel';
import FeelInput from './FeelInput';
import DmnTableSection from './DmnTableSection';
import { MarkdownField } from './MarkdownField';
import { CommentBubble, useActiveComment } from './Comments';
import { useConfirm } from './Confirm';
import { useStore } from '../store';
import { pagesForTask, userTaskSteps } from '../pages/taskLinks';
import { processTarget, stepTarget, sub } from '../comments';
import { knownPrefixes, nameFromService, splitPrefix, unnamed } from '../stepIds';
import { ALL_VARIANTS, chosenVariant, classFieldsOf, noVariantText, routingText, rowsForVariant, variantAllows, variantKey, variantRequires, variantsOf, type Chosen, type Variants } from '../variants';
import { uid } from '../util';
import { CORRELATION_KEY, carriesMessage, correlationOf, messageCorrelation, withMessageName, type MessageCorrelation } from '../messageCall';

interface Props {
  step: Step | null;
  spec: ProcessSpec;
  isDark: boolean;
  canEdit: boolean;
  model: Model | null;
  onPatch: (id: string, patch: Partial<Step>) => void;
  /** after renaming, update the ID according to the convention (when leaving the field) */
  onSyncId?: (id: string) => void;
  onClose: () => void;
  onGoto: (id: string) => void;
  onSpecChange: (spec: ProcessSpec) => void;
  /** jump to the class builder and show this type there */
  onEditType: (typeId: string) => void;
  /** all known `company-projekt` prefixes (catalog + specifications) */
  projectPrefixes?: string[];
  /** change company/project — updates all `{company}-{project}-*` IDs */
  onRenameProject?: (newPrefix: string) => void;
  /** insert or remove a pattern, change values — writes directly into the BPMN; `null` = on the process */
  onPattern?: (targetId: string | null, patternId: string, action: 'add' | 'remove' | 'update', params?: Record<string, string>, previous?: Record<string, string>) => void;
  /** is there a diagram? Without one there is nowhere a pattern could go */
  hasDiagram?: boolean;
  /** to a page of the app - the pages that complete a user task */
  onOpenPage?: (pageSlug: string) => void;
}

// Width, border and background come from the right column — only content here.
export default function StepDetail(p: Props) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {p.step ? <StepPanel {...p} step={p.step} /> : <SpecPanel {...p} />}
    </div>
  );
}

/**
 * The specification speaks FEEL, also for Camunda 7 — there the export
 * translates to JUEL. Whatever has no JUEL counterpart should be reported
 * while typing, not only on export.
 */
/** Colours for warning (yellow) and error (red) — text and border. */
const tones = (isDark: boolean) => ({
  warn: isDark ? 'text-amber-400' : 'text-amber-600',
  warnBox: isDark ? 'border-amber-500/40 bg-amber-500/5' : 'border-amber-400 bg-amber-50',
  err: isDark ? 'text-rose-400' : 'text-rose-600',
  errBox: isDark ? 'border-rose-500/50 bg-rose-500/5' : 'border-rose-400 bg-rose-50',
});

/** The assignment of a user task — the fields as the Camunda Modeler shows them */
const ASSIGNMENT_FIELDS = [
  { key: 'assignee', label: 'Assignee', placeholder: 'direkt zugeteilt an, z. B. = initiator', title: 'Wem die Aufgabe direkt zugeteilt ist.' },
  { key: 'candidateGroups', label: 'Candidate groups', placeholder: 'Gruppen, die die Aufgabe sehen, z. B. = kokRole', title: 'Gruppen, die die Aufgabe sehen und übernehmen können — fest als «a, b».' },
  { key: 'candidateUsers', label: 'Candidate users', placeholder: 'Personen, die die Aufgabe sehen', title: 'Personen, die die Aufgabe sehen und übernehmen können — fest als «a, b».' },
] as const;

function juelIssues(expression: string, engine: EngineId | undefined, json = false): FeelIssue[] {
  if (engine === 'c8') return [];
  const body = feelBody(expression);
  if (body == null) return [];
  const r = feelToJuel(body);
  if (r.ok) return [];
  // not valid FEEL (incomplete): the check of the expression already reports that
  if (!feelSyntaxOk(body)) return [];
  // a list or a context: in Camunda 7 a Groovy script with Spin — where a script can go
  if (json && isJsonLiteral(body)) {
    const g = feelToGroovy(body);
    if (g.ok) return [];
    return [{ level: 'warn', text: `Für ${C7_LABEL} als JSON-Skript nicht übersetzbar (${g.reason}) — beim Export bleibt das FEEL stehen.` }];
  }
  return [{ level: 'warn', text: `Für ${C7_LABEL} nicht nach JUEL übersetzbar (${r.reason}) — beim Export bleibt das FEEL stehen.` }];
}

// ── Process level (no step selected) ─────────────────────────────────────
function SpecPanel({ spec, isDark, canEdit, onSpecChange, projectPrefixes, onRenameProject, model, onPattern, hasDiagram }: Props) {
  const c = cls(isDark);
  return (
    <div className="p-4 space-y-4">
      <h2 className={`text-[10px] uppercase tracking-widest ${c.text}`}>Prozess</h2>
      {onRenameProject && (
        <ProjectPicker spec={spec} isDark={isDark} canEdit={canEdit}
          prefixes={projectPrefixes ?? []} onRename={onRenameProject} />
      )}
      <EpicPicker spec={spec} model={model} isDark={isDark} canEdit={canEdit} onChange={onSpecChange} />
      <Field label="Beschrieb / Ausgangslage / Ziel (Markdown)" isDark={isDark} comment={sub(processTarget, 'description')}>
        <MarkdownField value={spec.description ?? ''} disabled={!canEdit} isDark={isDark}
          onChange={v => onSpecChange({ ...spec, description: v })}
          rows={6} placeholder="Worum geht es fachlich?"
          className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />
      </Field>
      <Field label="Time to Live (Tage)" isDark={isDark}>
        <input value={spec.timeToLive ?? ''} disabled={!canEdit}
          onChange={e => onSpecChange({ ...spec, timeToLive: e.target.value || undefined })}
          placeholder="z. B. 60 — wie lange die Historie aufbewahrt wird"
          className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
      </Field>
      <PatternSection target={null} spec={spec} model={model} isDark={isDark} canEdit={canEdit}
        onPattern={onPattern} hasDiagram={hasDiagram} onSpecChange={onSpecChange} />
      <div>
        <h3 className={`text-[10px] uppercase tracking-widest mb-2 ${c.text}`}>Prozessvariablen</h3>
        <VariableList spec={spec} isDark={isDark} canEdit={canEdit} onChange={onSpecChange} />
      </div>
      <p className={`text-[10px] leading-relaxed ${c.muted}`}>
        Einen Schritt im Ablauf anklicken, um ihn zu beschreiben, den Service zu wählen
        oder den Status zu setzen.
      </p>
    </div>
  );
}

// Company and project of the process — the choice comes from the catalog
// (model.projects) and the existing specifications. A change updates
// all `{company}-{project}-*` IDs, in the specification as in the BPMN.
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

// Epics of the process — only an admin may create them (Admin → Epics), here
// they are only assigned. Closed ones stay, but are not added anew.
function EpicPicker({ spec, model, isDark, canEdit, onChange }: {
  spec: ProcessSpec; model: Model | null; isDark: boolean; canEdit: boolean; onChange: (s: ProcessSpec) => void;
}) {
  if (!(model?.epics ?? []).length && !canEdit) return null;
  return (
    <Field label="Epics" isDark={isDark}>
      <EpicChips ids={spec.epics} model={model} isDark={isDark} canEdit={canEdit} onChange={epics => onChange({ ...spec, epics })} />
    </Field>
  );
}

function VariableList({ spec, isDark, canEdit, onChange }: { spec: ProcessSpec; isDark: boolean; canEdit: boolean; onChange: (s: ProcessSpec) => void }) {
  const confirm = useConfirm();
  const c = cls(isDark);
  const vars = spec.variables ?? [];
  const set = (i: number, patch: Partial<(typeof vars)[number]>) =>
    onChange({ ...spec, variables: vars.map((v, k) => (k === i ? { ...v, ...patch } : v)) });
  return (
    <div className="space-y-1">
      {vars.map((v, i) => (
        <div key={i} data-cframe={v.name ? sub(processTarget, `var:${v.name}`) : undefined} className="group flex items-center gap-1">
          <input value={v.name} disabled={!canEdit} onChange={e => set(i, { name: e.target.value })}
            className={`w-28 text-[10px] px-1.5 py-1 rounded border outline-none font-mono ${c.input}`} />
          <input value={v.description ?? ''} disabled={!canEdit} onChange={e => set(i, { description: e.target.value })}
            placeholder="Bedeutung"
            className={`flex-1 text-[10px] px-1.5 py-1 rounded border outline-none ${c.input}`} />
          {v.name && <CommentBubble target={sub(processTarget, `var:${v.name}`)} quiet />}
          {canEdit && (
            <button onClick={async () => {
              if (await confirm({ title: v.name ? `Variable «${v.name}» entfernen?` : 'Leere Variable entfernen?' })) onChange({ ...spec, variables: vars.filter((_, k) => k !== i) });
            }} title="Variable entfernen" className={`p-1 ${c.muted}`}><X size={10} /></button>
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

// ── Step level ────────────────────────────────────────────────────────────
function StepPanel({ step, spec, isDark, canEdit, model, onPatch, onSyncId, onClose, onGoto, onSpecChange, onEditType, onPattern, hasDiagram, onOpenPage }: Props & { step: Step }) {
  const confirm = useConfirm();
  const { pages, specs } = useStore();
  const c = cls(isDark);
  const { warn, warnBox, err, errBox } = tones(isDark);
  const correlation = messageCorrelation(step, spec.engine);
  // A step read from the BPMN often carries no template, but a
  // topic — and in the OpenAPI catalog the topic **is** the identifier. So
  // try both ways, otherwise the entry stays unused.
  // Not the init worker: its topic is the process, and its entry
  // describes the call of the process (In/Out), not the init worker —
  // that one reads the In from the process variables and returns the InitIn.
  const initWorker = isInitWorker(step, spec.processId);
  // Step in the block of a pattern (link target → call …): the pattern fills it
  const ofPattern = step.pattern ? (model?.patterns?.find(d => d.id === step.pattern)?.name ?? step.pattern) : null;
  const service = initWorker ? null : catalogEntry(step, model);

  // What the mapping can be measured against: the class of the interaction, otherwise the
  // catalog entry. If there is neither, the mapping is free.
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id) ?? null;
  // a user task: the pages that complete it, and whether its key is in other processes too (a page
  // only knows the key - then it cannot tell the processes apart)
  const taskKey = ia?.kind === 'userTask' ? ia.key : null;
  const taskPages = useMemo(() => (taskKey ? pagesForTask(taskKey, pages) : []), [taskKey, pages]);
  const keyElsewhere = useMemo(() => (taskKey ? userTaskSteps(taskKey, specs).filter(t => t.slug !== spec.slug || t.stepId !== step.id) : []), [taskKey, specs, spec.slug, step.id]);
  const classFieldDefs = (list: 'inputs' | 'outputs'): Field[] | null => {
    const id = list === 'inputs' ? ia?.inTypeId : ia?.outTypeId;
    const t = id ? (spec.types ?? []).find(x => x.id === id) : null;
    // for an enum also the fields of its cases — which apply is said by the variant
    return t ? classFieldsOf(t) : null;
  };
  const classFields = (list: 'inputs' | 'outputs'): string[] | null =>
    classFieldDefs(list)?.map(f => f.name) ?? null;
  // The process variables with their paths — for the FEEL check and suggestions;
  // for the outputs first the result of the service (the fields of its Out)
  const scopes = useMemo(() => multiInstanceScopes(spec.steps).get(step.id), [spec.steps, step.id]);
  const baseVariables = useMemo(() => processVariables(spec, model), [spec, model]);
  const variables = useMemo(() => withMultiInstance(baseVariables, scopes), [baseVariables, scopes]);
  const resultVars = useMemo(() => withMultiInstance(resultVariables(step, spec, model, service), scopes), [step, spec, model, service, scopes]);
  // The Scala types of the service object from the domain catalog — the yardstick for
  // type and required, where the step has no In/Out class of its own
  const domainIn = useMemo(() => (initWorker ? null : stepDomainMember(step, spec, model, 'In')), [initWorker, step, spec, model]);
  // User tasks and custom workers read their In from the process variables —
  // a mapping is an extra there, no required field can be «missing»
  const ownKind = ia?.kind ?? interactionKind(step, spec.processId ?? '');
  const implicitIn = ownKind === 'userTask' || ownKind === 'customTask' || initWorker;
  const domainOut = useMemo(() => (initWorker ? null : stepDomainMember(step, spec, model, 'Out')), [initWorker, step, spec, model]);
  // enum with cases: the step chooses its variant (see variants.ts)
  const variantsIn = useMemo(() => variantsOf(step, spec, model, 'inputs', service), [step, spec, model, service]);
  const variantsOut = useMemo(() => variantsOf(step, spec, model, 'outputs', service), [step, spec, model, service]);
  const variantsFor = (list: 'inputs' | 'outputs') => (list === 'inputs' ? variantsIn : variantsOut);
  const chosenFor = (list: 'inputs' | 'outputs') => chosenVariant(step, list, variantsFor(list));
  const setVariant = (list: 'inputs' | 'outputs', name: string | null) => {
    const v = variantsFor(list);
    if (!v) return;
    onPatch(step.id, { [variantKey(list)]: name ?? undefined, [list]: rowsForVariant(step[list] ?? [], v, name, list) });
  };
  const reference = (list: 'inputs' | 'outputs'): { names: string[]; quelle: 'Modell' | 'Katalog' } | null => {
    // without a chosen variant only the common fields — for the own class as for the catalog
    const v = variantsFor(list), chosen = chosenFor(list);
    const fromClass = classFields(list);
    if (fromClass) return { names: fromClass.filter(n => variantAllows(v, chosen, n)), quelle: 'Modell' };
    const params = (list === 'inputs' ? service?.inputs : service?.outputs) ?? [];
    const names = params.map(p => p.name).filter(n => variantAllows(v, chosen, n));
    return params.length ? { names, quelle: 'Katalog' } : null;
  };

  const setMapping = (list: 'inputs' | 'outputs', i: number, patch: Partial<Mapping>) =>
    onPatch(step.id, { [list]: (step[list] ?? []).map((m, k) => (k === i ? { ...m, ...patch } : m)) });
  const addMapping = (list: 'inputs' | 'outputs') =>
    onPatch(step.id, { [list]: [...(step[list] ?? []), { name: '', expression: '' }] });
  /** Add missing rows from the model or the catalog. */
  const fillFromCatalog = (list: 'inputs' | 'outputs') => {
    const have = new Set((step[list] ?? []).map(m => m.name));
    const ref = reference(list);
    if (!ref) return;
    const descr = new Map(((list === 'inputs' ? service?.inputs : service?.outputs) ?? []).map(p => [p.name, p.description]));
    const add = ref.names.filter(n => !have.has(n)).map(name => ({
      name,
      expression: `= ${name}`,
      ...(descr.get(name) ? { description: descr.get(name) } : {}),
    }));
    if (add.length) onPatch(step.id, { [list]: [...(step[list] ?? []), ...add] });
  };
  const removeMapping = (list: 'inputs' | 'outputs', i: number) =>
    onPatch(step.id, { [list]: (step[list] ?? []).filter((_, k) => k !== i) });
  /** JUEL from an older state to FEEL — the same translation as on import. */
  const convertJuel = (list: 'inputs' | 'outputs') =>
    onPatch(step.id, { [list]: (step[list] ?? []).map(m => (isJuel(m.expression) ? { ...m, expression: importExpression(m.expression) } : m)) });

  // Header: the kind as a chip in its colour, next to it the object (own
  // contract, violet) or the catalog identifier (external service, teal)
  // Is the step in a block of its own or an event subprocess? Then the header says so – like the bracket in the tree
  const block = useMemo(() => blockIndex(spec.steps).get(step.id) ?? null, [spec.steps, step.id]);
  const kindTone = ia
    ? (isDark ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-violet-300 bg-violet-50 text-violet-800')
    : service
      ? (isDark ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-teal-300 bg-teal-50 text-teal-800')
      : (isDark ? 'border-white/15 text-white/50' : 'border-black/15 text-black/50');
  const foreign = !ia && (step.serviceId || step.topic) && step.topic !== (spec.processId ?? '') ? (step.serviceId ?? step.topic ?? '') : '';
  // where the foreign service comes from: its domain object, else the catalog group
  const origin = foreign ? foreignOrigin(step, model) : null;
  // Inputs and outputs contributed by a pattern: implementation — hidden
  const fromPattern = useMemo(() => patternMappings(model?.patterns, step.patterns, spec.engine ?? 'c7'), [model?.patterns, step.patterns, spec.engine]);
  const patternName = (id: string) => model?.patterns?.find(d => d.id === id)?.name ?? id;
  // Findings collected — the same list as the triangle in the tree
  // the kinds per timer variable — for the findings on the step and on its boundary timers
  const kinds = useMemo(() => timerKinds(spec.steps), [spec.steps]);
  const finding = stepFindings(step, spec, model, baseVariables, { kinds });
  // Whatever concerns an error or expression is already shown right there — not repeated at the top
  const inline = new Set(finding.inline ?? []);
  const shownErrors = finding.errors.filter(t => !inline.has(t));
  const shownWarnings = finding.warnings.filter(t => !inline.has(t));

  return (
    <div className="p-4 space-y-4">
      <div data-cframe={stepTarget(step.id)} className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${kindTone}`}>{KIND_LABEL[step.kind]}</span>
            {ia && (
              <button onClick={() => { const id = ia.inTypeId ?? ia.outTypeId; if (id) onEditType(id); }}
                title={`${INTERACTION_META[ia.kind].label} «${ia.name}» — zum Datenmodell`}
                className={`inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border ${kindTone} ${ia.inTypeId || ia.outTypeId ? 'hover:underline' : ''}`}>
                {ia.name}<ExternalLink size={9} className="opacity-60" />
              </button>
            )}
            {/* a user task: the pages of the app that complete it (only where the app has pages) */}
            {ia?.kind === 'userTask' && onOpenPage && pages.length > 0 && (() => {
              const forTask = taskPages;
              const elsewhere = keyElsewhere.length
                ? `\n⚠ Der Schlüssel «${ia.key}» kommt auch in ${keyElsewhere.map(t => `«${t.process}»`).join(', ')} vor – die Seite gilt für alle.`
                : '';
              const tone = isDark ? 'border-sky-500/30 bg-sky-500/15 text-sky-200' : 'border-sky-300 bg-sky-50 text-sky-800';
              return forTask.length ? forTask.map(pg => (
                <button key={pg.slug} onClick={() => onOpenPage(pg.slug)}
                  title={`Die Seite «${pg.title}» schliesst diesen Benutzer-Task ab – Klick: zur Seite im Seiten-Designer${elsewhere}`}
                  className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border hover:underline ${tone}`}>
                  <AppWindow size={9} />{pg.title}{keyElsewhere.length > 0 && ' ⚠'}<ArrowUpRight size={9} className="opacity-60" />
                </button>
              )) : (
                <span title={`Keine Seite der App schliesst «${ia.key}» ab (Aktion «Task abschliessen»)`}
                  className={`text-[9px] px-1.5 py-0.5 rounded border ${c.border2} ${c.muted}`}>keine Seite</span>
              );
            })()}
            {!ia && foreign && (
              <span title={service ? `${service.name} — im Katalog` : `«${foreign}» steht nicht im Katalog`}
                className={`inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[16rem] ${
                  service || !model?.services?.length ? kindTone : (isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700')}`}>
                <Plug size={9} className="flex-shrink-0" />{foreign}
              </span>
            )}
            <CommentBubble target={stepTarget(step.id)} title={`Kommentare zu «${step.name || step.id}»`} />
          </div>
          {!ia && foreign && (origin || service?.group) && (
            <div className={`mt-1 text-[10px] truncate ${c.muted}`}
              title={origin ? `Domain-Objekt ${origin.object} in ${origin.pkg}` : `Katalog, Gruppe ${service?.group}`}>
              {origin
                ? <>aus <span className="font-mono">{origin.project}</span> · <span className="font-mono">{origin.object}</span></>
                : <>aus dem Katalog · <span className="font-mono">{String(service?.group)}</span></>}
            </div>
          )}
          {block && (
            <button onClick={() => onGoto(block.head.id)}
              title={`${block.eventSub ? 'Ereignis-Subprozess — läuft neben dem Hauptablauf' : `Eigener Block — ${blockStart(block.head)}`}. Klick zeigt den Block im Ablauf.`}
              className={`mt-1 inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border ${
                isDark ? 'border-slate-500/40 bg-slate-500/10 text-slate-300 hover:bg-slate-500/20' : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
              <Unlink size={9} /> {block.eventSub ? 'Ereignis-Subprozess' : 'Eigener Block'} «{block.head.name}»
            </button>
          )}
          <input value={step.name} disabled={!canEdit} onChange={e => onPatch(step.id, { name: e.target.value })}
            onBlur={() => onSyncId?.(step.id)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className={`w-full bg-transparent outline-none text-sm font-semibold mt-1 ${c.text}`} />
          <div className={`text-[9px] font-mono mt-0.5 ${c.muted}`}>{step.id}</div>
        </div>
        <select value={step.status} disabled={!canEdit}
          onChange={e => onPatch(step.id, { status: e.target.value as Status })}
          className={`text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        {/* only closes the view — nothing is deleted */}
        <button onClick={onClose} title="Ansicht schliessen (Auswahl aufheben — löscht nichts)" aria-label="Ansicht schliessen"
          className={`p-1 ${c.muted}`}><X size={12} /></button>
      </div>

      {/* Findings — what is red or orange in the tree, written out here */}
      {(shownErrors.length > 0 || shownWarnings.length > 0) && (
        <div className={`text-[10px] px-2 py-1.5 rounded border space-y-0.5 ${
          shownErrors.length
            ? (isDark ? 'border-rose-500/30 bg-rose-500/5' : 'border-rose-300 bg-rose-50')
            : (isDark ? 'border-amber-500/30 bg-amber-500/5' : 'border-amber-300 bg-amber-50')}`}>
          {shownErrors.map((t, i) => <div key={`e${i}`} className={`flex items-start gap-1 ${err}`}><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /><span>{t}</span></div>)}
          {shownWarnings.map((t, i) => <div key={`w${i}`} className={`flex items-start gap-1 ${warn}`}><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /><span>{t}</span></div>)}
        </div>
      )}

      {/* Business description */}
      <Field label="Fachliche Beschreibung (Markdown)" isDark={isDark} comment={sub(stepTarget(step.id), 'description')}>
        <MarkdownField value={step.description ?? ''} disabled={!canEdit} isDark={isDark} rows={4}
          onChange={v => onPatch(step.id, { description: v })}
          placeholder="Was passiert hier fachlich? Was ist die Regel?"
          className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />
      </Field>

      {step.kind === 'user' && (() => {
        const filled = ASSIGNMENT_FIELDS.filter(f => step[f.key]?.trim()).length;
        // a pattern that defines the assignment: it is shown here, groups/person are locked
        const byPattern = (step.patterns ?? []).map(a => model?.patterns?.find(d => d.id === a.id)).filter(d => d?.area === 'assignment');
        return (
          <Section id="assign" label="Zuständigkeit" isDark={isDark}
            comment={sub(stepTarget(step.id), 'assignment')}
            count={filled + byPattern.length}
            hint={!filled && !byPattern.length ? <span className={`text-[9px] ${c.muted}`}>Gruppen oder Person</span> : undefined}>
            <div className="space-y-1.5">
              <PatternSection target={step} spec={spec} model={model} isDark={isDark} canEdit={canEdit}
                onPattern={onPattern} hasDiagram={hasDiagram} area="assignment" />
              {!!byPattern.length && (
                <p className={`text-[10px] ${c.muted}`}>
                  Die Zuständigkeit legt das Pattern {byPattern.map(d => `«${d!.name}»`).join(', ')} fest — Gruppen und Person sind hier nicht editierbar.
                </p>
              )}
              {ASSIGNMENT_FIELDS.map(f => {
                const value = step[f.key] ?? '';
                // as with the mappings: `= …` is FEEL and is checked, otherwise fixed text
                const issues: FeelIssue[] = isFeel(value)
                  ? [...checkFeel(value, variables).issues, ...juelIssues(value, spec.engine)]
                  : isJuel(value)
                    ? [{ level: 'warn', text: importExpression(value) !== value
                        ? 'JUEL aus einem älteren Stand — als FEEL schreiben (z. B. «= kokRole»).'
                        : 'JUEL, nicht nach FEEL übersetzbar — als «= …» schreiben; bis dahin geht es unverändert ins BPMN.' }]
                    : [];
                const hasErr = issues.some(i => i.level === 'error');
                return (
                  <div key={f.key} className={issues.length ? `px-2 py-1 rounded border space-y-1 ${hasErr ? errBox : warnBox}` : 'space-y-0.5'}>
                    <div className={`text-[9px] ${c.muted}`}>{f.label} <span className="font-mono">({f.key})</span></div>
                    <FeelInput value={value} disabled={!canEdit || !!byPattern.length} isDark={isDark}
                      variables={variables}
                      onChange={v => onPatch(step.id, { [f.key]: v || undefined })}
                      placeholder={f.placeholder}
                      title={`${f.title}\nMit «=» ein FEEL-Ausdruck — im BPMN für ${spec.engine === 'c8' ? `${C8_LABEL} als =…` : `${C7_LABEL} als \${…}`}; sonst fester Text.`} />
                    {issues.map((it, k) => (
                      <p key={k} className={`text-[10px] flex items-start gap-1 ${it.level === 'error' ? err : warn}`}>
                        <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{it.text}</span>
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })()}

      <PatternSection target={step} spec={spec} model={model} isDark={isDark} canEdit={canEdit}
        onPattern={onPattern} hasDiagram={hasDiagram} />

      {/* Loop */}
      {step.loop && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-violet-500/30 bg-violet-500/10 text-violet-300' : 'border-violet-300 bg-violet-50 text-violet-700'}`}>
          <div className="flex items-center gap-1.5 font-semibold"><Repeat size={10} /> Wiederholung</div>
          <div className="mt-1">{step.loop.condition}</div>
          {step.loop.maxAttempts && <div>höchstens <span className="font-mono">{step.loop.maxAttempts}</span> Versuche</div>}
          {step.loop.waitFor && <div className="font-mono">{step.loop.waitFor}</div>}
        </div>
      )}

      {/* Multi-instance: per element of a collection — read from the BPMN */}
      {step.multiInstance && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-violet-500/30 bg-violet-500/10 text-violet-300' : 'border-violet-300 bg-violet-50 text-violet-700'}`}>
          <div className="flex items-center gap-1.5 font-semibold"><Repeat size={10} /> Mehrfachausführung{step.multiInstance.sequential ? ' (nacheinander)' : ' (parallel)'}</div>
          {step.multiInstance.collection && <div>je Element von <span className="font-mono">{step.multiInstance.collection}</span></div>}
          {step.multiInstance.element && <div>Element heisst <span className="font-mono">{step.multiInstance.element}</span> · Zähler <span className="font-mono">loopCounter</span></div>}
        </div>
      )}

      {/* Service selection with prepared mapping */}
      {initWorker && (
        <Row label="Init-Worker" isDark={isDark}>
          <span title="Sein Topic ist der Prozess selbst: er liest das In aus den Prozessvariablen und liefert das InitIn — kein Service-Aufruf.">
            Topic <span className="font-mono">{step.topic}</span> — liest das In, liefert das InitIn
          </span>
        </Row>
      )}
      {/* Part of a pattern block: the pattern defines call, inputs and outputs */}
      {ofPattern && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${patternTone(isDark)}`}>
          <div className="flex items-center gap-1.5 font-semibold"><Puzzle size={10} /> Teil des Patterns «{ofPattern}»</div>
          <div className="mt-0.5">Aufruf, Ein- und Ausgaben füllt das Pattern — sie stehen hier nicht und werden nicht geprüft. Geändert wird am Element, das das Pattern trägt.</div>
        </div>
      )}
      {(step.kind === 'service' || step.kind === 'call' || step.kind === 'send' || step.kind === 'rule') && !initWorker && !ofPattern && (
        <ServicePicker step={step} spec={spec} model={model} isDark={isDark} canEdit={canEdit} onPatch={onPatch} onSyncId={onSyncId} current={service} />
      )}
      {/* DMN decision of this process: the table itself — In and Out follow it.
          A matched decision counts even without the process ID in its decisionRef */}
      {step.kind === 'rule' && !ofPattern && ownKind === 'decision' && (
        <DmnTableSection step={step} spec={spec} model={model} isDark={isDark} canEdit={canEdit} onSpecChange={onSpecChange} />
      )}

      {step.calledProcess && (
        <Row label="Ruft Prozess" isDark={isDark}><span className="font-mono">{step.calledProcess}</span></Row>
      )}
      {step.eventKind && step.eventKind !== 'none' && (
        <Row label="Ereignis" isDark={isDark}>
          <span className="flex items-center gap-1"><Zap size={10} /> {step.eventKind} {step.eventDirection === 'throw' ? '(werfend)' : '(fangend)'}</span>
        </Row>
      )}
      {/* the name from `messageRef` / `signalRef` — correlation is by it; the export writes it into the diagram */}
      {carriesMessage(step) && (
        <div className="flex items-center gap-2 text-[10px]">
          <span className={`${c.muted} w-24 flex-shrink-0`}>{step.eventKind === 'signal' ? 'Signal' : 'Nachricht'}</span>
          <input value={step.messageName ?? ''} disabled={!canEdit || !!ofPattern}
            onChange={e => onSpecChange(withMessageName(spec, step.id, e.target.value))}
            title={ofPattern ? `Legt das Pattern «${ofPattern}» fest` : 'Der Name, unter dem gesendet und korreliert wird'}
            placeholder={step.eventKind === 'signal' ? 'Name des Signals' : 'Name der Nachricht'}
            className={`flex-1 min-w-0 text-[10px] px-1.5 py-1 rounded border outline-none font-mono ${c.input}`} />
        </div>
      )}
      {correlation && (
        <CorrelationChoice corr={correlation} engine={spec.engine} isDark={isDark} disabled={!canEdit || !!ofPattern}
          onChoose={key => onPatch(step.id, { correlationKey: key })} />
      )}
      {step.eventKind === 'timer' && (
        <TimerSection timer={step.timer} spec={spec} isDark={isDark} canEdit={canEdit} lockedBy={ofPattern ?? undefined}
          onChange={timer => onPatch(step.id, { timer })} />
      )}

      {!ofPattern && <>
      <InteractionClasses step={step} spec={spec} isDark={isDark} canEdit={canEdit} entry={service} model={model}
        onSpecChange={onSpecChange} onEditType={onEditType} />

      <MappingTable key={`${step.id}-in`} title="Eingaben" list="inputs" step={step} isDark={isDark} canEdit={canEdit} service={service}
        variables={variables} refFields={classFieldDefs('inputs')} domain={domainIn} types={spec.types ?? []} model={model} engine={spec.engine}
        implicitIn={implicitIn} reference={reference('inputs')} fromPattern={fromPattern.inputs} patternTimes={fromPattern.times.inputs} patternName={patternName}
        variants={variantsIn} chosen={chosenFor('inputs')} onVariant={setVariant}
        onChange={setMapping} onAdd={addMapping} onRemove={removeMapping} onFill={fillFromCatalog} onConvert={convertJuel} />
      <MappingTable key={`${step.id}-out`} title="Ausgaben" list="outputs" step={step} isDark={isDark} canEdit={canEdit} service={service}
        variables={resultVars} refFields={classFieldDefs('outputs')} domain={domainOut} types={spec.types ?? []} model={model} engine={spec.engine}
        implicitIn={implicitIn} reference={reference('outputs')} fromPattern={fromPattern.outputs} patternTimes={fromPattern.times.outputs} patternName={patternName}
        variants={variantsOut} chosen={chosenFor('outputs')} onVariant={setVariant}
        onChange={setMapping} onAdd={addMapping} onRemove={removeMapping} onFill={fillFromCatalog} onConvert={convertJuel} />
      </>}

      {/* Signal, message, escalation on the boundary: no errors — name (and correlation) editable, the export writes them into the diagram */}
      {(step.errors ?? []).some(isEventBoundary) && (
        <Section id="events" label="Ereignisse am Rand" count={(step.errors ?? []).filter(isEventBoundary).length} isDark={isDark}>
          <div className="space-y-1">
            {(step.errors ?? []).map((e, i) => {
              if (!isEventBoundary(e)) return null;
              const setErr = (patch: Partial<typeof e>) =>
                onPatch(step.id, { errors: (step.errors ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x)) });
              const locked = !canEdit || !!e.pattern || !!ofPattern;
              const handled = handledErrorIssue(e, i, step.errors ?? [], { variables, engine: spec.engine });
              return (
                <div key={i} className={`rounded border px-2 py-1.5 space-y-1 ${handled ? warnBox : c.border2}`}>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <Zap size={10} className={`flex-shrink-0 ${c.muted}`} />
                    <span className="font-semibold">{boundaryLabel(e)}</span>
                    <span className="truncate">«{e.code}»</span>
                    {e.interrupting === false && <span className={`text-[9px] ${c.muted}`}>nicht unterbrechend</span>}
                    <span className="flex-1" />
                    {!!e.steps?.length && (
                      <button onClick={() => onGoto(e.steps![0].id)} className={`text-[9px] ${c.muted} hover:underline`}>Pfad →</button>
                    )}
                  </div>
                  {(e.eventKind === 'signal' || e.eventKind === 'message') && (
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className={`${c.muted} w-24 flex-shrink-0`}>{e.eventKind === 'signal' ? 'Signal' : 'Nachricht'}</span>
                      <input value={e.messageName ?? ''} disabled={locked}
                        onChange={ev => setErr({ messageName: ev.target.value })}
                        title={e.pattern ? 'Legt das Pattern fest' : 'Der Name, unter dem gesendet bzw. korreliert wird — ein Ausdruck mit = (FEEL)'}
                        placeholder={e.eventKind === 'signal' ? 'Name des Signals' : 'Name der Nachricht'}
                        className={`flex-1 min-w-0 text-[10px] px-1.5 py-1 rounded border outline-none font-mono ${c.input}`} />
                    </div>
                  )}
                  {e.eventKind === 'message' && (
                    <CorrelationChoice corr={correlationOf(e.correlationKey, spec.engine)} engine={spec.engine} isDark={isDark} disabled={locked}
                      onChoose={key => setErr({ correlationKey: key })} />
                  )}
                  {handled && (
                    <p className={`text-[10px] flex items-start gap-1 ${warn}`}>
                      <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{handled.text}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {((step.errors ?? []).some(e => !isEventBoundary(e)) || !!step.regexHandledErrors?.length || (canEdit && (step.kind === 'service' || step.kind === 'call'))) && (
        <Section id="errors" label="Behandelte Fehler" count={(step.errors ?? []).filter(e => !isEventBoundary(e) && (!e.side || e.timer)).length} isDark={isDark}
          openFor={sub(stepTarget(step.id), 'error:')}
          action={canEdit ? (
            <span className="flex items-center gap-2">
              <button
                onClick={() => onPatch(step.id, { errors: [...(step.errors ?? []), { code: newErrorCode(step.errors ?? []), declared: true }] })}
                className={`text-[10px] ${c.muted} hover:underline`}>
                + Fehler
              </button>
              <button
                onClick={() => onPatch(step.id, { regexHandledErrors: [...(step.regexHandledErrors ?? []), NEW_REGEX] })}
                title="Fehlercodes als regulärer Ausdruck (_regexHandledErrors)"
                className={`text-[10px] ${c.muted} hover:underline`}>
                + Regex
              </button>
            </span>
          ) : undefined}>
          <p className={`text-[10px] mb-1.5 leading-snug ${c.muted}`}>
            <b>Fehler</b>: der Code wird mit dem Fehlertyp (<span className="font-mono">messageType</span>) des Fehlers verglichen — z. B. <span className="font-mono">404</span>.{' '}
            <b>Regex</b>: der Ausdruck wird gegen die Fehlermeldung (<span className="font-mono">message</span>) geprüft — z. B. <span className="font-mono">.*timeout.*</span>.{' '}
            Mit <span className="font-mono">=</span> am Anfang ist der Eintrag ein FEEL-Ausdruck, der einen Text oder eine Liste von Texten liefert — sonst ein fester Text.
          </p>
          <div className="space-y-1">
            {(step.errors ?? []).map((e, i) => {
              // Side paths (without error code) belong in the tree, not in this list — except with a timer;
              // signal, message, escalation are listed above under «Ereignisse am Rand»
              if (isEventBoundary(e) || (e.side && !e.timer)) return null;
              const setErr = (patch: Partial<typeof e>) =>
                onPatch(step.id, { errors: (step.errors ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x)) });
              // handled is the normal case — yellow/red only if something is wrong with the entry
              const handled = handledErrorIssue(e, i, step.errors ?? [], { variables, engine: spec.engine });
              // the timer of a boundary event: the same findings as in the list above
              const timerIssues = { errors: [] as string[], warnings: [] as string[] };
              if (e.boundary && e.timer) timerFindings(e.timer, spec, timerIssues.errors, timerIssues.warnings, { kinds });
              const issue = handled?.level === 'error' || timerIssues.errors.length ? { level: 'error' as const }
                : handled ?? (timerIssues.warnings.length ? { level: 'warn' as const } : null);
              return (
                <div key={i} data-cframe={e.code ? sub(stepTarget(step.id), `error:${e.code}`) : undefined}
                  className={`rounded border ${
                  e.side
                    ? (isDark ? 'border-indigo-500/30 bg-indigo-500/10' : 'border-indigo-300 bg-indigo-50')
                    : issue ? (issue.level === 'error' ? errBox : warnBox) : c.border2}`}>
                <div className="group flex items-center gap-1.5 text-[10px] px-2 py-1">
                  {e.side ? <GitFork size={10} className="flex-shrink-0" /> : <ShieldCheck size={10} className={`flex-shrink-0 ${c.muted}`} />}
                  <FeelInput value={e.code} disabled={!canEdit || (e.boundary && !e.declared)} isDark={isDark}
                    variables={variables}
                    onChange={v => setErr({ code: v })}
                    title={e.boundary && !e.declared ? 'Kommt vom Boundary-Event im Diagramm' : 'Fester Code — oder mit «=» ein FEEL-Ausdruck, der ihn liefert'}
                    placeholder="Fehlercode, z. B. validation-failed — oder = …"
                    className="flex-1 min-w-0" />
                  {e.interrupting === false && <span className={`text-[9px] ${c.muted}`}>nicht unterbrechend</span>}
                  {!!e.steps?.length && (
                    <button onClick={() => onGoto(e.steps![0].id)} className={`text-[9px] ${c.muted} hover:underline`}>Pfad →</button>
                  )}
                  {e.code && <CommentBubble target={sub(stepTarget(step.id), `error:${e.code}`)} quiet />}
                  {canEdit && !e.boundary && (
                    <button onClick={async () => {
                      if (await confirm({ title: e.code ? `Fehler «${e.code}» entfernen?` : 'Leeren Fehler entfernen?' })) onPatch(step.id, { errors: (step.errors ?? []).filter((_, k) => k !== i) });
                    }}
                      title="Fehler entfernen" className={`p-0.5 ${c.muted}`}><Trash2 size={10} /></button>
                  )}
                </div>
                {handled && (
                  <p className={`text-[10px] flex items-start gap-1 px-2 pb-1 ${handled.level === 'error' ? err : warn}`}>
                    <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{handled.text}</span>
                  </p>
                )}
                {e.boundary && e.timer && (
                  <div className="px-2 pb-1.5 space-y-1">
                    <TimerSection timer={e.timer} spec={spec} isDark={isDark} canEdit={canEdit}
                      lockedBy={e.pattern ? (model?.patterns?.find(d => d.id === e.pattern)?.name ?? e.pattern) : ofPattern ?? undefined}
                      onChange={timer => setErr({ timer })} />
                    {[...timerIssues.errors.map(t => [t, err]), ...timerIssues.warnings.map(t => [t, warn])].map(([t, tone], k) => (
                      <p key={k} className={`text-[10px] flex items-start gap-1 ${tone}`}>
                        <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{t}</span>
                      </p>
                    ))}
                  </div>
                )}
                </div>
              );
            })}
          </div>
          {!!step.regexHandledErrors?.length && (
            <div className="mt-2 space-y-1">
              <p className={`text-[10px] ${c.muted}`}>Fehlercodes als regulärer Ausdruck <span className="font-mono">(_regexHandledErrors)</span></p>
              {step.regexHandledErrors.map((r, i) => {
                const issue = regexIssue(r, spec.engine, variables, (step.regexHandledErrors ?? []).length <= 1);
                const setList = (list: string[]) => onPatch(step.id, { regexHandledErrors: list.length ? list : undefined });
                return (
                  <div key={i} className={`rounded border ${issue ? (issue.level === 'error' ? errBox : warnBox) : c.border2}`}>
                    <div className="flex items-center gap-1.5 text-[10px] px-2 py-1">
                      <span className={`font-mono flex-shrink-0 ${c.muted}`}>.*</span>
                      <FeelInput value={r} disabled={!canEdit} isDark={isDark}
                        variables={variables}
                        onChange={v => setList((step.regexHandledErrors ?? []).map((x, k) => (k === i ? v : x)))}
                        title="Fester Ausdruck — oder mit «=» ein FEEL-Ausdruck, der ihn liefert"
                        placeholder="z. B. .*timeout.* (passt auf die Meldung) — oder = …"
                        className="flex-1 min-w-0" />
                      {canEdit && (
                        <button onClick={async () => {
                          if (await confirm({ title: r ? `Ausdruck «${r}» entfernen?` : 'Leeren Ausdruck entfernen?' })) setList((step.regexHandledErrors ?? []).filter((_, k) => k !== i));
                        }}
                          title="Ausdruck entfernen" className={`p-0.5 ${c.muted}`}><Trash2 size={10} /></button>
                      )}
                    </div>
                    {issue && (
                      <p className={`text-[10px] flex items-start gap-1 px-2 pb-1 ${issue.level === 'error' ? err : warn}`}>
                        <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{issue.text}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}
      {!!step.branches?.length && (
        <Section id="branches" label="Zweige" count={step.branches.length} isDark={isDark}
          openFor={sub(stepTarget(step.id), 'branch:')}>
          <div className="space-y-1">
            {step.branches.map((b, i) => {
              const setBranch = (patch: Partial<typeof b>) =>
                onPatch(step.id, { branches: (step.branches ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x)) });
              // Condition as FEEL: valid, paths known, result yes/no
              const cond: FeelIssue[] = !b.isDefault && b.condition && isFeel(b.condition)
                ? [...checkFeel(b.condition, variables, conditionExpected(spec.engine)).issues, ...juelIssues(b.condition, spec.engine)]
                : !b.isDefault && b.condition && isJuel(b.condition)
                  ? [{ level: 'warn', text: importExpression(b.condition) !== b.condition
                      ? 'JUEL aus einem älteren Stand — «→ FEEL» übersetzt es.'
                      : 'JUEL, nicht nach FEEL übersetzbar — als «= …» schreiben.' }]
                  : [];
              const condErr = cond.some(i => i.level === 'error');
              const condConvertible = !b.isDefault && !!b.condition && isJuel(b.condition) && importExpression(b.condition) !== b.condition;
              return (
                <div key={b.id} data-cframe={sub(stepTarget(step.id), `branch:${b.id}`)}
                  className={`group px-2 py-1.5 rounded border space-y-1 ${condErr ? errBox : cond.length ? warnBox : c.border2}`}>
                  {cond.map((it, k) => (
                    <p key={k} className={`text-[10px] flex items-start gap-1 ${it.level === 'error' ? err : warn}`}>
                      <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{it.text}</span>
                      {condConvertible && canEdit && k === 0 && (
                        <button onClick={() => setBranch({ condition: importExpression(b.condition!) })}
                          className={`ml-auto flex-shrink-0 font-mono px-1.5 rounded border ${isDark ? 'border-amber-500/40 hover:bg-amber-500/10' : 'border-amber-400 hover:bg-amber-50'}`}>
                          → FEEL
                        </button>
                      )}
                    </p>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <input value={b.label} disabled={!canEdit}
                      onChange={e => setBranch({ label: e.target.value })}
                      placeholder="Beschriftung"
                      className={`w-28 text-[10px] px-1.5 py-0.5 rounded border outline-none ${c.input}`} />
                    {b.isDefault && <span className={`text-[9px] ${c.muted}`}>Standardzweig</span>}
                    <span className="ml-auto"><CommentBubble target={sub(stepTarget(step.id), `branch:${b.id}`)} quiet /></span>
                  </div>
                  <FeelInput value={b.condition ?? ''} disabled={!canEdit || b.isDefault} isDark={isDark}
                    variables={variables}
                    onChange={v => setBranch({ condition: v || undefined })}
                    placeholder={b.isDefault ? 'Standardzweig — keine Bedingung' : 'Bedingung als FEEL, z. B. = severalMatches'}
                    title={`Bedingung des Zweigs als FEEL (= …) — beim Export für ${C7_LABEL} nach JUEL übersetzt`} />
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {(step.kind === 'service' || step.kind === 'call') && !isInitWorker(step, spec.processId) && (
        <Section id="mock" label="Mock" count={step.mockKind ? 1 : 0} isDark={isDark}>
          <select value={step.mockKind ?? ''} disabled={!canEdit}
            onChange={e => onPatch(step.id, { mockKind: (e.target.value || undefined) as Step['mockKind'] })}
            className={`w-full text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input}`}>
            <option value="">kein eigener Mock</option>
            <option value="output">_outputMock — das Ergebnis {step.kind === 'call' ? 'des Teilprozesses' : 'des Workers'}</option>
            {isServiceWorker(step) && <option value="service">_outputServiceMock — die Antwort des Services</option>}
          </select>
          <p className={`text-[10px] mt-1 leading-snug ${c.muted}`}>
            Beim Export: <span className="font-mono">_servicesMocked = _servicesMocked</span>{step.kind === 'call' && <>, <span className="font-mono">_mockedWorkers = _mockedWorkers</span>, <span className="font-mono">_identityCorrelation = _identityCorrelation</span></>}
            {step.mockKind && <>, dazu <span className="font-mono">{step.mockKind === 'service' ? '_outputServiceMock' : '_outputMock'} = {mockFieldOf(step)}</span> und im InConfig das Feld <span className="font-mono">{mockFieldOf(step)}</span></>}.
          </p>
          {step.mock && mockRef(step.mock) !== mockFieldOf(step) && (
            <pre className={`mt-1 text-[10px] px-2 py-1.5 rounded border overflow-x-auto ${c.border2} ${c.muted2}`} title="bisheriger Wert im BPMN — beim Export ersetzt">{step.mock}</pre>
          )}
        </Section>
      )}
    </div>
  );
}

// ── Pattern ──────────────────────────────────────────────────────────────────
//
// What the admin has set up as a pattern and fits this element can be
// chosen here — it is then in the diagram immediately (not only on
// export). The values of the parameters go in when leaving the field.
function PatternSection({ target, spec, model, isDark, canEdit, onPattern, hasDiagram, area, onSpecChange }: {
  target: Step | null; spec: ProcessSpec; model: Model | null; isDark: boolean; canEdit: boolean;
  onPattern?: Props['onPattern']; hasDiagram?: boolean;
  /** only the patterns of this section (`assignment`: in the assignment, without its own heading) — otherwise the rest */
  area?: PatternDef['area'];
  /** for the patterns of Orchescala — they live in the specification, not in the diagram */
  onSpecChange?: (spec: ProcessSpec) => void;
}) {
  const c = cls(isDark);
  const engine: EngineId = spec.engine ?? 'c7';
  const defs = allPatterns(model?.patterns);
  const defOf = (id: string) => defs.find(d => d.id === id);
  const here = (d: PatternDef | undefined) => (d?.area ?? undefined) === area;
  const applied = ((target ? target.patterns : processPatterns(spec)) ?? []).filter(a => here(defOf(a.id)));
  const tags = target ? stepTags(target.kind, target.eventDirection, target.gatewayType) : [PROCESS_TARGET];
  // into the diagram only with a diagram; those of Orchescala always work — and each once
  const editableBpmn = canEdit && !!onPattern && !!hasDiagram;
  const editableBuiltin = canEdit && !!onSpecChange;
  const available = patternsFor(defs, tags, engine).filter(here)
    .filter(d => !d.builtin || !applied.some(a => a.id === d.id));
  const selectable = available.filter(d => (d.builtin ? editableBuiltin : editableBpmn));
  // Parameters with «=» are FEEL like the mapping values — suggestions from the process variables
  // (before the early return: hooks always in the same order)
  const variables = useMemo(() => processVariables(spec, model), [spec, model]);
  if (!applied.length && !available.length) return null;
  const editable = editableBpmn;
  const id = target?.id ?? null;
  const add = (pid: string) => {
    if (defOf(pid)?.builtin) onSpecChange?.(changeBuiltinPattern(spec, pid, 'add'));
    else onPattern?.(id, pid, 'add');
  };
  const cards = applied.map((a, i) => {
    const def = defOf(a.id) ?? null;
    return (
      <AppliedPatternCard key={`${a.id}-${i}`} applied={a} def={def}
        isDark={isDark} editable={def?.builtin ? editableBuiltin : editable} engine={engine} atProcess={!target} variables={variables}
        onRemove={() => (def?.builtin ? onSpecChange?.(changeBuiltinPattern(spec, a.id, 'remove')) : onPattern?.(id, a.id, 'remove', a.params))}
        onParams={params => (def?.builtin ? onSpecChange?.(changeBuiltinPattern(spec, a.id, 'update', params)) : onPattern?.(id, a.id, 'update', params, a.params))} />
    );
  });
  // in the assignment: the patterns and — as long as none is chosen — the selection, without its own heading
  if (area) {
    return (
      <div className="space-y-1.5">
        {cards}
        {!applied.length && !!selectable.length && (
          <select value="" onChange={e => { if (e.target.value) add(e.target.value); }}
            title="Zuständigkeit per Pattern festlegen — es wird sofort ins Diagramm eingefügt"
            className={`text-[10px] px-1.5 py-0.5 rounded border outline-none max-w-[16rem] ${c.input}`}>
            <option value="">+ Zuweisung per Pattern …</option>
            {selectable.map(d => <option key={d.id} value={d.id} title={d.description}>{d.name}</option>)}
          </select>
        )}
      </div>
    );
  }
  return (
    <Section id="patterns" label="Pattern" count={applied.length} isDark={isDark}
      hint={!hasDiagram ? <span className={`text-[9px] ${c.muted}`}>braucht das Diagramm</span> : undefined}
      action={selectable.length ? (
        <select value="" onChange={e => { if (e.target.value) add(e.target.value); }}
          title="Pattern wählen — es wird sofort ins Diagramm eingefügt (die von Orchescala in die Spezifikation)"
          className={`text-[10px] px-1.5 py-0.5 rounded border outline-none max-w-[12rem] ${c.input}`}>
          <option value="">+ Pattern …</option>
          {selectable.map(d => <option key={d.id} value={d.id} title={d.description}>{d.name}{applied.some(a => a.id === d.id) ? ' (noch einmal)' : ''}</option>)}
        </select>
      ) : undefined}>
      <div className="space-y-1.5">
        {cards}
        {!applied.length && !!available.length && (
          <p className={`text-[10px] ${c.muted}`}>
            {available.length} passende{available.length === 1 ? 's' : ''} Pattern: {available.map(d => d.name).join(', ')}
          </p>
        )}
      </div>
    </Section>
  );
}

/**
 * A pattern parameter is written literally into the BPMN (`{{name}}`) — so in the form
 * of the engine: `${x}` in Camunda 7, `=x` in Camunda 8. It is shown and edited
 * like a mapping value: with «=» FEEL, otherwise fixed text.
 */
const paramView = (stored: string): string => (isJuel(stored) || feelBody(stored) != null ? importExpression(stored) : stored);

/** Back into the form of the engine — FEEL that does not translate to JUEL stays as is (and is reported). */
function paramStored(view: string, engine: EngineId, vars: VarNode[]): string {
  const body = feelBody(view);
  if (body == null) return view;
  if (engine === 'c8') return `=${body.trim()}`;
  // the variables determine how a Spin path ends (`numberValue()` …)
  const r = feelToJuel(body, { vars });
  return r.ok ? `\${${r.juel}}` : view;
}

function AppliedPatternCard({ applied, def, isDark, editable, engine, atProcess, variables, onRemove, onParams }: {
  applied: AppliedPattern; def: PatternDef | null; isDark: boolean; editable: boolean; engine: EngineId; atProcess: boolean;
  variables: VarNode[];
  onRemove: () => void; onParams: (params: Record<string, string>) => void;
}) {
  const c = cls(isDark);
  const { warn, err } = tones(isDark);
  const params: Array<{ name: string; label?: string; description?: string; default?: string; inBlock?: boolean; textOnly?: boolean; options?: string[] }> = def
    ? patternParamsFor(def, engine, atProcess)
    : Object.keys(applied.params ?? {}).map(name => ({ name }));
  const stored = applied.params ?? {};
  const storedKey = JSON.stringify(stored);
  // the FEEL view is edited; the form of the engine is stored
  const viewOf = (ps: Record<string, string>) => Object.fromEntries(Object.entries(ps).map(([k, v]) => [k, paramView(v)]));
  const textView = (ps: Record<string, string>) => {
    const text = new Set(params.filter(p => p.textOnly).map(p => p.name));
    return Object.fromEntries(Object.entries(viewOf(ps)).map(([k, v]) => [k, text.has(k) ? paramText(v) : v]));
  };
  const [draft, setDraft] = useState<Record<string, string>>(() => textView(stored));
  useEffect(() => { setDraft(textView(JSON.parse(storedKey))); }, [storedKey]);
  const [confirm, setConfirm] = useState(false);
  const commit = () => {
    // what was not touched stays literally as it is in the BPMN — the
    // values of an Orchescala pattern are not in the BPMN, but as typed
    // a parameter inside a string of the pattern takes only text (`succeeded`, not `= ProcessStatus.succeeded`)
    const text = new Set(params.filter(p => p.textOnly).map(p => p.name));
    const next = Object.fromEntries(Object.entries(draft).map(([k, v]) =>
      [k, def?.builtin ? v : text.has(k) ? paramText(v) : stored[k] != null && paramView(stored[k]) === v ? stored[k] : paramStored(v, engine, variables)]));
    if (JSON.stringify(next) !== storedKey) onParams(next);
  };
  const issuesOf = (v: string | undefined): FeelIssue[] => {
    if (!v?.trim()) return [];
    if (isFeel(v)) return [...checkFeel(v, variables).issues, ...juelIssues(v, engine)];
    return isJuel(v) ? [{ level: 'warn', text: 'JUEL — als «= …» schreiben, dann gilt es für beide Engines.' }] : [];
  };
  return (
    <div className={`rounded border px-2 py-1.5 space-y-1 ${patternTone(isDark)}`}>
      <div className="flex items-center gap-1.5 text-[10px]">
        <Puzzle size={10} className="flex-shrink-0" />
        <span className="font-semibold truncate" title={def?.description}>{def?.name ?? applied.id}</span>
        {def?.builtin && <span title="Fest in Orchescala — die Werte stehen in der Spezifikation, nicht im Diagramm" className="text-[9px] opacity-70">Orchescala</span>}
        {def?.docUrl && (
          <a href={def.docUrl} target="_blank" rel="noopener noreferrer" title="Dokumentation des Patterns" className="opacity-70 hover:opacity-100">
            <ExternalLink size={9} />
          </a>
        )}
        {editable && def && (
          confirm
            ? <span className="ml-auto flex items-center gap-1">
                <button onClick={() => { setConfirm(false); onRemove(); }} className="text-[9px] underline">{def.builtin ? 'entfernen' : 'aus dem Diagramm entfernen'}</button>
                <button onClick={() => setConfirm(false)} title="Abbrechen" className="opacity-70"><X size={10} /></button>
              </span>
            : <button onClick={() => setConfirm(true)} title="Pattern entfernen" className="ml-auto opacity-60 hover:opacity-100"><Trash2 size={10} /></button>
        )}
      </div>
      {!def && <p className={`text-[10px] flex items-start gap-1 ${warn}`}><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />Im Admin nicht (mehr) definiert — erkannt wurde es mit einem früheren Stand.</p>}
      {!!params.length && (
        <div className="space-y-0.5">
          {params.map(p => {
            const issues = p.inBlock || p.textOnly ? [] : issuesOf(draft[p.name]);
            return (
              <div key={p.name}>
                <div className="flex items-center gap-1.5 text-[10px]"
                  title={p.inBlock ? `${p.description ? `${p.description}\n` : ''}Steht im gemeinsamen Block des Prozesses — dort, im Diagramm, ändern.` : p.description}>
                  <span className={`w-28 flex-shrink-0 truncate ${c.muted2}`}>{p.label || p.name}</span>
                  {/* blur applies — as with the field before; Enter leaves the field */}
                  <div className="flex-1 min-w-0" onBlur={commit}
                    onKeyDown={e => {
                      // Enter applies (Shift+Enter: new line) — also in the expanded FEEL field
                      if (e.key === 'Enter' && !e.shiftKey && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
                        e.preventDefault();
                        e.target.blur();
                      }
                    }}>
                    {p.textOnly && !p.inBlock ? (
                      <>
                        <input value={draft[p.name] ?? ''} disabled={!editable} list={p.options ? `opts-${applied.id}-${p.name}` : undefined}
                          onChange={e => setDraft(d => ({ ...d, [p.name]: e.target.value }))}
                          placeholder={p.default ? `Vorgabe: ${p.default}` : p.options ? `z. B. ${p.options[0]}` : 'Text'}
                          title={`${p.description ? `${p.description}\n` : ''}Steht im Pattern in einer Zeichenkette — nur Text, kein FEEL.${p.options ? ` Zur Auswahl: ${p.options.join(', ')}; ein eigener Wert geht auch.` : ''}`}
                          className={`w-full text-[11px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />
                        {p.options && (
                          <datalist id={`opts-${applied.id}-${p.name}`}>
                            {p.options.map(o => <option key={o} value={o} />)}
                          </datalist>
                        )}
                      </>
                    ) : (
                    <FeelInput value={p.inBlock ? '' : draft[p.name] ?? ''} disabled={!editable || p.inBlock} isDark={isDark}
                      variables={variables}
                      onChange={v => setDraft(d => ({ ...d, [p.name]: v }))}
                      placeholder={p.inBlock ? 'im gemeinsamen Block' : p.default ? `Vorgabe: ${p.default}` : 'Text — oder = FEEL'}
                      title={`${p.description ? `${p.description}\n` : ''}Mit «=» ein FEEL-Ausdruck (wie bei den Mappings) — im BPMN für ${engine === 'c8' ? `${C8_LABEL} als =…` : `${C7_LABEL} als \${…}`}; sonst fester Text.`} />
                    )}
                  </div>
                </div>
                {issues.map((it, k) => (
                  <p key={k} className={`ml-[7.5rem] text-[10px] flex items-start gap-1 ${it.level === 'error' ? err : warn}`}>
                    <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{it.text}</span>
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Classes of an interaction ────────────────────────────────────────────────
//
// A user task (like a custom worker or a signal) has, besides the
// mapping, classes of its own: `In` and `Out` with described fields — just like
// the process. Here they are shown on the step; they are edited in the
// data model, where the types are chosen as well.
function InteractionClasses({ step, spec, isDark, canEdit, entry, model, onSpecChange, onEditType }: {
  step: Step; spec: ProcessSpec; isDark: boolean; canEdit: boolean;
  entry: ServiceDef | null;
  model: Model | null;
  onSpecChange: (spec: ProcessSpec) => void;
  onEditType: (typeId: string) => void;
}) {
  const c = cls(isDark);
  const interactions = spec.interactions ?? [];
  const ia = interactions.find(i => i.stepId === step.id) ?? null;
  const kind = step.id === spec.steps.find(s => s.kind === 'start')?.id
    ? null
    : ia?.kind ?? interactionKind(step, spec.processId ?? '');
  if (!kind) return null;

  const meta = INTERACTION_META[kind];
  const types = spec.types ?? [];

  const create = () => {
    const neu: Interaction = {
      id: uid('ia'), stepId: step.id, kind,
      name: suggestName(step, kind, spec.processId ?? '', model),
      key: kind === 'userTask' ? step.id : step.topic ?? step.name,
      ...(step.description ? { descr: step.description } : {}),
      // DMN decision: the result form from the BPMN (`camunda:mapDecisionResult`)
      ...(kind === 'decision' && step.decisionResult ? { decisionResult: step.decisionResult } : {}),
      status: 'draft',
    };
    onSpecChange({ ...spec, interactions: [...interactions, withOrigin(neu, model, packageOf(spec, model))] });
  };

  const openMember = (member: 'In' | 'Out') => {
    if (!ia) return;
    const key = member === 'In' ? 'inTypeId' : 'outTypeId';
    const existing = ia[key] as string | undefined;
    if (existing && types.some(t => t.id === existing)) { onEditType(existing); return; }
    const t: TypeDef = createMemberType(ia, member, entry, model, packageOf(spec, model));
    onSpecChange({
      ...spec,
      types: [...types, t],
      interactions: interactions.map(i => (i.id === ia.id ? { ...i, [key]: t.id } : i)),
    });
    onEditType(t.id);
  };

  const { warn, warnBox } = tones(isDark);
  // via the key in the catalog: an object of another process / project is
  // referenced and not exported
  const origin = ia ? interactionOrigin(ia, model, packageOf(spec, model)) : null;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <h3 className={`text-[10px] uppercase tracking-widest ${c.text}`}>Klassen</h3>
        <span className={`text-[9px] ${c.muted}`}>{meta.label}</span>
        {ia && <span className={`ml-auto text-[10px] font-mono ${c.muted2}`} title="Objekt der Interaktion im Datenmodell">{ia.name}</span>}
      </div>
      {origin?.foreign && (
        <p className={`text-[10px] mb-1 ${c.muted}`}
          title="Das Objekt gibt es schon in einer anderen Domain — der Export und der Helper legen es nicht nochmals an.">
          aus <span className="font-mono">{origin.pkg}</span> — referenziert, wird nicht exportiert
        </p>
      )}
      {origin?.ambiguous && (
        <p className={`text-[10px] mb-1 flex items-start gap-1 ${warn}`}>
          <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
          <span>«{ia?.key}» gibt es in mehreren Projekten ({origin.ambiguous.join(', ')}) — wird als neues Objekt exportiert; prüfen.</span>
        </p>
      )}

      {!ia ? (
        <button onClick={create} disabled={!canEdit}
          title={`Eigenes Objekt mit In${meta.hasOut ? ' und Out' : ''} anlegen`}
          className={`w-full flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
          <Workflow size={11} /> Als {meta.label} beschreiben
        </button>
      ) : (
        <div className="space-y-1">
          {(['In', 'Out'] as const).filter(m => m === 'In' || meta.hasOut).map(m => {
            const t = types.find(x => x.id === (m === 'In' ? ia.inTypeId : ia.outTypeId));
            const fields = (t?.fields ?? []).filter(f => f.name);
            const known = ((m === 'In' ? entry?.inputs : entry?.outputs) ?? []).length;
            // A class without fields is a hint (yellow): the step then receives
            // or returns nothing — usually it is not finished yet
            // — except for the In of a signal or a message: that may be empty
            const leer = !!t && !fields.length && meta.hasOut;
            const what = m === 'In'
              ? 'was der Schritt bekommt'
              : kind === 'userTask' ? 'was die Person erfasst' : 'was der Schritt zurückgibt';
            return (
              <button key={m} onClick={() => openMember(m)} disabled={!canEdit && !t}
                title={t ? `${ia.name}.${m} — ${what}. Klick öffnet die Klasse im Datenmodell.` : known ? `${m} anlegen — ${known} Felder aus dem Katalog übernehmen` : `${m} anlegen — ${what}`}
                className={`w-full px-2 py-1.5 rounded border text-left ${leer ? warnBox : t ? c.border2 : `border-dashed ${c.border2}`} ${c.hover}`}>
                <div className="flex items-center gap-1.5">
                  <Braces size={10} className={`flex-shrink-0 ${leer ? warn : isDark ? 'text-sky-300' : 'text-sky-700'}`} />
                  <span className={`text-[11px] font-mono ${c.text}`}>{m}</span>
                  <span className={`text-[10px] ${leer ? warn : c.muted}`}>
                    {t ? (fields.length ? `${fields.length} Feld${fields.length === 1 ? '' : 'er'}` : 'keine Felder') : known ? `${known} aus dem Katalog übernehmen` : 'anlegen'}
                  </span>
                  <span className={`ml-auto text-[9px] ${c.muted}`}>{what}</span>
                  {t ? <ExternalLink size={10} className={`flex-shrink-0 ${c.muted}`} /> : <Plus size={10} className={`flex-shrink-0 ${c.muted}`} />}
                </div>
                {!!fields.length && (
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                    {fields.map(f => {
                      const ex = expectedFor(f, types, model);
                      const st = kindStyle(ex?.kind ?? 'scalar', isDark);
                      return (
                        <span key={f.id} className="flex items-center gap-0.5 text-[9px] font-mono min-w-0"
                          title={f.description ? `${f.name}: ${f.description}` : f.name}>
                          <span className={c.muted2}>{f.name}{f.optional ? '?' : ''}</span>
                          <span className={`flex items-center gap-0.5 px-1 py-px rounded border ${st.cls}`}>
                            {st.icon}<span className="truncate max-w-[8rem]">{ex?.label ?? f.type}</span>
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {leer && (
                  <p className={`text-[9px] mt-0.5 ${warn}`}>
                    Noch keine Felder — im Datenmodell ergänzen{known ? ` (${known} im Katalog)` : ''}.
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Service catalog ──────────────────────────────────────────────────────────
function ServicePicker({ step, spec, model, isDark, canEdit, onPatch, onSyncId, current }: {
  step: Step; spec: ProcessSpec; model: Model | null; isDark: boolean; canEdit: boolean; current: ServiceDef | null;
  onPatch: (id: string, patch: Partial<Step>) => void;
  /** update the ID to the (new) name — as after renaming in the field */
  onSyncId?: (id: string) => void;
}) {
  const c = cls(isDark);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Offer only matching entries: service task → workers (kind 'service'),
  // call activity → processes ('call'), send → signals/messages ('send'),
  // decision → ONLY DMNs ('rule', no services). Entries without kind
  // (legacy) count as workers.
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

  // Take over the prepared mapping — existing meanings are kept
  const apply = (svc: ServiceDef) => {
    const keep = (list: Mapping[] | undefined) => new Map((list ?? []).map(m => [m.name, m]));
    const oldIn = keep(step.inputs), oldOut = keep(step.outputs);
    // Variants of the new service: a chosen one stays if it exists there
    // too; the fields of the others do not come in as rows. «Alle»
    // for the inputs says that **this** worker decides itself — on a
    // change of service it no longer applies
    const next: Step = { ...step, serviceId: svc.id, topic: svc.topic ?? step.topic, calledProcess: svc.calledProcess ?? step.calledProcess };
    const variantState = (list: 'inputs' | 'outputs') => {
      const v = variantsOf(next, spec, model, list, svc);
      const was = step[variantKey(list)];
      const keepAll = was === ALL_VARIANTS && (list === 'outputs' || current?.id === svc.id);
      const name = v && typeof was === 'string' && (v.cases.some(x => x.name === was) || keepAll) ? was : null;
      return { v, name, chosen: { name, inferred: false, mixed: [] } as Chosen };
    };
    const vin = variantState('inputs'), vout = variantState('outputs');
    // a step without a name of its own is named like the service — likewise one that
    // still carries the name of the previously chosen one; a chosen name is left as it is
    const refOf = (s: ServiceDef) => s.calledProcess ?? s.topic ?? s.id;
    const prefixes = knownPrefixes(model, [spec.project]);
    const autoName = unnamed(step) || (!!current && step.name === nameFromService(refOf(current), prefixes));
    const name = autoName ? nameFromService(refOf(svc), prefixes) : null;
    const inParams = (svc.inputs ?? []).filter(pm => variantAllows(vin.v, vin.chosen, pm.name));
    const outParams = (svc.outputs ?? []).filter(pm => variantAllows(vout.v, vout.chosen, pm.name));
    // the same service chosen again: rows its catalog does not know stay —
    // an extension or a field the (older) catalog does not list yet
    const same = current?.id === svc.id;
    const extra = (list: Mapping[] | undefined, params: ServiceParam[]) =>
      (same ? list ?? [] : []).filter(m => !params.some(pm => pm.name === m.name));
    onPatch(step.id, {
      ...(name && name !== step.name ? { name } : {}),
      serviceId: svc.id,
      inVariant: vin.name ?? undefined,
      outVariant: vout.name ?? undefined,
      ...(svc.topic ? { topic: svc.topic } : {}),
      ...(svc.calledProcess ? { calledProcess: svc.calledProcess } : {}),
      // What was already entered stays: expression, meaning and the deselection
      inputs: inParams.map(pm => ({
        name: pm.name,
        expression: oldIn.get(pm.name)?.expression ?? feelIfPossible(pm.expression ?? ''),
        ...(oldIn.get(pm.name)?.description ?? pm.description ? { description: oldIn.get(pm.name)?.description ?? pm.description } : {}),
        ...(oldIn.get(pm.name)?.disabled ? { disabled: true } : {}),
      })).concat(extra(step.inputs, inParams)),
      outputs: outParams.map(pm => ({
        name: pm.name,
        expression: oldOut.get(pm.name)?.expression ?? feelIfPossible(pm.expression ?? ''),
        ...(oldOut.get(pm.name)?.description ? { description: oldOut.get(pm.name)!.description } : {}),
        ...(oldOut.get(pm.name)?.disabled ? { disabled: true } : {}),
      })).concat(extra(step.outputs, outParams)),
      ...(svc.handledErrors?.length
        ? { errors: [...(step.errors ?? []), ...svc.handledErrors.filter(code => !(step.errors ?? []).some(e => e.code === code)).map(code => ({ code }))] }
        : {}),
      status: 'changed' as Status,
    });
    // only after rendering is the new name in the specification
    if (name && name !== step.name) window.setTimeout(() => onSyncId?.(step.id), 0);
    setOpen(false); setQ('');
  };

  return (
    <div data-cframe={sub(stepTarget(step.id), 'service')}>
      <div className="flex items-center gap-2 mb-1">
        <h3 className={`text-[10px] uppercase tracking-widest ${c.text}`}>{step.kind === 'rule' ? 'Decision' : 'Service'}</h3>
        <CommentBubble target={sub(stepTarget(step.id), 'service')} />
      </div>
      <button disabled={!canEdit} onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 30); }}
        className={`w-full flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border text-left ${c.border2} ${canEdit ? c.hover : ''}`}>
        <span className={`flex-1 truncate font-mono ${current ? c.text : c.muted}`}>
          {/* a decision is named by its decisionId, a worker by its topic, a call by
              its process — the import only sets `calledProcess` there, no `serviceId` */}
          {step.serviceId ?? current?.id ?? (step.calledProcess ? `Prozess: ${step.calledProcess}`
            : step.topic ? `${step.kind === 'rule' ? 'decisionId' : 'Topic'}: ${step.topic}`
            : step.kind === 'rule' ? 'keine Entscheidung gewählt' : step.kind === 'call' ? 'kein Prozess gewählt' : 'kein Service gewählt')}
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

// ── small building blocks ─────────────────────────────────────────────────────────
// Inputs and outputs of a step: editable, and every row can be
// **deselected** or removed. A catalog service brings everything it
// can do — what this process does not need is deselected (stays visible)
// or deleted (comes back via «+ N aus Katalog»). A new sync
// does not restore deselected rows.
function MappingTable({ title, list, step, isDark, canEdit, service, reference, variables, refFields, domain, types, model, engine, implicitIn, fromPattern, patternTimes, patternName, variants, chosen, onVariant, onChange, onAdd, onRemove, onFill, onConvert }: {
  title: string; list: 'inputs' | 'outputs'; step: Step; isDark: boolean; canEdit: boolean;
  /** variants of the In or Out (enum with cases) — null: none */
  variants: Variants | null;
  chosen: Chosen;
  onVariant: (list: 'inputs' | 'outputs', name: string | null) => void;
  /** name → pattern: these rows are contributed by a pattern — implementation, hidden */
  fromPattern: Map<string, string>;
  /** how often the pattern brings a name itself — that many times it is not a duplicate */
  patternTimes: Map<string, number>;
  patternName: (id: string) => string;
  /** user task or custom worker: the In comes from the process variables, a mapping is not required */
  implicitIn: boolean;
  /** catalog entry — provides the meaning where the step has none of its own */
  service: ServiceDef | null;
  /** what the expression may see: process variables — for outputs first the result of the service */
  variables: VarNode[] | null;
  /** fields of the In or Out class — from them the expected type per row */
  refFields: Field[] | null;
  /** `<Objekt>.In` or `.Out` from the domain catalog — the yardstick without an own class */
  domain: DomainType | null;
  types: TypeDef[];
  model: Model | null;
  engine: EngineId | undefined;
  /** what the data model or the catalog knows — the mapping is measured against it */
  reference: { names: string[]; quelle: 'Modell' | 'Katalog' } | null;
  onChange: (list: 'inputs' | 'outputs', i: number, patch: Partial<Mapping>) => void;
  onAdd: (list: 'inputs' | 'outputs') => void;
  onRemove: (list: 'inputs' | 'outputs', i: number) => void;
  onFill: (list: 'inputs' | 'outputs') => void;
  /** translate JUEL leftovers of this table to FEEL */
  onConvert: (list: 'inputs' | 'outputs') => void;
}) {
  const c = cls(isDark);
  const all = step[list] ?? [];
  // Fields of other variants are hidden — without a choice only the common ones apply
  const allowed = (name: string) => variantAllows(variants, chosen, name);
  const hiddenByVariant = all.filter(m => !fromPattern.has(m.name) && !allowed(m.name)).length;
  // Inputs: the service expects exactly one case — the same rule as in findings.ts
  const needsChoice = !!variants && !chosen.name && !chosen.mixed.length && list === 'inputs' && !implicitIn && !fromPattern.size;
  // what a pattern contributes is not shown here — its parameters are on the pattern
  const rows = all.filter(m => !fromPattern.has(m.name) && allowed(m.name));
  const byPattern = all.filter(m => fromPattern.has(m.name));
  const byPatternNames = [...new Set(byPattern.map(m => patternName(fromPattern.get(m.name)!)))];
  // JUEL from an older state: whatever can be translated gets the button at the top
  const juelRows = rows.filter(m => !m.disabled && isJuel(m.expression));
  const convertible = juelRows.filter(m => importExpression(m.expression) !== m.expression).length;
  const active = rows.filter(m => !m.disabled).length;
  /** row whose removal is about to be confirmed */
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  // What the fields mean — explained on hover, because for inputs and
  // outputs the reading direction differs: for inputs «name» is the
  // parameter of the service and the expression comes from the process, for
  // outputs «name» is the process variable and the expression the source.
  const hint = list === 'inputs'
    ? {
        section: 'Eingaben: was der Schritt beim Aufruf bekommt — je Zeile ein Parameter des Services (In) und der Wert dazu aus dem Prozess.',
        name: 'Input-Variablen-Name: so heisst der Parameter beim Service (Feld im In).',
        expression: 'Wert der Eingabe: FEEL-Ausdruck auf den Prozessvariablen, z. B. = clientKey.',
      }
    : {
        section: 'Ausgaben: was der Schritt in den Prozess zurückschreibt — je Zeile eine Prozessvariable und ihre Quelle im Ergebnis.',
        name: 'Output-Variablen-Name: so heisst die Prozessvariable, in die der Wert geschrieben wird.',
        expression: 'Quelle der Ausgabe: Ausdruck auf dem Ergebnis des Services — dessen Out-Felder stehen direkt bereit, z. B. = accountId.',
      };
  const descrHint = 'Fachliche Bedeutung des Feldes für die Stakeholder — landet in der Spezifikation und im Export.';
  // The catalog knows the meaning of the fields (from the OpenAPI schemas).
  // Where the step has none of its own, it is shown as a suggestion in the field — it
  // is not stored as long as nobody takes it over.
  const fromCatalog = new Map((service?.[list] ?? []).map(p => [p.name, p.description]));
  const vorhanden = new Set(all.map(m => m.name));
  // in addition, what the domain lists in the In (`inConfig`, mocks) — as in findings.ts; only for the catalog, the model knows its In itself
  const bekannt = reference ? new Set([...reference.names, ...(list === 'inputs' && reference.quelle === 'Katalog' ? domainInputNames(domain, model) : [])]) : null;
  const fehlend = reference ? reference.names.filter(n => !vorhanden.has(n)).length : 0;
  // Rows the model or the catalog does not know: an **extension**
  // that is still missing there — or a field that no longer exists. Both are
  // a warning, not an error: as soon as the field is in the model, the row
  // is fine without further ado.
  // For outputs the name is the **new** process variable — it may be
  // named as it likes; only inputs are measured against the In of the service
  // a general variable (`_idempotentId` …) is accepted by every worker — not an extension
  const unbekannt = (name: string) => !!bekannt && !!name && !bekannt.has(name) && !GENERAL_VARIABLES.has(name);
  const verwaist = list === 'inputs' ? rows.filter(m => unbekannt(m.name)).length : 0;
  const { warn, warnBox, err, errBox } = tones(isDark);
  // The same name twice: the second row would overwrite the first — in the
  // BPMN as in the export. Deselected rows do not count, they do not occur.
  const zaehler = new Map<string, number>();
  for (const m of all) if (m.name && !m.disabled) zaehler.set(m.name, (zaehler.get(m.name) ?? 0) + 1);
  const doppelt = new Set([...zaehler].filter(([name, n]) => n > (patternTimes.get(name) ?? 1)).map(([name]) => name));
  // Required: the field of the In class is not optional — or the catalog
  // says `required`. The service must receive a required field; the row
  // can therefore be neither deselected nor removed.
  const pflichtGrund = (name: string): string | null => {
    if (list !== 'inputs' || !name || implicitIn || !allowed(name)) return null;
    // Switches of the decoder: one is enough — required is the only active one, without an active one the first
    const routing = variants?.routing;
    if (routing?.includes(name)) {
      const on = routing.filter(n => all.some(m => m.name === n && !m.disabled));
      return (on.length ? on.length === 1 && on[0] === name : routing[0] === name)
        ? `Pflicht: ${routingText(routing)} — eines davon wählt die Ausprägung` : null;
    }
    if (!variantRequires(variants, chosen, name)) return null;
    if (refFields) {
      const f = refFields.find(x => x.name === name);
      return f && !f.optional ? `Pflichtfeld: «${name}» ist im In nicht optional` : null;
    }
    const dom = domainRequired(domain, name);
    if (dom != null) return dom ? `Pflichtfeld: «${name}» ist in ${domain?.name} nicht optional` : null;
    const p = service?.inputs?.find(x => x.name === name);
    return p?.required ? `Pflichtfeld: «${name}» ist laut Katalog erforderlich` : null;
  };
  // if a pattern defines the call, no required field is missing
  const pflichtFehlt = reference && !(list === 'inputs' && byPattern.length)
    ? reference.names.filter(n => pflichtGrund(n) && !all.some(m => m.name === n && !m.disabled))
    : [];

  // Expand and collapse, remembered per table; empty = collapsed, and whatever is added expands it
  const sectionKey = `orch-spec.section.${list}`;
  const [open, setOpen] = useState<boolean>(() => {
    try { const v = localStorage.getItem(sectionKey); if (v != null) return v === '1'; } catch { /* ignore */ }
    return rows.length > 0;
  });
  const prevRows = useRef(rows.length);
  useEffect(() => { if (rows.length > prevRows.current && !open) setOpen(true); prevRows.current = rows.length; }, [rows.length, open]);
  const toggle = () => setOpen(o => { try { localStorage.setItem(sectionKey, o ? '0' : '1'); } catch { /* ignore */ } return !o; });
  if (!rows.length && !byPattern.length && !canEdit) return null;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <button onClick={toggle} title={hint.section}
          className={`flex items-center gap-1 text-[10px] uppercase tracking-widest ${c.text} hover:underline`}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{title}
          <span className={`normal-case tracking-normal ${rows.length ? c.muted2 : c.muted}`}>
            {!rows.length ? 0 : active === rows.length ? rows.length : `${active} von ${rows.length}`}
          </span>
        </button>
        {canEdit && (
          <div className="ml-auto flex items-center gap-2">
            {convertible > 0 && (
              <button onClick={() => onConvert(list)}
                title="JUEL aus einem älteren Stand nach FEEL übersetzen — dieselbe Übersetzung wie beim Import"
                className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${isDark ? 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10' : 'border-amber-400 text-amber-700 hover:bg-amber-50'}`}>
                {convertible} JUEL → FEEL
              </button>
            )}
            {fehlend > 0 && (
              <button onClick={() => onFill(list)}
                title={`${fehlend} Feld(er) aus dem ${reference?.quelle} übernehmen`}
                className={`text-[10px] ${c.muted} hover:underline`}>
                + {fehlend} aus {reference?.quelle}
              </button>
            )}
            <button onClick={() => onAdd(list)}
              title={reference ? `Feld ergänzen, das im ${reference.quelle} noch fehlt (Erweiterung) — bleibt als Warnung markiert, bis es dort steht` : 'Feld ergänzen'}
              className={`text-[10px] ${c.muted} hover:underline`}>
              + Feld
            </button>
          </div>
        )}
      </div>
      {variants && (
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className={`text-[10px] ${c.muted}`} title={`${list === 'inputs' ? 'Das In' : 'Das Out'} ist ein enum mit Fällen — der Service ${list === 'inputs' ? 'bekommt' : 'liefert'} genau einen davon; bei «alle Ausprägungen» entscheidet ${list === 'inputs' ? 'der Worker beim Unmarshalling' : 'er'}, welchen.`}>
            Ausprägung
          </span>
          <select value={chosen.name ?? ''} disabled={!canEdit}
            onChange={e => onVariant(list, e.target.value || null)}
            title={needsChoice ? 'Der Service erwartet eine Ausprägung — ohne Wahl bekommt er keine. Unterstützt der Worker mehrere: «alle Ausprägungen».' : undefined}
            className={`text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input} ${needsChoice ? warnBox : ''}`}>
            <option value="">— nur gemeinsame Felder —</option>
            {/* Outputs: the service returns one case — which one, it decides: the outputs may read all of them.
                Inputs: the worker supports several cases and decides on unmarshalling */}
            {!chosen.runtime && <option value={ALL_VARIANTS}>— alle Ausprägungen{list === 'inputs' ? ' (Worker entscheidet)' : ''} —</option>}
            {/* the switch picks the case only at runtime — detected, not selectable */}
            {chosen.runtime && <option value={ALL_VARIANTS} disabled>— zur Laufzeit über {chosen.runtime} —</option>}
            {variants.cases.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          {chosen.inferred && <span className={`text-[10px] ${c.muted}`} title="Nicht gewählt, sondern aus den aktiven Zeilen erkannt">erkannt</span>}
          {!!hiddenByVariant && !chosen.mixed.length && (
            <span className={`text-[10px] ${c.muted}`}>· {hiddenByVariant} Feld{hiddenByVariant === 1 ? '' : 'er'} anderer Ausprägungen ausgeblendet</span>
          )}
        </div>
      )}
      {/* the same warning as in findings.ts — here, where it can be fixed */}
      {needsChoice && (
        <p className={`text-[10px] mb-1 ${warn}`}>{noVariantText(variants!)}</p>
      )}
      {!!chosen.mixed.length && (
        <p className={`text-[10px] mb-1 ${warn}`}>
          Aktive Zeilen aus mehreren Ausprägungen ({chosen.mixed.join(', ')}) — der Service {list === 'inputs' ? 'bekommt' : 'liefert'} nur eine. Ausprägung wählen; die übrigen werden abgewählt — oder «alle Ausprägungen», wenn {list === 'inputs' ? 'der Worker beim Unmarshalling' : 'der Service'} entscheidet.
        </p>
      )}
      {!!byPattern.length && (
        <p className={`text-[10px] mb-1 ${c.muted}`} title={byPattern.map(m => m.name).join(', ')}>
          {byPattern.length} {list === 'inputs' ? (byPattern.length === 1 ? 'Eingabe' : 'Eingaben') : (byPattern.length === 1 ? 'Ausgabe' : 'Ausgaben')} vom
          Pattern {byPatternNames.map(n => `«${n}»`).join(', ')} — Implementation, hier ausgeblendet.
        </p>
      )}
      {!!verwaist && (
        <p className={`text-[10px] mb-1 ${warn}`}>
          {verwaist} Zeile{verwaist === 1 ? '' : 'n'} noch nicht im {reference?.quelle} — Erweiterung, dort nachziehen.
        </p>
      )}
      {!!doppelt.size && (
        <p className={`text-[10px] mb-1 ${err}`}>
          Doppelt: {[...doppelt].map(n => `«${n}»`).join(', ')} — jeder Name nur einmal{[...doppelt].some(n => fromPattern.has(n)) ? ' (vom Pattern ausgeblendet — im Diagramm bereinigen)' : ''}.
        </p>
      )}
      {!!pflichtFehlt.length && (
        <p className={`text-[10px] mb-1 ${err}`}>
          Pflichtfeld{pflichtFehlt.length === 1 ? '' : 'er'} {pflichtFehlt.map(n => `«${n}»`).join(', ')} fehl{pflichtFehlt.length === 1 ? 't' : 'en'} — der Service braucht {pflichtFehlt.length === 1 ? 'es' : 'sie'}.
        </p>
      )}
      {open && <div className="space-y-1">
        {all.map((m, i) => {
          if (fromPattern.has(m.name) || !allowed(m.name)) return null;
          const off = !!m.disabled;
          const fehlt = list === 'inputs' && unbekannt(m.name);
          const dupl = !off && doppelt.has(m.name);
          const pflicht = pflichtGrund(m.name);
          // A duplicate is an error (red), an extension only a warning (yellow)
          const problem = dupl
            ? `«${m.name}» kommt mehrmals vor — jeder Name nur einmal; eine Zeile umbenennen oder abwählen.`
            : !off && list === 'inputs' && !refFields && m.name === inConfigField(domain) ? inConfigWarning(m.name)
            : fehlt ? `«${m.name}» steht noch nicht im ${reference?.quelle} — Erweiterung: dort ergänzen, dann ist die Zeile in Ordnung. Oder hier entfernen.` : undefined;
          // FEEL (Camunda 8): `= …` is checked while typing — syntax, paths, type
          // Expected type: the own class first, otherwise the domain catalog
          const expected = refFields
            ? expectedFor(refFields.find(f => f.name === m.name), types, model)
            : expectedFromDomain(domain, m.name, model);
          const feel = !off && isFeel(m.expression) ? checkFeel(m.expression, variables, expected) : null;
          const feelIssues: FeelIssue[] = [
            ...(pflicht && off ? [{ level: 'error' as const, text: `${pflicht} — abgewählt bekommt der Service es nicht. Wieder anwählen.` }] : []),
            // a parameter (not a `camunda:in` on the subprocess) can carry JSON as a script
            ...(feel ? [...feel.issues, ...juelIssues(m.expression, engine, step.kind !== 'call')] : []),
            // a script from the BPMN (Groovy): described, not translated
            ...(!off && isScriptValue(m.expression) ? [{ level: 'warn' as const, text: scriptWarning(engine) }] : []),
            // JUEL the import could not translate — stays until someone writes it as FEEL
            ...(!off && !feel && !isScriptValue(m.expression) && isJuel(m.expression)
              ? [{ level: 'warn' as const, text: importExpression(m.expression) !== m.expression
                  ? 'JUEL aus einem älteren Stand — «JUEL → FEEL» oben übersetzt es.'
                  : 'JUEL, nicht nach FEEL übersetzbar — als «= …» schreiben; bis dahin geht es unverändert ins BPMN.' }]
              : []),
          ];
          const feelOk = feel && !feel.issues.some(i => i.level === 'error');
          const box = dupl || feelIssues.some(i => i.level === 'error') ? errBox : fehlt || feelIssues.length ? warnBox : c.border2;
          const mark = dupl ? err : warn;
          return (
            // Key only by position: a key containing the name would
            // rebuild the row on every keystroke — and lose the focus.
            <div key={i}
              title={problem}
              data-cframe={m.name ? sub(stepTarget(step.id), `${list === 'inputs' ? 'in' : 'out'}:${m.name}`) : undefined}
              className={`group px-2 py-1.5 rounded border ${box} ${off ? 'opacity-45' : ''}`}>
              {/* Finding on the FEEL expression — above the field, so it stays in view while typing */}
              {feelIssues.map((it, k) => (
                <p key={k} className={`text-[10px] mb-1 flex items-start gap-1 ${it.level === 'error' ? err : warn}`}>
                  <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{it.text}</span>
                </p>
              ))}
              <div className="flex items-center gap-1.5">
                <input type="checkbox" checked={!off} disabled={!canEdit || (!!pflicht && !off)}
                  title={pflicht && !off ? `${pflicht} — lässt sich nicht abwählen` : off ? 'kommt in diesem Prozess nicht vor' : 'wird verwendet — abwählen, wenn nicht gebraucht'}
                  onChange={e => onChange(list, i, { disabled: e.target.checked ? undefined : true })}
                  className="flex-shrink-0" />
                <input value={m.name} disabled={!canEdit || off}
                  onChange={e => onChange(list, i, { name: e.target.value })}
                  placeholder="name"
                  title={pflicht ? `${hint.name}\n\n${pflicht} — weder abwählen noch entfernen.` : hint.name}
                  className={`flex-[2] min-w-[7rem] text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input} ${off ? 'line-through' : ''}`} />
                {pflicht && (
                  <span title={`${pflicht} — weder abwählen noch entfernen.`}
                    className={`flex-shrink-0 -ml-1 ${off ? err : c.muted}`}>
                    <Asterisk size={10} />
                  </span>
                )}
                {expected && <ExpectedChip expected={expected} list={list} isDark={isDark} />}
                <FeelInput value={m.expression} disabled={!canEdit || off} isDark={isDark}
                  variables={variables}
                  onChange={v => onChange(list, i, { expression: v })}
                  placeholder={list === 'inputs' ? 'Ausdruck / Variable' : 'Quelle'}
                  title={[
                    hint.expression,
                    feelOk && feel?.result ? `FEEL gültig · Ergebnis: ${FEEL_TYPE_LABEL[feel.result]}` : '',
                    m.expression ? `Aktuell: ${m.expression}` : '',
                  ].filter(Boolean).join('\n\n')}
                  className="flex-[3] min-w-0" />
                {feel && <ResultChip feel={feel} expected={expected} isDark={isDark} />}
                {problem && <AlertTriangle size={10} className={`flex-shrink-0 ${mark}`} />}
                {m.name && <CommentBubble target={sub(stepTarget(step.id), `${list === 'inputs' ? 'in' : 'out'}:${m.name}`)} quiet />}
                {/* Removing always works. A field of the yardstick comes back any time via
                    «+ N aus Modell/Katalog» — deselecting is
                    the gentler variant if it should stay visible. */}
                {canEdit && !pflicht && confirmRemove !== i && (
                  <button onClick={() => setConfirmRemove(i)}
                    title={reference && !fehlt ? `Zeile entfernen — steht danach unter «+ aus ${reference.quelle}» wieder bereit` : 'Zeile entfernen'}
                    className={`p-0.5 flex-shrink-0 ${c.muted}`}><Trash2 size={10} /></button>
                )}
                {/* Confirmation directly in the row — only «Ja» removes */}
                {canEdit && confirmRemove === i && (
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <span className={`text-[10px] ${err}`}>Entfernen?</span>
                    <button onClick={() => { setConfirmRemove(null); onRemove(list, i); }}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold text-white ${isDark ? 'bg-rose-500 hover:bg-rose-400' : 'bg-rose-600 hover:bg-rose-500'}`}>
                      Ja
                    </button>
                    <button onClick={() => setConfirmRemove(null)} title="Abbrechen"
                      className={`p-0.5 ${c.muted}`}><X size={10} /></button>
                  </span>
                )}
              </div>
              <input value={m.description ?? ''} disabled={!canEdit || off}
                onChange={e => onChange(list, i, { description: e.target.value || undefined })}
                placeholder={fromCatalog.get(m.name) || 'fachliche Bedeutung'}
                title={fromCatalog.get(m.name) ? `${descrHint}\n\nLaut Katalog: ${fromCatalog.get(m.name)}` : descrHint}
                className={`mt-1 w-full text-[10px] px-1.5 py-0.5 rounded border outline-none ${c.input}`} />
            </div>
          );
        })}
      </div>}
    </div>
  );
}

/** Colour and symbol per kind of type — the same as the type chips in the data model. */
function kindStyle(kind: ExpectedType['kind'], isDark: boolean): { cls: string; icon: React.ReactNode; what: string } {
  const ico = (I: typeof Braces) => <I size={9} className="flex-shrink-0" />;
  switch (kind) {
    case 'enum': return { icon: ico(ListOrdered), what: 'Enum',
      cls: isDark ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-violet-300 bg-violet-50 text-violet-800' };
    case 'class': return { icon: ico(Braces), what: 'Klasse',
      cls: isDark ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-sky-300 bg-sky-50 text-sky-800' };
    case 'list': return { icon: ico(List), what: 'Liste',
      cls: isDark ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' : 'border-indigo-300 bg-indigo-50 text-indigo-800' };
    case 'map': return { icon: ico(Braces), what: 'Map',
      cls: isDark ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-teal-300 bg-teal-50 text-teal-800' };
    default: return { icon: null, what: 'Wert',
      cls: isDark ? 'border-white/10 text-white/50' : 'border-black/10 text-black/50' };
  }
}

/**
 * Expected type of the row — what the field of the In/Out class (or the catalog)
 * demands. Shown next to the name, so it is clear what the expression must return.
 */
function ExpectedChip({ expected, list, isDark }: { expected: ExpectedType; list: 'inputs' | 'outputs'; isDark: boolean }) {
  const st = kindStyle(expected.kind, isDark);
  const soll = expected.accepts.filter(t => t !== 'nil').map(t => FEEL_TYPE_LABEL[t]).join(' oder ');
  const optional = expected.accepts.includes('nil') ? ' · optional' : '';
  return (
    <span title={`${st.what} ${expected.label}${optional} — ${list === 'inputs' ? 'so erwartet es der Service' : 'so ist die Prozessvariable definiert'}.\nDer Ausdruck muss ${soll} liefern.`}
      className={`flex-shrink-0 max-w-[9rem] truncate flex items-center gap-0.5 text-[9px] font-mono px-1 py-px rounded border ${st.cls}`}>
      {st.icon}<span className="truncate">{expected.label}</span>
    </span>
  );
}

/**
 * What the FEEL expression returns — evaluated with example values. Green if
 * it matches the expected type, red if not; grey without a yardstick. No chip if
 * the expression cannot be evaluated — then the finding is shown above it.
 */
function ResultChip({ feel, expected, isDark }: { feel: FeelCheck; expected: ExpectedType | null; isDark: boolean }) {
  if (!feel.result || feel.issues.some(i => i.level === 'error')) return null;
  const fits = expected ? expected.accepts.includes(feel.result) : null;
  const cls = fits === true
    ? (isDark ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-800')
    : fits === false
      ? (isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700')
      : (isDark ? 'border-white/10 text-white/50' : 'border-black/10 text-black/50');
  const title = `FEEL gültig · Ergebnis: ${FEEL_TYPE_LABEL[feel.result]}${
    fits === true ? ' — passt zum Feld' : fits === false ? ` — das Feld erwartet ${expected!.label}` : ' — kein Solltyp bekannt'}`;
  return (
    <span title={title} className={`flex-shrink-0 text-[9px] px-1 py-px rounded border ${cls}`}>
      {FEEL_TYPE_LABEL[feel.result]}
    </span>
  );
}

/**
 * Collapsible section with a counter. Collapsed when it is empty; open when
 * there is something in it — and the person's choice is remembered per section.
 * If something is added (the counter goes up), it opens.
 */
function Section({ id, label, count, isDark, action, hint, children, comment, openFor }: {
  id: string; label: string; count?: number; isDark: boolean;
  action?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode;
  /** Comment location of the section — speech bubble and frame */
  comment?: string;
  /** locations inside it (prefix): if the open comment is there, the section expands */
  openFor?: string;
}) {
  const c = cls(isDark);
  const key = `orch-spec.section.${id}`;
  const n = count ?? 0;
  const [open, setOpen] = useState<boolean>(() => {
    try { const v = localStorage.getItem(key); if (v != null) return v === '1'; } catch { /* ignore */ }
    return n > 0;
  });
  const prev = useRef(n);
  useEffect(() => { if (n > prev.current && !open) setOpen(true); prev.current = n; }, [n, open]);
  const toggle = () => setOpen(o => { try { localStorage.setItem(key, o ? '0' : '1'); } catch { /* ignore */ } return !o; });
  // When going through the comments: a location in a collapsed
  // section would not be visible — so expand it (without remembering it)
  const aktiv = useActiveComment();
  const betrifft = !!aktiv && ((!!comment && aktiv === comment) || (!!openFor && aktiv.startsWith(openFor)));
  useEffect(() => { if (betrifft) setOpen(true); }, [betrifft, aktiv]);
  return (
    <div data-cframe={comment}>
      <div className="flex items-center gap-2 mb-1">
        <button onClick={toggle} title={open ? 'einklappen' : 'aufklappen'}
          className={`flex items-center gap-1 text-[10px] uppercase tracking-widest ${c.text} hover:underline`}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {label}
          {count != null && <span className={`normal-case tracking-normal ${n ? c.muted2 : c.muted}`}>{n}</span>}
        </button>
        {comment && <CommentBubble target={comment} />}
        {hint}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {open && children}
    </div>
  );
}

function Field({ label, children, isDark, action, comment }: {
  label: string; children: React.ReactNode; isDark: boolean; action?: React.ReactNode;
  /** Comment location of this section — speech bubble next to the heading */
  comment?: string;
}) {
  const c = cls(isDark);
  return (
    <div data-cframe={comment}>
      <div className="flex items-center gap-2 mb-1">
        <h3 className={`text-[10px] uppercase tracking-widest ${c.text}`}>{label}</h3>
        {comment && <CommentBubble target={comment} />}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </div>
  );
}

const TIMER_KIND_LABEL: Record<TimerSpec['kind'], string> = { duration: 'Dauer', date: 'Zeitpunkt', cycle: 'Zyklus' };

/**
 * The timer of an event or boundary event: how long or when. Usually
 * a variable (`= timerEscalationCancel`) — it goes into `InConfig` as a constant with
 * its default, so it can be set per environment or in the test. If the
 * boundary event belongs to a pattern (`lockedBy`), the pattern sets
 * the timer — only the default remains here.
 */
function TimerSection({ timer, spec, isDark, canEdit, lockedBy, onChange }: {
  timer: TimerSpec | undefined; spec: ProcessSpec; isDark: boolean; canEdit: boolean;
  lockedBy?: string;
  onChange: (timer: TimerSpec) => void;
}) {
  const c = cls(isDark);
  const t: TimerSpec = timer ?? { kind: 'duration', expression: '' };
  const name = timerVariable(t);
  const own = name ? (spec.types ?? []).find(x => x.inConfig)?.fields?.find(f => f.name === name) : undefined;
  const input = `text-[11px] px-2 py-1 rounded border outline-none font-mono ${c.input}`;
  return (
    <div className="space-y-1.5">
      <div className={`text-[10px] uppercase tracking-widest ${c.text}`}>Timer</div>
      <div className="flex items-center gap-1.5">
        <select value={t.kind} disabled={!canEdit || !!lockedBy} onChange={e => onChange({ ...t, kind: e.target.value as TimerSpec['kind'] })}
          title="Dauer (timeDuration), Zeitpunkt (timeDate) oder Zyklus (timeCycle)" className={input}>
          {(Object.keys(TIMER_KIND_LABEL) as TimerSpec['kind'][]).map(k => <option key={k} value={k}>{TIMER_KIND_LABEL[k]}</option>)}
        </select>
        <input value={t.expression} disabled={!canEdit || !!lockedBy} onChange={e => onChange({ ...t, expression: e.target.value })}
          placeholder="= timerWait — eine Variable aus dem InConfig"
          title={lockedBy ? `Setzt das Pattern «${lockedBy}»` : 'Mit = eine Variable bzw. ein FEEL-Ausdruck, sonst fester Wert (ISO 8601, z. B. P7D)'}
          className={`flex-1 min-w-0 ${input}`} />
      </div>
      {name && (
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] ${c.muted} flex-shrink-0`}>Vorgabe im InConfig</span>
          {own
            ? <span className={`text-[10px] font-mono ${c.muted2}`} title="Steht schon im eigenen InConfig — dort pflegen">{own.default ? `${name} = ${own.default}` : name} (eigenes Feld)</span>
            : <input value={t.default ?? ''} disabled={!canEdit} onChange={e => onChange({ ...t, default: e.target.value || undefined })}
                placeholder={t.kind === 'duration' ? 'z. B. P7D' : t.kind === 'date' ? 'z. B. 2026-12-31T08:00:00Z' : 'z. B. R3/PT1H'}
                title={`Konstante «${name}» im InConfig — der Export schreibt sie mit dieser Vorgabe`}
                className={`w-40 ${input}`} />}
        </div>
      )}
      <p className={`text-[10px] ${c.muted}`}>
        {name
          ? <>Der Timer liest <span className="font-mono">{name}</span> — eine Konstante im InConfig; im Test lässt sie sich verkürzen.</>
          : t.expression.trim()
            ? 'Fester Wert — besser eine Variable (= timerWait) mit dieser Vorgabe im InConfig.'
            : 'Noch kein Wert — eine Variable setzen, z. B. = timerWait.'}
      </p>
    </div>
  );
}

/** The two paths of the gateway (businessKey / processInstanceId) — one is chosen; the docs (export) show the call */
function CorrelationChoice({ corr, engine, isDark, disabled, onChoose }: {
  corr: MessageCorrelation; engine?: EngineId; isDark: boolean; disabled: boolean; onChoose: (key: string) => void;
}) {
  const c = cls(isDark);
  const { warn, err } = tones(isDark);
  return (
    <>
      {/* the two paths of the gateway — one is chosen; the docs (export) show the call */}
      <div className="flex items-center gap-2 text-[10px]">
        <span className={`${c.muted} w-24 flex-shrink-0`}>Korrelation</span>
        <div className="flex gap-1">
          {(['businessKey', 'processInstanceId'] as const).map(choice => (
            <button key={choice} disabled={disabled}
              onClick={() => onChoose(CORRELATION_KEY[choice])}
              title={engine === 'c8'
                ? `Korrelationsschlüssel ${CORRELATION_KEY[choice]} — gesendet wird mit ${choice}`
                : `${C7_LABEL} korreliert direkt über ${choice} — die Wahl gilt für die Doku und die Umstellung auf ${C8_LABEL} (${CORRELATION_KEY[choice]})`}
              className={`px-2 py-0.5 rounded border font-mono ${corr.choice === choice
                ? (isDark ? 'border-indigo-400/60 bg-indigo-500/20 text-indigo-200' : 'border-indigo-400 bg-indigo-50 text-indigo-700')
                : `${c.border2} ${c.muted2}`} ${disabled ? 'cursor-default' : ''}`}>
              {choice}
            </button>
          ))}
        </div>
      </div>
      {!corr.choice && corr.expression && (
        <Row label="" isDark={isDark}>im Diagramm: <span className="font-mono">{corr.expression}</span></Row>
      )}
      {corr.missing && (
        <p className={`text-[10px] flex items-start gap-1 ${warn}`}>
          <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
          <span>Noch nicht gewählt — ohne Korrelationsschlüssel findet die Nachricht in {C8_LABEL} keine wartende Instanz.</span>
        </p>
      )}
      {corr.misnamed && (
        <p className={`text-[10px] flex items-start gap-1 ${err}`}>
          <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
          <span><span className="font-mono">processInstanceKey</span> ist der alte Name — der InitWorker setzt heute <span className="font-mono">processInstanceId</span>. So bleibt der Schlüssel leer und das Event erzeugt einen Incident: «processInstanceId» wählen.</span>
        </p>
      )}
      {corr.fixed && (
        <p className={`text-[10px] flex items-start gap-1 ${warn}`}>
          <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
          <span>Fester Wert — alle Instanzen warten auf denselben Schlüssel. Einen der beiden Wege wählen.</span>
        </p>
      )}
    </>
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
