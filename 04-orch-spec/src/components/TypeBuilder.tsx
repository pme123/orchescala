// Klassenbauer: das Datenmodell des Prozesses — allen voran das **In**.
//
// Links die Typen, in der Mitte die Felder, rechts der Scala-Code, der daraus
// entsteht (live). `InConfig` entsteht zum grössten Teil aus dem Ablauf
// (Schleifen, Mocks); eigene Stellschrauben lassen sich wie beim `InitIn`
// als Felder pflegen.
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Braces, ChevronDown, ChevronRight, Copy, Check, ListOrdered,
  Plus, Trash2, Workflow, X,
  Plug, ExternalLink, Unlink,
} from 'lucide-react';
import { isAdt,
  CONSTRAINTS, INTERACTION_META, STATUSES, STATUS_META,
  type ConstraintTemplate, type Field, type Interaction, type Model, type ProcessSpec,
  type Status, type TypeDef,
} from '../types';
import {
  catalogEntry, createMemberType, interactionStep, missingInteractions, syncInitIn, toInteraction, withOrigin,
} from '../interactions';
import { allSteps, blockIndex, blockStart, type BlockRef } from '../bpmn';
import { caseName, casesOf, isSimpleEnum, renderInConfig } from '../scala';
import { parseDomainRef, parseServiceRef } from '../serviceTypes';
import TypePicker, { NEW_CASE, NEW_ENUM } from './TypePicker';
import ScalaCode from './ScalaCode';
import FeelInput from './FeelInput';
import { checkTypes, constraintKind, defaultIsUsed, fieldType, homeOf, indexTypes, isScalaTypeExpression, packageOf, referencedClass, renderType } from '../scala';
import { BRANCH_COLORS, cls } from '../ui';
import { classesNotInDomain, referenceExistingClasses, sharedFields } from '../projectImport';
import { CommentBubble } from './Comments';
import { useConfirm } from './Confirm';
import { iaTarget, sub, typeTarget } from '../comments';
import { uid } from '../util';

interface Props {
  spec: ProcessSpec;
  isDark: boolean;
  canEdit: boolean;
  /** Service-Katalog — liefert die wählbaren Service-Objekte */
  model: Model | null;
  onChange: (spec: ProcessSpec) => void;
  /** aus dem Ablauf hierher gesprungen: diesen Typ zeigen */
  focusTypeId?: string | null;
  onFocused?: () => void;
  /** aus den Kommentaren hierher gesprungen: diese Interaktion zeigen */
  focusIaId?: string | null;
  onFocusedIa?: () => void;
}

const emptyField = (): Field => ({ id: uid('f'), name: '', type: 'String' });
const SCALA_KEY = 'orch-spec.showScala';

/** Gruppen der Seitenleiste je Art der Interaktion — in dieser Reihenfolge. */
const KIND_GROUP: Record<Interaction['kind'], string> = {
  userTask: 'User Tasks', customTask: 'Worker', signal: 'Signale', message: 'Nachrichten',
};

// ── Seitenleiste: was ein Typ ist, was ihm fehlt, ob er gebraucht wird ─────
/** Leer — kein Feld bzw. kein Wert mit Namen? */
const isEmptyType = (t: TypeDef | null | undefined): boolean =>
  !t || (t.kind === 'enum' ? !(t.values ?? []).some(v => v.name) : !(t.fields ?? []).some(f => f.name));

/** Kurz, was drin ist: «14», «ADT · 2 Fälle · 8 gemeinsam», «3 Werte». */
function contentLabel(t: TypeDef): string {
  if (t.kind !== 'enum') return String((t.fields ?? []).filter(f => f.name).length);
  const cases = (t.values ?? []).filter(v => v.name).length;
  if (!isAdt(t)) return `${cases} Wert${cases === 1 ? '' : 'e'}`;
  const common = (t.fields ?? []).filter(f => f.name).length;
  return `ADT · ${cases} F${cases === 1 ? 'all' : 'älle'}${common ? ` · ${common} gemeinsam` : ''}`;
}

/** Wie viele Felder anderer Typen auf diesen Typ zeigen. */
function usageCount(all: TypeDef[], id: string): number {
  let n = 0;
  for (const t of all) {
    if (t.id === id) continue;
    for (const f of [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])]) if (f.type === id) n++;
  }
  return n;
}

const amber = (isDark: boolean) => (isDark ? 'text-amber-400' : 'text-amber-600');

/** Farbe und Zeichen des Typ-Chips einer Feldzeile. */
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
    // Katalog — fehlt der Eintrag im geladenen Katalog, ist das ein Fehler
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
  if (constraintKind(f.type) !== null || ['Boolean', 'LocalDate', 'LocalDateTime'].includes(f.type)) {
    return { icon: null, cls: isDark ? 'border-white/10 text-white/50' : 'border-black/10 text-black/50' };
  }
  // ein Scala-Typ aus der Domain (`MockedServiceResponse[GetClient.Out]`) — wörtlich übernommen
  if (isScalaTypeExpression(f.type)) {
    return { icon: null, title: `${f.type} — Scala-Typ aus der Domain, wird wörtlich übernommen`,
      cls: isDark ? 'border-white/10 text-white/60' : 'border-black/10 text-black/60' };
  }
  return { icon: <AlertTriangle size={9} className="flex-shrink-0" />, title: `«${f.type}» ist kein bekannter Typ`,
    cls: isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700' };
}

/** Klasse ↔ ADT: die Felder wandern in den ersten Fall bzw. zurück. */
function switchKind(t: TypeDef, kind: 'case' | 'enum'): Partial<TypeDef> {
  if (kind === t.kind) return {};
  // Klasse → ADT: die Felder werden die gemeinsamen, ein erster Fall entsteht
  if (kind === 'enum') return { kind, values: [{ name: 'Standard' }] };
  // ADT → Klasse: gemeinsame und spezielle Felder zusammen, je Name einmal
  const seen = new Set<string>();
  const fields = [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])].filter(f => !seen.has(f.name) && seen.add(f.name));
  return { kind, values: undefined, fields: fields.length ? fields : [emptyField()] };
}

export default function TypeBuilder({ spec, isDark, canEdit, model, onChange, focusTypeId, onFocused, focusIaId, onFocusedIa }: Props) {
  const c = cls(isDark);
  const types = useMemo(() => spec.types ?? [], [spec.types]);
  const [selected, setSelected] = useState<string | null>(types[0]?.id ?? null);
  /** gewählte Interaktion — dann steht ihr Kopf im Editor statt eines Typs */
  const [selectedIa, setSelectedIa] = useState<string | null>(null);
  /** InConfig wird erzeugt, nicht gepflegt — es hat nur eine Ansicht */
  const [showConfig, setShowConfig] = useState(false);
  const interactions = useMemo(() => spec.interactions ?? [], [spec.interactions]);
  // Zu welchem eigenen Block ein Schritt gehört — die Seitenleiste klammert die Interaktionen so wie der Ablauf
  const blocks = useMemo(() => blockIndex(spec.steps), [spec.steps]);
  // eine Interaktion, deren Schritt nicht mehr im Ablauf steht — z. B. im Diagramm gelöscht
  const stepIds = useMemo(() => new Set(allSteps(spec.steps).map(s => s.id)), [spec.steps]);
  const offen = useMemo(() => missingInteractions(spec, model), [spec, model]);

  // Sprung aus dem Ablauf: den gewünschten Typ zeigen und die Anfrage quittieren
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
  // Klassen, die es in der Domain schon gibt — gehören nicht ins Datenmodell (siehe referencedClass)
  const existing = useMemo(() => referenceExistingClasses(spec, model), [spec, model]);
  // … und Klassen, die es dort (noch) nicht gibt — neu, oder der Import fehlt
  const notInDomain = useMemo(() => classesNotInDomain(spec, model), [spec, model]);
  const current = types.find(t => t.id === selected) ?? (selectedIa || showConfig ? null : types[0] ?? null);

  const setTypes = (next: TypeDef[]) => onChange({ ...spec, types: next });
  const pickType = (id: string) => { setSelected(id); setSelectedIa(null); setShowConfig(false); };

  /**
   * Die vier Typen eines Prozesses. Er ist die Klammer: `In` hinein, `Out`
   * heraus, `InitIn` die zu Beginn gesetzten Variablen, `InConfig` die
   * Stellschrauben für Tests. Fehlt einer, wird er beim Klick angelegt —
   * ausser `InConfig`, das entsteht aus dem Ablauf.
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
   * Was der Ablauf hergibt, in den Klassenbauer holen: je Benutzeraufgabe,
   * eigenem Worker und Signal eine Interaktion — dazu das `InitIn` aus den
   * Ausgaben des Init-Workers.
   */
  const ausAblauf = () => {
    const next = { ...spec };
    if (offen.length) next.interactions = [...interactions, ...offen.map(s => withOrigin(toInteraction(s), model, packageOf(spec, model)))];
    const withInit = syncInitIn(next);
    if (withInit) next.types = withInit;
    onChange(next);
  };

  const patchIa = (id: string, patch: Partial<Interaction>) =>
    onChange({ ...spec, interactions: interactions.map(i => (i.id === id ? { ...i, ...patch } : i)) });

  /** In bzw. Out einer Interaktion — beim ersten Klick angelegt. */
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
  const patchType = (id: string, patch: Partial<TypeDef>) =>
    setTypes(types.map(t => (t.id === id ? { ...t, ...patch } : t)));

  // Das In ist die Wurzel — es gibt genau eines und es liegt im Prozess-Objekt.
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
  /** eigene Stellschrauben — das erzeugte InConfig bekommt einen Typ zum Pflegen */
  const addInConfig = () => {
    const id = uid('t');
    setTypes([...types, { id, name: 'InConfig', kind: 'case', inConfig: true, status: 'draft', fields: [emptyField()] }]);
    pickType(id);
  };
  const issuesOf = (id: string) => issues.filter(i => i.typeId === id);
  const globalIssues = issues.filter(i => !i.typeId);

  return (
    <div className="flex h-full min-h-0">
      {/* ── Typen ──────────────────────────────────────────────────────────── */}
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
                  {t && !!issuesOf(t.id).length && <AlertTriangle size={10} className={isDark ? 'text-rose-400' : 'text-rose-600'} />}
                  {t && <CommentBubble target={typeTarget(t.id)} aggregate quiet inButton />}
                  {/* In und Out hat jeder Prozess — fehlen sie oder sind sie leer, ist das orange.
                      Das InitIn entsteht aus dem Init-Worker; ohne den gibt es keins, das ist kein Mangel. */}
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
              {inConfig && !!issuesOf(inConfig.id).length && <AlertTriangle size={10} className={isDark ? 'text-rose-400' : 'text-rose-600'} />}
              {inConfig && <CommentBubble target={typeTarget(inConfig.id)} aggregate quiet inButton />}
              <span className={`text-[9px] ${c.muted}`}>{inConfig && !isEmptyType(inConfig) ? `${contentLabel(inConfig)} + erzeugt` : 'erzeugt'}</span>
            </button>
          </div>

          {(['userTask', 'customTask', 'signal', 'message'] as const).map(kind => {
            const group = interactions.filter(ia => ia.kind === kind);
            if (!group.length) return null;
            // Hauptablauf zuerst, dann je eigenem Block bzw. Ereignis-Subprozess eine Klammer
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
                // Was der DSL verlangt (In, bei Aufgaben und Workern auch Out) und noch
                // fehlt oder leer ist, wird orange — Signale und Nachrichten ohne In
                // (oder mit leerem) sind `NoInput`, das ist erlaubt
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
          {/* Legende — die Farben sagen, was los ist */}
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
          </div>
        )}
      </div>

      {/* ── Editor ─────────────────────────────────────────────────────────── */}
      {/* Der Editor in lesbarer Breite, mittig — sonst laufen die Feldzeilen
          auf einem breiten Bildschirm ins Leere */}
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
            onRemove={() => {
              // ihr In und Out gehören nur ihr — sie gehen mit
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
  );
}

// ── InConfig ─────────────────────────────────────────────────────────────────
// Nur Ansicht: die Felder ergeben sich aus den Schleifen des Ablaufs und aus
// jedem Schritt, dessen Ergebnis sich für Tests überschreiben lässt.
function GeneratedConfig({ spec, idx, isDark, canEdit, onAdd }: {
  spec: ProcessSpec; idx: ReturnType<typeof indexTypes>; isDark: boolean; canEdit: boolean;
  /** eigene Stellschrauben anlegen */
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

/** Was aus dem Ablauf ins InConfig kommt */
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

// ── Interaktion ──────────────────────────────────────────────────────────────
// Kopf der Interaktion: Objektname, Schlüssel (`val name` / `topicName` /
// `messageName`) und Beschreibung. `In` und `Out` liegen daneben in der Liste.
function InteractionEditor({ ia, isDark, canEdit, types, orphan, onPatch, onOpen, onRemove }: {
  ia: Interaction; isDark: boolean; canEdit: boolean; types: TypeDef[];
  /** der Schritt steht nicht mehr im Ablauf */
  orphan: boolean;
  onPatch: (patch: Partial<Interaction>) => void;
  onOpen: (member: 'In' | 'Out') => void;
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
        <select value={ia.status ?? 'draft'} disabled={!canEdit}
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

      <textarea value={ia.descr ?? ''} disabled={!canEdit} rows={3}
        onChange={e => onPatch({ descr: e.target.value || undefined })}
        placeholder="Was passiert hier fachlich?"
        className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />

      <div className="flex gap-2">
        {(['In', 'Out'] as const).filter(m => m === 'In' || meta.hasOut).map(m => {
          const t = typeOf(m === 'In' ? ia.inTypeId : ia.outTypeId);
          return (
            <button key={m} onClick={() => onOpen(m)}
              className={`flex-1 text-[11px] px-3 py-2 rounded border text-left ${c.border2} ${c.hover}`}>
              <div className={`font-mono ${c.text}`}>{m}</div>
              <div className={`text-[10px] ${c.muted}`}>
                {t ? `${t.fields?.length ?? 0} Felder — bearbeiten` : 'noch keines — anlegen'}
              </div>
            </button>
          );
        })}
      </div>

      <p className={`text-[10px] leading-relaxed ${c.muted}`}>
        Ohne eigenes {meta.hasOut ? '«In» bzw. «Out»' : '«In»'} erzeugt der Generator
        <span className="font-mono"> type In = NoInput</span> — so schreibt es die Domain auch.
      </p>
    </div>
  );
}

// ── Typliste ─────────────────────────────────────────────────────────────────
function TypeGroup({ label, types, all, selected, onSelect, isDark, issuesOf }: {
  label: string; types: TypeDef[];
  /** alle Typen — um zu sehen, wer auf einen zeigt */
  all: TypeDef[];
  selected: string | null; isDark: boolean;
  onSelect: (id: string) => void; issuesOf: (id: string) => unknown[];
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
          {/* fett, was gebraucht wird; grau und kursiv, worauf nichts zeigt */}
          <span className={`flex-1 truncate text-[11px] font-mono ${used ? `font-semibold ${c.text}` : `italic ${c.muted}`}`}>{t.name}</span>
          {leer && <span className={`flex items-center gap-0.5 text-[9px] ${amber(isDark)}`} title="leer — Felder fehlen"><AlertTriangle size={9} /> leer</span>}
          {!!issuesOf(t.id).length && <AlertTriangle size={10} className={isDark ? 'text-rose-400' : 'text-rose-600'} />}
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

// ── Typ-Editor ───────────────────────────────────────────────────────────────
function TypeEditor({ type: t, types, spec, isDark, canEdit, issues, idx, model, onPatch, onRemove, onAddType, onOpenType }: {
  type: TypeDef; types: TypeDef[]; spec: ProcessSpec;
  isDark: boolean; canEdit: boolean; model: Model | null;
  issues: { field?: string; message: string }[];
  idx: ReturnType<typeof indexTypes>;
  onPatch: (patch: Partial<TypeDef>) => void;
  onRemove: () => void;
  onAddType: (kind: 'case' | 'enum') => string;
  /** zu einem eigenen Typ springen (Klick auf den Typ-Chip) */
  onOpenType: (id: string) => void;
}) {
  const confirm = useConfirm();
  const c = cls(isDark);
  const fields = t.fields ?? [];
  // Die Scala-Vorschau ist zu, bis man sie will — und merkt sich das
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

  const issueOf = (fieldId: string) => issues.find(i => i.field === fieldId)?.message;
  const typeIssues = issues.filter(i => !i.field);
  // über den Namen im Katalog: eine Klasse einer anderen Domain wird importiert, nicht exportiert
  const origin = referencedClass(t, model, packageOf(spec, model));
  // das InConfig zeigt, was insgesamt entsteht — eigene und erzeugte Felder
  const code = t.inConfig ? renderInConfig(spec, new Set<string>(), idx) : renderType(t, idx);

  return (
    <div className="p-4 space-y-4">
      {/* Kopf */}
      <div data-cframe={typeTarget(t.id)} className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] uppercase tracking-widest flex items-center gap-2 ${c.muted}`}>
            {t.root ? 'Prozess-Eingabe' : t.inConfig ? 'Prozess-Konfiguration' : t.kind === 'enum' ? (isAdt(t) ? 'Auswahl mit Fällen (ADT)' : 'Auswahl (enum)') : 'Klasse (case class)'}
            <CommentBubble target={typeTarget(t.id)} title={`Kommentare zu «${t.name}»`} />
            {/* Das In eines Prozesses ist meist eine Klasse — kann aber ein ADT
                sein (`enum In: case Standard(…) case VermoegensVerwaltung(…)`),
                wenn derselbe Prozess mit verschiedenen Eingaben startet. */}
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
        <select value={t.status ?? 'draft'} disabled={!canEdit}
          onChange={e => onPatch({ status: e.target.value as Status })}
          className={`text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
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

      {!!typeIssues.length && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
          {typeIssues.map((i, k) => <div key={k}>{i.message}</div>)}
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
              <button onClick={() => onPatch({ fields: [...fields, emptyField()] })}
                className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
                <Plus size={11} /> Feld
              </button>
            )}
          </div>
        )}

      {/* Scala-Vorschau des Typs — aufklappbar; der ganze Domain-Code steht im Export */}
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

// ── Feld ─────────────────────────────────────────────────────────────────────
function FieldRow({ field: f, index, last, types, selfId, isDark, canEdit, idx, model, issue, onChange, onRemove, onMove, onAddType, onOpenType }: {
  field: Field; index: number; last: boolean; types: TypeDef[]; selfId: string;
  isDark: boolean; canEdit: boolean; issue?: string; model: Model | null;
  idx: ReturnType<typeof indexTypes>;
  onChange: (patch: Partial<Field>) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
  onAddType: (kind: 'case' | 'enum') => string;
  onOpenType: (id: string) => void;
}) {
  const confirm = useConfirm();
  const c = cls(isDark);
  // der Typ, zu dem das Feld gehört — er bestimmt, ob es eine Vorgabe gibt
  const owner = types.find(t => t.id === selfId);
  // der Beispielwert aus der Domain (`defaultClientKey`), den das example ohne eigene Angabe nimmt
  const fromDomain = idx.defaultOf(f);
  // Der Typ als Chip: die Farbe sagt, was es ist — einfach (grau), eigene
  // Klasse (blau), Auswahl oder Ausprägung (violett), Katalog (teal, Stecker),
  // unbekannt (rot). Eigene Typen sind anklickbar und springen dorthin.
  const chip = typeChip(f, types, idx, model, isDark);
  // Einschränkungen nur, wo sie etwas bedeuten (Text und Zahlen)
  const canConstrain = !!constraintKind(f.type);
  // Fälle einer Auswahl — eigen oder aus dem Katalog. Bei einer Auswahl mit
  // Feldern (ADT) ist ein Fall eine Klasse, bei einer einfachen ein fester Wert
  const cases = casesOf(f.type, idx);
  const simple = isSimpleEnum(f.type, idx);
  // ein fester Fall einer einfachen Auswahl ist ein einzelner Wert
  const fixedValue = simple && !!f.enumCase;
  const fixedOk = idx.domainOf(f.type)?.fixedCases;

  const changeType = (v: string) => {
    if (v === NEW_CASE || v === NEW_ENUM) {
      // Neuen Typ direkt aus dem Feld heraus anlegen und verknüpfen
      const id = onAddType(v === NEW_CASE ? 'case' : 'enum');
      onChange({ type: id, constraint: undefined });
      return;
    }
    // Beim Typwechsel eine nicht mehr passende Einschränkung fallen lassen
    const keep = v === f.type || (constraintKind(v) && constraintKind(v) === constraintKind(f.type));
    onChange({ type: v, enumCase: undefined, ...(keep ? {} : { constraint: undefined }) });
  };

  return (
    <div data-cframe={f.name ? sub(typeTarget(selfId), `field:${f.id}`) : undefined}
      className={`group rounded border px-2 py-2 space-y-1.5 ${issue ? (isDark ? 'border-rose-500/40' : 'border-rose-400') : c.border2}`}>
      <div className="flex items-center gap-1.5">
        <input value={f.name} disabled={!canEdit} onChange={e => onChange({ name: e.target.value })}
          placeholder="feldName"
          className={`w-40 text-[11px] px-2 py-1 rounded border outline-none font-mono font-semibold ${c.input}`} />
        {/* Pflicht: nicht optional — wie in den Mappings */}
        {!f.optional && f.name && <span className={`-ml-1 text-[11px] ${c.muted}`} title="Pflichtfeld — nicht optional">*</span>}

        <TypePicker value={f.type} types={types} selfId={selfId} model={model} isDark={isDark}
          disabled={!canEdit} onPick={changeType}
          onCreate={kind => changeType(kind === 'case' ? NEW_CASE : NEW_ENUM)} />
        {/* Eine Auswahl mit Fällen: das Feld kann eine einzelne Ausprägung meinen
            (`CustomDocContents.\`QI-Deklaration\``) — oder alle */}
        {cases && (
          <select value={f.enumCase ? caseName(f.enumCase) : ''} disabled={!canEdit}
            onChange={e => {
              const v = e.target.value || undefined;
              // ein fester Wert ist ein einzelner — nicht mehrfach, keine Map
              onChange({ enumCase: v, ...(v && simple ? { collection: undefined, map: undefined } : {}) });
            }}
            title={simple
              ? 'Fester Fall: das Feld hat genau diesen Wert — in Scala `X.fall.type = X.fall` (z. B. processStatus im Out)'
              : 'Ausprägung: nur dieser Fall der Auswahl — oder alle'}
            className={`text-[10px] px-1.5 py-1 rounded border outline-none font-mono max-w-[10rem] ${c.input}`}>
            <option value="">{simple ? 'beliebiger Fall' : 'alle Fälle'}</option>
            {cases.map(v => (
              <option key={v} value={v} disabled={simple && !!fixedOk && !fixedOk.includes(v)}>
                {simple ? `nur ${v}` : v}{simple && fixedOk && !fixedOk.includes(v) ? ' (keine Givens)' : ''}
              </option>
            ))}
          </select>
        )}

        <label className={`flex items-center gap-1 text-[10px] ${c.muted2}`} title="Option[…] — darf fehlen">
          <input type="checkbox" checked={!!f.optional} disabled={!canEdit}
            onChange={e => onChange({ optional: e.target.checked || undefined })} />
          optional
        </label>
        <label className={`flex items-center gap-1 text-[10px] ${c.muted2}`} title="Seq[…] — mehrfach">
          <input type="checkbox" checked={!!f.collection} disabled={!canEdit || fixedValue}
            onChange={e => onChange({ collection: e.target.checked || undefined })} />
          mehrfach
        </label>
        <label className={`flex items-center gap-1 text-[10px] ${c.muted2}`} title="Map[String, …] — Schlüssel ist ein Text, der Typ hier ist der Wert">
          <input type="checkbox" checked={!!f.map} disabled={!canEdit || fixedValue}
            onChange={e => onChange({ map: e.target.checked || undefined })} />
          Map
        </label>

        {chip.ownId ? (
          <button onClick={() => onOpenType(chip.ownId!)} title={`${fieldType(f, idx)} — zum Typ springen`}
            className={`ml-auto flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[14rem] ${chip.cls}`}>
            {chip.icon}<span className="truncate">{fieldType(f, idx)}</span><ExternalLink size={9} className="flex-shrink-0 opacity-60" />
          </button>
        ) : (
          <span title={chip.title ?? fieldType(f, idx)}
            className={`ml-auto flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[14rem] ${chip.cls}`}>
            {chip.icon}<span className="truncate">{fieldType(f, idx)}</span>
          </span>
        )}
        {f.name && <CommentBubble target={sub(typeTarget(selfId), `field:${f.id}`)} quiet />}

        {canEdit && (
          <div className="flex items-center">
            <button onClick={() => onMove(-1)} disabled={index === 0} className={`p-1 disabled:opacity-20 ${c.muted}`}><ArrowUp size={11} /></button>
            <button onClick={() => onMove(1)} disabled={last} className={`p-1 disabled:opacity-20 ${c.muted}`}><ArrowDown size={11} /></button>
            <button onClick={async () => { if (await confirm({ title: f.name ? `Feld «${f.name}» entfernen?` : 'Leeres Feld entfernen?' })) onRemove(); }}
              title="Feld entfernen" className={`p-1 ${c.muted}`}><Trash2 size={11} /></button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {canConstrain && <ConstraintPicker field={f} isDark={isDark} canEdit={canEdit} onChange={onChange} />}
        {/* Vorgaben gibt es nur im InConfig, im InitIn (initialisiert Prozessvariablen) und bei
            optionalen Feldern der Prozess-Eingabe (dort setzt sie der Init-Worker im InitIn).
            FEEL mit «=», ohne «=» ein Scala-Ausdruck */}
        {(owner?.inConfig || owner?.initIn || owner?.root || f.default) && (
          <FeelInput value={f.default ?? ''} isDark={isDark}
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
            className="w-44" />
        )}
        <input value={f.example ?? ''} disabled={!canEdit} onChange={e => onChange({ example: e.target.value || undefined })}
          placeholder={fromDomain?.name ?? 'Beispiel'}
          title={fromDomain
            ? `Beispielwert für example — ohne Angabe ${fromDomain.name} aus ${fromDomain.pkg}.\nSome(…) / Seq(…) setzt der Export; None, Some(…) oder Seq(…) hier wird wörtlich übernommen.`
            : 'Beispielwert für example — ohne Angabe leitet die App einen ab.\nSome(…) / Seq(…) setzt der Export; None, Some(…) oder Seq(…) hier wird wörtlich übernommen.'}
          className={`w-32 text-[10px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />
        {/* ein Ausdruck aus der Domain (`clientKeyDescr`) bleibt einer, bis die Beschreibung geändert wird */}
        <input value={f.description ?? ''} disabled={!canEdit}
          onChange={e => onChange({ description: e.target.value || undefined, descriptionExpr: undefined })}
          placeholder="fachliche Bedeutung (@description)"
          title={f.descriptionExpr
            ? `Aus der Domain: @description(${f.descriptionExpr}) — wird so exportiert.\nÄndern ersetzt den Ausdruck durch Text.`
            : undefined}
          className={`flex-1 text-[10px] px-2 py-1 rounded border outline-none ${f.descriptionExpr ? 'font-mono' : ''} ${c.input}`} />
      </div>

      {issue && <div className={`text-[10px] ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>{issue}</div>}
    </div>
  );
}

// Iron-Refinements: Vorlage wählen, Wert eintragen — Ergebnis ist ein Ausdruck.
function ConstraintPicker({ field: f, isDark, canEdit, onChange }: {
  field: Field; isDark: boolean; canEdit: boolean; onChange: (patch: Partial<Field>) => void;
}) {
  const c = cls(isDark);
  const options = CONSTRAINTS.filter(x => x.for === constraintKind(f.type));
  const current = f.constraint ?? '';
  const template = options.find(o => matches(o, current));
  const [arg, setArg] = useState(() => argOf(template, current));

  const apply = (t: ConstraintTemplate | null, value: string) => {
    if (!t) { onChange({ constraint: undefined }); return; }
    if (!t.arg) { onChange({ constraint: t.expr }); return; }
    // Ohne Wert bliebe die Einschränkung leer und die Auswahl spränge zurück —
    // deshalb gleich mit einem Startwert setzen, den man überschreiben kann.
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
        className={`text-[10px] px-2 py-1 rounded border outline-none ${c.input}`}>
        <option value="">ohne Einschränkung</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        {current && !template && <option value="frei">eigener Ausdruck</option>}
      </select>
      {template?.arg && (
        <input value={arg} disabled={!canEdit}
          onChange={e => { setArg(e.target.value); apply(template, e.target.value); }}
          placeholder={template.arg}
          className={`w-20 text-[10px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />
      )}
      {!template && current && (
        <input value={current} disabled={!canEdit}
          onChange={e => onChange({ constraint: e.target.value || undefined })}
          className={`w-40 text-[10px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />
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

// ── Auswahl (enum) ───────────────────────────────────────────────────────────
//
// Ein Wert kann **Felder** tragen — dann ist die Auswahl ein ADT wie
// `enum In: case Standard(clientKey: Long, …) case VermoegensVerwaltung(…)`:
// jeder Fall eine eigene Klasse, gemeinsam ein Typ. Die Felder werden mit
// derselben Zeile bearbeitet wie in einer Klasse.
function EnumEditor({ type: t, types, isDark, canEdit, idx, model, issues, onPatch, onAddType, onOpenType }: {
  type: TypeDef; types: TypeDef[]; isDark: boolean; canEdit: boolean; model: Model | null;
  idx: ReturnType<typeof indexTypes>;
  issues: { field?: string; message: string }[];
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
  // Gemeinsame Felder aller Fälle — in Scala 3 als `def` im enum-Rumpf
  const common = t.fields ?? [];
  const setCommon = (fields: Field[]) => onPatch({ fields: fields.length ? fields : undefined });
  const fieldRows = (fields: Field[], setAll: (next: Field[]) => void) => fields.map((f, k) => (
    <FieldRow key={f.id} field={f} index={k} last={k === fields.length - 1}
      types={types} selfId={t.id} isDark={isDark} canEdit={canEdit} idx={idx} model={model}
      issue={issues.find(x => x.field === f.id)?.message}
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
  // Felder, die in allen Fällen gleich stehen, aber noch nicht gemeinsam sind —
  // dasselbe Urteil wie beim Import, hier als Knopf
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
          {/* in allen Fällen gleich — auf Knopfdruck gemeinsam */}
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
            <button onClick={() => setCommon([...common, emptyField()])}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
              <Plus size={11} /> Gemeinsames Feld
            </button>
          )}
        </div>
      )}
      {values.map((v, i) => {
        const fields = v.fields ?? [];
        // jeder Fall in seiner Farbe — wie die Zweige im Ablauf
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
                className={`w-40 text-[11px] px-2 py-1 rounded border outline-none font-mono font-semibold ${c.input}`} />
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
            {!!fields.length && (
              <div className="pl-3 space-y-2">
                {fieldRows(fields, next => setFields(i, next))}
                {canEdit && (
                  <button onClick={() => setFields(i, [...fields, emptyField()])}
                    className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
                    <Plus size={11} /> Feld
                  </button>
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
        catch { /* restriktive Umgebung */ }
      }}
      className={`ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
      {done ? <><Check size={10} /> Kopiert</> : <><Copy size={10} /> Kopieren</>}
    </button>
  );
}
