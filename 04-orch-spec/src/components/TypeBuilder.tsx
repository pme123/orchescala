// Class builder: the data model of the process — above all the **In**.
//
// On the left the types, in the middle the fields, on the right the Scala code
// generated from them (live). `InConfig` mostly results from the flow
// (loops, mocks); own adjusting knobs can be maintained, as with the `InitIn`,
// as fields.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Braces, ChevronDown, ChevronRight, ClipboardPaste, Copy, Check, ListOrdered,
  Plus, Puzzle, Trash2, Workflow, X,
  Plug, ExternalLink, Unlink,
} from 'lucide-react';
import { isAdt,
  CONSTRAINTS, INTERACTION_META, STATUSES, STATUS_META,
  type ConstraintTemplate, type DecisionResult, type Field, type Interaction, type Model, type ProcessSpec,
  type Status, type TypeDef,
} from '../types';
import {
  aliasMemberType, catalogEntry, catalogMembers, createMemberType, interactionStep, missingInteractions, syncInitIn, toInteraction, withOrigin,
} from '../interactions';
import { allSteps, blockIndex, blockStart, type BlockRef } from '../bpmn';
import { caseName, casesOf, isSimpleEnum, looksLikeScala, renderInConfig } from '../scala';
import { parseDomainRef, parseServiceRef } from '../serviceTypes';
import TypePicker, { NEW_CASE, NEW_ENUM } from './TypePicker';
import ScalaCode from './ScalaCode';
import FeelInput from './FeelInput';
import { checkTypes, constraintKind, dmnIssues, defaultIsUsed, fieldType, homeOf, indexTypes, isScalaTypeExpression, packageOf, referencedClass, renderType } from '../scala';
import { BRANCH_COLORS, cls, patternTone } from '../ui';
import { classesNotInDomain, referenceExistingClasses, sharedFields } from '../projectImport';
import { CommentBubble } from './Comments';
import { useConfirm } from './Confirm';
import { iaTarget, sub, typeTarget } from '../comments';
import { uid } from '../util';
import { getClipboard, setModelClip, useClipboard, type ClipSource } from '../clipboard';
import { pasteField, pasteType, typeClosure } from '../copyPaste';
import { patternOfField } from '../patterns';
import { interactionStatus } from '../status';

interface Props {
  spec: ProcessSpec;
  isDark: boolean;
  canEdit: boolean;
  /** service catalog — provides the selectable service objects */
  model: Model | null;
  onChange: (spec: ProcessSpec) => void;
  /** jumped here from the flow: show this type */
  focusTypeId?: string | null;
  onFocused?: () => void;
  /** jumped here from the comments: show this interaction */
  focusIaId?: string | null;
  onFocusedIa?: () => void;
}

const emptyField = (): Field => ({ id: uid('f'), name: '', type: 'String' });

// ── Copy and paste ───────────────────────────────────────────────────────────
// Classes and fields travel via the clipboard (clipboard.ts) into this
// or another data model — even in another tab. The context saves
// passing the actions through editor, selection and field row.
interface ClipActions {
  copyType: (t: TypeDef) => void;
  copyField: (f: Field) => void;
  /** into the class — for a choice into case number `valueIndex` */
  pasteField: (typeId: string, valueIndex?: number) => void;
}
const ClipContext = createContext<ClipActions | null>(null);
/** the whole specification — for the field row (does a field belong to a pattern?) */
const SpecContext = createContext<ProcessSpec | null>(null);

/** copy, briefly confirmed with a check mark */
function ClipCopyButton({ onCopy, title, className }: { onCopy: () => void; title: string; className: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { onCopy(); setDone(true); window.setTimeout(() => setDone(false), 1200); }}
      title={title} className={className}>
      {done ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

/** «Feld einfügen» — only if a field is in the clipboard */
function PasteFieldButton({ typeId, valueIndex, isDark }: { typeId: string; valueIndex?: number; isDark: boolean }) {
  const actions = useContext(ClipContext);
  const m = useClipboard().model;
  const c = cls(isDark);
  if (!actions || m?.kind !== 'field') return null;
  const mit = m.types.length ? ` — mit ${m.types.length === 1 ? 'einer Klasse' : `${m.types.length} Klassen`} als Kopie` : '';
  return (
    <button onClick={() => actions.pasteField(typeId, valueIndex)}
      title={`Feld «${m.field.name}» aus «${m.source.title || m.source.slug}» einfügen${mit}`}
      className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border min-w-0 ${c.btn}`}>
      <ClipboardPaste size={11} className="flex-shrink-0" /> <span className="truncate">«{m.field.name || 'Feld'}» einfügen</span>
    </button>
  );
}
const SCALA_KEY = 'orch-spec.showScala';

/** result shapes of a DMN decision — the factories in Orchescala (BpmnDecisionDsl) */
const DMN_FORMS: Array<{ id: DecisionResult; label: string }> = [
  { id: 'singleEntry', label: 'ein einfacher Wert (Out mit genau einem Feld)' },
  { id: 'singleResult', label: 'ein Objekt (Out)' },
  { id: 'collectEntries', label: 'Liste einfacher Werte (Out mit genau einem Feld)' },
  { id: 'resultList', label: 'Liste von Objekten (Out)' },
];

/** groups of the sidebar per kind of interaction — in this order. */
const KIND_GROUP: Record<Interaction['kind'], string> = {
  userTask: 'User Tasks', customTask: 'Worker', decision: 'DMN Decisions', signal: 'Signale', message: 'Nachrichten',
};

// ── Sidebar: what a type is, what it lacks, whether it is used ─────────────
/** empty — no field or no value with a name? */
const isEmptyType = (t: TypeDef | null | undefined): boolean =>
  !t || (t.kind === 'enum' ? !(t.values ?? []).some(v => v.name) : !(t.fields ?? []).some(f => f.name));

/** briefly, what is inside: «14», «ADT · 2 Fälle · 8 gemeinsam», «3 Werte». */
function contentLabel(t: TypeDef): string {
  if (t.kind !== 'enum') return String((t.fields ?? []).filter(f => f.name).length);
  const cases = (t.values ?? []).filter(v => v.name).length;
  if (!isAdt(t)) return `${cases} Wert${cases === 1 ? '' : 'e'}`;
  const common = (t.fields ?? []).filter(f => f.name).length;
  return `ADT · ${cases} F${cases === 1 ? 'all' : 'älle'}${common ? ` · ${common} gemeinsam` : ''}`;
}

/** how many fields of other types point to this type. */
function usageCount(all: TypeDef[], id: string): number {
  let n = 0;
  for (const t of all) {
    if (t.id === id) continue;
    for (const f of [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])]) if (f.type === id) n++;
  }
  return n;
}

const amber = (isDark: boolean) => (isDark ? 'text-amber-400' : 'text-amber-600');

/** Take over the suggested name with one click — next to the message that proposes it. */
function SuggestButton({ name, isDark, onTake }: { name: string; isDark: boolean; onTake: () => void }) {
  return (
    <button onClick={onTake} title={`Namen «${name}» übernehmen`}
      className={`ml-1.5 inline-flex items-center gap-1 px-1.5 py-px rounded border font-mono ${
        isDark ? 'border-white/20 text-white/80 hover:bg-white/10' : 'border-black/20 text-black/80 hover:bg-black/5'}`}>
      → {name} übernehmen
    </button>
  );
}

/** color and symbol of the type chip of a field row. */
function typeChip(f: Field, types: TypeDef[], idx: ReturnType<typeof indexTypes>, model: Model | null, isDark: boolean):
  { cls: string; icon: React.ReactNode; ownId?: string; title?: string } {
  const own = types.find(t => t.id === f.type);
  if (own) {
    const enumish = own.kind === 'enum';
    return {
      ownId: own.id,
      icon: enumish ? <ListOrdered size={9} className="flex-shrink-0" /> : <Braces size={9} className="flex-shrink-0" />,
      cls: enumish
        ? (isDark ? 'border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20' : 'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100')
        : (isDark ? 'border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20' : 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100'),
    };
  }
  const dom = idx.domainOf(f.type);
  const svc = idx.serviceOf(f.type);
  if (dom || svc) {
    // catalog — if the entry is missing in the loaded catalog, that is an error
    return {
      icon: <Plug size={9} className="flex-shrink-0" />,
      title: dom ? `${dom.name} — aus dem Domain-Katalog (${dom.pkg})` : `${svc!.name} — Service-Objekt, ${svc!.label}`,
      cls: isDark ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-teal-300 bg-teal-50 text-teal-800',
    };
  }
  if ((parseDomainRef(f.type) && model?.domainTypes) || (parseServiceRef(f.type) && model)) {
    return { icon: <AlertTriangle size={9} className="flex-shrink-0" />, title: 'steht nicht (mehr) im Katalog',
      cls: isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700' };
  }
  if (constraintKind(f.type) !== null || ['Boolean', 'LocalDate', 'LocalDateTime', 'Instant'].includes(f.type)) {
    return { icon: null, cls: isDark ? 'border-white/10 text-white/50' : 'border-black/10 text-black/50' };
  }
  // a Scala type from the domain (`MockedServiceResponse[GetClient.Out]`) — taken over verbatim
  if (isScalaTypeExpression(f.type)) {
    return { icon: null, title: `${f.type} — Scala-Typ aus der Domain, wird wörtlich übernommen`,
      cls: isDark ? 'border-white/10 text-white/60' : 'border-black/10 text-black/60' };
  }
  return { icon: <AlertTriangle size={9} className="flex-shrink-0" />, title: `«${f.type}» ist kein bekannter Typ`,
    cls: isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700' };
}

/** class ↔ ADT: the fields move into the first case or back. */
function switchKind(t: TypeDef, kind: 'case' | 'enum'): Partial<TypeDef> {
  if (kind === t.kind) return {};
  // class → ADT: the fields become the shared ones, a first case is created
  if (kind === 'enum') return { kind, values: [{ name: 'Standard' }] };
  // ADT → class: shared and specific fields together, once per name
  const seen = new Set<string>();
  const fields = [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])].filter(f => !seen.has(f.name) && seen.add(f.name));
  return { kind, values: undefined, fields: fields.length ? fields : [emptyField()] };
}

export default function TypeBuilder({ spec, isDark, canEdit, model, onChange, focusTypeId, onFocused, focusIaId, onFocusedIa }: Props) {
  const c = cls(isDark);
  const types = useMemo(() => spec.types ?? [], [spec.types]);
  const [selected, setSelected] = useState<string | null>(types[0]?.id ?? null);
  /** selected interaction — then its header is shown in the editor instead of a type */
  const [selectedIa, setSelectedIa] = useState<string | null>(null);
  /** InConfig is generated, not maintained — it only has a view */
  const [showConfig, setShowConfig] = useState(false);
  const interactions = useMemo(() => spec.interactions ?? [], [spec.interactions]);
  // which own block a step belongs to — the sidebar groups the interactions the same way as the flow
  const blocks = useMemo(() => blockIndex(spec.steps), [spec.steps]);
  // an interaction whose step is no longer in the flow — e.g. deleted in the diagram
  const stepIds = useMemo(() => new Set(allSteps(spec.steps).map(s => s.id)), [spec.steps]);
  const offen = useMemo(() => missingInteractions(spec, model), [spec, model]);

  // jump from the flow: show the requested type and acknowledge the request
  useEffect(() => {
    if (!focusTypeId) return;
    setSelected(focusTypeId);
    setSelectedIa(null);
    setShowConfig(false);
    onFocused?.();
  }, [focusTypeId, onFocused]);
  useEffect(() => {
    if (!focusIaId) return;
    setSelectedIa(focusIaId);
    setSelected(null);
    setShowConfig(false);
    onFocusedIa?.();
  }, [focusIaId, onFocusedIa]);

  const idx = useMemo(() => indexTypes(types, model, homeOf(spec)), [types, model, spec]);
  const issues = useMemo(() => checkTypes(types, model), [types, model]);
  // classes that already exist in the domain — do not belong in the data model (see referencedClass)
  const existing = useMemo(() => referenceExistingClasses(spec, model), [spec, model]);
  // … and classes that do not exist there (yet) — new, or the import is missing
  const notInDomain = useMemo(() => classesNotInDomain(spec, model), [spec, model]);
  const current = types.find(t => t.id === selected) ?? (selectedIa || showConfig ? null : types[0] ?? null);

  const setTypes = (next: TypeDef[]) => onChange({ ...spec, types: next });
  const pickType = (id: string) => { setSelected(id); setSelectedIa(null); setShowConfig(false); };

  /**
   * The four types of a process. It is the bracket: `In` going in, `Out`
   * coming out, `InitIn` the variables set at the start, `InConfig` the
   * adjusting knobs for tests. If one is missing, it is created on click —
   * except `InConfig`, which results from the flow.
   */
  const processSlot = (slot: 'root' | 'initIn' | 'processOut') => {
    const t = types.find(x => x[slot]);
    if (t) { pickType(t.id); return; }
    if (slot === 'initIn') {
      const next = syncInitIn(spec);
      if (next) {
        onChange({ ...spec, types: next });
        const created = next.find(x => x.initIn);
        if (created) pickType(created.id);
        return;
      }
    }
    const id = uid('t');
    const name = slot === 'root' ? 'In' : slot === 'processOut' ? 'Out' : 'InitIn';
    setTypes([...types, {
      id, name, kind: 'case', [slot]: true, status: 'draft', fields: [emptyField()],
    } as TypeDef]);
    pickType(id);
  };

  /**
   * Bring what the flow provides into the class builder: one interaction per user task,
   * own worker and signal — plus the `InitIn` from the
   * outputs of the init worker.
   */
  const ausAblauf = () => {
    const next = { ...spec };
    if (offen.length) next.interactions = [...interactions, ...offen.map(s => withOrigin(toInteraction(s), model, packageOf(spec, model)))];
    const withInit = syncInitIn(next);
    if (withInit) next.types = withInit;
    onChange(next);
  };

  // a new status of the interaction also applies to its In and Out — as with a step
  // for everything below it; otherwise the chip in the flow would stay on the status of a class
  const patchIa = (id: string, patch: Partial<Interaction>) =>
    onChange({
      ...spec,
      interactions: interactions.map(i => (i.id === id ? { ...i, ...patch } : i)),
      ...(patch.status ? { types: types.map(t => (t.interactionId === id ? { ...t, status: patch.status } : t)) } : {}),
    });

  /** In or Out of an interaction — created on the first click. */
  const openMember = (ia: Interaction, member: 'In' | 'Out') => {
    const key = member === 'In' ? 'inTypeId' : 'outTypeId';
    const existing = ia[key] as string | undefined;
    if (existing && types.some(t => t.id === existing)) { pickType(existing); return; }
    const entry = interactionStep(spec, ia) ? catalogEntry(interactionStep(spec, ia)!, model) : null;
    const t: TypeDef = createMemberType(ia, member, entry, model, packageOf(spec, model));
    const id = t.id;
    onChange({
      ...spec,
      types: [...types, t],
      interactions: interactions.map(i => (i.id === ia.id ? { ...i, [key]: id } : i)),
    });
    pickType(id);
  };
  /**
   * Set In or Out to another type (`type In = OrderCardUT.In`) —
   * or back to an own class (`null`). The fields come from the target;
   * this interaction's own class is dropped.
   */
  const setAlias = (ia: Interaction, member: 'In' | 'Out', ref: string | null) => {
    const aliasKey = member === 'In' ? 'inAlias' : 'outAlias';
    const typeKey = member === 'In' ? 'inTypeId' : 'outTypeId';
    const own = ia[typeKey] ? types.find(t => t.id === ia[typeKey] && t.interactionId === ia.id) : undefined;
    const rest = own ? types.filter(t => t.id !== own.id) : types;
    // a type of the catalog: its fields as a copy (for mappings and checks)
    const dom = ref?.startsWith('dom:') ? (model?.domainTypes ?? []).find(d => `dom:${d.id}` === ref) : undefined;
    const copy = dom ? aliasMemberType(ia, member, dom, model) : undefined;
    const dot = ref && !dom ? ref.lastIndexOf('.') : -1;
    const other = dot > 0 ? interactions.find(i => i.id === ref!.slice(0, dot)) : undefined;
    const targetId = copy ? copy.id : other ? (ref!.slice(dot + 1) === 'In' ? other.inTypeId : other.outTypeId) : undefined;
    onChange({
      ...spec,
      types: copy ? [...rest, copy] : rest,
      interactions: interactions.map(i => (i.id === ia.id
        ? { ...i, [aliasKey]: ref ?? undefined, [typeKey]: ref ? targetId : undefined }
        : i)),
    });
  };
  const patchType = (id: string, patch: Partial<TypeDef>) => {
    // In and Out of an interaction form a unit with it: a new status applies to all three
    const iaId = patch.status ? types.find(t => t.id === id)?.interactionId : undefined;
    if (iaId && interactions.some(i => i.id === iaId)) { patchIa(iaId, { status: patch.status }); return; }
    setTypes(types.map(t => (t.id === id ? { ...t, ...patch } : t)));
  };

  // The In is the root — there is exactly one and it lives in the process object.
  const addType = (kind: 'case' | 'enum', name = '', root = false): string => {
    const id = uid(kind === 'enum' ? 'e' : 't');
    const t: TypeDef = {
      id, kind, root: root || undefined,
      name: name || (kind === 'enum' ? 'NeueAuswahl' : 'NeueKlasse'),
      status: 'draft',
      ...(kind === 'enum' ? { values: [{ name: 'wert1' }] } : { fields: [emptyField()] }),
    };
    setTypes([...types, t]);
    setSelected(id);
    return id;
  };

  const removeType = (id: string) => {
    setTypes(types.filter(t => t.id !== id));
    if (selected === id) setSelected(null);
  };

  const hasRoot = types.some(t => t.root);
  const inConfig = types.find(t => t.inConfig) ?? null;
  /** own adjusting knobs — the generated InConfig gets a type to maintain */
  const addInConfig = () => {
    const id = uid('t');
    setTypes([...types, { id, name: 'InConfig', kind: 'case', inConfig: true, status: 'draft', fields: [emptyField()] }]);
    pickType(id);
  };
  const issuesOf = (id: string) => issues.filter(i => i.typeId === id);
  const globalIssues = issues.filter(i => !i.typeId);

  const clip = useClipboard();
  const source: ClipSource = { slug: spec.slug, title: spec.title || spec.name, engine: spec.engine };
  const clipActions: ClipActions = {
    copyType: t => setModelClip({ kind: 'type', source, typeId: t.id, types: typeClosure(types, [t.id]) }),
    copyField: f => setModelClip({ kind: 'field', source, field: f, types: typeClosure(types, [f.type]) }),
    pasteField: (typeId, valueIndex) => {
      const m = getClipboard().model;
      if (m?.kind !== 'field') return;
      const r = pasteField(spec, typeId, m, valueIndex);
      if (r) setTypes(r.types);
    },
  };
  const pasteTypeClip = () => {
    const m = getClipboard().model;
    if (m?.kind !== 'type') return;
    const r = pasteType(spec, m);
    setTypes(r.types);
    pickType(r.id);
  };
  const typeClip = clip.model?.kind === 'type' ? clip.model : null;

  return (
    <ClipContext.Provider value={clipActions}>
    <SpecContext.Provider value={spec}>
    <div className="flex h-full min-h-0">
      {/* ── Types ──────────────────────────────────────────────────────────── */}
      <div className={`w-72 flex-shrink-0 border-r ${c.border} flex flex-col`}>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <div className="mb-2">
            <div className={`text-[9px] uppercase tracking-widest px-2 py-1 ${c.muted}`}>Prozess</div>
            {([['root', 'In'], ['initIn', 'InitIn'], ['processOut', 'Out']] as const).map(([slot, label]) => {
              const t = types.find(x => x[slot]);
              return (
                <button key={slot} onClick={() => processSlot(slot)} data-cframe-base={t ? typeTarget(t.id) : undefined}
                  className={`group w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${c.hover} ${
                    t && selected === t.id ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
                  {t?.kind === 'enum' ? <ListOrdered size={11} className={c.muted} /> : <Braces size={11} className={c.muted} />}
                  <span className={`flex-1 truncate text-[11px] font-mono font-semibold ${t ? c.text : c.muted}`}>{label}</span>
                  {t && issuesOf(t.id).some(i => !i.warn) && <AlertTriangle size={10} className={isDark ? 'text-rose-400' : 'text-rose-600'} />}
                  {t && <CommentBubble target={typeTarget(t.id)} aggregate quiet inButton />}
                  {/* Every process has In and Out — if they are missing or empty, that is orange.
                      The InitIn results from the init worker; without it there is none, which is not a defect. */}
                  {!t && slot !== 'initIn'
                    ? <span className={`flex items-center gap-0.5 text-[9px] ${amber(isDark)}`} title={`${label} fehlt — anklicken legt es an`}><AlertTriangle size={9} /> fehlt</span>
                    : !t
                      ? <span className={`text-[9px] ${c.muted}`}>+</span>
                      : isEmptyType(t)
                        ? <span className={`flex items-center gap-0.5 text-[9px] ${amber(isDark)}`} title={`${label} ist leer — Felder fehlen`}><AlertTriangle size={9} /> leer</span>
                        : <span className={`text-[9px] ${c.muted}`}>{contentLabel(t)}</span>}
                </button>
              );
            })}
            <button onClick={() => { if (inConfig) pickType(inConfig.id); else { setShowConfig(true); setSelected(null); setSelectedIa(null); } }}
              title="Eigene Stellschrauben — dazu erzeugt aus dem Ablauf: Schleifen und Mocks"
              data-cframe-base={inConfig ? typeTarget(inConfig.id) : undefined}
              className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${c.hover} ${
                showConfig || (inConfig && selected === inConfig.id) ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
              <Braces size={11} className={c.muted} />
              <span className={`flex-1 truncate text-[11px] font-mono ${inConfig ? `font-semibold ${c.text}` : c.muted2}`}>InConfig</span>
              {inConfig && issuesOf(inConfig.id).some(i => !i.warn) && <AlertTriangle size={10} className={isDark ? 'text-rose-400' : 'text-rose-600'} />}
              {inConfig && <CommentBubble target={typeTarget(inConfig.id)} aggregate quiet inButton />}
              <span className={`text-[9px] ${c.muted}`}>{inConfig && !isEmptyType(inConfig) ? `${contentLabel(inConfig)} + erzeugt` : 'erzeugt'}</span>
            </button>
          </div>

          {(['userTask', 'customTask', 'decision', 'signal', 'message'] as const).map(kind => {
            const group = interactions.filter(ia => ia.kind === kind);
            if (!group.length) return null;
            // main flow first, then one bracket per own block or event subprocess
            const sub = new Map<string, { ref: BlockRef; items: Interaction[] }>();
            const main: Interaction[] = [];
            for (const ia of group) {
              const ref = blocks.get(ia.stepId);
              if (!ref) { main.push(ia); continue; }
              const e = sub.get(ref.head.id) ?? { ref, items: [] };
              e.items.push(ia);
              sub.set(ref.head.id, e);
            }
            const iaRow = (ia: Interaction) => {
                // What the DSL requires (In, for tasks and workers also Out) and is still
                // missing or empty turns orange — signals and messages without In
                // (or with an empty one) are `NoInput`, which is allowed
                const members = (['In', 'Out'] as const).filter(m => m === 'In' || INTERACTION_META[ia.kind].hasOut);
                const typeOf = (m: 'In' | 'Out') => { const id = m === 'In' ? ia.inTypeId : ia.outTypeId; return id ? types.find(x => x.id === id) ?? null : null; };
                const lacking = (m: 'In' | 'Out') => {
                  const t = typeOf(m);
                  if (m === 'In' && !INTERACTION_META[ia.kind].hasOut) return null;
                  if (!t) return 'fehlt';
                  return isEmptyType(t) ? 'leer' : null;
                };
                const mangel = members.some(m => lacking(m));
                return (
                <div key={ia.id}>
                  <button onClick={() => { setSelectedIa(ia.id); setSelected(null); }} data-cframe-base={iaTarget(ia.id)}
                    className={`group w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${c.hover} ${
                      selectedIa === ia.id ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
                    <Workflow size={11} className={c.muted} />
                    <span className={`flex-1 truncate text-[11px] font-mono font-semibold ${stepIds.has(ia.stepId) ? c.text : `line-through ${c.muted}`}`}>{ia.name}</span>
                    {!stepIds.has(ia.stepId)
                      ? <span title="Der Schritt ist nicht mehr im Ablauf — die Interaktion wird nicht exportiert" className={`text-[9px] ${amber(isDark)}`}>entfällt</span>
                      : mangel && <AlertTriangle size={10} className={amber(isDark)} />}
                    <CommentBubble target={iaTarget(ia.id)} quiet inButton />
                    <span className={`text-[9px] ${c.muted}`}>{INTERACTION_META[ia.kind].suffix || 'W'}</span>
                  </button>
                  <div className="flex gap-1 pl-6 pb-0.5">
                    {members.map(m => {
                        const t = typeOf(m);
                        const id = t?.id;
                        const fehl = lacking(m);
                        return (
                          <button key={m} onClick={() => openMember(ia, m)}
                            title={fehl === 'fehlt' ? `${m} fehlt — anlegen` : fehl === 'leer' ? `${m} ist leer — Felder fehlen` : t ? `${m} bearbeiten` : `${m} — NoInput, anlegen wenn gebraucht`}
                            className={`text-[9px] px-1.5 py-0.5 rounded border ${
                              selected === id ? (isDark ? 'bg-white/10 border-white/40' : 'bg-black/10 border-black/40')
                              : fehl ? (isDark ? 'border-amber-500/40' : 'border-amber-400') : c.border2
                            } ${fehl ? amber(isDark) : t ? c.muted2 : c.muted}`}>
                            {m}{t ? ` ${(t.fields ?? []).filter(f => f.name).length}` : ' +'}
                          </button>
                        );
                      })}
                  </div>
                </div>
                );
            };
            return (
            <div key={kind} className="mb-2">
              <div className={`text-[9px] uppercase tracking-widest px-2 py-1 ${c.muted}`}>{KIND_GROUP[kind]}</div>
              {main.map(iaRow)}
              {[...sub.values()].map(({ ref, items }) => (
                <div key={ref.head.id} className={`ml-2 pl-2 border-l-2 mt-1 ${isDark ? 'border-slate-500/40' : 'border-slate-300'}`}>
                  <div className={`flex items-center gap-1 px-1 py-0.5 text-[9px] ${isDark ? 'text-slate-300' : 'text-slate-600'}`}
                    title={ref.eventSub ? 'Ereignis-Subprozess — läuft neben dem Hauptablauf' : `Eigener Block — ${blockStart(ref.head)}`}>
                    <Unlink size={9} className="flex-shrink-0" />
                    <span className="truncate">{ref.eventSub ? 'Ereignis-Subprozess' : 'Eigener Block'} «{ref.head.name}»</span>
                  </div>
                  {items.map(iaRow)}
                </div>
              ))}
            </div>
            );
          })}

          {existing.moved.length > 0 && (
            <div className={`mx-2 my-1 text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
              <div>
                {existing.moved.length === 1 ? 'Eine Klasse gibt' : `${existing.moved.length} Klassen gibt`} es schon in der Domain —
                ins Datenmodell gehören nur neue: {existing.moved.join(', ')}
              </div>
              {canEdit && (
                <button onClick={() => onChange(existing.spec)}
                  title="Die Felder zeigen danach auf die Klasse im Katalog; die Kopie fällt weg und wird nicht mehr exportiert."
                  className="mt-1 underline hover:no-underline">
                  Als Verweis übernehmen
                </button>
              )}
            </div>
          )}
          {notInDomain.length > 0 && (
            <div className={`mx-2 my-1 text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
              title="Die Klassen im schema-Ordner des Prozesses kommen beim Import immer mit — diese stehen nirgends in der Domain.">
              {notInDomain.length === 1 ? 'Eine Klasse steht' : `${notInDomain.length} Klassen stehen`} nicht in der Domain — neu, oder fehlt der Import? {notInDomain.join(', ')}
            </div>
          )}
          <TypeGroup label="Klassen" isDark={isDark} all={types}
            types={types.filter(t => !t.root && !t.processOut && !t.initIn && !t.inConfig && !t.interactionId && t.kind === 'case')}
            selected={selected} onSelect={pickType} issuesOf={issuesOf} />
          <TypeGroup label="Auswahlen" isDark={isDark} all={types}
            types={types.filter(t => !t.root && !t.processOut && !t.initIn && !t.inConfig && !t.interactionId && t.kind === 'enum')}
            selected={selected} onSelect={pickType} issuesOf={issuesOf} />
          {/* legend — the colors say what is going on */}
          <div className={`text-[9px] px-2 pt-2 pb-1 leading-relaxed ${c.muted}`}>
            <span className={amber(isDark)}>orange</span> = fehlt etwas ·{' '}
            <span className={isDark ? 'text-rose-400' : 'text-rose-600'}>rot</span> = Fehler ·{' '}
            <span className="italic">grau kursiv</span> = nicht verwendet
          </div>
        </div>
        {canEdit && (
          <div className={`flex-shrink-0 border-t ${c.border} p-2 space-y-1`}>
            {!hasRoot && (
              <button onClick={() => addType('case', 'In', true)}
                className={`w-full flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded font-semibold ${c.btnPrimary}`}>
                <Plus size={11} /> Prozess-Eingabe «In»
              </button>
            )}
            {!!offen.length && (
              <button onClick={ausAblauf}
                title="Benutzeraufgaben, eigene Worker und Signale aus dem Ablauf übernehmen — dazu das InitIn"
                className={`w-full flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded border ${c.btn}`}>
                <Workflow size={11} /> {offen.length} aus dem Ablauf
              </button>
            )}
            <button onClick={() => addType('case')}
              className={`w-full flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded border ${c.btn}`}>
              <Braces size={11} /> Klasse
            </button>
            <button onClick={() => addType('enum')}
              className={`w-full flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded border ${c.btn}`}>
              <ListOrdered size={11} /> Auswahl
            </button>
            {typeClip && (() => {
              const t = typeClip.types.find(x => x.id === typeClip.typeId);
              const mit = typeClip.types.length - 1;
              return (
                <button onClick={pasteTypeClip}
                  title={`${t?.kind === 'enum' ? 'Auswahl' : 'Klasse'} «${t?.name ?? ''}» aus «${typeClip.source.title || typeClip.source.slug}» einfügen — als Kopie${mit ? `, mit ${mit === 1 ? 'einer Klasse' : `${mit} Klassen`}, auf die sie verweist` : ''}`}
                  className={`w-full flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded border ${c.btn}`}>
                  <ClipboardPaste size={11} className="flex-shrink-0" />
                  <span className="truncate">«{t?.name}» einfügen{mit ? ` (+${mit})` : ''}</span>
                </button>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Editor ─────────────────────────────────────────────────────────── */}
      {/* The editor in a readable width, centered — otherwise the field rows
          run into the void on a wide screen; inside it the fields fill the width */}
      <div className="flex-1 min-w-0 overflow-y-auto">
       <div className="max-w-4xl mx-auto w-full">
        {showConfig ? (
          <GeneratedConfig spec={spec} idx={idx} isDark={isDark} canEdit={canEdit} onAdd={addInConfig} />
        ) : !current && !selectedIa ? (
          <div className={`h-full flex items-center justify-center text-center px-8 text-xs ${c.muted}`}>
            <div className="max-w-sm space-y-2">
              <Braces size={24} className="mx-auto opacity-50" />
              <p>
                Noch kein Datenmodell. Beginne mit der <span className="font-semibold">Prozess-Eingabe «In»</span> —
                Felder mit Typ, Vorgabe und Einschränkung. Verschachtelte Klassen und Auswahlen
                legst du direkt aus dem Typ-Feld heraus an.
              </p>
              <p className="opacity-70">
                <span className="font-mono">InitIn</span> und <span className="font-mono">InConfig</span> entstehen
                zum grössten Teil aus dem Ablauf — links unter «Prozess».
              </p>
            </div>
          </div>
        ) : selectedIa ? (
          <InteractionEditor key={selectedIa}
            ia={interactions.find(i => i.id === selectedIa)!} isDark={isDark} canEdit={canEdit}
            types={types}
            orphan={!stepIds.has(interactions.find(i => i.id === selectedIa)?.stepId ?? '')}
            onPatch={patch => patchIa(selectedIa, patch)}
            onOpen={member => openMember(interactions.find(i => i.id === selectedIa)!, member)}
            interactions={interactions} model={model} ownPkg={packageOf(spec, model)}
            onAlias={(member, ref) => setAlias(interactions.find(i => i.id === selectedIa)!, member, ref)}
            onRemove={() => {
              // its In and Out belong only to it — they go along
              onChange({
                ...spec,
                interactions: interactions.filter(i => i.id !== selectedIa),
                types: (spec.types ?? []).filter(t => t.interactionId !== selectedIa),
              });
              setSelectedIa(null);
            }} />
        ) : current ? (
          <TypeEditor key={current.id} type={current} types={types} spec={spec}
            isDark={isDark} canEdit={canEdit}
            issues={issuesOf(current.id)} idx={idx} model={model}
            onPatch={patch => patchType(current.id, patch)}
            onRemove={() => removeType(current.id)}
            onAddType={addType}
            onOpenType={pickType}
            />
        ) : null}
        {!!globalIssues.length && (
          <div className={`mx-4 mb-4 text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
            {globalIssues.map((i, k) => <div key={k}>{i.message}</div>)}
          </div>
        )}
       </div>
      </div>
    </div>
    </SpecContext.Provider>
    </ClipContext.Provider>
  );
}

// ── InConfig ─────────────────────────────────────────────────────────────────
// View only: the fields result from the loops of the flow and from
// every step whose result can be overwritten for tests.
function GeneratedConfig({ spec, idx, isDark, canEdit, onAdd }: {
  spec: ProcessSpec; idx: ReturnType<typeof indexTypes>; isDark: boolean; canEdit: boolean;
  /** create own adjusting knobs */
  onAdd: () => void;
}) {
  const c = cls(isDark);
  const code = renderInConfig(spec, new Set<string>(), idx);
  return (
    <div className="p-4 space-y-3">
      <div>
        <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Prozess-Konfiguration</div>
        <div className={`text-sm font-semibold font-mono ${c.text}`}>InConfig</div>
      </div>
      <GeneratedNote isDark={isDark} />
      {canEdit && (
        <button onClick={onAdd}
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
          <Plus size={11} /> Eigene Stellschraube
        </button>
      )}
      {code
        ? <ScalaCode code={code} isDark={isDark} className={`text-[10px] leading-relaxed px-3 py-2 rounded border overflow-x-auto ${c.border2} ${c.muted2}`} />
        : <p className={`text-[11px] ${c.muted}`}>Noch nichts zu konfigurieren — der Ablauf hat weder Schleifen noch aufgerufene Services.</p>}
    </div>
  );
}

/** what comes from the flow into the InConfig */
function GeneratedNote({ isDark }: { isDark: boolean }) {
  const c = cls(isDark);
  return (
    <p className={`text-[11px] leading-relaxed ${c.muted}`}>
      <span className="font-semibold">Aus dem Ablauf erzeugt</span>: je Schleife <span className="font-mono">max…</span>,
      <span className="font-mono"> counter…</span> und <span className="font-mono">timerWait…</span>, dazu je Service und
      Teilprozess ein <span className="font-mono">…Mock</span>, mit dem sich sein Ergebnis in Tests überschreiben lässt.
      Eigene Stellschrauben stehen davor und brauchen einen Vorgabewert (oder sind optional) — der Prozess
      startet auch ohne sie.
    </p>
  );
}

// ── Interaction ──────────────────────────────────────────────────────────────
// Header of the interaction: object name, key (`val name` / `topicName` /
// `messageName`) and description. `In` and `Out` are next to it in the list.
function InteractionEditor({ ia, isDark, canEdit, types, orphan, interactions, model, ownPkg, onPatch, onOpen, onAlias, onRemove }: {
  ia: Interaction; isDark: boolean; canEdit: boolean; types: TypeDef[];
  /** the step is no longer in the flow */
  orphan: boolean;
  /** all interactions — their In and Out are fit as another type */
  interactions: Interaction[];
  model: Model | null;
  /** package of the process — catalog types from there come first */
  ownPkg: string;
  onPatch: (patch: Partial<Interaction>) => void;
  onOpen: (member: 'In' | 'Out') => void;
  /** set In or Out to another type — `null`: own class */
  onAlias: (member: 'In' | 'Out', ref: string | null) => void;
  onRemove: () => void;
}) {
  const confirm = useConfirm();
  const c = cls(isDark);
  const meta = INTERACTION_META[ia.kind];
  const typeOf = (id?: string) => types.find(t => t.id === id) ?? null;

  return (
    <div className="p-4 space-y-4">
      {orphan && (
        <div className={`flex items-center gap-2 text-[11px] px-3 py-2 rounded border ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span className="flex-1">
            Der Schritt <span className="font-mono">{ia.stepId}</span> steht nicht mehr im Ablauf — die Interaktion
            wird nicht exportiert. Bleibt der Schritt weg, kann sie samt In und Out entfernt werden.
          </span>
          {canEdit && (
            <button onClick={async () => { if (await confirm({ title: `Interaktion «${ia.name}» entfernen?`, text: 'Samt In und Out.' })) onRemove(); }}
              className={`flex items-center gap-1 px-2 py-1 rounded border ${c.btn}`}>
              <Trash2 size={11} /> Entfernen
            </button>
          )}
        </div>
      )}
      <div data-cframe={iaTarget(ia.id)} className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] uppercase tracking-widest flex items-center gap-2 ${c.muted}`}>
            {meta.label}
            <CommentBubble target={iaTarget(ia.id)} title={`Kommentare zu «${ia.name}»`} />
          </div>
          <input value={ia.name} disabled={!canEdit}
            onChange={e => onPatch({ name: e.target.value })}
            className={`w-full bg-transparent outline-none text-sm font-semibold font-mono ${c.text}`} />
          <div className={`text-[9px] font-mono mt-0.5 ${c.muted}`}>
            extends {meta.dsl} · Schritt {ia.stepId}
          </div>
        </div>
        {/* the status of the unit: the lowest of interaction, In and Out — otherwise this would show
            «Abgenommen» while the Out is still «Angepasst», and choosing the same would trigger nothing */}
        <select value={interactionStatus(ia, { types }) ?? ia.status ?? 'draft'} disabled={!canEdit}
          title="Status der Interaktion samt In und Out (der kleinste) — eine Wahl gilt für alle drei"
          onChange={e => onPatch({ status: e.target.value as Status })}
          className={`text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        {canEdit && (
          <button onClick={async () => { if (await confirm({ title: `Interaktion «${ia.name}» entfernen?`, text: 'Samt In und Out.' })) onRemove(); }}
            title="Interaktion entfernen" className={`p-1.5 rounded border ${c.btn}`}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div>
        <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.muted}`}>
          val {meta.keyName}
        </label>
        <input value={ia.key} disabled={!canEdit} onChange={e => onPatch({ key: e.target.value })}
          className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
      </div>

      {ia.kind === 'decision' && (
        <div>
          <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.muted}`}>Ergebnis</label>
          <select value={ia.decisionResult ?? 'singleResult'} disabled={!canEdit}
            onChange={e => onPatch({ decisionResult: e.target.value as DecisionResult })}
            title="Die Form des Ergebnisses — wie die Fabrik in Orchescala (BpmnDecisionDsl)"
            className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`}>
            {DMN_FORMS.map(f => <option key={f.id} value={f.id}>{f.id} — {f.label}</option>)}
          </select>
          {dmnIssues(ia, types).map((m, k) => (
            <p key={k} className={`mt-1 text-[10px] flex items-start gap-1 ${amber(isDark)}`}>
              <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{m}</span>
            </p>
          ))}
        </div>
      )}

      <textarea value={ia.descr ?? ''} disabled={!canEdit} rows={3}
        onChange={e => onPatch({ descr: e.target.value || undefined })}
        placeholder="Was passiert hier fachlich?"
        className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />

      <div className="flex gap-2">
        {(['In', 'Out'] as const).filter(m => m === 'In' || meta.hasOut).map(m => (
          <MemberCard key={m} ia={ia} member={m} types={types} interactions={interactions} model={model} ownPkg={ownPkg}
            isDark={isDark} canEdit={canEdit} onOpen={() => onOpen(m)} onAlias={ref => onAlias(m, ref)}
            onExample={values => onPatch(m === 'In' ? { inExample: values } : { outExample: values })} />
        ))}
      </div>

      <p className={`text-[10px] leading-relaxed ${c.muted}`}>
        Ohne eigenes {meta.hasOut ? '«In» bzw. «Out»' : '«In»'} erzeugt der Generator
        <span className="font-mono"> type In = NoInput</span> — so schreibt es die Domain auch.
      </p>
    </div>
  );
}

/**
 * In or Out of an interaction: an own class — or another type
 * (`type In = OrderCardUT.In`), the member of another interaction or a
 * type of the domain. Plus the values that differ in the interaction's example
 * (`OrderCardUT.In.example.copy(clientKeyIsIdentityOk = false)`).
 */
function MemberCard({ ia, member, types, interactions, model, ownPkg, isDark, canEdit, onOpen, onAlias, onExample }: {
  ia: Interaction; member: 'In' | 'Out'; types: TypeDef[]; interactions: Interaction[]; model: Model | null; ownPkg: string;
  isDark: boolean; canEdit: boolean;
  onOpen: () => void; onAlias: (ref: string | null) => void; onExample: (values: Record<string, string> | undefined) => void;
}) {
  const c = cls(isDark);
  const confirm = useConfirm();
  const alias = member === 'In' ? ia.inAlias : ia.outAlias;
  const typeId = member === 'In' ? ia.inTypeId : ia.outTypeId;
  const t = types.find(x => x.id === typeId) ?? null;
  const values = (member === 'In' ? ia.inExample : ia.outExample) ?? {};
  const label = (ref: string): string => {
    if (ref.startsWith('dom:')) return (model?.domainTypes ?? []).find(d => `dom:${d.id}` === ref)?.name ?? ref.slice(4);
    const dot = ref.lastIndexOf('.');
    const other = interactions.find(i => i.id === ref.slice(0, dot));
    return other ? `${other.name}.${ref.slice(dot + 1)}` : '(nicht mehr da)';
  };
  // the same member of the other interactions of the process — an In only an In, an Out only an Out
  const options = interactions.filter(i => i.id !== ia.id && i.name?.trim()).flatMap(i => (member === 'In'
    ? (i.inTypeId && !i.inAlias ? [`${i.id}.In`] : [])
    : (i.outTypeId && !i.outAlias && INTERACTION_META[i.kind].hasOut ? [`${i.id}.Out`] : [])));
  const fieldNames = [...(t?.fields ?? []), ...(t?.values ?? []).flatMap(v => v.fields ?? [])].map(f => f.name).filter(Boolean);
  const setValue = (name: string, value: string | null, rename?: string) => {
    const next = { ...values };
    delete next[name];
    if (value != null) next[rename ?? name] = value;
    onExample(Object.keys(next).length ? next : undefined);
  };
  const own = !alias && t && t.interactionId === ia.id;
  // from the catalog: `X.In` or `X.Out` of other objects — searched, there are many
  const [query, setQuery] = useState<string | null>(null);
  const catalog = useMemo(() => (query == null ? [] : catalogMembers(model, member, ownPkg,
    new Set(interactions.map(i => i.name).filter(Boolean)))), [query == null, model, member, ownPkg, interactions]);
  const hits = query == null ? [] : catalog.filter(d => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hay = `${d.name} ${d.pkg}`.toLowerCase();
    return words.every(w => hay.includes(w));
  }).slice(0, 12);
  const pick = async (v: string) => {
    // the own class gets lost — with fields, ask first
    if (own && (t?.fields?.length ?? 0) > 0
      && !(await confirm({ title: `${member} auf ${label(v)} stellen?`, text: `Die eigene Klasse ${ia.name}.${member} (${t!.fields!.length} Felder) fällt weg.`, confirmLabel: 'Umstellen' }))) return;
    setQuery(null);
    onAlias(v);
  };
  return (
    <div className={`flex-1 min-w-0 rounded border ${c.border2}`}>
      <button onClick={onOpen} className={`w-full text-[11px] px-3 py-2 text-left ${c.hover}`}>
        <div className={`font-mono ${c.text}`}>{member}{alias ? ` = ${label(alias)}` : ''}</div>
        <div className={`text-[10px] ${c.muted}`}>
          {alias ? `${t?.fields?.length ?? 0} Felder von ${label(alias)} — ansehen` : t ? `${t.fields?.length ?? 0} Felder — bearbeiten` : 'noch keines — anlegen'}
        </div>
      </button>
      <div className={`px-3 py-2 space-y-1.5 border-t ${c.border}`}>
        <select value={alias ?? ''} disabled={!canEdit}
          onChange={e => { const v = e.target.value || null; if (v) void pick(v); else onAlias(null); }}
          title="Ein anderer Typ: der Export schreibt `type In = OrderCardUT.In` — Felder und Beispiel kommen von dort"
          className={`w-full text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input}`}>
          <option value="">eigene Klasse</option>
          {alias && !options.includes(alias) && <option value={alias}>= {label(alias)}</option>}
          {options.map(o => <option key={o} value={o}>= {label(o)}</option>)}
        </select>
        {canEdit && (query == null ? (
          <button onClick={() => setQuery('')} className={`text-[10px] ${c.muted} hover:underline`}
            title={`Ein ${member} aus dem Katalog — eines anderen Prozesses oder Projekts`}>
            aus dem Katalog …
          </button>
        ) : (
          <div className={`rounded border ${c.border2}`}>
            <div className="flex items-center gap-1 px-1.5 py-0.5">
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setQuery(null); if (e.key === 'Enter' && hits[0]) void pick(`dom:${hits[0].id}`); }}
                placeholder={`${catalog.length} ${member} im Katalog durchsuchen …`}
                className={`flex-1 min-w-0 bg-transparent outline-none text-[10px] font-mono ${c.text}`} />
              <button onClick={() => setQuery(null)} title="Schliessen" className={c.muted}><X size={10} /></button>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {hits.map(d => (
                <button key={d.id} onClick={() => void pick(`dom:${d.id}`)} title={d.id}
                  className={`w-full flex items-center gap-2 px-1.5 py-0.5 text-left ${c.hover}`}>
                  <span className={`font-mono text-[10px] truncate ${c.text}`}>{d.name}</span>
                  <span className={`ml-auto text-[9px] truncate max-w-[10rem] ${c.muted}`}>{d.pkg}</span>
                </button>
              ))}
              {!hits.length && <div className={`px-1.5 py-1 text-[10px] ${c.muted}`}>{catalog.length ? 'Nichts gefunden.' : 'Kein Katalog geladen (Admin → Katalog).'}</div>}
            </div>
          </div>
        ))}
        {(Object.keys(values).length > 0 || canEdit) && (
          <div className="space-y-1">
            <div className={`text-[9px] uppercase tracking-widest ${c.muted}`}
              title={`Werte, die im Beispiel der Interaktion anders sind: ${alias ? label(alias) : member}.example.copy(…)`}>
              Beispiel abweichend
            </div>
            {Object.entries(values).map(([name, value]) => (
              <div key={name} className="flex items-center gap-1">
                <select value={name} disabled={!canEdit} onChange={e => setValue(name, value, e.target.value)}
                  className={`w-28 text-[10px] px-1 py-0.5 rounded border outline-none font-mono ${c.input}`}>
                  {[...new Set([name, ...fieldNames])].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <input value={value} disabled={!canEdit} onChange={e => setValue(name, e.target.value)}
                  placeholder="Scala, z. B. false" title="Scala-Ausdruck — wie im Beispiel"
                  className={`flex-1 min-w-0 text-[10px] px-1.5 py-0.5 rounded border outline-none font-mono ${c.input}`} />
                {canEdit && <button onClick={() => setValue(name, null)} title="Wert entfernen" className={c.muted}><X size={10} /></button>}
              </div>
            ))}
            {canEdit && fieldNames.some(n => !(n in values)) && (
              <button onClick={() => setValue(fieldNames.find(n => !(n in values))!, '')}
                className={`text-[10px] ${c.muted} hover:underline`}>+ Wert</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Type list ────────────────────────────────────────────────────────────────
function TypeGroup({ label, types, all, selected, onSelect, isDark, issuesOf }: {
  label: string; types: TypeDef[];
  /** all types — to see who points to one */
  all: TypeDef[];
  selected: string | null; isDark: boolean;
  onSelect: (id: string) => void; issuesOf: (id: string) => Array<{ warn?: boolean }>;
}) {
  const c = cls(isDark);
  if (!types.length) return null;
  return (
    <div className="mb-2">
      <div className={`text-[9px] uppercase tracking-widest px-2 py-1 ${c.muted}`}>{label}</div>
      {types.map(t => {
        const used = usageCount(all, t.id);
        const leer = isEmptyType(t);
        return (
        <button key={t.id} onClick={() => onSelect(t.id)} data-cframe-base={typeTarget(t.id)}
          title={used ? `${used}× als Feldtyp verwendet` : 'Kein Feld zeigt auf diesen Typ — Überbleibsel?'}
          className={`group w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${c.hover} ${
            selected === t.id ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
          {t.kind === 'enum' ? <ListOrdered size={11} className={c.muted} /> : <Braces size={11} className={c.muted} />}
          {/* bold what is used; gray and italic what nothing points to */}
          <span className={`flex-1 truncate text-[11px] font-mono ${used ? `font-semibold ${c.text}` : `italic ${c.muted}`}`}>{t.name}</span>
          {leer && <span className={`flex items-center gap-0.5 text-[9px] ${amber(isDark)}`} title="leer — Felder fehlen"><AlertTriangle size={9} /> leer</span>}
          {issuesOf(t.id).some(i => !i.warn) && <AlertTriangle size={10} className={isDark ? 'text-rose-400' : 'text-rose-600'} />}
          <CommentBubble target={typeTarget(t.id)} aggregate quiet inButton />
          <span className={`text-[9px] ${c.muted}`}>
            {leer ? '' : contentLabel(t)}{used ? ` · ${used}×` : ' · ungenutzt'}
          </span>
        </button>
        );
      })}
    </div>
  );
}

// ── Type editor ──────────────────────────────────────────────────────────────
function TypeEditor({ type: t, types, spec, isDark, canEdit, issues, idx, model, onPatch, onRemove, onAddType, onOpenType }: {
  type: TypeDef; types: TypeDef[]; spec: ProcessSpec;
  isDark: boolean; canEdit: boolean; model: Model | null;
  issues: { field?: string; message: string; warn?: boolean; suggestion?: string; value?: string }[];
  idx: ReturnType<typeof indexTypes>;
  onPatch: (patch: Partial<TypeDef>) => void;
  onRemove: () => void;
  onAddType: (kind: 'case' | 'enum') => string;
  /** jump to an own type (click on the type chip) */
  onOpenType: (id: string) => void;
}) {
  // In or Out of an interaction: a unit with it (one status for all three)
  const unit = t.interactionId ? (spec.interactions ?? []).find(x => x.id === t.interactionId) ?? null : null;
  const confirm = useConfirm();
  const clip = useContext(ClipContext);
  const c = cls(isDark);
  const fields = t.fields ?? [];
  // The Scala preview stays closed until one wants it — and remembers that
  const [showCode, setShowCodeState] = useState(() => { try { return localStorage.getItem(SCALA_KEY) === '1'; } catch { return false; } });
  const setShowCode = (on: boolean) => { setShowCodeState(on); try { localStorage.setItem(SCALA_KEY, on ? '1' : '0'); } catch { /* ignore */ } };

  const setField = (i: number, patch: Partial<Field>) =>
    onPatch({ fields: fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) });
  const moveField = (i: number, by: number) => {
    const next = [...fields];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onPatch({ fields: next });
  };

  // the error first; a warning only if there is none
  const issueOf = (fieldId: string) => issues.find(i => i.field === fieldId && !i.warn) ?? issues.find(i => i.field === fieldId);
  const typeIssues = issues.filter(i => !i.field && !i.value);
  // the suggested name for the type — or for one of its enum values
  const suggest = (i: { suggestion?: string; value?: string }) => i.suggestion && canEdit && (
    <SuggestButton name={i.suggestion} isDark={isDark} onTake={() => onPatch(i.value
      ? { values: (t.values ?? []).map(v => (v.name === i.value ? { ...v, name: i.suggestion! } : v)) }
      : { name: i.suggestion! })} />
  );
  // via the name in the catalog: a class of another domain is imported, not exported
  const origin = referencedClass(t, model, packageOf(spec, model));
  // the InConfig shows what results overall — own and generated fields
  const code = t.inConfig ? renderInConfig(spec, new Set<string>(), idx) : renderType(t, idx);

  return (
    <div className="p-4 space-y-4">
      {/* header */}
      <div data-cframe={typeTarget(t.id)} className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] uppercase tracking-widest flex items-center gap-2 ${c.muted}`}>
            {t.root ? 'Prozess-Eingabe' : t.inConfig ? 'Prozess-Konfiguration' : t.kind === 'enum' ? (isAdt(t) ? 'Auswahl mit Fällen (ADT)' : 'Auswahl (enum)') : 'Klasse (case class)'}
            <CommentBubble target={typeTarget(t.id)} title={`Kommentare zu «${t.name}»`} />
            {/* The In of a process is mostly a class — but it can be an ADT
                (`enum In: case Standard(…) case VermoegensVerwaltung(…)`),
                if the same process starts with different inputs. */}
            {t.root && canEdit && (
              <select value={t.kind} onChange={e => onPatch(switchKind(t, e.target.value as 'case' | 'enum'))}
                title="Klasse oder Auswahl mit Fällen (ADT) — die Felder der Klasse werden die gemeinsamen Felder, und zurück"
                className={`text-[10px] normal-case tracking-normal px-1.5 py-0.5 rounded border outline-none ${c.input}`}>
                <option value="case">Klasse</option>
                <option value="enum">Auswahl mit Fällen (ADT)</option>
              </select>
            )}
          </div>
          <input value={t.name} disabled={!canEdit || t.root || t.inConfig}
            onChange={e => onPatch({ name: e.target.value })}
            className={`w-full bg-transparent outline-none text-sm font-semibold font-mono ${c.text}`} />
        </div>
        <select value={(unit ? interactionStatus(unit, { types }) : null) ?? t.status ?? 'draft'} disabled={!canEdit}
          title={unit ? 'Status der Interaktion samt In und Out (der kleinste) — eine Wahl gilt für alle drei' : undefined}
          onChange={e => onPatch({ status: e.target.value as Status })}
          className={`text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        {clip && !t.inConfig && (
          <ClipCopyButton onCopy={() => clip.copyType(t)}
            title={`${t.kind === 'enum' ? 'Auswahl' : 'Klasse'} kopieren — mit den eigenen Klassen, auf die sie verweist. Einfügen links unten im Datenmodell, auch eines anderen Prozesses oder Tabs.`}
            className={`p-1.5 rounded border ${c.btn}`} />
        )}
        {canEdit && !t.root && (
          <button onClick={async () => { if (await confirm({ title: `Typ «${t.name || 'ohne Namen'}» löschen?` })) onRemove(); }}
            title="Typ löschen" className={`p-1.5 rounded border ${c.btn}`}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <textarea value={t.description ?? ''} disabled={!canEdit} rows={2}
        onChange={e => onPatch({ description: e.target.value })}
        placeholder="Wofür steht dieser Typ fachlich?"
        className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />

      {t.inConfig && <GeneratedNote isDark={isDark} />}

      {origin.type && (
        <p className={`text-[10px] ${c.muted}`}
          title="Die Klasse gibt es schon in einer anderen Domain — der Export legt sie nicht nochmals an, sondern importiert sie.">
          aus <span className="font-mono">{origin.type.pkg}</span> — referenziert, wird importiert und nicht exportiert
        </p>
      )}
      {origin.ambiguous && (
        <p className={`text-[10px] ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
          «{t.name}» gibt es in mehreren Projekten ({origin.ambiguous.join(', ')}) — wird als neue Klasse exportiert; prüfen.
        </p>
      )}

      {typeIssues.some(i => !i.warn) && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
          {typeIssues.filter(i => !i.warn).map((i, k) => <div key={k}>{i.message}{suggest(i)}</div>)}
        </div>
      )}
      {/* hints — valid, but worth a second look */}
      {typeIssues.some(i => i.warn) && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
          {typeIssues.filter(i => i.warn).map((i, k) => <div key={k}>{i.message}{suggest(i)}</div>)}
        </div>
      )}

      {t.kind === 'enum'
        ? <EnumEditor type={t} types={types} isDark={isDark} canEdit={canEdit} idx={idx} model={model} issues={issues} onPatch={onPatch} onAddType={onAddType} onOpenType={onOpenType} />
        : (
          <div className="space-y-2">
            {fields.map((f, i) => (
              <FieldRow key={f.id} field={f} index={i} last={i === fields.length - 1}
                types={types} selfId={t.id} isDark={isDark} canEdit={canEdit} idx={idx} model={model}
                issue={issueOf(f.id)}
                onChange={patch => setField(i, patch)}
                onRemove={() => onPatch({ fields: fields.filter((_, k) => k !== i) })}
                onMove={by => moveField(i, by)}
                onAddType={onAddType} onOpenType={onOpenType} />
            ))}
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => onPatch({ fields: [...fields, emptyField()] })}
                  className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
                  <Plus size={11} /> Feld
                </button>
                <PasteFieldButton typeId={t.id} isDark={isDark} />
              </div>
            )}
          </div>
        )}

      {/* Scala preview of the type — expandable; the whole domain code is in the export */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <button onClick={() => setShowCode(!showCode)}
            className={`flex items-center gap-1 text-[10px] uppercase tracking-widest ${c.muted} hover:underline`}>
            {showCode ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Scala
          </button>
          {showCode && <CopyButton text={code} isDark={isDark} />}
        </div>
        {showCode && (
          <ScalaCode code={code} isDark={isDark}
            className={`text-[10px] leading-relaxed px-3 py-2 rounded border overflow-x-auto ${c.border2} ${c.muted2}`} />
        )}
      </div>

    </div>
  );
}

// ── Field ────────────────────────────────────────────────────────────────────
function FieldRow({ field: f, index, last, types, selfId, isDark, canEdit, idx, model, issue, onChange, onRemove, onMove, onAddType, onOpenType }: {
  field: Field; index: number; last: boolean; types: TypeDef[]; selfId: string;
  isDark: boolean; canEdit: boolean; issue?: { message: string; warn?: boolean; suggestion?: string }; model: Model | null;
  idx: ReturnType<typeof indexTypes>;
  onChange: (patch: Partial<Field>) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
  onAddType: (kind: 'case' | 'enum') => string;
  onOpenType: (id: string) => void;
}) {
  const confirm = useConfirm();
  const clip = useContext(ClipContext);
  const spec = useContext(SpecContext);
  const c = cls(isDark);
  // the type the field belongs to — it determines whether there is a default
  const owner = types.find(t => t.id === selfId);
  const ofPattern = spec ? patternOfField(spec, owner, f) : null;
  // the example value from the domain (`defaultClientKey`) that the example takes without an own value
  const fromDomain = idx.defaultOf(f);
  // The type as a chip: the color says what it is — simple (gray), own
  // class (blue), choice or variant (violet), catalog (teal, plug),
  // unknown (red). Own types are clickable and jump there.
  const chip = typeChip(f, types, idx, model, isDark);
  // restrictions only where they mean something (text and numbers)
  const canConstrain = !!constraintKind(f.type);
  // Cases of a choice — own or from the catalog. For a choice with
  // fields (ADT) a case is a class, for a simple one a fixed value
  const cases = casesOf(f.type, idx);
  const simple = isSimpleEnum(f.type, idx);
  // a fixed case of a simple choice is a single value
  const fixedValue = simple && !!f.enumCase;
  const fixedOk = idx.domainOf(f.type)?.fixedCases;

  const changeType = (v: string) => {
    if (v === NEW_CASE || v === NEW_ENUM) {
      // create a new type directly from the field and link it
      const id = onAddType(v === NEW_CASE ? 'case' : 'enum');
      onChange({ type: id, constraint: undefined });
      return;
    }
    // on a type change, drop a restriction that no longer fits
    const keep = v === f.type || (constraintKind(v) && constraintKind(v) === constraintKind(f.type));
    onChange({ type: v, enumCase: undefined, ...(keep ? {} : { constraint: undefined }) });
  };

  // all fields the same: font, line height, padding — 28px high
  const box = `text-[11px] leading-[18px] px-2 py-1 rounded border outline-none ${c.input}`;
  return (
    <div data-cframe={f.name ? sub(typeTarget(selfId), `field:${f.id}`) : undefined}
      className={`group rounded border px-2 py-2 space-y-1.5 ${!issue ? c.border2
        : issue.warn ? (isDark ? 'border-amber-500/40' : 'border-amber-400')
          : (isDark ? 'border-rose-500/40' : 'border-rose-400')}`}>
      {/* 1 · the name across the full width; on the right the result as a Scala type, comment and buttons */}
      <div className="flex items-center gap-1.5">
        <input value={f.name} disabled={!canEdit} onChange={e => onChange({ name: e.target.value })}
          placeholder="feldName" title={f.name || undefined}
          className={`flex-1 min-w-0 font-mono font-semibold ${box}`} />
        {/* required: not optional — as in the mappings */}
        {!f.optional && f.name && <span className={`-ml-1 text-[11px] ${c.muted}`} title="Pflichtfeld — nicht optional">*</span>}
        {chip.ownId ? (
          <button onClick={() => onOpenType(chip.ownId!)} title={`${fieldType(f, idx)} — zum Typ springen`}
            className={`flex-shrink-0 flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[40%] ${chip.cls}`}>
            {chip.icon}<span className="truncate">{fieldType(f, idx)}</span><ExternalLink size={9} className="flex-shrink-0 opacity-60" />
          </button>
        ) : (
          <span title={chip.title ?? fieldType(f, idx)}
            className={`flex-shrink-0 flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[40%] ${chip.cls}`}>
            {chip.icon}<span className="truncate">{fieldType(f, idx)}</span>
          </span>
        )}
        {ofPattern && (
          <span title={`Gehört zum Pattern «${ofPattern.name}» — der Init-Worker setzt es aus processLabels; mit dem Pattern geht es wieder`}
            className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${patternTone(isDark)}`}>
            <Puzzle size={10} />{ofPattern.name}
          </span>
        )}
        {f.name && <CommentBubble target={sub(typeTarget(selfId), `field:${f.id}`)} quiet />}
        {clip && f.name && (
          <ClipCopyButton onCopy={() => clip.copyField(f)}
            title="Feld kopieren — einfügen unter den Feldern einer Klasse, auch eines anderen Prozesses oder Tabs"
            className={`p-1 flex-shrink-0 ${c.muted}`} />
        )}
        {canEdit && (
          <div className="flex items-center flex-shrink-0">
            <button onClick={() => onMove(-1)} disabled={index === 0} className={`p-1 disabled:opacity-20 ${c.muted}`}><ArrowUp size={11} /></button>
            <button onClick={() => onMove(1)} disabled={last} className={`p-1 disabled:opacity-20 ${c.muted}`}><ArrowDown size={11} /></button>
            <button onClick={async () => { if (await confirm({ title: f.name ? `Feld «${f.name}» entfernen?` : 'Leeres Feld entfernen?' })) onRemove(); }}
              title="Feld entfernen" className={`p-1 ${c.muted}`}><Trash2 size={11} /></button>
          </div>
        )}
      </div>

      {/* 2 · the type — with case, wrappers, restriction and default */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <TypePicker value={f.type} types={types} selfId={selfId} model={model} isDark={isDark}
          className="flex-1 min-w-[14rem]" disabled={!canEdit} onPick={changeType}
          onCreate={kind => changeType(kind === 'case' ? NEW_CASE : NEW_ENUM)} />
        {/* A choice with cases: the field can mean a single variant
            (`CustomDocContents.\`QI-Deklaration\``) — or all */}
        {cases && (
          <select value={f.enumCase ? caseName(f.enumCase) : ''} disabled={!canEdit}
            onChange={e => {
              const v = e.target.value || undefined;
              // a fixed value is a single one — not multiple, no map
              onChange({ enumCase: v, ...(v && simple ? { collection: undefined, map: undefined } : {}) });
            }}
            title={simple
              ? 'Fester Fall: das Feld hat genau diesen Wert — in Scala `X.fall.type = X.fall` (z. B. processStatus im Out)'
              : 'Ausprägung: nur dieser Fall der Auswahl — oder alle'}
            className={`h-7 font-mono max-w-[14rem] ${box}`}>
            <option value="">{simple ? 'beliebiger Fall' : 'alle Fälle'}</option>
            {cases.map(v => (
              <option key={v} value={v} disabled={simple && !!fixedOk && !fixedOk.includes(v)}>
                {simple ? `nur ${v}` : v}{simple && fixedOk && !fixedOk.includes(v) ? ' (keine Givens)' : ''}
              </option>
            ))}
          </select>
        )}

        <label className={`flex items-center gap-1 text-[11px] ${c.muted2}`} title="Option[…] — darf fehlen">
          <input type="checkbox" checked={!!f.optional} disabled={!canEdit}
            onChange={e => onChange({ optional: e.target.checked || undefined })} />
          optional
        </label>
        <label className={`flex items-center gap-1 text-[11px] ${c.muted2}`} title="Seq[…] — mehrfach">
          <input type="checkbox" checked={!!f.collection} disabled={!canEdit || fixedValue}
            onChange={e => onChange({ collection: e.target.checked || undefined })} />
          mehrfach
        </label>
        <label className={`flex items-center gap-1 text-[11px] ${c.muted2}`} title="Map[String, …] — Schlüssel ist ein Text, der Typ hier ist der Wert">
          <input type="checkbox" checked={!!f.map} disabled={!canEdit || fixedValue}
            onChange={e => onChange({ map: e.target.checked || undefined })} />
          Map
        </label>

        {canConstrain && <ConstraintPicker field={f} isDark={isDark} canEdit={canEdit} onChange={onChange} box={box} />}
        {/* Defaults exist only in the InConfig, in the InitIn (initializes process variables) and for
            optional fields of the process input (there the init worker sets them in the InitIn).
            FEEL with «=», without «=» a Scala expression */}
        {(owner?.inConfig || owner?.initIn || owner?.root || f.default) && (
          <FeelInput value={f.default ?? ''} isDark={isDark} size="md"
            disabled={!canEdit || (!!owner && !defaultIsUsed(owner, f) && !f.default)}
            variables={[]}
            onChange={v => onChange({ default: v || undefined })}
            placeholder={owner?.root && !f.optional ? 'Vorgabe nur bei optional' : 'Vorgabe, z. B. = [1, 2]'}
            title={(owner?.root
              ? 'Wert, wenn das optionale Feld fehlt — der Init-Worker setzt ihn im InitIn (dort ist das Feld Pflicht).\n'
              : owner?.inConfig ? 'Vorgabewert der Konfiguration.\n'
                : owner?.initIn ? 'Anfangswert der Prozessvariable.\n'
                  : 'Vorgaben gibt es nur im InConfig, im InitIn und bei optionalen Feldern der Prozess-Eingabe — hier wird sie nicht verwendet.\n')
              + 'Als FEEL mit «=», z. B. = [90, 110, 140], = "CH", = date("2026-01-01") oder = {ort: "Bern"} — der Export schreibt ihn als Scala. Ohne «=» ein Scala-Ausdruck, wörtlich übernommen.'}
            className="flex-1 min-w-[12rem]" />
        )}
      </div>

      {/* 3 · the meaning and an example */}
      <div className="flex flex-wrap items-start gap-x-1.5 gap-y-1">
        {/* an expression from the domain (`clientKeyDescr`) stays one until the description is changed */}
        {/* like the example: text — with «=» FEEL, an expression from the domain
            (`clientKeyDescr`, `s"…${X.processName}"`) stays Scala. Grows with
            the text — a long description is shown in full */}
        <FeelInput multiline mono={!!f.descriptionExpr} value={f.descriptionExpr ?? f.description ?? ''} isDark={isDark} size="md" disabled={!canEdit}
          variables={[]}
          onChange={v => {
            const t = v.trim();
            // what looks like Scala is exported as such (`@description(clientKeyDescr)`)
            if (t && !t.startsWith('=') && looksLikeScala(t, 'description')) {
              onChange({ descriptionExpr: t, description: undefined, ...(t === f.descriptionExpr ? {} : { descriptionImports: undefined }) });
            } else {
              onChange({ description: v || undefined, descriptionExpr: undefined, descriptionImports: undefined });
            }
          }}
          placeholder="fachliche Bedeutung (@description)"
          title={(f.descriptionExpr
            ? `Aus der Domain: @description(${f.descriptionExpr}) — wird so exportiert.${f.description && f.description !== f.descriptionExpr ? `\nLesbar: ${f.description}` : ''}\n`
            : 'Fachliche Bedeutung — wird zu @description("…").\n')
            + 'Mit «=» FEEL, das einen Text ergibt, z. B. = "Kunde " + "Nummer". '
            + 'Ein Verweis wie clientKeyDescr, Texte.kunde oder s"…${X.processName}" bleibt Scala.'}
          className="flex-[2] min-w-[14rem]" />
        {/* like the default: FEEL with «=»; without «=» for text the text itself, otherwise Scala (that is how it comes from the domain) */}
        <FeelInput value={f.example ?? ''} isDark={isDark} size="md" disabled={!canEdit}
          variables={[]}
          onChange={v => onChange({ example: v || undefined })}
          placeholder={fromDomain?.name ?? 'Beispiel, z. B. = "CH"'}
          title={(fromDomain
            ? `Beispielwert für example — ohne Angabe ${fromDomain.name} aus ${fromDomain.pkg}.\n`
            : 'Beispielwert für example — ohne Angabe leitet die App einen ab.\n')
            + 'Als FEEL mit «=», z. B. = "CH", = 42, = date("2026-01-01"), = ["a", "b"] oder = {ort: "Bern"} — der Export schreibt es als Scala; '
            + 'ein einzelner Wert bekommt die Hülle des Feldes (Some / Seq / Map), eine Liste oder null ist schon der ganze Wert.\n'
            + 'Ohne «=» bei einem Text einfach der Text, ohne Anführungszeichen (rot → "rot"); Scala bleibt, was danach aussieht ("CH", defaultClientKey, Defaults.street). '
            + 'Sonst ein Scala-Ausdruck, wörtlich übernommen: Some(…) / Seq(…) setzt der Export, None, Some(…) oder Seq(…) hier gilt so.'}
          className="flex-1 min-w-[10rem]" />
      </div>

      {issue && (
        <div className={`text-[10px] ${issue.warn ? amber(isDark) : isDark ? 'text-rose-400' : 'text-rose-600'}`}>
          {issue.message}
          {issue.suggestion && canEdit && <SuggestButton name={issue.suggestion} isDark={isDark} onTake={() => onChange({ name: issue.suggestion })} />}
        </div>
      )}
    </div>
  );
}

// Iron refinements: choose a template, enter a value — the result is an expression.
function ConstraintPicker({ field: f, canEdit, onChange, box }: {
  field: Field; isDark: boolean; canEdit: boolean; onChange: (patch: Partial<Field>) => void;
  /** the classes of the other fields — same size */
  box: string;
}) {
  const options = CONSTRAINTS.filter(x => x.for === constraintKind(f.type));
  const current = f.constraint ?? '';
  const template = options.find(o => matches(o, current));
  const [arg, setArg] = useState(() => argOf(template, current));

  const apply = (t: ConstraintTemplate | null, value: string) => {
    if (!t) { onChange({ constraint: undefined }); return; }
    if (!t.arg) { onChange({ constraint: t.expr }); return; }
    // Without a value the restriction would stay empty and the selection would jump back —
    // so set it right away with a start value that can be overwritten.
    const v = value.trim() || (t.arg === 'zahl' ? '1' : '.*');
    onChange({ constraint: t.expr.replace(/N|X/, v) });
  };

  return (
    <>
      <select value={template?.id ?? (current ? 'frei' : '')} disabled={!canEdit}
        onChange={e => {
          const t = options.find(o => o.id === e.target.value) ?? null;
          const start = t?.arg ? (t.arg === 'zahl' ? '1' : '.*') : '';
          setArg(start);
          apply(t, start);
        }}
        title="Einschränkung (Iron-Refinement)"
        className={`h-7 ${box}`}>
        <option value="">ohne Einschränkung</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        {current && !template && <option value="frei">eigener Ausdruck</option>}
      </select>
      {template?.arg && (
        <input value={arg} disabled={!canEdit}
          onChange={e => { setArg(e.target.value); apply(template, e.target.value); }}
          placeholder={template.arg}
          className={`w-20 font-mono ${box}`} />
      )}
      {!template && current && (
        <input value={current} disabled={!canEdit}
          onChange={e => onChange({ constraint: e.target.value || undefined })}
          className={`w-40 font-mono ${box}`} />
      )}
    </>
  );
}

function matches(t: ConstraintTemplate, value: string): boolean {
  if (!value) return false;
  if (!t.arg) return t.expr === value;
  const re = new RegExp(`^${t.expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/N|X/, '(.+)')}$`);
  return re.test(value);
}

function argOf(t: ConstraintTemplate | undefined, value: string): string {
  if (!t?.arg) return '';
  const re = new RegExp(`^${t.expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/N|X/, '(.+)')}$`);
  return re.exec(value)?.[1] ?? '';
}

// ── Choice (enum) ────────────────────────────────────────────────────────────
//
// A value can carry **fields** — then the choice is an ADT like
// `enum In: case Standard(clientKey: Long, …) case VermoegensVerwaltung(…)`:
// each case its own class, together one type. The fields are edited with
// the same row as in a class.
function EnumEditor({ type: t, types, isDark, canEdit, idx, model, issues, onPatch, onAddType, onOpenType }: {
  type: TypeDef; types: TypeDef[]; isDark: boolean; canEdit: boolean; model: Model | null;
  idx: ReturnType<typeof indexTypes>;
  issues: { field?: string; message: string; warn?: boolean; suggestion?: string; value?: string }[];
  onPatch: (patch: Partial<TypeDef>) => void;
  onAddType: (kind: 'case' | 'enum') => string;
  onOpenType: (id: string) => void;
}) {
  const confirm = useConfirm();
  const c = cls(isDark);
  const values = t.values ?? [];
  const set = (i: number, patch: Partial<(typeof values)[number]>) =>
    onPatch({ values: values.map((v, k) => (k === i ? { ...v, ...patch } : v)) });
  const setFields = (i: number, fields: Field[]) => set(i, { fields: fields.length ? fields : undefined });
  const adt = isAdt(t);
  // shared fields of all cases — in Scala 3 as `def` in the enum body
  const common = t.fields ?? [];
  const setCommon = (fields: Field[]) => onPatch({ fields: fields.length ? fields : undefined });
  const fieldRows = (fields: Field[], setAll: (next: Field[]) => void) => fields.map((f, k) => (
    <FieldRow key={f.id} field={f} index={k} last={k === fields.length - 1}
      types={types} selfId={t.id} isDark={isDark} canEdit={canEdit} idx={idx} model={model}
      issue={issues.find(x => x.field === f.id && !x.warn) ?? issues.find(x => x.field === f.id)}
      onChange={patch => setAll(fields.map((x, m) => (m === k ? { ...x, ...patch } : x)))}
      onRemove={() => setAll(fields.filter((_, m) => m !== k))}
      onMove={by => {
        const next = [...fields];
        const j = k + by;
        if (j < 0 || j >= next.length) return;
        [next[k], next[j]] = [next[j], next[k]];
        setAll(next);
      }}
      onAddType={onAddType} onOpenType={onOpenType} />
  ));
  // fields that are the same in all cases but not yet shared —
  // the same judgment as on import, here as a button
  const shared = adt ? sharedFields(values.filter(v => v.fields?.length).map(v => v.fields!)) : [];
  const makeCommon = (f: Field) => {
    onPatch({
      fields: [...common, f],
      values: values.map(v => (v.fields ? { ...v, fields: v.fields.filter(x => x.name !== f.name) } : v)),
    });
  };
  return (
    <div className="space-y-2">
      {adt && (
        <p className={`text-[10px] ${c.muted}`}>
          Auswahl mit Feldern (ADT) — jeder Fall wird eine eigene Klasse, zusammen ein Typ.
          Gemeinsame Felder stehen in jedem Fall, spezielle nur in ihrem.
        </p>
      )}
      {(adt || common.length > 0) && (
        <div className={`rounded border px-2 py-2 space-y-1.5 ${isDark ? 'border-white/15 bg-white/[0.04]' : 'border-black/15 bg-black/[0.03]'}`}>
          <div className={`flex items-center gap-2 text-[10px] uppercase tracking-widest ${c.muted2}`}>
            Gemeinsame Felder <span className={`normal-case tracking-normal ${c.muted}`}>· in jedem Fall · {common.length}</span>
          </div>
          {common.length > 0 && <div className="space-y-2">{fieldRows(common, setCommon)}</div>}
          {/* the same in all cases — shared at the push of a button */}
          {canEdit && shared.length > 0 && (
            <div className={`flex flex-wrap items-center gap-1.5 text-[10px] ${amber(isDark)}`}>
              <AlertTriangle size={10} />
              <span>In allen Fällen gleich:</span>
              {shared.map(f => (
                <button key={f.id} onClick={() => makeCommon(f)} title={`«${f.name}» aus den Fällen herausziehen — steht dann einmal hier`}
                  className={`font-mono px-1.5 py-0.5 rounded border ${isDark ? 'border-amber-500/40 hover:bg-amber-500/10' : 'border-amber-400 hover:bg-amber-50'}`}>
                  {f.name} → gemeinsam
                </button>
              ))}
            </div>
          )}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setCommon([...common, emptyField()])}
                className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
                <Plus size={11} /> Gemeinsames Feld
              </button>
              <PasteFieldButton typeId={t.id} isDark={isDark} />
            </div>
          )}
        </div>
      )}
      {values.map((v, i) => {
        const fields = v.fields ?? [];
        // what the check says about this value or case — the error first
        const valueIssue = issues.find(x => x.value === v.name && !x.warn) ?? issues.find(x => x.value === v.name);
        // each case in its color — like the branches in the flow
        const col = BRANCH_COLORS[i % BRANCH_COLORS.length];
        const tone = isDark ? col.dark : col.light;
        return (
          <div key={i} data-cframe={v.name ? sub(typeTarget(t.id), `value:${v.name}`) : undefined}
            className={`group rounded border ${fields.length ? `${c.border2} border-l-4 ${tone.split(' ')[0]} px-2 py-1.5 space-y-1.5` : 'border-transparent'}`}>
            {fields.length > 0 && (
              <div className={`flex items-center gap-2 text-[10px] uppercase tracking-widest ${tone.split(' ')[1]}`}>
                Fall <span className="font-mono normal-case tracking-normal font-semibold">{v.name || '…'}</span>
                <span className={`normal-case tracking-normal ${c.muted}`}>· {fields.length} spezielle{fields.length === 1 ? 's Feld' : ' Felder'}{common.length ? ` + ${common.length} gemeinsam` : ''}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <input value={v.name} disabled={!canEdit} onChange={e => set(i, { name: e.target.value })}
                placeholder={adt ? 'Fall' : 'wert'}
                className={`w-40 text-[11px] px-2 py-1 rounded border outline-none font-mono font-semibold ${c.input} ${
                  !valueIssue ? '' : valueIssue.warn ? (isDark ? '!border-amber-500/60' : '!border-amber-400') : (isDark ? '!border-rose-500/60' : '!border-rose-400')}`} />
              <input value={v.description ?? ''} disabled={!canEdit} onChange={e => set(i, { description: e.target.value || undefined })}
                placeholder="Bedeutung"
                className={`flex-1 text-[10px] px-2 py-1 rounded border outline-none ${c.input}`} />
              {v.name && <CommentBubble target={sub(typeTarget(t.id), `value:${v.name}`)} quiet />}
              {canEdit && !fields.length && (
                <button onClick={() => setFields(i, [emptyField()])} title="Spezielle Felder nur für diesen Fall (ADT)"
                  className={`text-[10px] px-1.5 py-1 rounded border flex-shrink-0 ${c.btn}`}>+ Feld</button>
              )}
              {canEdit && (
                <button onClick={async () => {
                  if (await confirm({ title: v.name ? `Wert «${v.name}» entfernen?` : 'Leeren Wert entfernen?', ...(fields.length ? { text: 'Samt seinen Feldern.' } : {}) })) {
                    onPatch({ values: values.filter((_, k) => k !== i) });
                  }
                }} title="Wert entfernen" className={`p-1 ${c.muted}`}>
                  <Trash2 size={11} />
                </button>
              )}
            </div>
            {valueIssue && (
              <div className={`text-[10px] ${valueIssue.warn ? amber(isDark) : isDark ? 'text-rose-400' : 'text-rose-600'}`}>
                {valueIssue.message}
                {valueIssue.suggestion && canEdit && <SuggestButton name={valueIssue.suggestion} isDark={isDark} onTake={() => set(i, { name: valueIssue.suggestion! })} />}
              </div>
            )}
            {!!fields.length && (
              <div className="pl-3 space-y-2">
                {fieldRows(fields, next => setFields(i, next))}
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setFields(i, [...fields, emptyField()])}
                      className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
                      <Plus size={11} /> Feld
                    </button>
                    <PasteFieldButton typeId={t.id} valueIndex={i} isDark={isDark} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {canEdit && (
        <button onClick={() => onPatch({ values: [...values, { name: '' }] })}
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
          <Plus size={11} /> {adt ? 'Fall' : 'Wert'}
        </button>
      )}
    </div>
  );
}

function CopyButton({ text, isDark }: { text: string; isDark: boolean }) {
  const c = cls(isDark);
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }
        catch { /* restrictive environment */ }
      }}
      className={`ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
      {done ? <><Check size={10} /> Kopiert</> : <><Copy size={10} /> Kopieren</>}
    </button>
  );
}
