// Admin: Pattern — wiederkehrende BPMN-Bausteine, die die Spezifikationen
// an ihren Elementen wählen können.
//
// Ein Pattern ist ein kleines BPMN mit einem **Anker** (`PatternTarget`):
// was an ihm hängt, kommt an jedes gewählte Element, losgelöste Blöcke
// einmal in den Prozess. Werte, die je Einsatz wechseln, stehen als
// `{{name}}` darin — das sind die Parameter. Gezeichnet wird im selben
// Modeler wie in der Prozessansicht; «Leeres Pattern» legt den Anker an.
//
// Aus demselben BPMN erkennt der Import das Pattern wieder — die Übersicht
// je Pattern zeigt deshalb, was die App darin sieht.
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Download, FileUp, Pencil, Plus, Puzzle, Trash2, Upload } from 'lucide-react';
import type { EngineId, Model, PatternDef, PatternParam } from '../types';
import { BUILTIN_PARAMS, ORCHESCALA_PATTERNS, PATTERN_TARGETS, appliesTo, describeFragment, parseFragment, patternParams, placeholders, starterFragment, targetLabel } from '../patterns';
import { cls, patternTone } from '../ui';
import { slugify } from '../util';
import { AdminSection, FieldLabel, SaveRow, StateChip, flashOf, useFlash } from './adminUi';
import { useConfirm } from './Confirm';
import { MarkdownField } from './MarkdownField';
import { engineLabel } from '../engineLabels';
import { ENGINES } from '../template';

const BpmnEditor = lazy(() => import('./BpmnEditor'));

type Save = (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;

/** Zustand für Statusleiste und Kartenkopf */
export function patternState(model: Model): { tone: 'ok' | 'off' | 'warn'; label: string; detail?: string } {
  const all = model.patterns ?? [];
  if (!all.length) return { tone: 'off', label: 'keine', detail: 'noch keine Pattern definiert' };
  const bad = all.filter(p => Object.values(p.bpmn).every(x => !x) || Object.values(p.bpmn).some(x => x && 'error' in parseFragment(x)));
  return bad.length
    ? { tone: 'warn', label: `${all.length} Pattern`, detail: `${bad.length} ohne lesbares BPMN` }
    : { tone: 'ok', label: `${all.length} Pattern`, detail: all.map(p => p.name).join(', ') };
}

export default function PatternAdmin({ model, isDark, onSave, state }: { model: Model; isDark: boolean; onSave: Save; state: React.ReactNode }) {
  const c = cls(isDark);
  const patterns = model.patterns ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();
  const fileRef = useRef<HTMLInputElement>(null);

  const speichern = async (next: PatternDef[], text = 'Gespeichert') => {
    const res = await onSave({ ...model, patterns: next });
    setFlash(flashOf(res, text));
    return res.ok;
  };

  const neu = () => {
    let id = 'neues-pattern', n = 2;
    while (patterns.some(p => p.id === id)) id = `neues-pattern-${n++}`;
    const def: PatternDef = { id, name: 'Neues Pattern', appliesTo: ['userTask'], bpmn: { c7: starterFragment('userTask', 'c7') } };
    void speichern([...patterns, def], 'Angelegt').then(ok => { if (ok) setOpen(id); });
  };

  const exportieren = () => {
    const blob = new Blob([JSON.stringify({ version: 1, patterns }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orch-spec-pattern.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Import ergänzt: gleiche id wird ersetzt, neue kommen dazu, die übrigen bleiben */
  const importieren = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as { patterns?: PatternDef[] } | PatternDef[];
      const list = (Array.isArray(raw) ? raw : raw.patterns ?? []).filter(p => p && typeof p.id === 'string' && p.bpmn);
      if (!list.length) { setFlash({ ok: false, text: 'Keine Pattern in der Datei.' }); return; }
      const ids = new Set(list.map(p => p.id));
      const ersetzt = patterns.filter(p => ids.has(p.id)).length;
      await speichern([...patterns.filter(p => !ids.has(p.id)), ...list],
        `${list.length} importiert${ersetzt ? ` (${ersetzt} ersetzt)` : ''}`);
    } catch (e) {
      setFlash({ ok: false, text: `Datei unlesbar: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <AdminSection id="patterns" icon={<Puzzle size={13} />} title="Pattern" isDark={isDark} state={state}
      hint="Wiederkehrende BPMN-Bausteine — in der Spezifikation am passenden Element wählbar, beim Import wiedererkannt."
      more={<>Ein Pattern ist ein kleines BPMN mit einem <b>Anker</b> — dem Element mit der ID{' '}
        <span className="font-mono">PatternTarget</span>. Was an ihm hängt (Listener, Eingaben, Boundary-Ereignisse
        samt ihrem Pfad), kommt an jedes Element, an dem das Pattern gewählt wird. Blöcke ohne Verbindung zum Anker
        (z. B. Link-Ziel → Call Activity → Ende, ein Ereignis-Subprozess) braucht der Prozess <b>einmal</b>: fehlen
        sie, kommen sie unter das Diagramm, sonst nicht. Werte, die je Einsatz wechseln, stehen als{' '}
        <span className="font-mono">{'{{name}}'}</span> im BPMN; eingebaut sind{' '}
        <span className="font-mono">{BUILTIN_PARAMS.map(b => `{{${b}}}`).join(' ')}</span>. Ein Pattern ohne Anker
        gehört an den Prozess selbst. Erkannt wird tolerant: Reihenfolge, IDs, Namen der Knoten und
        Gross-/Kleinschreibung zählen nicht, <span className="font-mono">#{'{'}…{'}'}</span> gilt wie{' '}
        <span className="font-mono">${'{'}…{'}'}</span>, und was ein Element darüber hinaus trägt, stört nicht.</>}>
      <div className="space-y-2">
        {/* fest in Orchescala — zur Ansicht, nicht änderbar */}
        {ORCHESCALA_PATTERNS.map(p => (
          <div key={p.id} title={p.description}
            className={`rounded-lg border flex items-center gap-2 px-3 py-2 ${c.border2}`}>
            <span className="w-3" />
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-semibold ${patternTone(isDark)}`}>
              <Puzzle size={10} />{p.name}
            </span>
            <span className={`text-[10px] font-mono ${c.muted}`}>{p.id}</span>
            <span className={`text-[10px] truncate ${c.muted}`}>— fest in Orchescala, Werte in der Spezifikation</span>
            <span className="ml-auto flex items-center gap-1">
              {appliesTo(p).map(t => <span key={t} className={`text-[9px] px-1.5 py-0.5 rounded border ${c.border2} ${c.muted2}`}>{targetLabel(t)}</span>)}
              <span className={`text-[9px] font-mono ${c.muted}`}>C7 C8</span>
            </span>
          </div>
        ))}
        {patterns.map(p => (
          <PatternRow key={p.id} def={p} isDark={isDark} open={open === p.id}
            onToggle={() => setOpen(open === p.id ? null : p.id)}
            others={patterns.filter(x => x.id !== p.id).map(x => x.id)}
            onSave={async next => {
              const ok = await speichern(patterns.map(x => (x.id === p.id ? next : x)));
              if (ok && next.id !== p.id) setOpen(next.id);
              return ok;
            }}
            onDelete={() => { void speichern(patterns.filter(x => x.id !== p.id), 'Gelöscht'); setOpen(null); }} />
        ))}
        {!patterns.length && <p className={`text-[11px] ${c.muted}`}>Noch keine Pattern. Neu anlegen oder eine Pattern-Datei importieren.</p>}
        <SaveRow onSave={neu} flash={flash} isDark={isDark} label="Neues Pattern">
          <button onClick={() => fileRef.current?.click()} title="Pattern-Datei importieren — gleiche ID wird ersetzt, die übrigen bleiben"
            className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>
            <Upload size={12} /> Importieren
          </button>
          {!!patterns.length && (
            <button onClick={exportieren} title="Alle Pattern als Datei — für einen anderen Ordner oder die Bankenzone"
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

function PatternRow({ def, isDark, open, onToggle, onSave, onDelete, others }: {
  def: PatternDef; isDark: boolean; open: boolean; others: string[];
  onToggle: () => void; onSave: (d: PatternDef) => Promise<boolean>; onDelete: () => void;
}) {
  const c = cls(isDark);
  const engines = ENGINES.filter(e => def.bpmn[e.id]);
  const problems = engines.map(e => parseFragment(def.bpmn[e.id]!)).filter(f => 'error' in f).length;
  return (
    <div className={`rounded-lg border ${c.border2}`}>
      <button onClick={onToggle} className={`w-full flex items-center gap-2 px-3 py-2 text-left ${c.hover}`}>
        {open ? <ChevronDown size={12} className={c.muted2} /> : <ChevronRight size={12} className={c.muted2} />}
        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-semibold ${patternTone(isDark)}`}>
          <Puzzle size={10} />{def.name}
        </span>
        <span className={`text-[10px] font-mono ${c.muted}`}>{def.id}</span>
        <span className="ml-auto flex items-center gap-1 flex-wrap justify-end">
          {appliesTo(def).map(t => <span key={t} className={`text-[9px] px-1.5 py-0.5 rounded border ${c.border2} ${c.muted2}`}>{targetLabel(t)}</span>)}
          {engines.map(e => <span key={e.id} className={`text-[9px] font-mono ${c.muted}`}>{e.id.toUpperCase()}</span>)}
          {(problems > 0 || !engines.length) && <StateChip tone="warn" label={engines.length ? 'BPMN unlesbar' : 'ohne BPMN'} isDark={isDark} />}
        </span>
      </button>
      {open && <PatternEditor def={def} isDark={isDark} onSave={onSave} onDelete={onDelete} others={others} />}
    </div>
  );
}

function PatternEditor({ def, isDark, onSave, onDelete, others }: {
  def: PatternDef; isDark: boolean; others: string[];
  onSave: (d: PatternDef) => Promise<boolean>; onDelete: () => void;
}) {
  const confirm = useConfirm();
  const c = cls(isDark);
  const [draft, setDraft] = useState<PatternDef>(def);
  const [engine, setEngine] = useState<EngineId>(def.bpmn.c7 || !def.bpmn.c8 ? 'c7' : 'c8');
  const [editing, setEditing] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [flash, setFlash] = useFlash();
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<PatternDef>) => { setDraft(d => ({ ...d, ...patch })); setFlash(null); };
  const setBpmn = (e: EngineId, xml: string | undefined) => set({ bpmn: { ...draft.bpmn, [e]: xml } });

  const xml = draft.bpmn[engine];
  const frag = useMemo(() => (xml ? parseFragment(xml) : null), [xml]);
  const idOk = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.id) && !others.includes(draft.id);
  const params = patternParams(draft);
  const inBpmn = new Set(Object.values(draft.bpmn).flatMap(x => (x ? placeholders(x) : [])));

  const setParam = (name: string, patch: Partial<PatternParam>) => {
    const list = draft.params ?? [];
    const has = list.some(p => p.name === name);
    set({ params: has ? list.map(p => (p.name === name ? { ...p, ...patch } : p)) : [...list, { name, ...patch }] });
  };

  const speichern = async () => {
    if (!idOk) { setFlash({ ok: false, text: 'ID ungültig oder schon vergeben' }); return; }
    // nur Parameter behalten, die im BPMN vorkommen oder etwas tragen
    const cleaned: PatternDef = {
      ...draft,
      name: draft.name.trim() || draft.id,
      params: (draft.params ?? []).filter(p => inBpmn.has(p.name) || p.label || p.default || p.description),
      bpmn: Object.fromEntries(Object.entries(draft.bpmn).filter(([, x]) => x?.trim())),
    };
    const ok = await onSave(cleaned);
    setFlash(ok ? { ok: true, text: 'Gespeichert' } : { ok: false, text: 'Nicht gespeichert' });
  };

  const tags = draft.appliesTo ?? [];
  const toggleTag = (t: string) => set({ appliesTo: tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t] });
  const anchorTag = frag && !('error' in frag) ? frag.anchorTag : null;

  return (
    <div className={`border-t px-3 py-3 space-y-3 ${c.border}`}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_14rem] gap-3">
        <div>
          <FieldLabel isDark={isDark}>Name</FieldLabel>
          <input value={draft.name} onChange={e => set({ name: e.target.value })}
            onBlur={() => { if (draft.id.startsWith('neues-pattern') && draft.name.trim() && draft.name !== 'Neues Pattern') set({ id: slugify(draft.name) }); }}
            className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none ${c.input}`} />
        </div>
        <div>
          <FieldLabel isDark={isDark} hint="steht in den Spezifikationen">ID</FieldLabel>
          <input value={draft.id} onChange={e => set({ id: e.target.value })} spellCheck={false}
            className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input} ${idOk ? '' : (isDark ? 'border-rose-500/60' : 'border-rose-400')}`} />
          {draft.id !== def.id && <p className={`text-[10px] mt-1 ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>Spezifikationen mit «{def.id}» erkennen es nach dem nächsten Abgleich unter der neuen ID.</p>}
        </div>
      </div>
      <div>
        <FieldLabel isDark={isDark} hint="Markdown — was es tut und wann man es nimmt">Beschreibung</FieldLabel>
        <MarkdownField value={draft.description ?? ''} rows={3} isDark={isDark} onChange={v => set({ description: v || undefined })}
          className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none resize-y ${c.input}`} />
      </div>
      <div>
        <FieldLabel isDark={isDark}>Dokumentation</FieldLabel>
        <input value={draft.docUrl ?? ''} onChange={e => set({ docUrl: e.target.value || undefined })} spellCheck={false}
          placeholder="https://…/pattern.html#…"
          className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
      </div>
      <div>
        <FieldLabel isDark={isDark} hint={anchorTag ? `Anker im BPMN: ${targetLabel(anchorTag)}` : undefined}>Passt an</FieldLabel>
        <div className="flex flex-wrap gap-1">
          {PATTERN_TARGETS.map(t => {
            const on = tags.includes(t.tag);
            return (
              <button key={t.tag} type="button" onClick={() => toggleTag(t.tag)}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${on ? patternTone(isDark) : `${c.border2} ${c.muted}`}`}>
                {t.label}
              </button>
            );
          })}
        </div>
        {anchorTag && !tags.includes(anchorTag) && (
          <p className={`text-[10px] mt-1 ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>Der Anker im BPMN ist ein(e) {targetLabel(anchorTag)} — der Typ fehlt in der Auswahl.</p>
        )}
        {tags.includes('userTask') && (
          <label className={`mt-1.5 flex items-center gap-1.5 text-[10px] ${c.muted2}`}
            title="Das Pattern steht am Schritt unter «Zuständigkeit»; Gruppen und Person sind dort dann nicht editierbar.">
            <input type="checkbox" checked={draft.area === 'assignment'}
              onChange={e => set({ area: e.target.checked ? 'assignment' : undefined })} />
            legt die Zuständigkeit fest (steht unter «Zuständigkeit», Gruppen/Person gesperrt)
          </label>
        )}
      </div>

      {/* BPMN je Engine */}
      <div className={`rounded border ${c.border2}`}>
        <div className={`flex items-center gap-1 px-2 py-1.5 border-b ${c.border}`}>
          {ENGINES.map(e => (
            <button key={e.id} onClick={() => { setEngine(e.id); setEditing(false); }}
              className={`text-[10px] px-2 py-1 rounded border ${engine === e.id ? (isDark ? 'border-white/40 bg-white/10 text-white' : 'border-black/40 bg-black/10 text-black') : c.btn}`}>
              {e.label}{draft.bpmn[e.id] ? '' : ' —'}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1">
            {!xml && (
              <button onClick={() => { setBpmn(engine, starterFragment(tags[0] ?? 'userTask', engine)); setEditing(true); }}
                title={`BPMN mit dem Anker (${targetLabel(tags[0] ?? 'userTask')}) anlegen`}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}><Plus size={11} /> Leeres Pattern</button>
            )}
            {xml && (
              <button onClick={() => setEditing(!editing)} className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
                <Pencil size={11} /> {editing ? 'Editor schliessen' : 'Im Editor bearbeiten'}
              </button>
            )}
            <button onClick={() => fileRef.current?.click()} title="BPMN-Datei laden" className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
              <FileUp size={11} /> Datei
            </button>
            {xml && (
              <button onClick={() => {
                const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
                const a = document.createElement('a'); a.href = url; a.download = `${draft.id}-${engine}.bpmn`; a.click(); URL.revokeObjectURL(url);
              }} title="Als Datei herunterladen" className={`p-1 rounded border ${c.btn}`}><Download size={11} /></button>
            )}
            {xml && (
              <button onClick={async () => {
                if (!await confirm({ title: `BPMN für ${engineLabel(engine)} entfernen?`, text: 'Erst «Speichern» übernimmt es — in Spezifikationen dieser Engine wird das Pattern danach nicht mehr angeboten.' })) return;
                setBpmn(engine, undefined); setEditing(false);
              }} title={`BPMN für ${engineLabel(engine)} entfernen`}
                className={`p-1 rounded border ${c.btn}`}><Trash2 size={11} /></button>
            )}
            <input ref={fileRef} type="file" accept=".bpmn,.xml" className="hidden"
              onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setBpmn(engine, await f.text()); }} />
          </span>
        </div>
        {editing && xml && (
          <div className="h-[420px] relative">
            <Suspense fallback={<div className={`h-full flex items-center justify-center text-xs ${c.muted}`}>Editor wird geladen …</div>}>
              <BpmnEditor xml={xml} isDark={isDark} canEdit onChange={x => setBpmn(engine, x)} onSelect={() => {}}
                onReady={() => {}} onError={m => setEditorError(m)} />
            </Suspense>
          </div>
        )}
        {editorError && editing && <p className={`px-2 py-1 text-[10px] ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>{editorError}</p>}
        <div className="px-2 py-1.5 text-[10px] space-y-0.5">
          {!xml && <p className={c.muted}>Kein BPMN für {engineLabel(engine)} — in Spezifikationen dieser Engine wird das Pattern nicht angeboten.</p>}
          {frag && 'error' in frag && <p className={`flex items-start gap-1 ${isDark ? 'text-rose-300' : 'text-rose-700'}`}><AlertTriangle size={10} className="mt-0.5" />{frag.error}</p>}
          {frag && !('error' in frag) && (
            <>
              <p className={c.muted2}><span className="font-semibold">Anker:</span> {frag.anchor ? targetLabel(frag.anchorTag) : 'der Prozess selbst (kein PatternTarget)'}</p>
              {describeFragment(frag).map((l, i) => <p key={i} className={c.muted2}>· {l}</p>)}
              {!!draft.variants?.[engine]?.length && (
                <p className={c.muted2}>· erkennt auch {draft.variants[engine]!.length === 1 ? 'eine weitere Schreibweise' : `${draft.variants[engine]!.length} weitere Schreibweisen`} (nur in der Pattern-Datei gepflegt)</p>
              )}
              {frag.warnings.map((w, i) => <p key={`w${i}`} className={`flex items-start gap-1 ${isDark ? 'text-amber-300' : 'text-amber-700'}`}><AlertTriangle size={10} className="mt-0.5 flex-shrink-0" />{w}</p>)}
            </>
          )}
        </div>
      </div>

      {/* Parameter */}
      <div>
        <FieldLabel isDark={isDark} hint="aus den {{…}} im BPMN — Beschriftung und Vorgabe hier">Parameter</FieldLabel>
        {!params.length && <p className={`text-[10px] ${c.muted}`}>Keine — ein Wert, der je Einsatz wechselt, als {'{{name}}'} ins BPMN schreiben.</p>}
        <div className="space-y-1">
          {params.map(p => (
            <div key={p.name} className="grid grid-cols-[9rem_1fr_8rem] gap-1.5 items-center">
              <span className={`text-[10px] font-mono truncate ${inBpmn.has(p.name) ? c.text : c.muted}`}
                title={inBpmn.has(p.name) ? `{{${p.name}}} im BPMN` : 'kommt im BPMN nicht (mehr) vor'}>{p.name}</span>
              <input value={p.label ?? ''} onChange={e => setParam(p.name, { label: e.target.value || undefined })} placeholder="Beschriftung"
                className={`text-[10px] px-1.5 py-1 rounded border outline-none ${c.input}`} />
              <input value={p.default ?? ''} onChange={e => setParam(p.name, { default: e.target.value || undefined })} placeholder="Vorgabe"
                className={`text-[10px] px-1.5 py-1 rounded border outline-none font-mono ${c.input}`} />
              <input value={p.description ?? ''} onChange={e => setParam(p.name, { description: e.target.value || undefined })} placeholder="Bedeutung (Tooltip)"
                className={`col-start-2 col-span-2 text-[10px] px-1.5 py-1 rounded border outline-none ${c.input}`} />
            </div>
          ))}
        </div>
      </div>

      <SaveRow onSave={() => void speichern()} flash={flash} isDark={isDark} disabled={!idOk}>
        {confirmDelete
          ? <span className="flex items-center gap-2 text-[11px]">
              <span className={c.muted2}>Pattern löschen? Im BPMN bleibt, was schon eingefügt ist.</span>
              <button onClick={onDelete} className={`px-2 py-1 rounded border ${isDark ? 'border-rose-500/50 text-rose-300' : 'border-rose-400 text-rose-700'}`}>Löschen</button>
              <button onClick={() => setConfirmDelete(false)} className={`${c.muted} hover:underline`}>Abbrechen</button>
            </span>
          : <button onClick={() => setConfirmDelete(true)} className={`flex items-center gap-1 text-[11px] ${c.muted} hover:underline`}><Trash2 size={11} /> Löschen</button>}
      </SaveRow>
    </div>
  );
}
