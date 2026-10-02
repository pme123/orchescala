// Detailspalte: alles zu einem Schritt — fachlich oben, technisch darunter.
//
// Hier hängt auch die **Service-Auswahl mit vorbereitetem Mapping**: ein
// Klick auf einen Katalog-Eintrag setzt Topic und übernimmt die Ein-/Ausgaben
// des element-templates als Vorlage; bereits gepflegte Bedeutungen bleiben.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Asterisk, ShieldCheck, Braces, ChevronDown, ChevronRight, ExternalLink, GitFork, List, ListOrdered, Plug, Plus, Puzzle, Repeat, Search, Trash2, Unlink, Workflow, X, Zap } from 'lucide-react';
import { marked } from 'marked';
import type { AppliedPattern, DomainType, EngineId, Field, Interaction, Mapping, Model, PatternDef, ProcessSpec, ServiceDef, Status, Step, TypeDef } from '../types';
import { INTERACTION_META, STATUSES, STATUS_META } from '../types';
import { catalogEntry, createMemberType, interactionKind, interactionOrigin, suggestName, withOrigin } from '../interactions';
import { packageOf } from '../scala';
import { KIND_LABEL, cls, patternTone } from '../ui';
import { PROCESS_TARGET, patternMappings, patternParamsFor, patternsFor, stepTags } from '../patterns';
import { GENERAL_VARIABLES, blockIndex, blockStart, isInitWorker, isServiceWorker, mockField } from '../bpmn';
import { FEEL_TYPE_LABEL, checkFeel, conditionExpected, domainRequired, expectedFor, expectedFromDomain, isFeel, multiInstanceScopes, processVariables, resultVariables, stepDomainMember, withMultiInstance, type ExpectedType, type FeelCheck, type FeelIssue, type VarNode } from '../feel';
import { NEW_REGEX, handledErrorIssue, isScriptValue, newErrorCode, regexIssue, scriptWarning, stepFindings } from '../findings';
import { feelBody, feelToJuel } from '../feelJuel';
import { feelIfPossible, importExpression, isJuel } from '../juelFeel';
import FeelInput from './FeelInput';
import { CommentBubble, useActiveComment } from './Comments';
import { useConfirm } from './Confirm';
import { processTarget, stepTarget, sub } from '../comments';
import { knownPrefixes, nameFromService, splitPrefix, unnamed } from '../stepIds';
import { ALL_VARIANTS, chosenVariant, classFieldsOf, rowsForVariant, variantAllows, variantKey, variantsOf, type Chosen, type Variants } from '../variants';
import { uid } from '../util';

interface Props {
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
  /** Pattern einfügen, entfernen, Werte ändern — schreibt direkt ins BPMN; `null` = am Prozess */
  onPattern?: (targetId: string | null, patternId: string, action: 'add' | 'remove' | 'update', params?: Record<string, string>, previous?: Record<string, string>) => void;
  /** liegt ein Diagramm vor? Ohne es gibt es nichts, wo ein Pattern hinkäme */
  hasDiagram?: boolean;
}

// Breite, Rand und Hintergrund kommen von der rechten Spalte — hier nur Inhalt.
export default function StepDetail(p: Props) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {p.step ? <StepPanel {...p} step={p.step} /> : <SpecPanel {...p} />}
    </div>
  );
}

/**
 * Die Spezifikation spricht FEEL, auch für Camunda 7 — dort übersetzt der
 * Export nach JUEL. Was kein JUEL-Gegenstück hat, soll man beim Tippen
 * erfahren, nicht erst beim Export.
 */
/** Farben für Warnung (gelb) und Fehler (rot) — Text und Rahmen. */
const tones = (isDark: boolean) => ({
  warn: isDark ? 'text-amber-400' : 'text-amber-600',
  warnBox: isDark ? 'border-amber-500/40 bg-amber-500/5' : 'border-amber-400 bg-amber-50',
  err: isDark ? 'text-rose-400' : 'text-rose-600',
  errBox: isDark ? 'border-rose-500/50 bg-rose-500/5' : 'border-rose-400 bg-rose-50',
});

function juelIssues(expression: string, engine: EngineId | undefined): FeelIssue[] {
  if (engine === 'c8') return [];
  const body = feelBody(expression);
  if (body == null) return [];
  const r = feelToJuel(body);
  return r.ok ? [] : [{ level: 'warn', text: `Für Camunda 7 nicht nach JUEL übersetzbar (${r.reason}) — beim Export bleibt das FEEL stehen.` }];
}

// ── Prozess-Ebene (kein Schritt gewählt) ─────────────────────────────────────
function SpecPanel({ spec, isDark, canEdit, onSpecChange, projectPrefixes, onRenameProject, model, onPattern, hasDiagram }: Props) {
  const c = cls(isDark);
  return (
    <div className="p-4 space-y-4">
      <h2 className={`text-[10px] uppercase tracking-widest ${c.text}`}>Prozess</h2>
      {onRenameProject && (
        <ProjectPicker spec={spec} isDark={isDark} canEdit={canEdit}
          prefixes={projectPrefixes ?? []} onRename={onRenameProject} />
      )}
      <Field label="Ausgangslage / Ziel (Markdown)" isDark={isDark} comment={sub(processTarget, 'description')}>
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
      <PatternSection target={null} spec={spec} model={model} isDark={isDark} canEdit={canEdit}
        onPattern={onPattern} hasDiagram={hasDiagram} />
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

// ── Schritt-Ebene ────────────────────────────────────────────────────────────
function StepPanel({ step, spec, isDark, canEdit, model, onPatch, onSyncId, onClose, onGoto, onSpecChange, onEditType, onPattern, hasDiagram }: Props & { step: Step }) {
  const confirm = useConfirm();
  const c = cls(isDark);
  const { warn, warnBox, err, errBox } = tones(isDark);
  const [preview, setPreview] = useState(false);
  // Ein aus dem BPMN gelesener Schritt trägt oft kein Template, aber ein
  // Topic — und im OpenAPI-Katalog **ist** das Topic die Kennung. Deshalb
  // beide Wege probieren, sonst bleibt der Eintrag ungenutzt.
  // Der Init-Worker nicht: sein Topic ist der Prozess, und dessen Eintrag
  // beschreibt den Aufruf des Prozesses (In/Out), nicht den Init-Worker —
  // der liest das In aus den Prozessvariablen und liefert das InitIn.
  const initWorker = isInitWorker(step, spec.processId);
  // Schritt im Block eines Patterns (Link-Ziel → Aufruf …): das Pattern füllt ihn
  const ofPattern = step.pattern ? (model?.patterns?.find(d => d.id === step.pattern)?.name ?? step.pattern) : null;
  const service = initWorker ? null : catalogEntry(step, model);

  // Woran sich das Mapping messen lässt: die Klasse der Interaktion, sonst der
  // Katalog-Eintrag. Gibt es beides nicht, ist das Mapping frei.
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id) ?? null;
  const classFieldDefs = (list: 'inputs' | 'outputs'): Field[] | null => {
    const id = list === 'inputs' ? ia?.inTypeId : ia?.outTypeId;
    const t = id ? (spec.types ?? []).find(x => x.id === id) : null;
    // bei einem enum auch die Felder seiner Fälle — welche gelten, sagt die Ausprägung
    return t ? classFieldsOf(t) : null;
  };
  const classFields = (list: 'inputs' | 'outputs'): string[] | null =>
    classFieldDefs(list)?.map(f => f.name) ?? null;
  // Die Prozessvariablen mit ihren Pfaden — für FEEL-Prüfung und Vorschläge;
  // bei den Ausgaben zuerst das Ergebnis des Services (die Felder seines Out)
  const scopes = useMemo(() => multiInstanceScopes(spec.steps).get(step.id), [spec.steps, step.id]);
  const baseVariables = useMemo(() => processVariables(spec, model), [spec, model]);
  const variables = useMemo(() => withMultiInstance(baseVariables, scopes), [baseVariables, scopes]);
  const resultVars = useMemo(() => withMultiInstance(resultVariables(step, spec, model, service), scopes), [step, spec, model, service, scopes]);
  // Die Scala-Typen des Service-Objekts aus dem Domain-Katalog — Massstab für
  // Typ und Pflicht, wo der Schritt keine eigene In-/Out-Klasse hat
  const domainIn = useMemo(() => (initWorker ? null : stepDomainMember(step, spec, model, 'In')), [initWorker, step, spec, model]);
  // Benutzeraufgaben und eigene Worker lesen ihr In aus den Prozessvariablen —
  // ein Mapping ist dort Zusatz, kein Pflichtfeld kann «fehlen»
  const ownKind = ia?.kind ?? interactionKind(step, spec.processId ?? '');
  const implicitIn = ownKind === 'userTask' || ownKind === 'customTask' || initWorker;
  const domainOut = useMemo(() => (initWorker ? null : stepDomainMember(step, spec, model, 'Out')), [initWorker, step, spec, model]);
  // enum mit Fällen: der Schritt wählt seine Ausprägung (siehe variants.ts)
  const variantsIn = useMemo(() => variantsOf(step, spec, model, 'inputs', service), [step, spec, model, service]);
  const variantsOut = useMemo(() => variantsOf(step, spec, model, 'outputs', service), [step, spec, model, service]);
  const variantsFor = (list: 'inputs' | 'outputs') => (list === 'inputs' ? variantsIn : variantsOut);
  const chosenFor = (list: 'inputs' | 'outputs') => chosenVariant(step, list, variantsFor(list));
  const setVariant = (list: 'inputs' | 'outputs', name: string | null) => {
    const v = variantsFor(list);
    if (!v) return;
    onPatch(step.id, { [variantKey(list)]: name ?? undefined, [list]: rowsForVariant(step[list] ?? [], v, name) });
  };
  const reference = (list: 'inputs' | 'outputs'): { names: string[]; quelle: 'Modell' | 'Katalog' } | null => {
    // ohne gewählte Ausprägung nur die gemeinsamen Felder — bei der eigenen Klasse wie beim Katalog
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
  /** Fehlende Zeilen aus Modell bzw. Katalog ergänzen. */
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
  /** JUEL aus einem älteren Stand nach FEEL — dieselbe Übersetzung wie beim Import. */
  const convertJuel = (list: 'inputs' | 'outputs') =>
    onPatch(step.id, { [list]: (step[list] ?? []).map(m => (isJuel(m.expression) ? { ...m, expression: importExpression(m.expression) } : m)) });

  // Kopf: die Art als Chip in ihrer Farbe, daneben das Objekt (eigener
  // Vertrag, violett) oder die Katalog-Kennung (fremder Service, teal)
  // Steht der Schritt in einem eigenen Block oder Ereignis-Subprozess? Dann sagt es der Kopf – wie die Klammer im Baum
  const block = useMemo(() => blockIndex(spec.steps).get(step.id) ?? null, [spec.steps, step.id]);
  const kindTone = ia
    ? (isDark ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-violet-300 bg-violet-50 text-violet-800')
    : service
      ? (isDark ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-teal-300 bg-teal-50 text-teal-800')
      : (isDark ? 'border-white/15 text-white/50' : 'border-black/15 text-black/50');
  const foreign = !ia && (step.serviceId || step.topic) && step.topic !== (spec.processId ?? '') ? (step.serviceId ?? step.topic ?? '') : '';
  // Ein- und Ausgaben, die ein Pattern beisteuert: Implementation — ausgeblendet
  const fromPattern = useMemo(() => patternMappings(model?.patterns, step.patterns, spec.engine ?? 'c7'), [model?.patterns, step.patterns, spec.engine]);
  const patternName = (id: string) => model?.patterns?.find(d => d.id === id)?.name ?? id;
  // Befunde gesammelt — dieselbe Liste wie das Dreieck im Baum
  const finding = stepFindings(step, spec, model, baseVariables);
  // Was an einem Fehler oder Ausdruck steht, steht schon direkt dort — oben nicht noch einmal
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
            {!ia && foreign && (
              <span title={service ? `${service.name} — im Katalog` : `«${foreign}» steht nicht im Katalog`}
                className={`inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[16rem] ${
                  service || !model?.services?.length ? kindTone : (isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700')}`}>
                <Plug size={9} className="flex-shrink-0" />{foreign}
              </span>
            )}
            <CommentBubble target={stepTarget(step.id)} title={`Kommentare zu «${step.name || step.id}»`} />
          </div>
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
        {/* schliesst nur die Ansicht — gelöscht wird nichts */}
        <button onClick={onClose} title="Ansicht schliessen (Auswahl aufheben — löscht nichts)" aria-label="Ansicht schliessen"
          className={`p-1 ${c.muted}`}><X size={12} /></button>
      </div>

      {/* Befunde — was rot oder orange im Baum steht, hier ausgeschrieben */}
      {(shownErrors.length > 0 || shownWarnings.length > 0) && (
        <div className={`text-[10px] px-2 py-1.5 rounded border space-y-0.5 ${
          shownErrors.length
            ? (isDark ? 'border-rose-500/30 bg-rose-500/5' : 'border-rose-300 bg-rose-50')
            : (isDark ? 'border-amber-500/30 bg-amber-500/5' : 'border-amber-300 bg-amber-50')}`}>
          {shownErrors.map((t, i) => <div key={`e${i}`} className={`flex items-start gap-1 ${err}`}><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /><span>{t}</span></div>)}
          {shownWarnings.map((t, i) => <div key={`w${i}`} className={`flex items-start gap-1 ${warn}`}><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /><span>{t}</span></div>)}
        </div>
      )}

      {/* Fachliche Beschreibung */}
      <Field label="Fachliche Beschreibung (Markdown)" isDark={isDark} comment={sub(stepTarget(step.id), 'description')}
        action={step.description ? <button onClick={() => setPreview(!preview)} className={`text-[9px] ${c.muted} hover:underline`}>
          {preview ? 'bearbeiten' : 'Vorschau'}</button> : undefined}>
        {preview && step.description
          ? <div className="md px-2 py-1.5" dangerouslySetInnerHTML={{ __html: marked.parse(step.description) as string }} />
          : <textarea value={step.description ?? ''} disabled={!canEdit} rows={4}
              onChange={e => onPatch(step.id, { description: e.target.value })}
              placeholder="Was passiert hier fachlich? Was ist die Regel?"
              className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />}
      </Field>

      {step.kind === 'user' && (
        <Section id="assign" label="Zuständigkeit" isDark={isDark}
          comment={sub(stepTarget(step.id), 'assignment')}
          count={(step.candidateGroups ? 1 : 0) + (step.assignee ? 1 : 0)}
          hint={!step.candidateGroups && !step.assignee ? <span className={`text-[9px] ${c.muted}`}>Gruppen oder Person</span> : undefined}>
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
        </Section>
      )}

      <PatternSection target={step} spec={spec} model={model} isDark={isDark} canEdit={canEdit}
        onPattern={onPattern} hasDiagram={hasDiagram} />

      {/* Schleife */}
      {step.loop && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-violet-500/30 bg-violet-500/10 text-violet-300' : 'border-violet-300 bg-violet-50 text-violet-700'}`}>
          <div className="flex items-center gap-1.5 font-semibold"><Repeat size={10} /> Wiederholung</div>
          <div className="mt-1">{step.loop.condition}</div>
          {step.loop.maxAttempts && <div>höchstens <span className="font-mono">{step.loop.maxAttempts}</span> Versuche</div>}
          {step.loop.waitFor && <div className="font-mono">{step.loop.waitFor}</div>}
        </div>
      )}

      {/* Mehrfachausführung: je Element einer Sammlung — aus dem BPMN gelesen */}
      {step.multiInstance && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-violet-500/30 bg-violet-500/10 text-violet-300' : 'border-violet-300 bg-violet-50 text-violet-700'}`}>
          <div className="flex items-center gap-1.5 font-semibold"><Repeat size={10} /> Mehrfachausführung{step.multiInstance.sequential ? ' (nacheinander)' : ' (parallel)'}</div>
          {step.multiInstance.collection && <div>je Element von <span className="font-mono">{step.multiInstance.collection}</span></div>}
          {step.multiInstance.element && <div>Element heisst <span className="font-mono">{step.multiInstance.element}</span> · Zähler <span className="font-mono">loopCounter</span></div>}
        </div>
      )}

      {/* Service-Auswahl mit vorbereitetem Mapping */}
      {initWorker && (
        <Row label="Init-Worker" isDark={isDark}>
          <span title="Sein Topic ist der Prozess selbst: er liest das In aus den Prozessvariablen und liefert das InitIn — kein Service-Aufruf.">
            Topic <span className="font-mono">{step.topic}</span> — liest das In, liefert das InitIn
          </span>
        </Row>
      )}
      {/* Teil eines Pattern-Blocks: Aufruf, Ein- und Ausgaben legt das Pattern fest */}
      {ofPattern && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${patternTone(isDark)}`}>
          <div className="flex items-center gap-1.5 font-semibold"><Puzzle size={10} /> Teil des Patterns «{ofPattern}»</div>
          <div className="mt-0.5">Aufruf, Ein- und Ausgaben füllt das Pattern — sie stehen hier nicht und werden nicht geprüft. Geändert wird am Element, das das Pattern trägt.</div>
        </div>
      )}
      {(step.kind === 'service' || step.kind === 'call' || step.kind === 'send' || step.kind === 'rule') && !initWorker && !ofPattern && (
        <ServicePicker step={step} spec={spec} model={model} isDark={isDark} canEdit={canEdit} onPatch={onPatch} onSyncId={onSyncId} current={service} />
      )}

      {step.calledProcess && (
        <Row label="Ruft Prozess" isDark={isDark}><span className="font-mono">{step.calledProcess}</span></Row>
      )}
      {step.eventKind && step.eventKind !== 'none' && (
        <Row label="Ereignis" isDark={isDark}>
          <span className="flex items-center gap-1"><Zap size={10} /> {step.eventKind} {step.eventDirection === 'throw' ? '(werfend)' : '(fangend)'}</span>
        </Row>
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

      {(!!step.errors?.length || !!step.regexHandledErrors?.length || (canEdit && (step.kind === 'service' || step.kind === 'call'))) && (
        <Section id="errors" label="Behandelte Fehler" count={(step.errors ?? []).filter(e => !e.side).length} isDark={isDark}
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
              if (e.side) return null; // Nebenpfade (ohne Fehlercode) gehören in den Baum, nicht in diese Liste
              const setErr = (patch: Partial<typeof e>) =>
                onPatch(step.id, { errors: (step.errors ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x)) });
              // behandelt ist der Normalfall — gelb/rot nur, wenn am Eintrag etwas nicht stimmt
              const issue = handledErrorIssue(e, i, step.errors ?? [], { variables, engine: spec.engine });
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
                {issue && (
                  <p className={`text-[10px] flex items-start gap-1 px-2 pb-1 ${issue.level === 'error' ? err : warn}`}>
                    <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{issue.text}</span>
                  </p>
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
              // Bedingung als FEEL: gültig, Pfade bekannt, Ergebnis Ja/Nein
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
                    title="Bedingung des Zweigs als FEEL (= …) — beim Export für Camunda 7 nach JUEL übersetzt" />
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
            {step.mockKind && <>, dazu <span className="font-mono">{step.mockKind === 'service' ? '_outputServiceMock' : '_outputMock'} = {mockField(step.name)}</span> und im InConfig das Feld <span className="font-mono">{mockField(step.name)}</span></>}.
          </p>
          {step.mock && !/^=\s*\w+Mock$|getVariable/.test(step.mock) && (
            <pre className={`mt-1 text-[10px] px-2 py-1.5 rounded border overflow-x-auto ${c.border2} ${c.muted2}`} title="bisheriger Wert im BPMN — beim Export ersetzt">{step.mock}</pre>
          )}
        </Section>
      )}
    </div>
  );
}

// ── Pattern ──────────────────────────────────────────────────────────────────
//
// Was der Admin als Pattern hinterlegt hat und zu diesem Element passt, lässt
// sich hier wählen — es steht danach sofort im Diagramm (nicht erst beim
// Export). Die Werte der Parameter gehen beim Verlassen des Felds hinein.
function PatternSection({ target, spec, model, isDark, canEdit, onPattern, hasDiagram }: {
  target: Step | null; spec: ProcessSpec; model: Model | null; isDark: boolean; canEdit: boolean;
  onPattern?: Props['onPattern']; hasDiagram?: boolean;
}) {
  const c = cls(isDark);
  const engine: EngineId = spec.engine ?? 'c7';
  const applied = (target ? target.patterns : spec.patterns) ?? [];
  const tags = target ? stepTags(target.kind, target.eventDirection, target.gatewayType) : [PROCESS_TARGET];
  const available = patternsFor(model?.patterns, tags, engine);
  if (!applied.length && !available.length) return null;
  const editable = canEdit && !!onPattern && !!hasDiagram;
  const id = target?.id ?? null;
  // Parameter mit «=» sind FEEL wie die Mapping-Werte — Vorschläge aus den Prozessvariablen
  const variables = useMemo(() => processVariables(spec, model), [spec, model]);
  return (
    <Section id="patterns" label="Pattern" count={applied.length} isDark={isDark}
      hint={!hasDiagram ? <span className={`text-[9px] ${c.muted}`}>braucht das Diagramm</span> : undefined}
      action={editable && available.length ? (
        <select value="" onChange={e => { if (e.target.value) onPattern!(id, e.target.value, 'add'); }}
          title="Pattern wählen — es wird sofort ins Diagramm eingefügt"
          className={`text-[10px] px-1.5 py-0.5 rounded border outline-none max-w-[12rem] ${c.input}`}>
          <option value="">+ Pattern …</option>
          {available.map(d => <option key={d.id} value={d.id} title={d.description}>{d.name}{applied.some(a => a.id === d.id) ? ' (noch einmal)' : ''}</option>)}
        </select>
      ) : undefined}>
      <div className="space-y-1.5">
        {applied.map((a, i) => (
          <AppliedPatternCard key={`${a.id}-${i}`} applied={a} def={model?.patterns?.find(d => d.id === a.id) ?? null}
            isDark={isDark} editable={editable} engine={engine} atProcess={!target} variables={variables}
            onRemove={() => onPattern?.(id, a.id, 'remove', a.params)}
            onParams={params => onPattern?.(id, a.id, 'update', params, a.params)} />
        ))}
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
 * Ein Pattern-Parameter steht wörtlich im BPMN (`{{name}}`) — also in der Form
 * der Engine: `${x}` in Camunda 7, `=x` in Camunda 8. Gezeigt und bearbeitet
 * wird er wie ein Mapping-Wert: mit «=» FEEL, sonst fester Text.
 */
const paramView = (stored: string): string => (isJuel(stored) || feelBody(stored) != null ? importExpression(stored) : stored);

/** Zurück in die Form der Engine — FEEL, das nicht nach JUEL geht, bleibt stehen (und wird gemeldet). */
function paramStored(view: string, engine: EngineId): string {
  const body = feelBody(view);
  if (body == null) return view;
  if (engine === 'c8') return `=${body.trim()}`;
  const r = feelToJuel(body);
  return r.ok ? `\${${r.juel}}` : view;
}

function AppliedPatternCard({ applied, def, isDark, editable, engine, atProcess, variables, onRemove, onParams }: {
  applied: AppliedPattern; def: PatternDef | null; isDark: boolean; editable: boolean; engine: EngineId; atProcess: boolean;
  variables: VarNode[];
  onRemove: () => void; onParams: (params: Record<string, string>) => void;
}) {
  const c = cls(isDark);
  const { warn, err } = tones(isDark);
  const params: Array<{ name: string; label?: string; description?: string; default?: string; inBlock?: boolean }> = def
    ? patternParamsFor(def, engine, atProcess)
    : Object.keys(applied.params ?? {}).map(name => ({ name }));
  const stored = applied.params ?? {};
  const storedKey = JSON.stringify(stored);
  // bearbeitet wird die FEEL-Ansicht; gespeichert die Form der Engine
  const viewOf = (ps: Record<string, string>) => Object.fromEntries(Object.entries(ps).map(([k, v]) => [k, paramView(v)]));
  const [draft, setDraft] = useState<Record<string, string>>(() => viewOf(stored));
  useEffect(() => { setDraft(viewOf(JSON.parse(storedKey))); }, [storedKey]);
  const [confirm, setConfirm] = useState(false);
  const commit = () => {
    // was nicht angefasst wurde, bleibt wörtlich, wie es im BPMN steht
    const next = Object.fromEntries(Object.entries(draft).map(([k, v]) =>
      [k, stored[k] != null && paramView(stored[k]) === v ? stored[k] : paramStored(v, engine)]));
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
        {def?.docUrl && (
          <a href={def.docUrl} target="_blank" rel="noopener noreferrer" title="Dokumentation des Patterns" className="opacity-70 hover:opacity-100">
            <ExternalLink size={9} />
          </a>
        )}
        {editable && def && (
          confirm
            ? <span className="ml-auto flex items-center gap-1">
                <button onClick={() => { setConfirm(false); onRemove(); }} className="text-[9px] underline">aus dem Diagramm entfernen</button>
                <button onClick={() => setConfirm(false)} title="Abbrechen" className="opacity-70"><X size={10} /></button>
              </span>
            : <button onClick={() => setConfirm(true)} title="Pattern entfernen" className="ml-auto opacity-60 hover:opacity-100"><Trash2 size={10} /></button>
        )}
      </div>
      {!def && <p className={`text-[10px] flex items-start gap-1 ${warn}`}><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />Im Admin nicht (mehr) definiert — erkannt wurde es mit einem früheren Stand.</p>}
      {!!params.length && (
        <div className="space-y-0.5">
          {params.map(p => {
            const issues = p.inBlock ? [] : issuesOf(draft[p.name]);
            return (
              <div key={p.name}>
                <div className="flex items-center gap-1.5 text-[10px]"
                  title={p.inBlock ? `${p.description ? `${p.description}\n` : ''}Steht im gemeinsamen Block des Prozesses — dort, im Diagramm, ändern.` : p.description}>
                  <span className={`w-28 flex-shrink-0 truncate ${c.muted2}`}>{p.label || p.name}</span>
                  {/* Blur übernimmt — wie beim Feld vorher; Enter verlässt das Feld */}
                  <div className="flex-1 min-w-0" onBlur={commit}
                    onKeyDown={e => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.target.blur(); }}>
                    <FeelInput value={p.inBlock ? '' : draft[p.name] ?? ''} disabled={!editable || p.inBlock} isDark={isDark}
                      variables={variables}
                      onChange={v => setDraft(d => ({ ...d, [p.name]: v }))}
                      placeholder={p.inBlock ? 'im gemeinsamen Block' : p.default ? `Vorgabe: ${p.default}` : 'Text — oder = FEEL'}
                      title={`${p.description ? `${p.description}\n` : ''}Mit «=» ein FEEL-Ausdruck (wie bei den Mappings) — im BPMN für ${engine === 'c8' ? 'Camunda 8 als =…' : 'Camunda 7 als ${…}'}; sonst fester Text.`} />
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
  // über den Schlüssel im Katalog: ein Objekt eines anderen Prozesses / Projekts wird
  // referenziert und nicht exportiert
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
            // Eine Klasse ohne Felder ist ein Hinweis (gelb): der Schritt bekommt
            // bzw. liefert dann nichts — meist ist das noch nicht fertig
            // — ausser beim In eines Signals oder einer Nachricht: das darf leer sein
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

// ── Service-Katalog ──────────────────────────────────────────────────────────
function ServicePicker({ step, spec, model, isDark, canEdit, onPatch, onSyncId, current }: {
  step: Step; spec: ProcessSpec; model: Model | null; isDark: boolean; canEdit: boolean; current: ServiceDef | null;
  onPatch: (id: string, patch: Partial<Step>) => void;
  /** die ID dem (neuen) Namen nachziehen — wie nach dem Umbenennen im Feld */
  onSyncId?: (id: string) => void;
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
    // Ausprägungen des neuen Service: eine gewählte bleibt, wenn es sie dort
    // auch gibt; die Felder der anderen kommen nicht als Zeilen herein
    const next: Step = { ...step, serviceId: svc.id, topic: svc.topic ?? step.topic, calledProcess: svc.calledProcess ?? step.calledProcess };
    const variantState = (list: 'inputs' | 'outputs') => {
      const v = variantsOf(next, spec, model, list, svc);
      const was = step[variantKey(list)];
      const name = v && typeof was === 'string' && (v.cases.some(x => x.name === was) || (list === 'outputs' && was === ALL_VARIANTS)) ? was : null;
      return { v, name, chosen: { name, inferred: false, mixed: [] } as Chosen };
    };
    const vin = variantState('inputs'), vout = variantState('outputs');
    // ein Schritt ohne eigenen Namen heisst wie der Service — ebenso einer, der
    // noch den Namen des bisher gewählten trägt; einen gewählten Namen lässt es stehen
    const refOf = (s: ServiceDef) => s.calledProcess ?? s.topic ?? s.id;
    const prefixes = knownPrefixes(model, [spec.project]);
    const autoName = unnamed(step) || (!!current && step.name === nameFromService(refOf(current), prefixes));
    const name = autoName ? nameFromService(refOf(svc), prefixes) : null;
    const inParams = (svc.inputs ?? []).filter(pm => variantAllows(vin.v, vin.chosen, pm.name));
    const outParams = (svc.outputs ?? []).filter(pm => variantAllows(vout.v, vout.chosen, pm.name));
    onPatch(step.id, {
      ...(name && name !== step.name ? { name } : {}),
      serviceId: svc.id,
      inVariant: vin.name ?? undefined,
      outVariant: vout.name ?? undefined,
      ...(svc.topic ? { topic: svc.topic } : {}),
      ...(svc.calledProcess ? { calledProcess: svc.calledProcess } : {}),
      // Was schon erfasst war, bleibt: Ausdruck, Bedeutung und die Abwahl
      inputs: inParams.map(pm => ({
        name: pm.name,
        expression: oldIn.get(pm.name)?.expression ?? feelIfPossible(pm.expression ?? ''),
        ...(oldIn.get(pm.name)?.description ?? pm.description ? { description: oldIn.get(pm.name)?.description ?? pm.description } : {}),
        ...(oldIn.get(pm.name)?.disabled ? { disabled: true } : {}),
      })),
      outputs: outParams.map(pm => ({
        name: pm.name,
        expression: oldOut.get(pm.name)?.expression ?? feelIfPossible(pm.expression ?? ''),
        ...(oldOut.get(pm.name)?.description ? { description: oldOut.get(pm.name)!.description } : {}),
        ...(oldOut.get(pm.name)?.disabled ? { disabled: true } : {}),
      })),
      ...(svc.handledErrors?.length
        ? { errors: [...(step.errors ?? []), ...svc.handledErrors.filter(code => !(step.errors ?? []).some(e => e.code === code)).map(code => ({ code }))] }
        : {}),
      status: 'changed' as Status,
    });
    // erst nach dem Rendern steht der neue Name in der Spezifikation
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
          {/* eine Entscheidung heisst über ihre decisionId, ein Worker über sein Topic */}
          {step.serviceId ?? (step.topic ? `${step.kind === 'rule' ? 'decisionId' : 'Topic'}: ${step.topic}` : step.kind === 'rule' ? 'keine Entscheidung gewählt' : 'kein Service gewählt')}
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
// **abwählen** oder entfernen. Ein Katalog-Service bringt alles mit, was er
// kann — was dieser Prozess nicht braucht, wird abgewählt (bleibt sichtbar)
// oder gelöscht (kommt über «+ N aus Katalog» zurück). Ein erneuter Abgleich
// stellt Abgewähltes nicht wieder her.
function MappingTable({ title, list, step, isDark, canEdit, service, reference, variables, refFields, domain, types, model, engine, implicitIn, fromPattern, patternTimes, patternName, variants, chosen, onVariant, onChange, onAdd, onRemove, onFill, onConvert }: {
  title: string; list: 'inputs' | 'outputs'; step: Step; isDark: boolean; canEdit: boolean;
  /** Ausprägungen des In bzw. Out (enum mit Fällen) — null: keine */
  variants: Variants | null;
  chosen: Chosen;
  onVariant: (list: 'inputs' | 'outputs', name: string | null) => void;
  /** Name → Pattern: diese Zeilen steuert ein Pattern bei — Implementation, ausgeblendet */
  fromPattern: Map<string, string>;
  /** wie oft das Pattern einen Namen selbst mitbringt — so oft ist er kein Doppel */
  patternTimes: Map<string, number>;
  patternName: (id: string) => string;
  /** Benutzeraufgabe oder eigener Worker: das In kommt aus den Prozessvariablen, ein Mapping ist keine Pflicht */
  implicitIn: boolean;
  /** Katalog-Eintrag — liefert die Bedeutung, wo der Schritt keine eigene hat */
  service: ServiceDef | null;
  /** was der Ausdruck sehen darf: Prozessvariablen — bei Ausgaben zuerst das Ergebnis des Services */
  variables: VarNode[] | null;
  /** Felder der In- bzw. Out-Klasse — daraus der erwartete Typ je Zeile */
  refFields: Field[] | null;
  /** `<Objekt>.In` bzw. `.Out` aus dem Domain-Katalog — Massstab ohne eigene Klasse */
  domain: DomainType | null;
  types: TypeDef[];
  model: Model | null;
  engine: EngineId | undefined;
  /** was das Datenmodell bzw. der Katalog kennt — daran misst sich das Mapping */
  reference: { names: string[]; quelle: 'Modell' | 'Katalog' } | null;
  onChange: (list: 'inputs' | 'outputs', i: number, patch: Partial<Mapping>) => void;
  onAdd: (list: 'inputs' | 'outputs') => void;
  onRemove: (list: 'inputs' | 'outputs', i: number) => void;
  onFill: (list: 'inputs' | 'outputs') => void;
  /** JUEL-Reste dieser Tabelle nach FEEL übersetzen */
  onConvert: (list: 'inputs' | 'outputs') => void;
}) {
  const c = cls(isDark);
  const all = step[list] ?? [];
  // Felder anderer Ausprägungen sind ausgeblendet — ohne Wahl gelten nur die gemeinsamen
  const allowed = (name: string) => variantAllows(variants, chosen, name);
  const hiddenByVariant = all.filter(m => !fromPattern.has(m.name) && !allowed(m.name)).length;
  // Eingaben: der Service erwartet genau einen Fall — dieselbe Regel wie in findings.ts
  const needsChoice = !!variants && !chosen.name && !chosen.mixed.length && list === 'inputs' && !implicitIn && !fromPattern.size;
  // was ein Pattern beisteuert, steht nicht hier — seine Parameter stehen am Pattern
  const rows = all.filter(m => !fromPattern.has(m.name) && allowed(m.name));
  const byPattern = all.filter(m => fromPattern.has(m.name));
  const byPatternNames = [...new Set(byPattern.map(m => patternName(fromPattern.get(m.name)!)))];
  // JUEL aus einem älteren Stand: was sich übersetzen lässt, bekommt oben den Knopf
  const juelRows = rows.filter(m => !m.disabled && isJuel(m.expression));
  const convertible = juelRows.filter(m => importExpression(m.expression) !== m.expression).length;
  const active = rows.filter(m => !m.disabled).length;
  /** Zeile, deren Entfernen gerade bestätigt werden soll */
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  // Was die Felder bedeuten — beim Überfahren erklärt, denn bei Ein- und
  // Ausgaben ist die Leserichtung verschieden: bei Eingaben ist «name» der
  // Parameter des Services und der Ausdruck kommt aus dem Prozess, bei
  // Ausgaben ist «name» die Prozessvariable und der Ausdruck die Quelle.
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
  // Der Katalog kennt die Bedeutung der Felder (aus den OpenAPI-Schemas).
  // Wo der Schritt keine eigene hat, steht sie als Vorschlag im Feld — sie
  // wird nicht mitgespeichert, solange niemand sie übernimmt.
  const fromCatalog = new Map((service?.[list] ?? []).map(p => [p.name, p.description]));
  const vorhanden = new Set(all.map(m => m.name));
  const bekannt = reference ? new Set(reference.names) : null;
  const fehlend = reference ? reference.names.filter(n => !vorhanden.has(n)).length : 0;
  // Zeilen, die das Modell bzw. der Katalog nicht kennt: eine **Erweiterung**,
  // die dort noch fehlt — oder ein Feld, das es nicht mehr gibt. Beides ist
  // eine Warnung, kein Fehler: sobald das Feld im Modell steht, ist die Zeile
  // ohne weiteres Zutun in Ordnung.
  // Bei den Ausgaben ist der Name die **neue** Prozessvariable — die darf
  // heissen, wie sie will; nur Eingaben messen sich am In des Services
  // eine allgemeine Variable (`_idempotentId` …) nimmt jeder Worker — keine Erweiterung
  const unbekannt = (name: string) => !!bekannt && !!name && !bekannt.has(name) && !GENERAL_VARIABLES.has(name);
  const verwaist = list === 'inputs' ? rows.filter(m => unbekannt(m.name)).length : 0;
  const { warn, warnBox, err, errBox } = tones(isDark);
  // Derselbe Name zweimal: die zweite Zeile überschriebe die erste — im
  // BPMN wie im Export. Abgewählte Zeilen zählen nicht, die kommen nicht vor.
  const zaehler = new Map<string, number>();
  for (const m of all) if (m.name && !m.disabled) zaehler.set(m.name, (zaehler.get(m.name) ?? 0) + 1);
  const doppelt = new Set([...zaehler].filter(([name, n]) => n > (patternTimes.get(name) ?? 1)).map(([name]) => name));
  // Pflicht: das Feld der In-Klasse ist nicht optional — oder der Katalog
  // sagt `required`. Ein Pflichtfeld muss der Service bekommen; die Zeile
  // lässt sich deshalb weder abwählen noch entfernen.
  const pflichtGrund = (name: string): string | null => {
    if (list !== 'inputs' || !name || implicitIn || !allowed(name)) return null;
    if (refFields) {
      const f = refFields.find(x => x.name === name);
      return f && !f.optional ? `Pflichtfeld: «${name}» ist im In nicht optional` : null;
    }
    const dom = domainRequired(domain, name);
    if (dom != null) return dom ? `Pflichtfeld: «${name}» ist in ${domain?.name} nicht optional` : null;
    const p = service?.inputs?.find(x => x.name === name);
    return p?.required ? `Pflichtfeld: «${name}» ist laut Katalog erforderlich` : null;
  };
  // legt ein Pattern den Aufruf fest, fehlt kein Pflichtfeld
  const pflichtFehlt = reference && !(list === 'inputs' && byPattern.length)
    ? reference.names.filter(n => pflichtGrund(n) && !all.some(m => m.name === n && !m.disabled))
    : [];

  // Auf- und zuklappen, je Tabelle gemerkt; leer = zu, und was hinzukommt, klappt auf
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
          <span className={`text-[10px] ${c.muted}`} title={`${list === 'inputs' ? 'Das In' : 'Das Out'} ist ein enum mit Fällen — der Service bekommt bzw. liefert genau einen davon.`}>
            Ausprägung
          </span>
          <select value={chosen.name ?? ''} disabled={!canEdit}
            onChange={e => onVariant(list, e.target.value || null)}
            title={needsChoice ? 'Der Service erwartet genau eine Ausprägung — ohne Wahl bekommt er keine.' : undefined}
            className={`text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input} ${needsChoice ? warnBox : ''}`}>
            <option value="">— nur gemeinsame Felder —</option>
            {/* der Service liefert einen Fall — welchen, entscheidet er: die Ausgaben dürfen alle lesen */}
            {list === 'outputs' && <option value={ALL_VARIANTS}>— alle Ausprägungen —</option>}
            {variants.cases.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          {chosen.inferred && <span className={`text-[10px] ${c.muted}`} title="Nicht gewählt, sondern aus den aktiven Zeilen erkannt">erkannt</span>}
          {!!hiddenByVariant && !chosen.mixed.length && (
            <span className={`text-[10px] ${c.muted}`}>· {hiddenByVariant} Feld{hiddenByVariant === 1 ? '' : 'er'} anderer Ausprägungen ausgeblendet</span>
          )}
        </div>
      )}
      {!!chosen.mixed.length && (
        <p className={`text-[10px] mb-1 ${warn}`}>
          Aktive Zeilen aus mehreren Ausprägungen ({chosen.mixed.join(', ')}) — der Service {list === 'inputs' ? 'bekommt' : 'liefert'} nur eine. Ausprägung wählen; die übrigen werden abgewählt.
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
          // Doppelt ist ein Fehler (rot), eine Erweiterung nur eine Warnung (gelb)
          const problem = dupl
            ? `«${m.name}» kommt mehrmals vor — jeder Name nur einmal; eine Zeile umbenennen oder abwählen.`
            : fehlt ? `«${m.name}» steht noch nicht im ${reference?.quelle} — Erweiterung: dort ergänzen, dann ist die Zeile in Ordnung. Oder hier entfernen.` : undefined;
          // FEEL (Camunda 8): `= …` wird beim Tippen geprüft — Syntax, Pfade, Typ
          // Solltyp: die eigene Klasse zuerst, sonst der Domain-Katalog
          const expected = refFields
            ? expectedFor(refFields.find(f => f.name === m.name), types, model)
            : expectedFromDomain(domain, m.name, model);
          const feel = !off && isFeel(m.expression) ? checkFeel(m.expression, variables, expected) : null;
          const feelIssues: FeelIssue[] = [
            ...(pflicht && off ? [{ level: 'error' as const, text: `${pflicht} — abgewählt bekommt der Service es nicht. Wieder anwählen.` }] : []),
            ...(feel ? [...feel.issues, ...juelIssues(m.expression, engine)] : []),
            // ein Skript aus dem BPMN (Groovy): beschrieben, nicht übersetzt
            ...(!off && isScriptValue(m.expression) ? [{ level: 'warn' as const, text: scriptWarning(engine) }] : []),
            // JUEL, das der Import nicht übersetzen konnte — bleibt, bis es jemand als FEEL schreibt
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
            // Key nur über die Position: ein Key mit dem Namen darin würde die
            // Zeile bei jedem Tastendruck neu aufbauen — und den Fokus verlieren.
            <div key={i}
              title={problem}
              data-cframe={m.name ? sub(stepTarget(step.id), `${list === 'inputs' ? 'in' : 'out'}:${m.name}`) : undefined}
              className={`group px-2 py-1.5 rounded border ${box} ${off ? 'opacity-45' : ''}`}>
              {/* Befund zum FEEL-Ausdruck — über dem Feld, damit er beim Tippen im Blick bleibt */}
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
                  className={`w-32 text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input} ${off ? 'line-through' : ''}`} />
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
                  className="flex-1 min-w-0" />
                {feel && <ResultChip feel={feel} expected={expected} isDark={isDark} />}
                {problem && <AlertTriangle size={10} className={`flex-shrink-0 ${mark}`} />}
                {m.name && <CommentBubble target={sub(stepTarget(step.id), `${list === 'inputs' ? 'in' : 'out'}:${m.name}`)} quiet />}
                {/* Entfernen geht immer. Ein Feld des Massstabs kommt über
                    «+ N aus Modell/Katalog» jederzeit zurück — Abwählen ist
                    die sanftere Variante, wenn es sichtbar bleiben soll. */}
                {canEdit && !pflicht && confirmRemove !== i && (
                  <button onClick={() => setConfirmRemove(i)}
                    title={reference && !fehlt ? `Zeile entfernen — steht danach unter «+ aus ${reference.quelle}» wieder bereit` : 'Zeile entfernen'}
                    className={`p-0.5 flex-shrink-0 ${c.muted}`}><Trash2 size={10} /></button>
                )}
                {/* Rückfrage direkt in der Zeile — erst «Ja» entfernt */}
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

/** Farbe und Zeichen je Typart — dieselben wie die Typ-Chips im Datenmodell. */
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
 * Solltyp der Zeile — was das Feld der In-/Out-Klasse (oder der Katalog)
 * verlangt. Steht neben dem Namen, damit klar ist, was der Ausdruck liefern muss.
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
 * Was der FEEL-Ausdruck liefert — ausgewertet mit Beispielwerten. Grün, wenn
 * es zum Solltyp passt, rot, wenn nicht; grau ohne Massstab. Kein Chip, wenn
 * der Ausdruck nicht auswertbar ist — dann steht der Befund darüber.
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
 * Einklappbarer Abschnitt mit Zähler. Zu, wenn er leer ist; offen, wenn
 * etwas drin ist — und die Wahl der Person wird je Abschnitt gemerkt.
 * Kommt etwas hinzu (der Zähler steigt), geht er auf.
 */
function Section({ id, label, count, isDark, action, hint, children, comment, openFor }: {
  id: string; label: string; count?: number; isDark: boolean;
  action?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode;
  /** Kommentar-Stelle des Abschnitts — Sprechblase und Rahmen */
  comment?: string;
  /** Stellen darin (Präfix): steht der offene Kommentar dort, klappt der Abschnitt auf */
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
  // Beim Durchgehen der Kommentare: eine Stelle in einem zugeklappten
  // Abschnitt wäre nicht zu sehen — also aufklappen (ohne es zu merken)
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
  /** Kommentar-Stelle dieses Abschnitts — Sprechblase neben der Überschrift */
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

function Row({ label, children, isDark }: { label: string; children: React.ReactNode; isDark: boolean }) {
  const c = cls(isDark);
  return (
    <div className="flex items-baseline gap-2 text-[10px]">
      <span className={`${c.muted} w-24 flex-shrink-0`}>{label}</span>
      <span className={`${c.muted2} truncate`}>{children}</span>
    </div>
  );
}
