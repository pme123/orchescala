// Overview of all specifications in the shared folder.
//
// Two ways to a new specification:
//
//  · **From BPMN** — the structure comes from the implementation, the prose
//    is written afterwards. Via the process ID the app finds the domain
//    (catalog, remembered project folders, otherwise it asks) and adds
//    data model and interactions (see `projectImport.ts`).
//  · **New** — the process starts with the **template** (Admin → Vorlage für
//    neue Prozesse; without a custom one the built-in one applies). From it
//    diagram and flow tree are created in one go — with the new process ID, because
//    topics, domain mapping and file name depend on it.
//
// **Deleting** exists only here, not in the process view — there the app
// saves automatically, and an autosave after deleting would recreate the file
// right away. It is only allowed with the admin role or without
// mandatory login (`canDelete`); it asks first, because gone is gone:
// specification **and** BPMN.
//
// **Epics** (Admin → Epics) filter the list: a click shows only the
// processes of this epic. The filter stays remembered in the browser — whoever works on a
// change comes back from the process to the same selection.
import { overallStatus } from '../status';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileCode2, FilePlus2, FolderOpen, Loader2, MessageSquare, Trash2, Upload, X } from 'lucide-react';
import { ProjectGroups, SpecListHead, useSpecList, type ListEntry } from './SpecList';
import { collectFindings, withServiceRows } from '../findings';
import { enrichSpec, findDomain, prepareInteractions, readProjectDir, readProjectZip, scanDomain, type Enriched } from '../projectImport';
import { useStore, type SpecListItem } from '../store';
import { usePermissions } from '../auth';
import { allSteps, importBpmn, patternSummary, statusCounts, withStatus } from '../bpmn';
import { alignPoolIds } from '../poolIds';
import { ENGINES, applyTemplate, loadTemplate } from '../template';
import { C7_LABEL, C8_LABEL, DEFAULT_ENGINE } from '../engineLabels';
import { STATUS_META, STATUSES, type EngineId, type ProcessSpec, type Status } from '../types';
import { EpicChip, PatternSummary, StatusChip, cls } from '../ui';
import { epicsOf } from '../epics';
import { knownPrefixes, splitPrefix } from '../stepIds';
import { slugify } from '../util';
import { findProjectDmns, saveProjectDmns, withDmnFiles, type FoundDmn } from '../dmnProject';
import { patternDefs } from '../patterns';

/** Bar colour per status — strong, because the bar carries no text. */
const BAR: Record<Status, string> = {
  draft: 'bg-neutral-400/60', review: 'bg-amber-400', final: 'bg-blue-400',
  implemented: 'bg-emerald-400', accepted: 'bg-emerald-600', changed: 'bg-rose-400',
};

/** What the head of the list knows of a process. */
const processEntry = ({ slug, data }: SpecListItem): ListEntry => ({
  title: data.title, terms: [data.processId ?? '', slug], project: data.project, epics: data.epics, updatedAt: data.updatedAt,
});

/** «heute», «gestern», «vor 3 Tagen» … from the ISO timestamp. */
function relativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 14) return `vor ${days} Tagen`;
  if (days < 60) return `vor ${Math.floor(days / 7)} Wochen`;
  if (days < 730) return `vor ${Math.floor(days / 30)} Monaten`;
  return `vor ${Math.floor(days / 365)} Jahren`;
}

export default function ProcessesView({ onOpen }: { onOpen: (slug: string) => void }) {
  const { isDark, specs, specsLoading, createSpec, saveBpmn, saveDmn, deleteSpec, model } = useStore();
  const { canEdit, canDelete } = usePermissions();
  const c = cls(isDark);
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  // Import from BPMN: read, domain searched — before creating, you see what will be created
  const [pending, setPending] = useState<{
    spec: ProcessSpec; xml: string; stepCount: number;
    enriched: Enriched | null; source: string | null;
    /** without a domain: the prepared interactions (draft with In/Out) */
    bare: { spec: ProcessSpec; prepared: string[] };
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Status of the new process — read from the implementation, «Umgesetzt» is the default */
  const [createStatus, setCreateStatus] = useState<Status>('implemented');
  /** Specification whose deletion is about to be confirmed */
  const [toDelete, setToDelete] = useState<{ slug: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // List: search, epics, sorting and the groups per project (SpecList.tsx, shared with the pages);
  // the status is a filter of the processes only
  const [listStatus, setListStatus] = useState<Status | null>(null);
  const byStatus = useCallback((s: SpecListItem) => !listStatus || overallStatus(s.data) === listStatus, [listStatus]);
  const list = useSpecList(specs, processEntry, model, byStatus);
  // Per process: status counters and findings — once per state of the list
  const summaries = useMemo(() => new Map(specs.map(({ slug, data }) => {
    const counts = statusCounts(data);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    let findings = 0, errors = 0;
    try {
      const f = collectFindings(data, model, allSteps(data.steps));
      findings = f.size;
      errors = [...f.values()].filter(x => x.errors.length).length;
    } catch { /* a broken specification must not block the list */ }
    const comments = (data.comments ?? []).filter(t => !t.resolved).length;
    return [slug, { counts, total, findings, errors, comments }];
  })), [specs, model]);
  const { visible, groups } = list;
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [project, setProject] = useState('');
  const [version, setVersion] = useState('1');
  const [engine, setEngine] = useState<EngineId>(DEFAULT_ENGINE);
  // `company-project-processVversion` — that is how the processes are named in-house, and
  // the template carries exactly these parts at its placeholder positions.
  const processId = [company.trim(), project.trim(), name.trim() && `${name.trim()}V${version.trim() || '1'}`]
    .filter(Boolean).join('-');
  // Choice instead of guessing: all companies and projects that the catalog and
  // existing specifications know — free text stays possible for new ones.
  const prefixes = useMemo(() => knownPrefixes(model, specs.map(s => s.data.project)), [model, specs]);
  const companies = useMemo(() => [...new Set(prefixes.map(p => splitPrefix(p).company))], [prefixes]);
  const projectOptions = useMemo(() => {
    const firma = company.trim();
    const passend = firma ? prefixes.filter(p => p.startsWith(`${firma}-`)) : prefixes;
    return [...new Set(passend.map(p => (firma ? p.slice(firma.length + 1) : splitPrefix(p).project)))].filter(Boolean);
  }, [prefixes, company]);
  // Company and project are the same for all processes of a house — the
  // one created last is therefore the best suggestion.
  const letztes = useMemo(() => {
    const voriges = specs.map(s => s.data.project).filter(Boolean).slice(-1)[0] ?? '';
    const [firma, ...rest] = voriges.split('-');
    return { company: firma ?? '', project: rest.join('-') };
  }, [specs]);

  const fromBpmn = async (file: File) => {
    setError('');
    try {
      // Process ID after the pool (or the process name), before the domain
      // is searched via it and it determines the file name — see poolIds.ts
      const text = alignPoolIds(await file.text()).xml;
      const { spec, stepCount, unreachable } = importBpmn(text, file.name, { patterns: patternDefs(model) });
      if (unreachable.length) console.warn('[orch-spec] nicht erreichbare BPMN-Elemente:', unreachable);
      // Search the domain via the process ID: catalog, then remembered folders
      setBusy('Domain wird gesucht …');
      const hit = spec.processId ? await findDomain(spec.processId, model, setBusy) : null;
      setBusy(null);
      const enriched = hit ? enrichSpec(spec, hit.domain, model) : null;
      if (enriched && hit?.note) enriched.warnings.unshift(hit.note);
      setPending({ spec, xml: text, stepCount, enriched, source: hit?.source ?? null, bare: prepareInteractions(spec, model) });
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  /** Supply the domain later from a chosen folder or ZIP. */
  const domainFrom = async (read: () => Promise<Array<{ path: string; text: string }>>, source: string) => {
    if (!pending) return;
    try {
      setBusy(`${source} wird gelesen …`);
      const domain = scanDomain(await read());
      const enriched = enrichSpec(pending.spec, domain, model);
      if (!enriched) setError(`In ${source} gibt es kein Objekt mit \`val processName = "${pending.spec.processId}"\`.`);
      else { setError(''); setPending({ ...pending, enriched, source }); }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const pickDomainDir = async () => {
    if (!('showDirectoryPicker' in window)) { setError('Ordner wählen geht nur in Chrome oder Edge — als Alternative ein ZIP wählen.'); return; }
    const dir = await window.showDirectoryPicker({ mode: 'read' }).catch(() => null);
    if (dir) await domainFrom(() => readProjectDir(dir), `Ordner ${dir.name}`);
  };
  const pickDomainZip = (file: File) =>
    domainFrom(async () => readProjectZip(new Uint8Array(await file.arrayBuffer())), file.name);
  /** Create — with domain, if there is one, otherwise only the structure. */
  const createPending = async () => {
    if (!pending) return;
    // all fields of the services as rows — mandatory inputs and used outputs checked
    const rows = withServiceRows(withStatus(pending.enriched?.spec ?? pending.bare.spec, createStatus), model, { importing: true }).spec;
    try {
      // the tables of the matched decisions right from the project — editable at the step then.
      // Written only when there is no spec with this name, and create-only: a table already
      // stored under this name is never overwritten, it is linked as it is. Referenced only
      // when it is there — nothing points to a table that was not written. Accepted: if createSpec
      // fails after all, the table stays behind unreferenced and a later spec of that name links it
      const problems: string[] = [];
      let saved: FoundDmn[] = [];
      if (!specs.some(s => s.slug === rows.slug)) {
        setBusy('DMN-Tabellen werden gesucht …');
        const r = await findProjectDmns(rows, model, setBusy);
        const w = await saveProjectDmns(rows.slug, r.found, saveDmn, { createOnly: true });
        saved = [...w.saved, ...w.kept];
        problems.push(...r.failed.map(f => `DMN-Tabelle nicht gelesen: ${f}`), ...w.failed.map(f => `DMN-Tabelle nicht gespeichert: ${f}`));
      }
      const spec = withDmnFiles(rows, saved);
      // busy until the end (the finally clears it) — the button stays disabled, no second run
      setBusy('Wird angelegt …');
      const res = await createSpec(spec);
      if (!res.ok) { setError(res.message); return; }
      // The BPMN stays next to the specification — so it can be
      // edited directly in the process view.
      const w = await saveBpmn(spec.slug, pending.xml);
      if (!w.ok) problems.push(w.message);
      console.info(`[orch-spec] ${pending.stepCount} Schritte importiert`);
      setPending(null);
      // something went wrong: stay in the list so the message is seen — the spec is there
      if (problems.length) { setError(`«${spec.title || spec.slug}» angelegt — ${problems.join('; ')}`); return; }
      onOpen(spec.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Both come from the template: the diagram and the tree from it. So
  // a new process starts where everyone in-house starts.
  const createFromTemplate = async () => {
    if (!name.trim()) { setError('Bitte einen Prozessnamen angeben.'); return; }
    if (specs.some(s => s.data.processId === processId || s.slug === slugify(processId))) {
      setError(`«${processId}» gibt es schon.`);
      return;
    }
    setError('');
    try {
      const xml = applyTemplate(await loadTemplate(engine), { processId, title: title || processId });
      const { spec } = importBpmn(xml, `${slugify(processId)}.bpmn`, { patterns: patternDefs(model) });
      // The flow comes from the template, but is not implemented yet —
      // on all levels: sub-steps, branches and error paths.
      const neu = { ...withStatus(spec, 'draft'), title: title || processId, engine };
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

      {pending && (
        <div className={`mb-4 p-3 rounded border ${c.border2} ${c.panel}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[11px] ${c.muted2}`}>Aus BPMN</span>
            <span className={`text-xs ${c.text}`}>{pending.spec.title || pending.spec.processId}</span>
            <span className={`text-[10px] font-mono ${c.muted}`}>{pending.spec.processId}</span>
            <button onClick={() => setPending(null)} className={`ml-auto ${c.muted}`}><X size={12} /></button>
          </div>
          <div className="mb-1.5">
            <PatternSummary items={patternSummary(pending.spec)} isDark={isDark} hasDefs={!!patternDefs(model).length}
              nameOf={id => patternDefs(model).find(d => d.id === id)?.name ?? id} />
          </div>
          {pending.enriched ? (
            <div className="space-y-1">
              <p className={`text-[10px] ${c.muted2}`}>
                {pending.stepCount} Schritte · Domain <span className="font-mono">{pending.enriched.object}</span> aus {pending.source}
                {' · '}{pending.enriched.spec.types?.length ?? 0} Typen · {pending.enriched.spec.interactions?.length ?? 0} Interaktionen
                {pending.enriched.matched.length ? ` (${pending.enriched.matched.join(', ')})` : ''}
              </p>
              {pending.enriched.notes.map((n, i) => <p key={i} className={`text-[10px] ${c.muted}`}>{n}</p>)}
              {(pending.enriched.warnings.length > 0 || pending.enriched.unmatched.length > 0 || pending.enriched.unresolved.length > 0 || pending.enriched.prepared.length > 0) && (
                <div className={`text-[10px] space-y-0.5 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                  {pending.enriched.warnings.map((w, i) => <div key={i} className="flex items-start gap-1"><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{w}</span></div>)}
                  {!!pending.enriched.prepared.length && (
                    <div className="flex items-start gap-1"><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
                      <span>Ohne Domain-Objekt — als Entwurf mit In/Out vorbereitet: {pending.enriched.prepared.join(', ')}</span></div>
                  )}
                  {!!pending.enriched.unmatched.length && <div>Ohne Schritt im Ablauf: {pending.enriched.unmatched.join(', ')}</div>}
                  {!!pending.enriched.unresolved.length && <div>Typen weder im Projekt noch im Katalog: {pending.enriched.unresolved.join(', ')}</div>}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className={`text-[10px] ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                <AlertTriangle size={10} className="inline mr-1 -mt-0.5" />
                {pending.stepCount} Schritte — kein Domain-Objekt mit <span className="font-mono">val processName = "{pending.spec.processId}"</span>
                {' '}im Katalog oder in den gemerkten Projekt-Ordnern (Admin → Katalog). Projekt-Ordner oder ZIP wählen — oder ohne Domain anlegen.
              </p>
              {!!pending.bare.prepared.length && (
                <p className={`text-[10px] ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                  <AlertTriangle size={10} className="inline mr-1 -mt-0.5" />
                  Ohne Domain werden als Entwurf mit In/Out vorbereitet: {pending.bare.prepared.join(', ')}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button onClick={pickDomainDir} disabled={!!busy}
                  className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
                  <FolderOpen size={12} /> Projekt-Ordner wählen
                </button>
                <input ref={zipRef} type="file" accept=".zip" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void pickDomainZip(f); e.target.value = ''; }} />
                <button onClick={() => zipRef.current?.click()} disabled={!!busy}
                  className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
                  <Upload size={12} /> ZIP wählen
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            <label className={`flex items-center gap-1.5 text-[10px] ${c.muted2}`}
              title="Gilt für Prozess, Schritte und das Datenmodell aus der Domain — Vorbereitetes ohne Domain-Objekt bleibt Entwurf">
              Status
              <select value={createStatus} onChange={e => setCreateStatus(e.target.value as Status)}
                className={`text-[11px] px-1.5 py-1 rounded border outline-none ${c.input}`}>
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </label>
            <button onClick={createPending} disabled={!!busy}
              className={`text-[11px] px-3 py-1.5 rounded font-semibold disabled:opacity-40 ${c.btnPrimary}`}>
              {pending.enriched ? 'Anlegen' : 'Ohne Domain anlegen'}
            </button>
            {busy && <span className={`text-[10px] ${c.muted}`}>{busy}</span>}
          </div>
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
            {/* Company and project with the known values from catalog and
                specifications as a choice — typing new ones stays possible */}
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
          {/* The provided templates — one per engine. */}
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

      {/* Head of the list: search, status filter, epics, sorting */}
      {specs.length > 0 && (
        <SpecListHead isDark={isDark} list={list} placeholder="Titel, Prozess-ID, Projekt …" noun="Prozesse">
          {STATUSES.filter(st => specs.some(x => overallStatus(x.data) === st)).map(st => (
            <button key={st} onClick={() => setListStatus(listStatus === st ? null : st)}
              title={`Nur Prozesse mit Status «${STATUS_META[st].label}»`}
              className={`text-[9px] px-1.5 py-0.5 rounded border transition-opacity ${isDark ? STATUS_META[st].dark : STATUS_META[st].light} ${
                listStatus && listStatus !== st ? 'opacity-30' : ''}`}>
              {STATUS_META[st].label} {specs.filter(x => overallStatus(x.data) === st).length}
            </button>
          ))}
        </SpecListHead>
      )}

      {!specs.length && specsLoading ? (
        <div className={`text-xs ${c.muted} py-10 flex items-center justify-center gap-2`}>
          <Loader2 size={14} className="animate-spin" /> Spezifikationen werden geladen …
        </div>
      ) : !specs.length ? (
        <div className={`text-xs ${c.muted} py-10 text-center`}>
          Noch keine Spezifikation. {canEdit ? '«Aus BPMN» liest die Struktur direkt aus der Implementation.' : ''}
        </div>
      ) : !visible.length ? (
        <div className={`text-xs ${c.muted} py-10 text-center`}>
          Kein Prozess passt zu Suche und Filter.
          {(listStatus || list.filtered) && (
            <button onClick={() => { setListStatus(null); list.reset(); }} className="ml-1.5 hover:underline">Filter aus</button>
          )}
        </div>
      ) : (
        <ProjectGroups isDark={isDark} groups={groups} noun={['Prozess', 'Prozesse']} render={({ slug, data }) => {
                  const sum = summaries.get(slug)!;
                  const engine = data.engine === 'c8' ? 'C8' : 'C7';
                  return (
                    <div key={slug} className={`rounded border ${c.border2} ${c.hover} flex items-center`}>
                      <button onClick={() => onOpen(slug)}
                        className="min-w-0 flex-1 text-left px-3 py-2.5 flex items-center gap-3">
                        <FileCode2 size={14} className={c.muted} />
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-semibold truncate ${c.text}`}>{data.title || slug}</div>
                          <div className={`text-[10px] font-mono truncate ${c.muted}`}>{data.processId || data.name}</div>
                          {!!data.epics?.length && (
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              {epicsOf(data, model).map(e => <EpicChip key={e.id} name={e.name} closed={e.closed} isDark={isDark} />)}
                            </div>
                          )}
                        </div>
                        {/* Progress: a bar in status colours, the numbers in the tooltip */}
                        <div className="hidden sm:flex flex-col items-end gap-1 w-40 flex-shrink-0">
                          <div className="flex w-full h-1.5 rounded overflow-hidden" title={STATUSES.filter(st => sum.counts[st] > 0).map(st => `${sum.counts[st]} × ${STATUS_META[st].label}`).join('\n')}>
                            {STATUSES.filter(st => sum.counts[st] > 0).map(st => (
                              <div key={st} className={BAR[st]} style={{ width: `${(100 * sum.counts[st]) / Math.max(sum.total, 1)}%` }} />
                            ))}
                          </div>
                          <span className={`text-[9px] whitespace-nowrap ${c.muted}`}>{sum.total} Schritte · {relativeTime(data.updatedAt)}</span>
                        </div>
                        <span title={engine === 'C8' ? `${C8_LABEL} — FEEL` : `${C7_LABEL} — JUEL beim Export`}
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                            engine === 'C8'
                              ? (isDark ? 'border-sky-500/40 text-sky-300' : 'border-sky-300 text-sky-800')
                              : (isDark ? 'border-white/15 text-white/50' : 'border-black/15 text-black/50')}`}>
                          {engine}
                        </span>
                        {/* open comments — need for clarification, without opening the process */}
                        {sum.comments > 0 ? (
                          <span title={`${sum.comments} offene${sum.comments === 1 ? 'r Kommentar' : ' Kommentare'}`}
                            className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${
                              isDark ? 'border-blue-500/30 text-blue-300' : 'border-blue-300 text-blue-700'}`}>
                            <MessageSquare size={9} />{sum.comments}
                          </span>
                        ) : (
                          <span className="w-7" />
                        )}
                        {sum.findings > 0 ? (
                          <span title={`${sum.findings} Schritt${sum.findings === 1 ? '' : 'e'} mit Befund${sum.errors ? `, ${sum.errors} mit Fehlern` : ''}`}
                            className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border ${
                              sum.errors
                                ? (isDark ? 'border-rose-500/30 bg-rose-500/15 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700')
                                : (isDark ? 'border-amber-500/30 bg-amber-500/15 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700')}`}>
                            <AlertTriangle size={9} />{sum.findings}
                          </span>
                        ) : (
                          <span className="w-8" />
                        )}
                        <StatusChip status={overallStatus(data)} isDark={isDark} title="Der kleinste Status der Schritte und Klassen" />
                      </button>
                      {/* Delete — admin only (or without mandatory login) */}
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
        }} />
      )}
    </div>
  );
}
