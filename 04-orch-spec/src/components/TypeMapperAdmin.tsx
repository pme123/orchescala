// Admin: type mappers - conversions of one type into another, for the lines of every mapping in
// the folder (`ClientMainType` → `ClientType`, `BigDecimalWrapper` → `BigDecimal`). They live in
// the model.json; a line between their types converts with them, in the worker a method each.
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Download, Plus, Repeat, Trash2, Upload, Wand2 } from 'lucide-react';
import type { Model, TypeMapper } from '../types';
import { indexTypes } from '../scala';
import { MAPPER_KINDS, cleanMapper, enumCases, importedMappers, mapperBody, mapperFile, mapperIssues, mapperMethod, prefilledCases } from '../typeMappers';
import { cls } from '../ui';
import { uid } from '../util';
import { AdminSection, SaveRow, flashOf, useFlash, type AdminTone } from './adminUi';
import TypePicker from './TypePicker';

type Save = (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;

/** State for the status bar and the card header */
export function typeMapperState(model: Model): { tone: AdminTone; label: string; detail?: string } {
  const all = model.typeMappers ?? [];
  if (!all.length) return { tone: 'off', label: 'keine', detail: 'noch keine Typ-Mapper' };
  const idx = indexTypes([], model);
  const name = (ref: string) => idx.nameOf(ref).replace(/^.*\./, '');
  return { tone: 'ok', label: `${all.length}`, detail: all.map(m => `${name(m.from)} → ${name(m.to)}`).join(', ') };
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
  /** the table filled where the cases are alike - when both are enums */
  const filled = (m: TypeMapper): Partial<TypeMapper> => {
    const from = enumCases(m.from, idx);
    const to = enumCases(m.to, idx);
    return from && to ? { cases: prefilledCases(from, to, m.cases) } : {};
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
        «Automatisch zuordnen» nimmt solche Felder auch. Im Worker wird jeder benutzte Mapper eine eigene
        Methode; eine Liste oder ein Option davon wird mitgemappt. <b>Tabelle</b>: ein Enum in ein Enum, Fall
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
              ) : <p className={`text-[10px] ${c.muted}`}>Eine Tabelle braucht als Von und Nach je ein Enum.</p>)}
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
              <input value={m.description ?? ''} onChange={e => set(m.id, { description: e.target.value })} placeholder="Worum es geht (optional)" className={`w-full ${input}`} />
              {m.from && m.to && (
                <details className="text-[10px]">
                  <summary className={`cursor-pointer ${c.muted}`}>Im Worker</summary>
                  <pre className={`mt-1 p-1.5 rounded border whitespace-pre-wrap font-mono text-[10px] ${c.border}`}>
                    {`def ${mapperMethod(m, idx.nameOf)}(x: ${name(m.from)}): ${name(m.to)} =\n${mapperBody(m, idx.nameOf, fromCases).replace(/^/gm, '  ')}`}
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
        <SaveRow onSave={() => void save()} flash={flash} isDark={isDark}>
          <button onClick={add} className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>
            <Plus size={12} /> Typ-Mapper
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={unsaved}
            title={unsaved ? 'Erst speichern - der Import ergänzt die gespeicherten' : 'Typ-Mapper-Datei importieren - gleiche ID oder gleiches Von → Nach wird ersetzt, die übrigen bleiben'}
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
