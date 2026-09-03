// Klassenbauer: das Datenmodell des Prozesses — allen voran das **In**.
//
// Links die Typen, in der Mitte die Felder, rechts der Scala-Code, der daraus
// entsteht (live). Absichtlich nicht dabei: `InConfig` und `InitIn` — das sind
// Implementations-Details und gehören nicht in die Spezifikation.
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Braces, Code2, Copy, Check, ListOrdered,
  Plus, Trash2, Workflow, X,
  MessageSquare,
} from 'lucide-react';
import {
  CONSTRAINTS, INTERACTION_META, STATUSES, STATUS_META,
  type ConstraintTemplate, type Field, type Interaction, type Model, type ProcessSpec,
  type Status, type TypeDef,
} from '../types';
import {
  catalogEntry, createMemberType, interactionStep, missingInteractions, syncInitIn, toInteraction,
} from '../interactions';
import { renderInConfig } from '../scala';
import TypePicker, { NEW_CASE, NEW_ENUM } from './TypePicker';
import { checkTypes, constraintKind, fieldType, indexTypes, renderType, scalaBundle } from '../scala';
import { cls } from '../ui';
import Comments from './Comments';
import { typeTarget, openCount } from '../comments';
import { useAuthorName } from '../auth';
import { uid } from '../util';

interface Props {
  spec: ProcessSpec;
  isDark: boolean;
  canEdit: boolean;
  /** Service-Katalog — liefert die wählbaren Service-Objekte */
  model: Model | null;
  onChange: (spec: ProcessSpec) => void;
  /** Kommentar-Faden, auf dem die Navigation steht */
  highlight?: string;
  /** aus dem Ablauf hierher gesprungen: diesen Typ zeigen */
  focusTypeId?: string | null;
  onFocused?: () => void;
}

const emptyField = (): Field => ({ id: uid('f'), name: '', type: 'String' });

export default function TypeBuilder({ spec, isDark, canEdit, model, onChange, focusTypeId, onFocused, highlight }: Props) {
  const author = useAuthorName();
  const c = cls(isDark);
  const types = useMemo(() => spec.types ?? [], [spec.types]);
  const [selected, setSelected] = useState<string | null>(types[0]?.id ?? null);
  /** gewählte Interaktion — dann steht ihr Kopf im Editor statt eines Typs */
  const [selectedIa, setSelectedIa] = useState<string | null>(null);
  /** InConfig wird erzeugt, nicht gepflegt — es hat nur eine Ansicht */
  const [showConfig, setShowConfig] = useState(false);
  const interactions = useMemo(() => spec.interactions ?? [], [spec.interactions]);
  const offen = useMemo(() => missingInteractions(spec, model), [spec, model]);
  const [showCode, setShowCode] = useState(true);

  // Sprung aus dem Ablauf: den gewünschten Typ zeigen und die Anfrage quittieren
  useEffect(() => {
    if (!focusTypeId) return;
    setSelected(focusTypeId);
    setSelectedIa(null);
    setShowConfig(false);
    onFocused?.();
  }, [focusTypeId, onFocused]);

  const idx = useMemo(() => indexTypes(types, model), [types, model]);
  const issues = useMemo(() => checkTypes(types, model), [types, model]);
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
    if (offen.length) next.interactions = [...interactions, ...offen.map(toInteraction)];
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
    const t: TypeDef = createMemberType(ia, member, entry, model);
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
  const issuesOf = (id: string) => issues.filter(i => i.typeId === id);
  const globalIssues = issues.filter(i => !i.typeId);

  return (
    <div className="flex h-full min-h-0">
      {/* ── Typen ──────────────────────────────────────────────────────────── */}
      <div className={`w-56 flex-shrink-0 border-r ${c.border} flex flex-col`}>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <div className="mb-2">
            <div className={`text-[9px] uppercase tracking-widest px-2 py-1 ${c.muted}`}>Prozess</div>
            {([['root', 'In'], ['initIn', 'InitIn'], ['processOut', 'Out']] as const).map(([slot, label]) => {
              const t = types.find(x => x[slot]);
              return (
                <button key={slot} onClick={() => processSlot(slot)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${c.hover} ${
                    t && selected === t.id ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
                  <Braces size={11} className={c.muted} />
                  <span className={`flex-1 truncate text-[11px] font-mono ${t ? c.text : c.muted}`}>{label}</span>
                  {t && !!issuesOf(t.id).length && <AlertTriangle size={10} className={isDark ? 'text-rose-400' : 'text-rose-600'} />}
                  {t && !!openCount(spec, typeTarget(t.id)) && (
                    <span className={`flex items-center gap-0.5 text-[9px] ${c.muted}`}
                      title={`${openCount(spec, typeTarget(t.id))} offene Kommentare`}>
                      <MessageSquare size={9} />{openCount(spec, typeTarget(t.id))}
                    </span>
                  )}
                  <span className={`text-[9px] ${c.muted}`}>{t ? t.fields?.length ?? 0 : '+'}</span>
                </button>
              );
            })}
            <button onClick={() => { setShowConfig(true); setSelected(null); setSelectedIa(null); }}
              title="Wird aus dem Ablauf erzeugt — Schleifen und Mocks"
              className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${c.hover} ${
                showConfig ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
              <Braces size={11} className={c.muted} />
              <span className={`flex-1 truncate text-[11px] font-mono ${c.muted2}`}>InConfig</span>
              <span className={`text-[9px] ${c.muted}`}>erzeugt</span>
            </button>
          </div>

          {!!interactions.length && (
            <div className="mb-2">
              <div className={`text-[9px] uppercase tracking-widest px-2 py-1 ${c.muted}`}>Interaktionen</div>
              {interactions.map(ia => (
                <div key={ia.id}>
                  <button onClick={() => { setSelectedIa(ia.id); setSelected(null); }}
                    className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${c.hover} ${
                      selectedIa === ia.id ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
                    <Workflow size={11} className={c.muted} />
                    <span className={`flex-1 truncate text-[11px] font-mono ${c.text}`}>{ia.name}</span>
                    <span className={`text-[9px] ${c.muted}`}>{INTERACTION_META[ia.kind].suffix || 'W'}</span>
                  </button>
                  <div className="flex gap-1 pl-6 pb-0.5">
                    {(['In', 'Out'] as const)
                      .filter(m => m === 'In' || INTERACTION_META[ia.kind].hasOut)
                      .map(m => {
                        const id = m === 'In' ? ia.inTypeId : ia.outTypeId;
                        const t = id ? types.find(x => x.id === id) : null;
                        return (
                          <button key={m} onClick={() => openMember(ia, m)}
                            title={t ? `${m} bearbeiten` : `${m} anlegen`}
                            className={`text-[9px] px-1.5 py-0.5 rounded border ${
                              selected === id ? (isDark ? 'bg-white/10 border-white/40' : 'bg-black/10 border-black/40') : c.border2
                            } ${t ? c.muted2 : c.muted}`}>
                            {m}{t ? ` ${t.fields?.length ?? 0}` : ' +'}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <TypeGroup label="Klassen" isDark={isDark}
            types={types.filter(t => !t.root && !t.processOut && !t.initIn && !t.interactionId && t.kind === 'case')}
            selected={selected} onSelect={pickType} issuesOf={issuesOf} spec={spec} />
          <TypeGroup label="Auswahlen" isDark={isDark}
            types={types.filter(t => t.kind === 'enum')} selected={selected} onSelect={pickType} issuesOf={issuesOf} spec={spec} />
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
      <div className="flex-1 min-w-0 overflow-y-auto">
        {showConfig ? (
          <GeneratedConfig spec={spec} idx={idx} isDark={isDark} />
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
                <span className="font-mono">InConfig</span> und <span className="font-mono">InitIn</span> gehören
                nicht hierher — das sind Implementations-Details.
              </p>
            </div>
          </div>
        ) : selectedIa ? (
          <InteractionEditor key={selectedIa}
            ia={interactions.find(i => i.id === selectedIa)!} isDark={isDark} canEdit={canEdit}
            types={types}
            onPatch={patch => patchIa(selectedIa, patch)}
            onOpen={member => openMember(interactions.find(i => i.id === selectedIa)!, member)}
            onRemove={() => {
              onChange({ ...spec, interactions: interactions.filter(i => i.id !== selectedIa) });
              setSelectedIa(null);
            }} />
        ) : current ? (
          <TypeEditor key={current.id} type={current} types={types} spec={spec} author={author}
            isDark={isDark} canEdit={canEdit}
            issues={issuesOf(current.id)} idx={idx} model={model}
            onPatch={patch => patchType(current.id, patch)}
            onRemove={() => removeType(current.id)}
            onAddType={addType}
            onSpecChange={onChange}
            highlight={highlight} />
        ) : null}
        {!!globalIssues.length && (
          <div className={`mx-4 mb-4 text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
            {globalIssues.map((i, k) => <div key={k}>{i.message}</div>)}
          </div>
        )}
      </div>

      {/* ── Scala ──────────────────────────────────────────────────────────── */}
      {showCode ? (
        <div className={`w-[30rem] flex-shrink-0 border-l ${c.border} ${c.panel} flex flex-col min-h-0`}>
          <div className={`flex items-center gap-2 px-3 py-2 border-b ${c.border}`}>
            <Code2 size={12} className={c.muted} />
            <span className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Orchescala-Domain</span>
            <CopyButton text={scalaBundle(spec, model)} isDark={isDark} />
            <button onClick={() => setShowCode(false)} className={`p-1 ${c.muted}`}><X size={12} /></button>
          </div>
          <pre className={`flex-1 overflow-auto text-[10px] leading-relaxed p-3 ${c.muted2}`}>{scalaBundle(spec, model)}</pre>
        </div>
      ) : (
        <button onClick={() => setShowCode(true)} title="Scala-Code zeigen"
          className={`flex-shrink-0 px-2 border-l ${c.border} ${c.muted} ${c.hover}`}>
          <Code2 size={14} />
        </button>
      )}
    </div>
  );
}

// ── InConfig ─────────────────────────────────────────────────────────────────
// Nur Ansicht: die Felder ergeben sich aus den Schleifen des Ablaufs und aus
// jedem Schritt, dessen Ergebnis sich für Tests überschreiben lässt.
function GeneratedConfig({ spec, idx, isDark }: { spec: ProcessSpec; idx: ReturnType<typeof indexTypes>; isDark: boolean }) {
  const c = cls(isDark);
  void idx;
  const code = renderInConfig(spec, new Set<string>());
  return (
    <div className="p-4 space-y-3">
      <div>
        <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Prozess-Konfiguration</div>
        <div className={`text-sm font-semibold font-mono ${c.text}`}>InConfig</div>
      </div>
      <p className={`text-[11px] leading-relaxed ${c.muted}`}>
        Wird <span className="font-semibold">aus dem Ablauf erzeugt</span> und nicht von Hand gepflegt:
        je Schleife <span className="font-mono">max…</span>, <span className="font-mono">counter…</span> und
        <span className="font-mono"> timerWait…</span>, dazu je Service und Teilprozess ein
        <span className="font-mono"> …Mock</span>, mit dem sich sein Ergebnis in Tests überschreiben lässt.
      </p>
      {code
        ? <pre className={`text-[10px] leading-relaxed px-3 py-2 rounded border overflow-x-auto ${c.border2} ${c.muted2}`}>{code}</pre>
        : <p className={`text-[11px] ${c.muted}`}>Noch nichts zu konfigurieren — der Ablauf hat weder Schleifen noch aufgerufene Services.</p>}
    </div>
  );
}

// ── Interaktion ──────────────────────────────────────────────────────────────
// Kopf der Interaktion: Objektname, Schlüssel (`val name` / `topicName` /
// `messageName`) und Beschreibung. `In` und `Out` liegen daneben in der Liste.
function InteractionEditor({ ia, isDark, canEdit, types, onPatch, onOpen, onRemove }: {
  ia: Interaction; isDark: boolean; canEdit: boolean; types: TypeDef[];
  onPatch: (patch: Partial<Interaction>) => void;
  onOpen: (member: 'In' | 'Out') => void;
  onRemove: () => void;
}) {
  const c = cls(isDark);
  const meta = INTERACTION_META[ia.kind];
  const typeOf = (id?: string) => types.find(t => t.id === id) ?? null;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>{meta.label}</div>
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
          <button onClick={onRemove} title="Interaktion entfernen" className={`p-1.5 rounded border ${c.btn}`}>
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
function TypeGroup({ label, types, selected, onSelect, isDark, issuesOf, spec }: {
  label: string; types: TypeDef[]; selected: string | null; isDark: boolean;
  onSelect: (id: string) => void; issuesOf: (id: string) => unknown[];
  spec: ProcessSpec;
}) {
  const c = cls(isDark);
  if (!types.length) return null;
  return (
    <div className="mb-2">
      <div className={`text-[9px] uppercase tracking-widest px-2 py-1 ${c.muted}`}>{label}</div>
      {types.map(t => (
        <button key={t.id} onClick={() => onSelect(t.id)}
          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left ${c.hover} ${
            selected === t.id ? (isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
          {t.kind === 'enum' ? <ListOrdered size={11} className={c.muted} /> : <Braces size={11} className={c.muted} />}
          <span className={`flex-1 truncate text-[11px] font-mono ${c.text}`}>{t.name}</span>
          {!!issuesOf(t.id).length && <AlertTriangle size={10} className={isDark ? 'text-rose-400' : 'text-rose-600'} />}
          {!!openCount(spec, typeTarget(t.id)) && (
            <span className={`flex items-center gap-0.5 text-[9px] ${c.muted}`}
              title={`${openCount(spec, typeTarget(t.id))} offene Kommentare`}>
              <MessageSquare size={9} />{openCount(spec, typeTarget(t.id))}
            </span>
          )}
          <span className={`text-[9px] ${c.muted}`}>
            {t.kind === 'enum' ? t.values?.length ?? 0 : t.fields?.length ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Typ-Editor ───────────────────────────────────────────────────────────────
function TypeEditor({ type: t, types, spec, author, isDark, canEdit, issues, idx, model, onPatch, onRemove, onAddType, onSpecChange, highlight }: {
  type: TypeDef; types: TypeDef[]; spec: ProcessSpec; author: string;
  isDark: boolean; canEdit: boolean; model: Model | null;
  issues: { field?: string; message: string }[];
  idx: ReturnType<typeof indexTypes>;
  onPatch: (patch: Partial<TypeDef>) => void;
  onRemove: () => void;
  onAddType: (kind: 'case' | 'enum') => string;
  onSpecChange: (spec: ProcessSpec) => void;
  highlight?: string;
}) {
  const c = cls(isDark);
  const fields = t.fields ?? [];

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

  return (
    <div className="p-4 space-y-4">
      {/* Kopf */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] uppercase tracking-widest ${c.muted}`}>
            {t.root ? 'Prozess-Eingabe' : t.kind === 'enum' ? 'Auswahl (enum)' : 'Klasse (case class)'}
          </div>
          <input value={t.name} disabled={!canEdit || t.root}
            onChange={e => onPatch({ name: e.target.value })}
            className={`w-full bg-transparent outline-none text-sm font-semibold font-mono ${c.text}`} />
        </div>
        <select value={t.status ?? 'draft'} disabled={!canEdit}
          onChange={e => onPatch({ status: e.target.value as Status })}
          className={`text-[11px] px-2 py-1 rounded border outline-none ${c.input}`}>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        {canEdit && !t.root && (
          <button onClick={onRemove} title="Typ löschen" className={`p-1.5 rounded border ${c.btn}`}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <textarea value={t.description ?? ''} disabled={!canEdit} rows={2}
        onChange={e => onPatch({ description: e.target.value })}
        placeholder="Wofür steht dieser Typ fachlich?"
        className={`grow w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />

      {!!typeIssues.length && (
        <div className={`text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
          {typeIssues.map((i, k) => <div key={k}>{i.message}</div>)}
        </div>
      )}

      {t.kind === 'enum'
        ? <EnumEditor type={t} isDark={isDark} canEdit={canEdit} onPatch={onPatch} />
        : (
          <div className="space-y-2">
            {fields.map((f, i) => (
              <FieldRow key={f.id} field={f} index={i} last={i === fields.length - 1}
                types={types} selfId={t.id} isDark={isDark} canEdit={canEdit} idx={idx} model={model}
                issue={issueOf(f.id)}
                onChange={patch => setField(i, patch)}
                onRemove={() => onPatch({ fields: fields.filter((_, k) => k !== i) })}
                onMove={by => moveField(i, by)}
                onAddType={onAddType} />
            ))}
            {canEdit && (
              <button onClick={() => onPatch({ fields: [...fields, emptyField()] })}
                className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
                <Plus size={11} /> Feld
              </button>
            )}
          </div>
        )}

      {/* Vorschau des einzelnen Typs */}
      <div>
        <div className={`text-[10px] uppercase tracking-widest mb-1 ${c.muted}`}>Scala</div>
        <pre className={`text-[10px] leading-relaxed px-3 py-2 rounded border overflow-x-auto ${c.border2} ${c.muted2}`}>
          {renderType(t, idx)}
        </pre>
      </div>

      <Comments spec={spec} target={typeTarget(t.id)} author={author} isDark={isDark}
        canEdit={canEdit} onChange={onSpecChange} title={`Kommentare · ${t.name}`} highlight={highlight} />
    </div>
  );
}

// ── Feld ─────────────────────────────────────────────────────────────────────
function FieldRow({ field: f, index, last, types, selfId, isDark, canEdit, idx, model, issue, onChange, onRemove, onMove, onAddType }: {
  field: Field; index: number; last: boolean; types: TypeDef[]; selfId: string;
  isDark: boolean; canEdit: boolean; issue?: string; model: Model | null;
  idx: ReturnType<typeof indexTypes>;
  onChange: (patch: Partial<Field>) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
  onAddType: (kind: 'case' | 'enum') => string;
}) {
  const c = cls(isDark);
  // Einschränkungen nur, wo sie etwas bedeuten (Text und Zahlen)
  const canConstrain = !!constraintKind(f.type);

  const changeType = (v: string) => {
    if (v === NEW_CASE || v === NEW_ENUM) {
      // Neuen Typ direkt aus dem Feld heraus anlegen und verknüpfen
      const id = onAddType(v === NEW_CASE ? 'case' : 'enum');
      onChange({ type: id, constraint: undefined });
      return;
    }
    // Beim Typwechsel eine nicht mehr passende Einschränkung fallen lassen
    const keep = v === f.type || (constraintKind(v) && constraintKind(v) === constraintKind(f.type));
    onChange({ type: v, ...(keep ? {} : { constraint: undefined }) });
  };

  return (
    <div className={`rounded border px-2 py-2 space-y-1.5 ${issue ? (isDark ? 'border-rose-500/40' : 'border-rose-400') : c.border2}`}>
      <div className="flex items-center gap-1.5">
        <input value={f.name} disabled={!canEdit} onChange={e => onChange({ name: e.target.value })}
          placeholder="feldName"
          className={`w-40 text-[11px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />

        <TypePicker value={f.type} types={types} selfId={selfId} model={model} isDark={isDark}
          disabled={!canEdit} onPick={changeType}
          onCreate={kind => changeType(kind === 'case' ? NEW_CASE : NEW_ENUM)} />

        <label className={`flex items-center gap-1 text-[10px] ${c.muted2}`} title="Option[…] — darf fehlen">
          <input type="checkbox" checked={!!f.optional} disabled={!canEdit}
            onChange={e => onChange({ optional: e.target.checked || undefined })} />
          optional
        </label>
        <label className={`flex items-center gap-1 text-[10px] ${c.muted2}`} title="Seq[…] — mehrfach">
          <input type="checkbox" checked={!!f.collection} disabled={!canEdit}
            onChange={e => onChange({ collection: e.target.checked || undefined })} />
          mehrfach
        </label>

        <span className={`ml-auto text-[10px] font-mono truncate max-w-[14rem] ${c.muted}`} title={fieldType(f, idx)}>
          {fieldType(f, idx)}
        </span>

        {canEdit && (
          <div className="flex items-center">
            <button onClick={() => onMove(-1)} disabled={index === 0} className={`p-1 disabled:opacity-20 ${c.muted}`}><ArrowUp size={11} /></button>
            <button onClick={() => onMove(1)} disabled={last} className={`p-1 disabled:opacity-20 ${c.muted}`}><ArrowDown size={11} /></button>
            <button onClick={onRemove} className={`p-1 ${c.muted}`}><Trash2 size={11} /></button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {canConstrain && <ConstraintPicker field={f} isDark={isDark} canEdit={canEdit} onChange={onChange} />}
        <input value={f.default ?? ''} disabled={!canEdit} onChange={e => onChange({ default: e.target.value || undefined })}
          placeholder="Vorgabe"
          title="Vorgabewert als Scala-Ausdruck, z. B. \u00abCH\u00bb oder Seq.empty"
          className={`w-28 text-[10px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />
        <input value={f.example ?? ''} disabled={!canEdit} onChange={e => onChange({ example: e.target.value || undefined })}
          placeholder="Beispiel"
          title="Beispielwert für example — ohne Angabe leitet die App einen ab"
          className={`w-32 text-[10px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />
        <input value={f.description ?? ''} disabled={!canEdit} onChange={e => onChange({ description: e.target.value || undefined })}
          placeholder="fachliche Bedeutung (@description)"
          className={`flex-1 text-[10px] px-2 py-1 rounded border outline-none ${c.input}`} />
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
function EnumEditor({ type: t, isDark, canEdit, onPatch }: {
  type: TypeDef; isDark: boolean; canEdit: boolean; onPatch: (patch: Partial<TypeDef>) => void;
}) {
  const c = cls(isDark);
  const values = t.values ?? [];
  const set = (i: number, patch: Partial<(typeof values)[number]>) =>
    onPatch({ values: values.map((v, k) => (k === i ? { ...v, ...patch } : v)) });
  return (
    <div className="space-y-1">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input value={v.name} disabled={!canEdit} onChange={e => set(i, { name: e.target.value })}
            placeholder="wert"
            className={`w-40 text-[11px] px-2 py-1 rounded border outline-none font-mono ${c.input}`} />
          <input value={v.description ?? ''} disabled={!canEdit} onChange={e => set(i, { description: e.target.value || undefined })}
            placeholder="Bedeutung"
            className={`flex-1 text-[10px] px-2 py-1 rounded border outline-none ${c.input}`} />
          {canEdit && (
            <button onClick={() => onPatch({ values: values.filter((_, k) => k !== i) })} className={`p-1 ${c.muted}`}>
              <Trash2 size={11} />
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <button onClick={() => onPatch({ values: [...values, { name: '' }] })}
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
          <Plus size={11} /> Wert
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
