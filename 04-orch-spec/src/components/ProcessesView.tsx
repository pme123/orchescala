// Übersicht aller Spezifikationen im geteilten Ordner.
//
// Zwei Wege zu einer neuen Spezifikation:
//
//  · **Aus BPMN** — die Struktur kommt aus der Implementation, die Prosa
//    schreibt man danach. Über die Prozess-ID findet die App die Domain
//    (Katalog, gemerkte Projekt-Ordner, sonst Rückfrage) und ergänzt
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
//
// **Epics** (Admin → Epics) filtern die Liste: ein Klick zeigt nur die
// Prozesse dieses Epics. Der Filter bleibt im Browser gemerkt — wer an einem
// Change arbeitet, kommt aus dem Prozess in dieselbe Auswahl zurück.
import { overallStatus } from '../status';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpDown, FileCode2, Flag, FilePlus2, FolderOpen, Loader2, MessageSquare, Search, Trash2, Upload, X } from 'lucide-react';
import { collectFindings, withServiceRows } from '../findings';
import { enrichSpec, findDomain, prepareInteractions, readProjectDir, readProjectZip, scanDomain, type Enriched } from '../projectImport';
import { useStore } from '../store';
import { usePermissions } from '../auth';
import { allSteps, importBpmn, patternSummary, statusCounts, withStatus } from '../bpmn';
import { alignPoolIds } from '../poolIds';
import { DEFAULT_ENGINE, ENGINES, applyTemplate, loadTemplate } from '../template';
import { STATUS_META, STATUSES, type EngineId, type ProcessSpec, type Status } from '../types';
import { EpicChip, PatternSummary, StatusChip, cls, epicTone } from '../ui';
import { epicsOf } from '../epics';
import { knownPrefixes, splitPrefix } from '../stepIds';
import { slugify } from '../util';

/** Balkenfarbe je Status — kräftig, weil der Balken keine Schrift trägt. */
const BAR: Record<Status, string> = {
  draft: 'bg-neutral-400/60', review: 'bg-amber-400', final: 'bg-blue-400',
  implemented: 'bg-emerald-400', accepted: 'bg-emerald-600', changed: 'bg-rose-400',
};

const EPIC_FILTER_KEY = 'orch-spec.epicFilter';

/** «heute», «gestern», «vor 3 Tagen» … aus dem ISO-Zeitpunkt. */
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
  const { isDark, specs, specsLoading, createSpec, saveBpmn, deleteSpec, model } = useStore();
  const { canEdit, canDelete } = usePermissions();
  const c = cls(isDark);
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  // Import aus BPMN: gelesen, Domain gesucht — vor dem Anlegen sieht man, was entsteht
  const [pending, setPending] = useState<{
    spec: ProcessSpec; xml: string; stepCount: number;
    enriched: Enriched | null; source: string | null;
    /** ohne Domain: die vorbereiteten Interaktionen (Entwurf mit In/Out) */
    bare: { spec: ProcessSpec; prepared: string[] };
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Status des neuen Prozesses — aus der Implementation gelesen ist «Umgesetzt» die Vorgabe */
  const [createStatus, setCreateStatus] = useState<Status>('implemented');
  /** Spezifikation, deren Löschen gerade bestätigt werden soll */
  const [toDelete, setToDelete] = useState<{ slug: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Liste: Suche, Status-Filter, Sortierung
  const [listQuery, setListQuery] = useState('');
  const [listStatus, setListStatus] = useState<Status | null>(null);
  const [sortBy, setSortBy] = useState<'title' | 'updated'>('title');
  const [listEpic, setListEpic] = useState<string | null>(() => {
    try { return localStorage.getItem(EPIC_FILTER_KEY); } catch { return null; }
  });
  useEffect(() => {
    try {
      if (listEpic) localStorage.setItem(EPIC_FILTER_KEY, listEpic);
      else localStorage.removeItem(EPIC_FILTER_KEY);
    } catch { /* ohne Speicher gilt der Filter nur bis zum Verlassen */ }
  }, [listEpic]);
  // Epics im Filter: alle offenen, dazu abgeschlossene, solange ein Prozess sie trägt
  const epicFilter = useMemo(() => (model?.epics ?? [])
    .map(e => ({ ...e, n: specs.filter(s => s.data.epics?.includes(e.id)).length }))
    .filter(e => !e.closed || e.n > 0), [model, specs]);
  // ein gemerktes Epic, das es nicht mehr gibt, filtert nicht ins Leere
  const activeEpic = listEpic && epicFilter.some(e => e.id === listEpic) ? listEpic : null;
  // Je Prozess: Status-Zähler und Befunde — einmal je Stand der Liste
  const summaries = useMemo(() => new Map(specs.map(({ slug, data }) => {
    const counts = statusCounts(data);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    let findings = 0, errors = 0;
    try {
      const f = collectFindings(data, model, allSteps(data.steps));
      findings = f.size;
      errors = [...f.values()].filter(x => x.errors.length).length;
    } catch { /* eine defekte Spezifikation darf die Liste nicht blockieren */ }
    const comments = (data.comments ?? []).filter(t => !t.resolved).length;
    return [slug, { counts, total, findings, errors, comments }];
  })), [specs, model]);
  const visible = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    const list = specs.filter(({ slug, data }) =>
      (!q || `${data.title} ${data.processId ?? ''} ${data.project ?? ''} ${slug} ${epicsOf(data, model).map(e => e.name).join(' ')}`.toLowerCase().includes(q))
      && (!listStatus || overallStatus(data) === listStatus)
      && (!activeEpic || !!data.epics?.includes(activeEpic)));
    return sortBy === 'updated'
      ? [...list].sort((a, b) => (b.data.updatedAt ?? '').localeCompare(a.data.updatedAt ?? ''))
      : list;
  }, [specs, listQuery, listStatus, activeEpic, sortBy, model]);
  // Gruppen je Projekt, in der Reihenfolge ihres ersten Prozesses
  const groups = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const item of visible) {
      const key = item.data.project || 'ohne Projekt';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [visible]);
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
      // Prozess-ID nach dem Pool (bzw. dem Prozessnamen), bevor die Domain
      // über sie gesucht wird und sie den Dateinamen bestimmt — siehe poolIds.ts
      const text = alignPoolIds(await file.text()).xml;
      const { spec, stepCount, unreachable } = importBpmn(text, file.name, { patterns: model?.patterns });
      if (unreachable.length) console.warn('[orch-spec] nicht erreichbare BPMN-Elemente:', unreachable);
      // Über die Prozess-ID die Domain suchen: Katalog, dann gemerkte Ordner
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
  /** Domain aus einem gewählten Ordner oder ZIP nachreichen. */
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
  /** Anlegen — mit Domain, wenn eine da ist, sonst nur die Struktur. */
  const createPending = async () => {
    if (!pending) return;
    // alle Felder der Services als Zeilen — Pflicht-Eingaben und gebrauchte Ausgaben angehakt
    const spec = withServiceRows(withStatus(pending.enriched?.spec ?? pending.bare.spec, createStatus), model).spec;
    const res = await createSpec(spec);
    if (!res.ok) { setError(res.message); return; }
    // Das BPMN bleibt neben der Spezifikation liegen — damit lässt es sich
    // in der Prozessansicht direkt bearbeiten.
    const w = await saveBpmn(spec.slug, pending.xml);
    if (!w.ok) setError(w.message);
    console.info(`[orch-spec] ${pending.stepCount} Schritte importiert`);
    setPending(null);
    onOpen(spec.slug);
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
      const { spec } = importBpmn(xml, `${slugify(processId)}.bpmn`, { patterns: model?.patterns });
      // Der Ablauf kommt aus der Vorlage, ist aber noch nicht umgesetzt —
      // und zwar auf allen Ebenen: Unterschritte, Zweige und Fehlerpfade.
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
            <PatternSummary items={patternSummary(pending.spec)} isDark={isDark} hasDefs={!!model?.patterns?.length}
              nameOf={id => model?.patterns?.find(d => d.id === id)?.name ?? id} />
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

      {/* Kopf der Liste: Suche, Status-Filter, Sortierung */}
      {specs.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className={`flex items-center gap-1 px-2 py-1 rounded border ${c.border2} min-w-[16rem]`}>
            <Search size={11} className={c.muted} />
            <input value={listQuery} onChange={e => setListQuery(e.target.value)} placeholder="Titel, Prozess-ID, Projekt …"
              className={`flex-1 min-w-0 bg-transparent outline-none text-[11px] ${c.text}`} />
            {listQuery && <button onClick={() => setListQuery('')} className={c.muted}><X size={10} /></button>}
          </div>
          {STATUSES.filter(st => specs.some(x => overallStatus(x.data) === st)).map(st => (
            <button key={st} onClick={() => setListStatus(listStatus === st ? null : st)}
              title={`Nur Prozesse mit Status «${STATUS_META[st].label}»`}
              className={`text-[9px] px-1.5 py-0.5 rounded border transition-opacity ${isDark ? STATUS_META[st].dark : STATUS_META[st].light} ${
                listStatus && listStatus !== st ? 'opacity-30' : ''}`}>
              {STATUS_META[st].label} {specs.filter(x => overallStatus(x.data) === st).length}
            </button>
          ))}
          {epicFilter.length > 0 && (
            <span className={`flex items-center gap-1 flex-wrap pl-2 border-l ${c.border2}`}>
              <Flag size={10} className={c.muted} />
              {epicFilter.map(e => (
                <button key={e.id} onClick={() => setListEpic(activeEpic === e.id ? null : e.id)}
                  title={`Nur Prozesse im Epic «${e.name}»${e.description ? ` — ${e.description}` : ''}${e.closed ? ' (abgeschlossen)' : ''}`}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-opacity ${epicTone(isDark)} ${
                    e.closed ? 'border-dashed' : ''} ${activeEpic && activeEpic !== e.id ? 'opacity-30' : ''} ${
                    activeEpic === e.id ? 'ring-1 ring-current' : ''}`}>
                  {e.name} {e.n}
                </button>
              ))}
            </span>
          )}
          <button onClick={() => setSortBy(sortBy === 'title' ? 'updated' : 'title')}
            title="Sortierung wechseln"
            className={`ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${c.btn}`}>
            <ArrowUpDown size={10} /> {sortBy === 'title' ? 'nach Titel' : 'zuletzt geändert'}
          </button>
        </div>
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
          {(listStatus || activeEpic || listQuery) && (
            <button onClick={() => { setListStatus(null); setListEpic(null); setListQuery(''); }} className="ml-1.5 hover:underline">Filter aus</button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([project, items]) => (
            // Je Projekt eine Klammer wie im Ablauf: Kopf und Linie links — nur, wenn es mehr als eines gibt
            <div key={project} className={groups.length > 1 ? `pl-3 border-l-2 ${isDark ? 'border-slate-500/40' : 'border-slate-300'}` : ''}>
              {groups.length > 1 && (
                <div className="flex items-baseline gap-2 mb-1.5 px-1">
                  <span className={`text-sm font-mono font-bold ${c.muted2}`}>{project}</span>
                  <span className={`text-[10px] uppercase tracking-widest ${c.muted}`}>{items.length} Prozess{items.length === 1 ? '' : 'e'}</span>
                </div>
              )}
              <div className="space-y-1.5">
                {items.map(({ slug, data }) => {
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
                        {/* Fortschritt: ein Balken in Statusfarben, die Zahlen im Tooltip */}
                        <div className="hidden sm:flex flex-col items-end gap-1 w-40 flex-shrink-0">
                          <div className="flex w-full h-1.5 rounded overflow-hidden" title={STATUSES.filter(st => sum.counts[st] > 0).map(st => `${sum.counts[st]} × ${STATUS_META[st].label}`).join('\n')}>
                            {STATUSES.filter(st => sum.counts[st] > 0).map(st => (
                              <div key={st} className={BAR[st]} style={{ width: `${(100 * sum.counts[st]) / Math.max(sum.total, 1)}%` }} />
                            ))}
                          </div>
                          <span className={`text-[9px] whitespace-nowrap ${c.muted}`}>{sum.total} Schritte · {relativeTime(data.updatedAt)}</span>
                        </div>
                        <span title={engine === 'C8' ? 'Camunda 8 — FEEL' : 'Camunda 7 — JUEL beim Export'}
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                            engine === 'C8'
                              ? (isDark ? 'border-sky-500/40 text-sky-300' : 'border-sky-300 text-sky-800')
                              : (isDark ? 'border-white/15 text-white/50' : 'border-black/15 text-black/50')}`}>
                          {engine}
                        </span>
                        {/* offene Kommentare — Klärungsbedarf, ohne den Prozess zu öffnen */}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
