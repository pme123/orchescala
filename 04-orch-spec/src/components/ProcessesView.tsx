// Übersicht aller Spezifikationen im geteilten Ordner.
//
// Zwei Wege zu einer neuen Spezifikation:
//
//  · **Aus BPMN** — die Struktur kommt aus der Implementation, die Prosa
//    schreibt man danach.
//  · **Aus Projekt** — ein Ordner oder ZIP des Orchescala-Projekts: die App
//    findet die BPMNs und die Domain und baut daraus Spezifikationen mit
//    Datenmodell und Interaktionen (siehe `projectImport.ts`).
//  · **Neu** — der Prozess startet mit der **Vorlage** (Admin → Vorlage für
//    neue Prozesse; ohne eigene gilt die eingebaute). Aus ihr entstehen
//    Diagramm und Ablaufbaum in einem Zug — mit der neuen Prozess-ID, denn
//    daran hängen Topics, Domain-Zuordnung und Dateiname.
//
// **Löschen** gibt es nur hier, nicht in der Prozessansicht — dort speichert
// die App automatisch, und ein Autosave nach dem Löschen legte die Datei
// gleich wieder an. Erlaubt ist es nur mit Admin-Rolle oder ohne
// Anmeldepflicht (`canDelete`); vorher wird gefragt, denn weg ist weg:
// Spezifikation **und** BPMN.
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileCode2, FilePlus2, FolderOpen, Package, Trash2, Upload, X } from 'lucide-react';
import { analyzeProject, readProjectDir, readProjectZip, type ProjectAnalysis } from '../projectImport';
import { useStore } from '../store';
import { usePermissions } from '../auth';
import { importBpmn, statusCounts } from '../bpmn';
import { DEFAULT_ENGINE, ENGINES, applyTemplate, loadTemplate } from '../template';
import { STATUS_META, STATUSES, type EngineId, type Status, type Step } from '../types';
import { StatusChip, cls } from '../ui';
import { knownPrefixes, splitPrefix } from '../stepIds';
import { slugify } from '../util';

export default function ProcessesView({ onOpen }: { onOpen: (slug: string) => void }) {
  const { isDark, specs, createSpec, saveBpmn, deleteSpec, model } = useStore();
  const { canEdit, canDelete } = usePermissions();
  const c = cls(isDark);
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  // Import aus Projekt: Analyse und Auswahl der gefundenen Prozesse
  const [projOpen, setProjOpen] = useState(false);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [projBusy, setProjBusy] = useState<string | null>(null);
  const [projErrors, setProjErrors] = useState<string[]>([]);
  /** Spezifikation, deren Löschen gerade bestätigt werden soll */
  const [toDelete, setToDelete] = useState<{ slug: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [project, setProject] = useState('');
  const [version, setVersion] = useState('1');
  const [engine, setEngine] = useState<EngineId>(DEFAULT_ENGINE);
  // `company-project-processVversion` — so heissen die Prozesse im Haus, und
  // genau diese Teile trägt die Vorlage an ihren Platzhalter-Stellen.
  const processId = [company.trim(), project.trim(), name.trim() && `${name.trim()}V${version.trim() || '1'}`]
    .filter(Boolean).join('-');
  // Auswahl statt Raten: alle Firmen und Projekte, die Katalog und
  // vorhandene Spezifikationen kennen — Freitext bleibt für Neues möglich.
  const prefixes = useMemo(() => knownPrefixes(model, specs.map(s => s.data.project)), [model, specs]);
  const companies = useMemo(() => [...new Set(prefixes.map(p => splitPrefix(p).company))], [prefixes]);
  const projectOptions = useMemo(() => {
    const firma = company.trim();
    const passend = firma ? prefixes.filter(p => p.startsWith(`${firma}-`)) : prefixes;
    return [...new Set(passend.map(p => (firma ? p.slice(firma.length + 1) : splitPrefix(p).project)))].filter(Boolean);
  }, [prefixes, company]);
  // Firma und Projekt sind bei allen Prozessen eines Hauses dieselben — der
  // zuletzt angelegte ist deshalb der beste Vorschlag.
  const letztes = useMemo(() => {
    const voriges = specs.map(s => s.data.project).filter(Boolean).slice(-1)[0] ?? '';
    const [firma, ...rest] = voriges.split('-');
    return { company: firma ?? '', project: rest.join('-') };
  }, [specs]);

  const fromBpmn = async (file: File) => {
    setError('');
    try {
      const text = await file.text();
      const { spec, stepCount, unreachable } = importBpmn(text, file.name);
      const res = await createSpec(spec);
      if (!res.ok) { setError(res.message); return; }
      // Das BPMN bleibt neben der Spezifikation liegen — damit lässt es sich
      // in der Prozessansicht direkt bearbeiten.
      const w = await saveBpmn(spec.slug, text);
      if (!w.ok) setError(w.message);
      if (unreachable.length) {
        console.warn('[orch-spec] nicht erreichbare BPMN-Elemente:', unreachable);
      }
      console.info(`[orch-spec] ${stepCount} Schritte importiert`);
      onOpen(spec.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── Aus Projekt ────────────────────────────────────────────────────────
  const analyze = (files: Array<{ path: string; text: string }>) => {
    const a = analyzeProject(files, model);
    setAnalysis(a);
    // vorgewählt: alles, was noch nicht als Spezifikation da ist
    setChosen(new Set(a.processes.filter(p => !specs.some(s => s.slug === p.spec.slug)).map(p => p.file)));
    setProjErrors(a.errors);
  };
  const pickProjectDir = async () => {
    if (!('showDirectoryPicker' in window)) { setProjErrors(['Ordner wählen geht nur in Chrome oder Edge — als Alternative ein ZIP wählen.']); return; }
    try {
      const dir = await window.showDirectoryPicker({ mode: 'read' });
      setProjBusy(`${dir.name} wird gelesen …`);
      analyze(await readProjectDir(dir));
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setProjErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setProjBusy(null);
    }
  };
  const pickProjectZip = async (file: File) => {
    try {
      setProjBusy(`${file.name} wird gelesen …`);
      analyze(readProjectZip(new Uint8Array(await file.arrayBuffer())));
    } catch (e) {
      setProjErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setProjBusy(null);
    }
  };
  const importChosen = async () => {
    if (!analysis) return;
    const todo = analysis.processes.filter(p => chosen.has(p.file));
    const fehler: string[] = [];
    let first: string | null = null;
    setProjBusy('Spezifikationen werden angelegt …');
    for (const p of todo) {
      const res = await createSpec(p.spec);
      if (!res.ok) { fehler.push(`${p.spec.title || p.spec.slug}: ${res.message}`); continue; }
      const w = await saveBpmn(p.spec.slug, p.xml);
      if (!w.ok) fehler.push(`${p.spec.title || p.spec.slug}: BPMN nicht gespeichert — ${w.message}`);
      first ??= p.spec.slug;
    }
    setProjBusy(null);
    setProjErrors(fehler);
    if (!fehler.length) { setProjOpen(false); setAnalysis(null); }
    if (first && todo.length === 1) onOpen(first);
  };

  // Aus der Vorlage entsteht beides: das Diagramm und der Baum daraus. So
  // fängt ein neuer Prozess dort an, wo im Haus alle anfangen.
  const createFromTemplate = async () => {
    if (!name.trim()) { setError('Bitte einen Prozessnamen angeben.'); return; }
    if (specs.some(s => s.data.processId === processId || s.slug === slugify(processId))) {
      setError(`«${processId}» gibt es schon.`);
      return;
    }
    setError('');
    try {
      const xml = applyTemplate(await loadTemplate(engine), { processId, title: title || processId });
      const { spec } = importBpmn(xml, `${slugify(processId)}.bpmn`);
      // Der Ablauf kommt aus der Vorlage, ist aber noch nicht umgesetzt —
      // und zwar auf allen Ebenen: Unterschritte, Zweige und Fehlerpfade.
      const entwurf = (steps: Step[]): Step[] => steps.map(s => ({
        ...s,
        status: 'draft' as Status,
        ...(s.children ? { children: entwurf(s.children) } : {}),
        ...(s.branches ? { branches: s.branches.map(b => ({ ...b, steps: entwurf(b.steps) })) } : {}),
        ...(s.errors ? { errors: s.errors.map(e => (e.steps ? { ...e, steps: entwurf(e.steps) } : e)) } : {}),
      }));
      const neu = { ...spec, title: title || processId, engine, status: 'draft' as Status, steps: entwurf(spec.steps) };
      const res = await createSpec(neu);
      if (!res.ok) { setError(res.message); return; }
      const w = await saveBpmn(neu.slug, xml);
      if (!w.ok) { setError(w.message); return; }
      setNewOpen(false); setTitle(''); setName('');
      onOpen(neu.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete || deleting) return;
    setDeleting(true); setError('');
    const res = await deleteSpec(toDelete.slug);
    setDeleting(false);
    if (!res.ok) setError(res.message);
    setToDelete(null);
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-5">
        <h1 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Prozess-Spezifikationen</h1>
        {canEdit && (
          <div className="ml-auto flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".bpmn,.xml" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void fromBpmn(f); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
              <Upload size={12} /> Aus BPMN
            </button>
            <button onClick={() => { setProjOpen(v => !v); setProjErrors([]); }}
              title="Ordner oder ZIP eines Orchescala-Projekts — BPMN und Domain werden zusammen eingelesen"
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${
                projOpen ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10') : c.btn}`}>
              <Package size={12} /> Aus Projekt
            </button>
            <button onClick={() => {
              setCompany(v => v || letztes.company);
              setProject(v => v || letztes.project);
              setNewOpen(true);
            }}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded font-semibold ${c.btnPrimary}`}>
              <FilePlus2 size={12} /> Neu
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className={`mb-4 text-[11px] px-3 py-2 rounded border ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
          {error}
        </div>
      )}

      {projOpen && (
        <div className={`mb-4 p-3 rounded border ${c.border2} ${c.panel}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-[11px] ${c.muted2}`}>Aus Projekt importieren</span>
            <button onClick={() => { setProjOpen(false); setAnalysis(null); }} className={`ml-auto ${c.muted}`}><X size={12} /></button>
          </div>
          <p className={`text-[10px] mb-2 ${c.muted}`}>
            Das Orchescala-Projekt als Ordner (Chrome/Edge) oder als ZIP: die App findet die BPMNs und liest die Domain
            unter <span className="font-mono">01-domain</span> — je Prozess entsteht eine Spezifikation mit Datenmodell
            (In, InitIn, Out, eigene Typen) und Interaktionen samt deren In/Out.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={pickProjectDir} disabled={!!projBusy}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
              <FolderOpen size={12} /> Ordner wählen
            </button>
            <input ref={zipRef} type="file" accept=".zip" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void pickProjectZip(f); e.target.value = ''; }} />
            <button onClick={() => zipRef.current?.click()} disabled={!!projBusy}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
              <Upload size={12} /> ZIP wählen
            </button>
            {projBusy && <span className={`text-[10px] ${c.muted}`}>{projBusy}</span>}
          </div>
          {!!projErrors.length && (
            <div className={`mt-2 text-[10px] px-2 py-1.5 rounded border space-y-0.5 ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
              {projErrors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
          {analysis && (
            <div className="mt-3 space-y-1.5">
              <p className={`text-[10px] ${c.muted}`}>
                {analysis.bpmnFiles} BPMN · {analysis.scalaFiles} Scala-Dateien · {analysis.domainTypes} Domain-Typen
                {analysis.processes.length ? '' : ' — kein Prozess gefunden.'}
              </p>
              {analysis.processes.map(p => {
                const exists = specs.some(s => s.slug === p.spec.slug);
                const on = chosen.has(p.file);
                return (
                  <label key={p.file} className={`block px-2 py-1.5 rounded border cursor-pointer ${on ? c.border2 : c.border} ${c.hover}`}>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={on} disabled={exists}
                        onChange={e => setChosen(prev => { const n = new Set(prev); if (e.target.checked) n.add(p.file); else n.delete(p.file); return n; })} />
                      <span className={`text-[11px] ${c.text}`}>{p.spec.title || p.spec.processId}</span>
                      <span className={`text-[10px] font-mono ${c.muted}`}>{p.spec.processId}</span>
                      <span className={`ml-auto text-[10px] ${c.muted}`}>
                        {p.steps} Schritte · {p.spec.types?.length ?? 0} Typen · {p.spec.interactions?.length ?? 0} Interaktionen
                        {exists ? ' · schon vorhanden' : ''}
                      </span>
                    </div>
                    <div className={`text-[10px] font-mono truncate ${c.muted}`} title={[p.file, ...p.copies].join('\n')}>
                      {p.file}{p.copies.length ? ` (+${p.copies.length} Kopie${p.copies.length === 1 ? '' : 'n'})` : ''}
                      {p.object ? ` · ${p.object}` : ''}
                    </div>
                    {(p.warnings.length > 0 || p.unmatched.length > 0 || p.unresolved.length > 0) && (
                      <div className={`mt-1 text-[10px] space-y-0.5 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                        {p.warnings.map((w, i) => <div key={i} className="flex items-start gap-1"><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{w}</span></div>)}
                        {!!p.unmatched.length && <div>Ohne Schritt im Ablauf: {p.unmatched.join(', ')}</div>}
                        {!!p.unresolved.length && <div>Typen weder im Projekt noch im Katalog: {p.unresolved.join(', ')}</div>}
                      </div>
                    )}
                  </label>
                );
              })}
              {!!analysis.processes.length && (
                <button onClick={importChosen} disabled={!chosen.size || !!projBusy}
                  className={`text-[11px] px-3 py-1.5 rounded font-semibold disabled:opacity-40 ${c.btnPrimary}`}>
                  {chosen.size} importieren
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {toDelete && (
        <div className={`mb-4 p-3 rounded border ${isDark ? 'border-rose-500/30 bg-rose-500/5' : 'border-rose-300 bg-rose-50'}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <Trash2 size={12} className={isDark ? 'text-rose-300' : 'text-rose-700'} />
            <span className={`text-[11px] font-semibold ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>
              «{toDelete.title}» löschen?
            </span>
            <button onClick={() => setToDelete(null)} disabled={deleting} className={`ml-auto ${c.muted}`}><X size={12} /></button>
          </div>
          <p className={`text-[11px] ${c.muted2}`}>
            Entfernt werden Spezifikation und Diagramm aus dem geteilten Ordner:
            {' '}<span className="font-mono">processes/{toDelete.slug}.json</span>
            {' '}und <span className="font-mono">processes/{toDelete.slug}.bpmn</span>.
            {' '}Das lässt sich in der App nicht rückgängig machen.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={confirmDelete} disabled={deleting}
              className={`text-[11px] px-3 py-1.5 rounded font-semibold text-white disabled:opacity-40 ${isDark ? 'bg-rose-500 hover:bg-rose-400' : 'bg-rose-600 hover:bg-rose-500'}`}>
              {deleting ? 'Löscht …' : 'Endgültig löschen'}
            </button>
            <button onClick={() => setToDelete(null)} disabled={deleting}
              className={`text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
          </div>
        </div>
      )}

      {newOpen && (
        <div className={`mb-4 p-3 rounded border ${c.border2} ${c.panel}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-[11px] ${c.muted2}`}>Neue Spezifikation</span>
            <button onClick={() => setNewOpen(false)} className={`ml-auto ${c.muted}`}><X size={12} /></button>
          </div>
          <div className="flex gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Fachlicher Titel"
              className={`flex-1 text-[11px] px-2 py-1.5 rounded border outline-none ${c.input}`} />
            <button onClick={createFromTemplate} disabled={!name.trim()}
              className={`text-[11px] px-3 py-1.5 rounded font-semibold disabled:opacity-40 ${c.btnPrimary}`}>Anlegen</button>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            {/* Firma und Projekt mit den bekannten Werten aus Katalog und
                Spezifikationen als Auswahl — tippen für neue bleibt möglich */}
            {([['company', company, setCompany, 'company', 'w-28', 'firmen-liste'],
               ['project', project, setProject, 'project', 'w-28', 'projekte-liste'],
               ['process', name, setName, 'process', 'flex-1', undefined]] as const).map(([id, wert, setzen, platzhalter, breite, liste]) => (
              <div key={id} className={breite}>
                <input value={wert} onChange={e => setzen(e.target.value)} placeholder={platzhalter} list={liste}
                  className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
              </div>
            ))}
            <datalist id="firmen-liste">
              {companies.map(f => <option key={f} value={f} />)}
            </datalist>
            <datalist id="projekte-liste">
              {projectOptions.map(p => <option key={p} value={p} />)}
            </datalist>
            <span className={`text-[11px] font-mono ${c.muted}`}>V</span>
            <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1"
              className={`w-12 text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
          </div>
          {/* Die bereitgestellten Vorlagen — je Engine eine. */}
          <div className="flex items-center gap-1.5 mt-2">
            {ENGINES.map(e => (
              <button key={e.id} onClick={() => setEngine(e.id)}
                title={e.hint}
                className={`flex-1 text-left text-[11px] px-2.5 py-1.5 rounded border transition-colors ${
                  engine === e.id
                    ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10')
                    : c.btn}`}>
                {e.label}
                <span className={`block text-[9px] ${c.muted}`}>{e.hint}</span>
              </button>
            ))}
          </div>
          <p className={`text-[10px] mt-1.5 ${c.muted}`}>
            Prozess-ID: <span className="font-mono">{processId || '…'}</span>
            {' · '}Vorlage <span className="font-mono">templates/{ENGINES.find(e => e.id === engine)?.file}</span>
          </p>
        </div>
      )}

      {!specs.length ? (
        <div className={`text-xs ${c.muted} py-10 text-center`}>
          Noch keine Spezifikation. {canEdit ? '«Aus BPMN» liest die Struktur direkt aus der Implementation.' : ''}
        </div>
      ) : (
        <div className="space-y-1.5">
          {specs.map(({ slug, data }) => {
            const counts = statusCounts(data);
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            return (
              <div key={slug} className={`rounded border ${c.border2} ${c.hover} flex items-center`}>
                <button onClick={() => onOpen(slug)}
                  className="min-w-0 flex-1 text-left px-3 py-2.5 flex items-center gap-3">
                  <FileCode2 size={14} className={c.muted} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-xs truncate ${c.text}`}>{data.title || slug}</div>
                    <div className={`text-[10px] font-mono truncate ${c.muted}`}>
                      {data.processId || data.name}{data.project ? ` · ${data.project}` : ''}
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-1">
                    {STATUSES.filter(s => counts[s] > 0).map(s => (
                      <span key={s} title={`${counts[s]} × ${STATUS_META[s].label}`}
                        className={`text-[9px] px-1 py-0.5 rounded border ${isDark ? STATUS_META[s].dark : STATUS_META[s].light}`}>
                        {counts[s]}
                      </span>
                    ))}
                  </div>
                  <span className={`text-[10px] ${c.muted} w-20 text-right`}>{total} Schritte</span>
                  <StatusChip status={data.status as Status} isDark={isDark} />
                </button>
                {/* Löschen — nur Admin (oder ohne Anmeldepflicht) */}
                {canDelete && (
                  <button onClick={() => { setError(''); setToDelete({ slug, title: data.title || slug }); }}
                    title="Spezifikation löschen (Admin)"
                    className={`mr-2 p-1.5 rounded border flex-shrink-0 transition-colors ${
                      isDark ? 'border-white/15 text-white/50 hover:border-rose-400/60 hover:text-rose-300 hover:bg-rose-500/10'
                             : 'border-black/15 text-black/50 hover:border-rose-400 hover:text-rose-700 hover:bg-rose-50'}`}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
