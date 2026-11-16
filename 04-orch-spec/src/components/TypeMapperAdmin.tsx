// Admin: type mappers - conversions of one type into another, for the lines of every mapping in
// the folder (`ClientMainType` → `ClientType`, `BigDecimalWrapper` → `BigDecimal`). They live in
// the model.json; a line between their types converts with them - in the code an extension in the
// `schema` of the level both types share, which the worker imports.
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Download, Plus, Repeat, Trash2, Upload, Wand2 } from 'lucide-react';
import type { Model, TypeMapper } from '../types';
import { indexTypes } from '../scala';
import { isMember, isStandard, ORCHESCALA_MAPPERS, STANDARD_MAPPERS } from '../standardMappers';
import { MAPPER_KINDS, cleanMapper, enumCases, importedMappers, mapperCode, mapperFile, mapperIssues, modelMappers, prefilledCases } from '../typeMappers';
import { cls } from '../ui';
import { uid } from '../util';
import { AdminSection, SaveRow, flashOf, useFlash, type AdminTone } from './adminUi';
import TypePicker from './TypePicker';

type Save = (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;

/** State for the status bar and the card header */
export function typeMapperState(model: Model): { tone: AdminTone; label: string; detail?: string } {
  // the model's and those of the code (catalog)
  const all = modelMappers(model).filter(m => !isStandard(m));
  if (!all.length) return { tone: 'off', label: 'keine', detail: 'noch keine Typ-Mapper' };
  const idx = indexTypes([], model);
  const name = (ref: string) => idx.nameOf(ref).replace(/^.*\./, '');
  const code = all.filter(m => m.code).length;
  return { tone: 'ok', label: `${all.length}`, detail: `${all.map(m => `${name(m.from)} → ${name(m.to)}`).join(', ')}${code ? ` (${code} aus dem Code)` : ''}` };
}

export default function TypeMapperAdmin({ model, isDark, onSave, state }: {
  model: Model; isDark: boolean; onSave: Save; state: React.ReactNode;
}) {
  const c = cls(isDark);
  const err = isDark ? 'text-rose-400' : 'text-rose-600';
  const [draft, setDraft] = useState<TypeMapper[]>(model.typeMappers ?? []);
  const [flash, setFlash] = useFlash();
  const idx = useMemo(() => indexTypes([], model), [model]);
  const name = (ref: string) => (ref ? idx.nameOf(ref).replace(/^.*\./, '') : '?');
  const set = (id: string, patch: Partial<TypeMapper>) => {
    setDraft(d => d.map(m => (m.id === id ? { ...m, ...patch } : m)));
    setFlash(null);
  };
  /** the table filled where the cases are alike - when both are enums; an enum onto values: a row per case */
  const filled = (m: TypeMapper): Partial<TypeMapper> => {
    const from = enumCases(m.from, idx);
    const to = enumCases(m.to, idx);
    if (from && to) return { cases: prefilledCases(from, to, m.cases) };
    if (from) return { cases: from.map(f => (m.cases ?? []).find(x => x.from === f) ?? { from: f, to: '' }) };
    return {};
  };
  const setTypes = (m: TypeMapper, patch: Pick<Partial<TypeMapper>, 'from' | 'to'>) => {
    const next = { ...m, ...patch };
    // two enums: a table, filled by the names
    const both = !!enumCases(next.from, idx) && !!enumCases(next.to, idx);
    set(m.id, { ...patch, ...(both ? { kind: 'table' as const, ...filled({ ...next, cases: [] }) } : {}) });
  };
  const add = () => { setDraft(d => [...d, { id: uid('tm'), from: '', to: '', kind: 'field', path: 'value' }]); setFlash(null); };
  const remove = (id: string) => { setDraft(d => d.filter(m => m.id !== id)); setFlash(null); };

  const store = async (next: TypeMapper[], text?: string) => {
    const res = await onSave({ ...model, typeMappers: next.length ? next : undefined });
    if (res.ok) setDraft(next);
    setFlash(flashOf(res, text));
  };
  const save = () => store(draft.map(cleanMapper).filter((m): m is TypeMapper => !!m));

  const fileRef = useRef<HTMLInputElement>(null);
  /** the saved mappers as a file - for another folder or the bank zone */
  const exportieren = () => {
    const url = URL.createObjectURL(new Blob([mapperFile(model.typeMappers ?? [])], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orch-spec-type-mappers.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  /** import adds to the saved ones: the same id or From → To is replaced, the others stay */
  const importieren = async (file: File) => {
    try {
      const { all, added, replaced } = importedMappers(model.typeMappers ?? [], await file.text());
      await store(all, `${added} importiert${replaced ? `, ${replaced} ersetzt` : ''}`);
    } catch (e) {
      setFlash({ ok: false, text: `Datei unlesbar: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const unsaved = JSON.stringify(draft) !== JSON.stringify(model.typeMappers ?? []);

  const input = `text-[11px] px-2 py-1 rounded border outline-none ${c.input}`;
  return (
    <AdminSection id="type-mappers" icon={<Repeat size={13} />} title="Typ-Mapper" isDark={isDark} state={state}
      hint="Wie ein Typ in einen anderen kommt - eine Linie eines Mappings zwischen ihnen wandelt damit."
      more={<>Gilt für alle Mappings im Ordner (Skript-Aufgaben einer Service-Orchestrierung). Zieht man im
        Mapping eine Linie von einem <span className="font-mono">ClientMainType</span> auf einen{' '}
        <span className="font-mono">ClientType</span>, wandelt der Mapper dazwischen - ohne Warnung, und
        «Automatisch zuordnen» nimmt solche Felder auch. Im Code wird jeder benutzte Mapper eine Extension
        (<span className="font-mono">existing.kind.toClientType</span>) im <span className="font-mono">schema</span> der
        tiefsten Ebene, die seine Typen des Projekts teilen (ein Typ eines anderen Projekts oder <span className="font-mono">LocalDate</span>{' '}
        zählt nicht) - sonst in dem des Projekts; der Export bringt die Datei mit, der
        Worker importiert sie. Eine Liste oder ein Option davon wird mitgemappt. <b>Tabelle</b>: ein Enum in ein Enum, Fall
        für Fall (gleiche Namen sind vorbelegt). <b>Feld</b>: ein Feld davon, z.B. <span className="font-mono">value</span>{' '}
        eines Wrappers. <b>Scala</b>: ein Ausdruck über <span className="font-mono">x</span>.{' '}
        <b>Deserialisierer</b>: der Decoder des Ziels im Code liest es (<span className="font-mono">x.asJson.as[Ziel]</span>).</>}>
      <div className="space-y-2">
        {draft.map(m => {
          const issues = m.from && m.to ? mapperIssues(m, draft, idx) : [];
          const fromCases = enumCases(m.from, idx);
          const toCases = enumCases(m.to, idx);
          return (
            <div key={m.id} className={`rounded-lg border px-3 py-2 space-y-1.5 ${c.border2}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <TypePicker value={m.from} types={[]} selfId="" model={model} isDark={isDark} onPick={v => setTypes(m, { from: v })} className="w-56" />
                <ArrowRight size={12} className={c.muted} />
                <TypePicker value={m.to} types={[]} selfId="" model={model} isDark={isDark} onPick={v => setTypes(m, { to: v })} className="w-56" />
                <span className={`inline-flex rounded border overflow-hidden text-[10px] ${c.border}`}>
                  {MAPPER_KINDS.map(k => (
                    <button key={k.kind} type="button" title={k.hint}
                      onClick={() => set(m.id, { kind: k.kind, ...(k.kind === 'table' ? filled(m) : {}) })}
                      className={`px-1.5 py-0.5 ${m.kind === k.kind ? c.btnPrimary : c.btn}`}>{k.label}</button>
                  ))}
                </span>
                <button onClick={() => remove(m.id)} title="Typ-Mapper löschen" className={`ml-auto p-1 rounded ${c.muted} hover:text-rose-500`}>
                  <Trash2 size={12} />
                </button>
              </div>

              {m.kind === 'table' && (fromCases && toCases ? (
                <div className="space-y-0.5">
                  <div className={`grid grid-cols-[minmax(0,1fr)_12px_minmax(0,1fr)] gap-2 text-[10px] uppercase tracking-wide ${c.muted}`}>
                    <span className="truncate">{name(m.from)}</span><span /><span className="truncate">{name(m.to)}</span>
                  </div>
                  {!fromCases.length && <p className={`text-[10px] ${err}`}>{name(m.from)} hat im Katalog keine Fälle.</p>}
                  {!toCases.length && <p className={`text-[10px] ${err}`}>{name(m.to)} hat im Katalog keine Fälle - nichts zum Auswählen.</p>}
                  {fromCases.map(f => {
                    const row = (m.cases ?? []).find(x => x.from === f);
                    return (
                      <div key={f} className="grid grid-cols-[minmax(0,1fr)_12px_minmax(0,1fr)] gap-2 items-center text-[11px]">
                        <span className="font-mono break-all" title={`${name(m.from)}.${f}`}>{f}</span>
                        <ArrowRight size={11} className={c.muted} />
                        <select value={row?.to ?? ''} onChange={e => set(m.id, { cases: [...(m.cases ?? []).filter(x => x.from !== f), { from: f, to: e.target.value }] })}
                          className={`min-w-0 font-mono ${input} ${row?.to ? '' : (isDark ? 'border-amber-500/60' : 'border-amber-400')}`}>
                          <option value="">- kein Fall -</option>
                          {toCases.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => set(m.id, filled({ ...m, cases: (m.cases ?? []).filter(x => x.to) }))}
                    className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${c.btn}`} title="Die Fälle ohne Ziel vorbelegen: gleicher Name, sonst der einzige, auf den der Name endet (CLIENT_MAIN_TYPE_PERSON → PERSON)">
                    <Wand2 size={10} /> Ähnliche Namen
                  </button>
                </div>
              ) : m.from && m.to ? (
                // values: Von a simple type (or Nach) - row by row, a value and what it becomes
                <div className="space-y-0.5">
                  <div className={`grid grid-cols-[minmax(0,1fr)_12px_minmax(0,1fr)_16px] gap-2 text-[10px] uppercase tracking-wide ${c.muted}`}>
                    <span className="truncate">{name(m.from)}</span><span /><span className="truncate">{name(m.to)}</span><span />
                  </div>
                  {(m.cases ?? []).map((row, k) => {
                    const put = (patch: Partial<{ from: string; to: string }>) =>
                      set(m.id, { cases: (m.cases ?? []).map((x, j) => (j === k ? { ...x, ...patch } : x)) });
                    return (
                      <div key={k} className="grid grid-cols-[minmax(0,1fr)_12px_minmax(0,1fr)_16px] gap-2 items-center text-[11px]">
                        {fromCases
                          ? <span className="font-mono break-all">{row.from}</span>
                          : <input value={row.from} onChange={e => put({ from: e.target.value })} placeholder="1" className={`min-w-0 font-mono ${input}`} />}
                        <ArrowRight size={11} className={c.muted} />
                        {toCases
                          ? (
                            <select value={row.to} onChange={e => put({ to: e.target.value })} className={`min-w-0 font-mono ${input} ${row.to ? '' : (isDark ? 'border-amber-500/60' : 'border-amber-400')}`}>
                              <option value="">- kein Fall -</option>
                              {toCases.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          )
                          : <input value={row.to} onChange={e => put({ to: e.target.value })} placeholder="de" className={`min-w-0 font-mono ${input}`} />}
                        <button type="button" onClick={() => set(m.id, { cases: (m.cases ?? []).filter((_, j) => j !== k) })} title="Zeile löschen"
                          className={`p-0.5 ${c.muted} hover:text-rose-500`}><Trash2 size={10} /></button>
                      </div>
                    );
                  })}
                  {!fromCases && (
                    <button type="button" onClick={() => set(m.id, { cases: [...(m.cases ?? []), { from: '', to: '' }] })}
                      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${c.btn}`}>
                      <Plus size={10} /> Zeile
                    </button>
                  )}
                  <p className={`text-[10px] ${c.muted}`}>Werte wie im Code: ein String ohne Anführungszeichen (de), eine Zahl wie sie ist (1). Ein Wert ohne Zeile wirft zur Laufzeit.</p>
                </div>
              ) : <p className={`text-[10px] ${c.muted}`}>Erst Von und Nach wählen.</p>)}
              {m.kind === 'field' && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`${c.muted} w-20`}>Feld</span>
                  <span className="font-mono">x.</span>
                  <input value={m.path ?? ''} onChange={e => set(m.id, { path: e.target.value })} placeholder="value" className={`w-56 font-mono ${input}`} />
                </div>
              )}
              {m.kind === 'scala' && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={`${c.muted} w-20`}>Ausdruck</span>
                    <input value={m.scala ?? ''} onChange={e => set(m.id, { scala: e.target.value })} placeholder="LocalDate.parse(x.date)" className={`flex-1 font-mono ${input}`} />
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={`${c.muted} w-20`}>Imports</span>
                    <input value={(m.imports ?? []).join(', ')} onChange={e => set(m.id, { imports: e.target.value.split(',').map(i => i.trim()) })}
                      placeholder="java.time.LocalDate" className={`flex-1 font-mono ${input}`} />
                  </div>
                </div>
              )}
              {m.kind === 'decoder' && (
                <p className={`text-[10px] ${c.muted}`}>Der Deserialisierer von {name(m.to)} im Code liest den Wert von {name(m.from)} - ohne Fall-Tabelle hier.</p>
              )}
              <div className="flex items-center gap-2">
                <input value={m.name ?? ''} onChange={e => set(m.id, { name: e.target.value || undefined })} placeholder="Name (optional)"
                  title="Mit Namen (Sprache, Land …) gilt er nur, wo eine Linie eines Mappings ihn wählt - so gehen mehrere mit denselben Typen (Int → String)"
                  className={`w-40 ${input} ${m.kind === 'table' && !fromCases && !m.name?.trim() ? (isDark ? 'border-amber-500/60' : 'border-amber-400') : ''}`} />
                <input value={m.description ?? ''} onChange={e => set(m.id, { description: e.target.value })} placeholder="Worum es geht (optional)" className={`flex-1 ${input}`} />
              </div>
              {m.from && m.to && (
                <details className="text-[10px]">
                  <summary className={`cursor-pointer ${c.muted}`}>Im Code</summary>
                  <pre className={`mt-1 p-1.5 rounded border whitespace-pre-wrap font-mono text-[10px] ${c.border}`}>
                    {mapperCode(m, idx.nameOf, fromCases, toCases).replace(/^ {2}/gm, '')}
                  </pre>
                </details>
              )}
              {issues.map((t, k) => (
                <p key={k} className={`text-[10px] flex items-start gap-1 ${err}`}><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{t}</span></p>
              ))}
            </div>
          );
        })}
        {!draft.length && <p className={`text-[11px] ${c.muted}`}>Noch keine Typ-Mapper.</p>}
        {/* those of the code - the catalog read them (extensions in the domain), not editable here */}
        {!!(model.domainMappers ?? []).length && (
          <div className={`rounded-lg border px-3 py-2 space-y-1 ${c.border2}`}>
            <p className={`text-[10px] uppercase tracking-wide ${c.muted}`}>Aus dem Code (Katalog)</p>
            {(model.domainMappers ?? []).map(d => {
              const own = draft.some(m => name(m.from) === d.from && name(m.to) === d.to);
              return (
                <div key={d.id} className="flex items-baseline gap-2 flex-wrap text-[11px]" title={d.source ?? d.pkg}>
                  <span className="font-mono">{d.from}</span><ArrowRight size={10} className={c.muted} /><span className="font-mono">{d.to}</span>
                  <span className={`font-mono text-[10px] ${c.muted}`}>{d.object}.{d.method}</span>
                  <span className={`font-mono text-[10px] ${c.muted} break-all`}>{d.pkg}</span>
                  {d.descr && <span className={`text-[10px] ${c.muted}`}>{d.descr}</span>}
                  {own && <span className={`text-[10px] ${c.muted}`}>· der eigene oben gilt</span>}
                </div>
              );
            })}
          </div>
        )}
        {/* the generic ones every project has - none to define, none to copy */}
        <details className={`rounded-lg border px-3 py-2 text-[11px] ${c.border2}`}>
          <summary className={`cursor-pointer text-[10px] uppercase tracking-wide ${c.muted}`}>Standard (orchescala) · {STANDARD_MAPPERS.length}</summary>
          <p className={`mt-1 text-[10px] ${c.muted}`}>Gelten in jedem Projekt, ohne Definition hier. Eine Methode des Typs ruft der Worker direkt
            (<span className="font-mono">x.toString</span>), die übrigen kommen aus <span className="font-mono">{ORCHESCALA_MAPPERS.pkg}.{ORCHESCALA_MAPPERS.object}</span>.
            Ein eigener Typ-Mapper mit denselben Typen geht vor.</p>
          <div className="mt-1 grid grid-cols-[auto_12px_auto_1fr] gap-x-2 gap-y-0.5 items-baseline">
            {STANDARD_MAPPERS.map(m => (
              <div key={m.id} className="contents">
                <span className="font-mono">{m.from}</span><ArrowRight size={10} className={c.muted} /><span className="font-mono">{m.to}</span>
                <span className={`font-mono text-[10px] ${c.muted}`}>
                  {isMember(m) ? `x.${m.code!.method}` : `${ORCHESCALA_MAPPERS.object}.${m.code!.method}`}{m.description ? ` · ${m.description.replace(/`/g, '')}` : ''}
                </span>
              </div>
            ))}
          </div>
        </details>
        <SaveRow onSave={() => void save()} flash={flash} isDark={isDark}>
          <button onClick={add} className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>
            <Plus size={12} /> Typ-Mapper
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={unsaved}
            title={unsaved ? 'Erst speichern - der Import ergänzt die gespeicherten' : 'Typ-Mapper-Datei importieren - gleiches Von → Nach wird ersetzt, die übrigen bleiben. Scala-Ausdrücke und Imports der Datei kommen so in den Code - nur Dateien aus bekannter Quelle.'}
            className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
            <Upload size={12} /> Importieren
          </button>
          {!!model.typeMappers?.length && (
            <button onClick={exportieren} title={unsaved ? 'Exportiert den gespeicherten Stand - Änderungen erst speichern' : 'Alle gespeicherten Typ-Mapper als Datei - für einen anderen Ordner oder die Bankenzone'}
              className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>
              <Download size={12} /> Exportieren
            </button>
          )}
          <input ref={fileRef} type="file" accept=".json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importieren(f); }} />
        </SaveRow>
      </div>
    </AdminSection>
  );
}
