// Die Prozess-Ansicht: links der Ablauf als einklappbarer Baum, rechts die
// Details des gewählten Schritts.
//
// Der Baum ist der Kern des PoC — Verzweigungen als farbige, beschriftete
// Zweige, Schleifen und Fehlerpfade sichtbar, Details standardmässig
// eingeklappt. Änderungen werden automatisch gespeichert (wie im arch-review).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronLeft, Download, RefreshCw, Search, X, Minimize2, Maximize2,
  AlertTriangle, GitFork, Repeat, CornerDownRight, Save, Braces, ListTree, Workflow, GripHorizontal, GripVertical,
  MessageSquare,
} from 'lucide-react';
import { useStore } from '../store';
import { useAuthorName, usePermissions } from '../auth';
import { openCount, openThreads, pruneComments, stepTarget, threadTarget } from '../comments';
import { allSteps, importBpmn, mergeSpec, statusCounts, type MergeReport } from '../bpmn';
import { conventionalId, derivable, knownPrefixes, renameIdInXml, renamePrefix, renamePrefixInXml, renameStepId } from '../stepIds';
import { engineLabel } from '../template';
import { STATUSES, STATUS_META, type Branch, type ProcessSpec, type Status, type Step } from '../types';
import { BlockChip, BRANCH_COLORS, ErrorChip, KIND_LABEL, LoopChip, STEP_ICON, StatusChip, cls } from '../ui';
import { nowIsoWithTimezone } from '../util';
import ExportDialog from './ExportDialog';
import StepDetail from './StepDetail';
import TypeBuilder from './TypeBuilder';
import type { BpmnHandle } from './BpmnEditor';

// Der Modeler ist gross — er kommt erst, wenn das Diagramm gezeigt wird.
const BpmnEditor = lazy(() => import('./BpmnEditor'));

const HEIGHT_KEY = 'orch-spec.diagramHeight';
const PANEL_W_KEY = 'orch-spec.panelWidth';

interface Props { slug: string; onBack: () => void }

// Alle Schritt-IDs, die Kinder haben (für «alles ein-/ausklappen»)
function containerIds(steps: Step[], out: string[] = []): string[] {
  for (const s of steps) {
    if (s.branches?.length || s.children?.length || s.errors?.some(e => e.steps?.length)) out.push(s.id);
    for (const b of s.branches ?? []) containerIds(b.steps, out);
    for (const e of s.errors ?? []) containerIds(e.steps ?? [], out);
    containerIds(s.children ?? [], out);
  }
  return out;
}

/**
 * Zu jedem Schritt seine Vorfahren — nur so lässt sich ein Schritt zeigen,
 * der in einem eingeklappten Zweig steckt.
 */
function ancestorsOf(steps: Step[], oben: string[] = [], out = new Map<string, string[]>()): Map<string, string[]> {
  for (const s of steps) {
    out.set(s.id, oben);
    const tiefer = [...oben, s.id];
    for (const b of s.branches ?? []) ancestorsOf(b.steps, tiefer, out);
    for (const e of s.errors ?? []) ancestorsOf(e.steps ?? [], tiefer, out);
    ancestorsOf(s.children ?? [], tiefer, out);
  }
  return out;
}

// Was der Fachbereich hier festlegt, gehört auch ins BPMN — sonst überschreibt
// es der nächste Abgleich mit der Datei wieder.
const applyToBpmn = (id: string, patch: Partial<Step>, before: Step | undefined, bpmn: BpmnHandle | null) => {
  if (!bpmn) return;
  if ('candidateGroups' in patch || 'assignee' in patch) {
    bpmn.setProps(id, {
      ...('candidateGroups' in patch ? { 'camunda:candidateGroups': patch.candidateGroups || undefined } : {}),
      ...('assignee' in patch ? { 'camunda:assignee': patch.assignee || undefined } : {}),
    });
  }
  if (patch.branches) {
    const alt = new Map((before?.branches ?? []).map(b => [b.id, b]));
    for (const b of patch.branches) {
      const old = alt.get(b.id);
      if (old?.label !== b.label) bpmn.setProps(b.id, { name: b.label });
      if (old?.condition !== b.condition) bpmn.setCondition(b.id, b.condition);
    }
  }
  if (patch.errors) {
    // `_handledErrors` führt, was **nicht** allein am Boundary-Event hängt:
    // die schon deklarierten und die hier neu erfassten.
    bpmn.setHandledErrors(id, patch.errors.filter(e => e.code && (e.declared || !e.boundary)).map(e => e.code));
  }
};

export default function ProcessView({ slug, onBack }: Props) {
  const { isDark, model, specs, loadSpec, saveSpec, loadBpmn, saveBpmn } = useStore();
  const { canEdit } = usePermissions();
  const author = useAuthorName();
  const c = cls(isDark);

  const [spec, setSpec] = useState<ProcessSpec | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [saveState, setSaveState] = useState<{ at: string } | { error: string } | null>(null);
  const [report, setReport] = useState<MergeReport | null>(null);
  const [tab, setTab] = useState<'flow' | 'model'>('flow');
  /** Sprung aus dem Ablauf ins Datenmodell — dort wird dieser Typ gezeigt */
  const [focusType, setFocusType] = useState<string | null>(null);
  /** wo man beim Durchgehen der offenen Kommentare steht */
  const [kommentarIdx, setKommentarIdx] = useState(0);
  const [xml, setXml] = useState<string | null>(null);
  const xmlRef = useRef<string | null>(null);
  xmlRef.current = xml;
  const [showDiagram, setShowDiagram] = useState(false);
  const [height, setHeight] = useState(() => Number(localStorage.getItem(HEIGHT_KEY)) || 340);
  const bpmnRef = useRef<BpmnHandle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Eigenschaften-Panel: Breite an der Trennlinie ziehbar (wie die Höhe
  // zwischen Diagramm und Ablauf) — die Einstellung bleibt über die Sitzung.
  const [panelW, setPanelW] = useState(() => {
    const n = Number(localStorage.getItem(PANEL_W_KEY));
    return Number.isFinite(n) && n >= 320 ? Math.min(n, 800) : 416;
  });

  useEffect(() => {
    let alive = true;
    loadSpec(slug).then(r => {
      if (!alive || !r) return;
      setSpec(r.data);
      setVersion(r.version);
      // Subprozesse und Fehlerpfade zu Beginn zugeklappt: erst der Überblick
      const start = new Set<string>();
      for (const s of allSteps(r.data.steps)) if (s.kind === 'subprocess') start.add(s.id);
      setCollapsed(start);
    });
    loadBpmn(slug).then(x => { if (alive) { setXml(x); setShowDiagram(!!x); } });
    return () => { alive = false; };
  }, [slug, loadSpec, loadBpmn]);

  // ── Autosave ──────────────────────────────────────────────────────────────
  const timer = useRef<number | null>(null);
  const pending = useRef<ProcessSpec | null>(null);
  const versionRef = useRef<string | null>(null);
  versionRef.current = version;

  const flush = useCallback(async () => {
    const data = pending.current;
    if (!data) return;
    pending.current = null;
    const res = await saveSpec(data, versionRef.current);
    if (res.status === 'saved') {
      setVersion(res.version);
      setSaveState({ at: new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) });
    } else if (res.status === 'conflict') {
      setSaveState({ error: 'Die Datei wurde inzwischen geändert — Seite neu laden.' });
    } else {
      setSaveState({ error: res.message });
    }
  }, [saveSpec]);

  const update = useCallback((next: ProcessSpec) => {
    const data = { ...next, updatedAt: nowIsoWithTimezone() };
    setSpec(data);
    pending.current = data;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flush(); }, 1000);
  }, [flush]);

  // beim Verlassen ausstehende Änderungen noch wegschreiben
  useEffect(() => () => { if (pending.current) void flush(); }, [flush]);

  // Einen Schritt im Baum ersetzen (unveränderlich)
  const patchStep = useCallback((id: string, patch: Partial<Step>) => {
    if (!spec) return;
    if (typeof patch.name === 'string') bpmnRef.current?.rename(id, patch.name);
    applyToBpmn(id, patch, byIdRef.current.get(id), bpmnRef.current);
    const walk = (steps: Step[]): Step[] => steps.map(s => {
      if (s.id === id) return { ...s, ...patch };
      const next: Step = { ...s };
      if (s.children) next.children = walk(s.children);
      if (s.branches) next.branches = s.branches.map(b => ({ ...b, steps: walk(b.steps) }));
      if (s.errors) next.errors = s.errors.map(e => (e.steps ? { ...e, steps: walk(e.steps) } : e));
      return next;
    });
    update({ ...spec, steps: walk(spec.steps) });
  }, [spec, update]);

  // Ein im Baum gewählter Schritt wird im Diagramm mitgewählt
  useEffect(() => { bpmnRef.current?.select(selected); }, [selected]);

  /**
   * ID nach Hauskonvention aus dem fachlichen Namen ableiten und überall
   * nachziehen — Diagramm, Baum, Interaktionen, Kommentare. Läuft beim
   * Verlassen des Namensfelds (nicht je Tastendruck) und nach Umbenennungen
   * im Diagramm.
   */
  const syncStepId = useCallback((id: string) => {
    const current = specRef.current;
    if (!current) return;
    const step = allSteps(current.steps).find(s => s.id === id);
    if (!step || !derivable(step)) return;
    const ids = new Set(allSteps(current.steps).map(s => s.id));
    const neu = conventionalId(step, x => x !== id && ids.has(x));
    if (!neu || neu === id) return;
    const res = bpmnRef.current?.setId(id, neu) ?? 'absent';
    if (res === 'conflict') return;
    if (res === 'absent' && xmlRef.current) {
      // Modeler nicht offen — das gespeicherte BPMN direkt nachziehen, sonst
      // fände der nächste Abgleich den Schritt nicht mehr
      const next = renameIdInXml(xmlRef.current, id, neu, step.name);
      if (!next) return;
      setXml(next);
      void saveBpmn(slug, next).then(w => { if (!w.ok) setSaveState({ error: w.message }); });
    }
    update(renameStepId(current, id, neu));
    setSelected(prev => (prev === id ? neu : prev));
    setCollapsed(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      next.add(neu);
      return next;
    });
  }, [update, saveBpmn, slug]);

  // ── Firma/Projekt wechseln ────────────────────────────────────────────────
  // Alle bekannten `company-projekt`-Prefixe für die Auswahl am Prozess
  const projectPrefixes = useMemo(
    () => knownPrefixes(model, specs.map(s => s.data.project)),
    [model, specs]);

  /**
   * Der neue Prefix ersetzt den alten in allen fachlichen IDs
   * (`{company}-{project}-*`) — in der Spezifikation und im BPMN. Der
   * Dateiname bleibt; Dateien benennt die App bewusst nicht um.
   */
  const renameProject = useCallback((newPrefix: string) => {
    const current = specRef.current;
    if (!current) return;
    const oldPrefix = current.project
      || /^(.*)-[A-Za-z][A-Za-z0-9]*V\d+$/.exec(current.processId ?? '')?.[1]
      || '';
    if (!oldPrefix || !newPrefix || oldPrefix === newPrefix) return;
    if (xmlRef.current) {
      const nx = renamePrefixInXml(xmlRef.current, oldPrefix, newPrefix);
      if (nx) {
        setXml(nx);   // der offene Modeler lädt das neue XML selbst nach
        void saveBpmn(slug, nx).then(w => { if (!w.ok) setSaveState({ error: w.message }); });
      }
    }
    update({ ...renamePrefix(current, oldPrefix, newPrefix), project: newPrefix });
  }, [update, saveBpmn, slug]);

  const byId = useMemo(() => new Map(allSteps(spec?.steps).map(s => [s.id, s])), [spec]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const counts = useMemo(() => (spec ? statusCounts(spec) : null), [spec]);
  const containers = useMemo(() => (spec ? containerIds(spec.steps) : []), [spec]);
  const ancestors = useMemo(() => (spec ? ancestorsOf(spec.steps) : new Map<string, string[]>()), [spec]);

  // ── Offene Kommentare durchgehen ─────────────────────────────────────────
  const offeneKommentare = useMemo(
    () => (spec
      ? openThreads(spec, allSteps(spec.steps).map(s => s.id), (spec.types ?? []).map(t => t.id))
      : []),
    [spec]);

  /** Der Faden, auf dem die Navigation steht — er wird hervorgehoben. */
  const aktuellerFaden = offeneKommentare.length
    ? offeneKommentare[kommentarIdx % offeneKommentare.length]?.id
    : undefined;

  const zeigeFaden = useCallback((i: number) => {
    const faden = offeneKommentare[i];
    if (!faden) return;
    setKommentarIdx(i);
    const ziel = threadTarget(faden);
    const zumFaden = () => {
      for (const nach of [0, 60, 200, 400]) {
        window.setTimeout(() => {
          document.querySelector(`[data-thread="${CSS.escape(faden.id)}"]`)
            ?.scrollIntoView({ block: 'center' });
        }, nach);
      }
    };
    if (ziel.kind === 'type') { setFocusType(ziel.id); setTab('model'); zumFaden(); return; }
    setTab('flow');
    if (ziel.kind === 'process') { setSelected(null); zumFaden(); return; }
    // Der Schritt kann in einem eingeklappten Zweig stecken
    const oben = ancestors.get(ziel.id) ?? [];
    if (oben.length) setCollapsed(prev => {
      const next = new Set(prev);
      for (const id of oben) next.delete(id);
      return next;
    });
    setSelected(ziel.id);
    for (const nach of [0, 60, 200, 400]) {
      window.setTimeout(() => {
        document.querySelector(`[data-step="${CSS.escape(ziel.id)}"]`)
          ?.scrollIntoView({ block: 'center' });
        // die rechte Spalte scrollt für sich — dort steht der Faden vielleicht
        // weit unten, und hervorgehoben nützt er nur, wenn man ihn sieht
        document.querySelector(`[data-thread="${CSS.escape(faden.id)}"]`)
          ?.scrollIntoView({ block: 'center' });
      }, nach);
    }
  }, [offeneKommentare, ancestors]);

  // Suche/Filter: passt ein Schritt oder einer seiner Nachfahren?
  const matches = useCallback((s: Step): boolean => {
    const q = query.trim().toLowerCase();
    const hit = (!q || `${s.name} ${s.description ?? ''} ${s.serviceId ?? ''} ${s.topic ?? ''}`.toLowerCase().includes(q))
      && (!statusFilter || s.status === statusFilter);
    if (hit) return true;
    const sub = [...(s.children ?? []), ...(s.branches ?? []).flatMap(b => b.steps), ...(s.errors ?? []).flatMap(e => e.steps ?? [])];
    return sub.some(matches);
  }, [query, statusFilter]);

  const active = query.trim() !== '' || statusFilter !== null;

  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── BPMN abgleichen ───────────────────────────────────────────────────────
  // Ein Weg für beides: die gewählte Datei und die Änderung im Modeler.
  const specRef = useRef<ProcessSpec | null>(null);
  specRef.current = spec;

  const applyXml = useCallback(async (text: string, from: string, quiet = false) => {
    const current = specRef.current;
    if (!current) return;
    try {
      const { spec: fresh } = importBpmn(text, from);
      const { spec: merged0, report: r } = mergeSpec(fresh, current);
      // Im Diagramm umbenannte Schritte: die ID folgt dem Namen (Konvention).
      // Das Umbenennen im Modeler löst den nächsten Speicherlauf aus, der das
      // BPMN mit den neuen IDs ablegt.
      let merged = merged0;
      const vorher = new Map(allSteps(current.steps).map(s => [s.id, s.name]));
      for (const s of allSteps(merged0.steps)) {
        const alt = vorher.get(s.id);
        if (alt === undefined || alt === s.name || !derivable(s)) continue;
        const ids = new Set(allSteps(merged.steps).map(x => x.id));
        const neu = conventionalId(s, x => x !== s.id && ids.has(x));
        if (!neu || neu === s.id) continue;
        if (bpmnRef.current?.setId(s.id, neu) !== 'renamed') continue;
        merged = renameStepId(merged, s.id, neu);
        setSelected(prev => (prev === s.id ? neu : prev));
      }
      update({
        ...merged,
        comments: pruneComments(merged, new Set(allSteps(merged.steps).map(x => x.id)),
          new Set((merged.types ?? []).map(t => t.id))),
      });
      setXml(text);
      if (!quiet) setReport(r);
      else if (r.added.length || r.removed.length || r.changed.length) setReport(r);
      const w = await saveBpmn(slug, text);
      if (!w.ok) setSaveState({ error: w.message });
    } catch (e) {
      setSaveState({ error: e instanceof Error ? e.message : String(e) });
    }
  }, [update, saveBpmn, slug]);

  const onFile = async (file: File) => {
    const text = await file.text();
    await applyXml(text, file.name);
    setShowDiagram(true);
  };

  if (!spec) return <div className={`h-full flex items-center justify-center text-xs ${c.muted}`}>Lade Spezifikation …</div>;

  const selectedStep = selected ? byId.get(selected) ?? null : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Werkzeugleiste: Navigation, Ansicht, Werkzeuge, Status ─────────── */}
      <div className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b ${c.border} ${c.top}`}>
        <button onClick={onBack} className={`flex items-center gap-1 text-[11px] flex-shrink-0 ${c.muted} hover:underline`}>
          <ChevronLeft size={12} /> Prozesse
        </button>
        <Divider isDark={isDark} />

        {/* Ansicht */}
        {([['flow', 'Ablauf', ListTree], ['model', 'Datenmodell', Braces]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border transition-colors flex-shrink-0 ${
              tab === id
                ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10')
                : c.btn}`}>
            <Icon size={12} /> {label}
            {id === 'model' && !!spec.types?.length && <span className="opacity-60">{spec.types.length}</span>}
          </button>
        ))}

        {tab === 'flow' && (
          <>
            <Divider isDark={isDark} />
            {xml && (
              <button onClick={() => setShowDiagram(!showDiagram)}
                title={showDiagram ? 'Diagramm ausblenden' : 'Diagramm zeigen'}
                className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border transition-colors flex-shrink-0 ${
                  showDiagram
                    ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10')
                    : c.btn}`}>
                <Workflow size={12} /> Diagramm
              </button>
            )}
            <button onClick={() => setCollapsed(new Set())} title="Alles ausklappen"
              className={`p-1.5 rounded border flex-shrink-0 ${c.btn}`}><Maximize2 size={12} /></button>
            <button onClick={() => setCollapsed(new Set(containers))} title="Alles einklappen"
              className={`p-1.5 rounded border flex-shrink-0 ${c.btn}`}><Minimize2 size={12} /></button>
            {canEdit && (
              <>
                <input ref={fileRef} type="file" accept=".bpmn,.xml" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
                <button onClick={() => fileRef.current?.click()}
                  title="BPMN wählen — Struktur aus der Implementation übernehmen, fachliche Texte bleiben"
                  className={`p-1.5 rounded border flex-shrink-0 ${c.btn}`}><RefreshCw size={12} /></button>
              </>
            )}
          </>
        )}

        {/* rechts: Speicherstand, Export, Status */}
        <div className="ml-auto flex items-center gap-2 min-w-0">
          {saveState && (
            'error' in saveState
              ? <span title={saveState.error}
                  className={`flex items-center gap-1 text-[10px] truncate max-w-[18rem] ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
                  <AlertTriangle size={11} className="flex-shrink-0" /> {saveState.error}
                </span>
              : <span title={`Automatisch gespeichert um ${saveState.at}`}
                  className={`flex items-center gap-1 text-[10px] flex-shrink-0 ${c.muted}`}>
                  <Save size={11} /> {saveState.at}
                </span>
          )}
          {/* Offene Kommentare der Reihe nach durchgehen */}
          {!!offeneKommentare.length && (
            <div className={`flex items-center gap-0.5 rounded border flex-shrink-0 ${c.border2}`}>
              <button
                onClick={() => zeigeFaden((kommentarIdx - 1 + offeneKommentare.length) % offeneKommentare.length)}
                title="Voriger offener Kommentar"
                className={`px-1.5 py-1.5 ${c.muted} hover:opacity-100`}><ChevronLeft size={12} /></button>
              <button onClick={() => zeigeFaden(kommentarIdx % offeneKommentare.length)}
                title={offeneKommentare[kommentarIdx % offeneKommentare.length]?.entries[0]?.text}
                className={`flex items-center gap-1 text-[11px] ${c.muted2}`}>
                <MessageSquare size={11} />
                {Math.min(kommentarIdx + 1, offeneKommentare.length)}/{offeneKommentare.length}
              </button>
              <button
                onClick={() => zeigeFaden((kommentarIdx + 1) % offeneKommentare.length)}
                title="Nächster offener Kommentar"
                className={`px-1.5 py-1.5 ${c.muted} hover:opacity-100`}><ChevronRight size={12} /></button>
            </div>
          )}
          <button onClick={() => setExportOpen(true)}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border flex-shrink-0 ${c.btn}`}>
            <Download size={12} /> Export
          </button>
          <select value={spec.status} disabled={!canEdit}
            onChange={e => update({ ...spec, status: e.target.value as Status })}
            title="Status der Spezifikation"
            className={`text-[11px] px-2 py-1.5 rounded border outline-none flex-shrink-0 ${c.input}`}>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </div>
      </div>

      {/* Bericht des letzten Abgleichs — über die volle Breite, wegklickbar */}
      {report && (
        <div className={`flex-shrink-0 text-[10px] px-3 py-1.5 border-b ${c.border} ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
          <div className="flex items-center gap-2">
            <span className={c.muted2}>
              Abgleich: {report.kept} behalten · {report.added.length} neu · {report.changed.length} geändert
              {report.renamed.length ? ` · ${report.renamed.length} umbenannt` : ''} · {report.removed.length} entfallen
            </span>
            <button onClick={() => setReport(null)} className={`ml-auto ${c.muted}`}><X size={10} /></button>
          </div>
          {[...report.added.map(n => `+ ${n}`), ...report.changed.map(n => `~ ${n}`),
            ...report.renamed.map(n => `✎ ${n}`), ...report.removed.map(n => `− ${n}`)]
            .slice(0, 8).map((l, i) => <div key={i} className={`font-mono ${c.muted}`}>{l}</div>)}
        </div>
      )}

      {/* ── Inhalt ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {tab === 'flow' ? (
          <>
            {/* links: Diagramm über dem Ablauf */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              {showDiagram && xml && (
                <div className={`flex-shrink-0 border-b ${c.border} relative`} style={{ height }}>
                  <Suspense fallback={<div className={`h-full flex items-center justify-center text-xs ${c.muted}`}>Modeler wird geladen …</div>}>
                    <BpmnEditor xml={xml} isDark={isDark} canEdit={canEdit}
                      onChange={text => { void applyXml(text, 'Diagramm', true); }}
                      onSelect={id => setSelected(id)}
                      onReady={h => { bpmnRef.current = h; h.select(selected); }}
                      onError={m => setSaveState({ error: m })} />
                  </Suspense>
                  <ResizeHandle isDark={isDark} height={height} onHeight={h => {
                    setHeight(h);
                    localStorage.setItem(HEIGHT_KEY, String(h));
                  }} />
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <StepList steps={spec.steps} depth={0} isDark={isDark} collapsed={collapsed} toggle={toggle}
                  selected={selected} onSelect={setSelected} byId={byId}
                  matches={matches} filterActive={active}
                  onStatus={canEdit ? (id, s) => patchStep(id, { status: s }) : undefined}
                  comments={id => openCount(spec, stepTarget(id))} />
                {!spec.steps.length && (
                  <p className={`text-xs ${c.muted}`}>
                    Noch kein Ablauf — «Mit BPMN abgleichen» übernimmt die Struktur aus der Implementation.
                  </p>
                )}
              </div>
            </div>

            {/* rechts: Titel und Filter über den Eigenschaften — die Breite
                lässt sich an der Trennlinie ziehen */}
            <div style={{ width: panelW }}
              className={`relative flex-shrink-0 border-l ${c.border} ${c.panel} flex flex-col min-h-0`}>
              <PanelWidthHandle isDark={isDark} width={panelW} onWidth={w => {
                setPanelW(w);
                localStorage.setItem(PANEL_W_KEY, String(w));
              }} />
              <div className={`flex-shrink-0 px-4 py-3 border-b ${c.border}`}>
                <input value={spec.title} disabled={!canEdit}
                  onChange={e => update({ ...spec, title: e.target.value })}
                  placeholder="Fachlicher Titel"
                  className={`w-full bg-transparent outline-none text-sm font-semibold ${c.text} disabled:opacity-100`} />
                <div className={`flex items-center gap-2 mt-0.5 text-[10px] ${c.muted}`}>
                  <span className="font-mono truncate">{spec.processId || spec.name}</span>
                  {spec.project && <span className="font-mono opacity-70 truncate">· {spec.project}</span>}
                  {spec.engine && <span className="flex-shrink-0 opacity-70">· {engineLabel(spec.engine)}</span>}
                  <span className="flex-shrink-0">· {spec.updatedAt.slice(0, 10)}</span>

                </div>

                <div className={`flex items-center gap-1 mt-2 px-2 py-1 rounded border ${c.border2}`}>
                  <Search size={11} className={c.muted} />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Schritt, Service, Text …"
                    className={`flex-1 min-w-0 bg-transparent outline-none text-[10px] ${c.text}`} />
                  {query && <button onClick={() => setQuery('')} className={c.muted}><X size={10} /></button>}
                </div>

                {counts && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {STATUSES.filter(s => counts[s] > 0).map(s => (
                      <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                        title={`Nur «${STATUS_META[s].label}» zeigen`}
                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-opacity ${isDark ? STATUS_META[s].dark : STATUS_META[s].light} ${
                          statusFilter && statusFilter !== s ? 'opacity-30' : ''}`}>
                        {STATUS_META[s].label} {counts[s]}
                      </button>
                    ))}
                    {statusFilter && (
                      <button onClick={() => setStatusFilter(null)} className={`text-[9px] ${c.muted} hover:underline`}>
                        Filter aus
                      </button>
                    )}
                  </div>
                )}
              </div>

              <StepDetail step={selectedStep} spec={spec} author={author} highlight={aktuellerFaden}
                isDark={isDark} canEdit={canEdit} model={model}
                onPatch={patchStep} onSyncId={syncStepId} onClose={() => setSelected(null)} onGoto={setSelected}
                projectPrefixes={projectPrefixes} onRenameProject={renameProject}
                onSpecChange={next => {
                  if (next.timeToLive !== spec.timeToLive) {
                    bpmnRef.current?.setProps(null, { 'camunda:historyTimeToLive': next.timeToLive || undefined });
                  }
                  update(next);
                }}
                onEditType={id => { setFocusType(id); setTab('model'); }} />
            </div>
          </>
        ) : (
          <TypeBuilder spec={spec} isDark={isDark} canEdit={canEdit} model={model} onChange={update}
            focusTypeId={focusType} onFocused={() => setFocusType(null)} highlight={aktuellerFaden} />
        )}
      </div>

      {exportOpen && <ExportDialog spec={spec} model={model} bpmn={xml ?? ''} isDark={isDark} onClose={() => setExportOpen(false)} />}
    </div>
  );
}

// Senkrechter Trenner in der Werkzeugleiste
function Divider({ isDark }: { isDark: boolean }) {
  return <div className={`w-px h-4 flex-shrink-0 ${isDark ? 'bg-white/15' : 'bg-black/15'}`} />;
}

// Höhe des Diagramms ziehen — die Einstellung bleibt über die Sitzung hinaus.
function ResizeHandle({ isDark, height, onHeight }: { isDark: boolean; height: number; onHeight: (h: number) => void }) {
  const c = cls(isDark);
  const start = useRef<{ y: number; h: number } | null>(null);
  return (
    <div
      onPointerDown={e => {
        start.current = { y: e.clientY, h: height };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (!start.current) return;
        const next = Math.min(900, Math.max(140, start.current.h + (e.clientY - start.current.y)));
        onHeight(next);
      }}
      onPointerUp={e => {
        start.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }}
      title="Höhe ziehen"
      className={`absolute left-0 right-0 -bottom-1 h-2 cursor-row-resize flex items-center justify-center ${c.muted} hover:opacity-100 opacity-40`}>
      <GripHorizontal size={12} />
    </div>
  );
}

// Breite der Eigenschaften ziehen — dasselbe Muster wie zwischen Diagramm
// und Ablauf, nur senkrecht: die linke Kante des Panels ist der Griff.
function PanelWidthHandle({ isDark, width, onWidth }: { isDark: boolean; width: number; onWidth: (w: number) => void }) {
  const c = cls(isDark);
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      onPointerDown={e => {
        start.current = { x: e.clientX, w: width };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (!start.current) return;
        const next = Math.min(800, Math.max(320, start.current.w - (e.clientX - start.current.x)));
        onWidth(next);
      }}
      onPointerUp={e => {
        start.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }}
      title="Breite ziehen"
      className={`absolute top-0 bottom-0 -left-1 w-2 cursor-col-resize z-10 select-none touch-none flex items-center justify-center ${c.muted} hover:opacity-100 opacity-40`}>
      <GripVertical size={12} />
    </div>
  );
}

// ── Baum ─────────────────────────────────────────────────────────────────────
interface ListProps {
  steps: Step[];
  depth: number;
  isDark: boolean;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  byId: Map<string, Step>;
  matches: (s: Step) => boolean;
  filterActive: boolean;
  onStatus?: (id: string, s: Status) => void;
  /** wie viele offene Kommentare an diesem Schritt hängen */
  comments: (id: string) => number;
}

function StepList(p: ListProps) {
  return (
    <div className="flex flex-col">
      {p.steps.filter(s => !p.filterActive || p.matches(s)).map(s => <StepRow key={s.id} step={s} {...p} />)}
    </div>
  );
}

function nextStatus(s: Status): Status {
  return STATUSES[(STATUSES.indexOf(s) + 1) % STATUSES.length];
}

function StepRow({ step, ...p }: ListProps & { step: Step }) {
  const c = cls(p.isDark);
  const Icon = STEP_ICON[step.kind];
  const isOpen = !p.collapsed.has(step.id);
  const hasChildren = !!(step.branches?.length || step.children?.length || step.errors?.some(e => e.steps?.length));
  const isSelected = p.selected === step.id;

  if (step.kind === 'goto') {
    const target = step.gotoId ? p.byId.get(step.gotoId) : null;
    return (
      <button onClick={() => step.gotoId && p.onSelect(step.gotoId)}
        className={`flex items-center gap-2 py-1 text-left text-[11px] ${c.muted} hover:underline`}>
        {step.back ? <Repeat size={11} /> : <CornerDownRight size={11} />}
        <span>{step.back ? 'zurück zu' : 'weiter bei'}</span>
        <span className={c.muted2}>«{target?.name ?? step.name}»</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col">
      <div data-step={step.id} onClick={() => p.onSelect(step.id)}
        className={`group flex items-center gap-2 py-1 pr-2 rounded cursor-pointer ${c.hover} ${
          isSelected ? (p.isDark ? 'bg-white/10' : 'bg-black/10') : ''}`}>
        <button onClick={e => { e.stopPropagation(); if (hasChildren) p.toggle(step.id); }}
          className={`w-4 flex-shrink-0 ${hasChildren ? c.muted2 : 'opacity-0 pointer-events-none'}`}>
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <Icon size={12} className={`flex-shrink-0 ${c.muted2}`} />
        <span className={`text-xs truncate ${c.text} ${step.kind === 'gateway' ? 'italic' : ''}`}>{step.name}</span>
        {step.serviceId && (
          <span className={`hidden md:inline text-[9px] font-mono truncate max-w-[16rem] ${c.muted}`} title={step.serviceId}>
            {step.serviceId}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {step.description && <span className={`text-[9px] ${c.muted}`} title="fachlich beschrieben">✎</span>}
          {step.open && <span className={p.isDark ? 'text-amber-400' : 'text-amber-600'} title={step.open}>❓</span>}
          {!!p.comments(step.id) && (
            <span className={`flex items-center gap-0.5 text-[9px] ${c.muted}`}
              title={`${p.comments(step.id)} offene Kommentare`}>
              <MessageSquare size={9} />{p.comments(step.id)}
            </span>
          )}
          <BlockChip step={step} isDark={p.isDark} />
          <LoopChip step={step} isDark={p.isDark} />
          {!!step.errors?.filter(e => !e.side).length && <ErrorChip n={step.errors.filter(e => !e.side).length} isDark={p.isDark} />}
          <StatusChip status={step.status} isDark={p.isDark}
            onClick={p.onStatus ? () => p.onStatus!(step.id, nextStatus(step.status)) : undefined} />
        </div>
      </div>

      {isOpen && hasChildren && (
        <div className="flex flex-col">
          {/* Verzweigungen */}
          {step.branches?.map((b, i) => <BranchBlock key={b.id} branch={b} index={i} {...p} />)}

          {/* Fehler- und Nebenpfade */}
          {step.errors?.filter(e => e.steps?.length).map(e => (
            <div key={e.code} className={`ml-6 pl-3 border-l-2 ${
              e.side
                ? (p.isDark ? 'border-indigo-500/40' : 'border-indigo-400')
                : (p.isDark ? 'border-amber-500/40' : 'border-amber-400')}`}>
              <div className={`flex items-center gap-1.5 py-1 text-[10px] ${
                e.side
                  ? (p.isDark ? 'text-indigo-300' : 'text-indigo-700')
                  : (p.isDark ? 'text-amber-300' : 'text-amber-700')}`}>
                {e.side ? <GitFork size={10} /> : <AlertTriangle size={10} />}
                {e.side ? 'Nebenpfad' : 'Fehler'} «{e.code}»
                {!e.side && e.interrupting === false && <span className={c.muted}>· nicht unterbrechend</span>}
              </div>
              <StepList {...p} steps={e.steps!} depth={p.depth + 1} />
            </div>
          ))}

          {/* Subprozess */}
          {!!step.children?.length && (
            <div className={`ml-6 pl-3 border-l-2 ${p.isDark ? 'border-white/15' : 'border-black/15'}`}>
              <StepList {...p} steps={step.children} depth={p.depth + 1} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BranchBlock({ branch, index, ...p }: ListProps & { branch: Branch; index: number }) {
  const c = cls(p.isDark);
  const col = BRANCH_COLORS[index % BRANCH_COLORS.length];
  const tint = p.isDark ? col.dark : col.light;
  return (
    <div className={`ml-6 pl-3 border-l-2 ${tint.split(' ')[0]}`}>
      <div className={`flex items-center gap-1.5 py-1 text-[10px] ${tint.split(' ')[1]}`}>
        <span className="font-semibold">{branch.label}</span>
        {branch.isDefault && <span className={c.muted}>· Standard</span>}
        {branch.condition && <span className={`font-mono truncate max-w-[24rem] ${c.muted}`} title={branch.condition}>{branch.condition}</span>}
        {!branch.steps.length && <span className={c.muted}>· direkt weiter</span>}
      </div>
      {!!branch.steps.length && <StepList {...p} steps={branch.steps} depth={p.depth + 1} />}
    </div>
  );
}
