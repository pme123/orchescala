// Die Prozess-Ansicht: links der Ablauf als einklappbarer Baum, rechts die
// Details des gewählten Schritts.
//
// Der Baum ist der Kern des PoC — Verzweigungen als farbige, beschriftete
// Zweige, Schleifen und Fehlerpfade sichtbar, Details standardmässig
// eingeklappt. Änderungen werden automatisch gespeichert (wie im arch-review).
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { projectColor } from '../projects';
import {
  ChevronDown, ChevronRight, ChevronLeft, Download, RefreshCw, Search, X, Minimize2, Maximize2, Plug,
  AlertTriangle, ShieldCheck, GitFork, Repeat, CornerDownRight, Save, Braces, ListTree, Workflow, GripHorizontal, Unlink,
  MessageSquare, Puzzle, History, Database, ClipboardPaste,
} from 'lucide-react';
import { useStore } from '../store';
import { useAuth, useAuthor, usePermissions } from '../auth';
import { collectFindings, withServiceRows, type Finding } from '../findings';
import { catalogEntry, healLooseTypes } from '../interactions';
import { baseOf, commentTargets, countIndex, locate, markNotified, processTarget, rememberPlaces, stepTarget, sub, threadOf } from '../comments';
import { TEAMS_SCOPES } from '../teams';
import { DIRECTORY_SCOPES, type DirectorySearchResult } from '../store';
import { useTeamsNotify } from './useTeamsNotify';
import { engineExpression } from '../feelJuel';
import { ASSIGNMENT_KEYS, DEFAULT_MERGE_STATUS, allSteps, blockGroups, blockStart, healJuel, importBpmn, mergeSpec, statusCounts, syncPatterns, type MergeReport, type MergeStatus } from '../bpmn';
import { applyPattern, removePattern, updatePattern } from '../patterns';
import { conventionalId, derivable, knownPrefixes, renameIdInXml, renamePrefix, renamePrefixInXml, renameStepId } from '../stepIds';
import { engineLabel } from '../template';
import { alignPoolIds, checkProcessId, poolNames, renameProcess } from '../poolIds';
import { INTERACTION_META, STATUSES, STATUS_META, type Branch, type EngineId, type Interaction, type ProcessSpec, type ServiceDef, type Status, type Step } from '../types';
import { BlockChip, BRANCH_COLORS, ErrorChip, KIND_LABEL, LoopChip, PanelWidthHandle, PatternChip, STEP_ICON, StatusChip, cls, patternTone } from '../ui';
import { nowIsoWithTimezone } from '../util';
import { bpmnReport, domainReport, makeEntry, type AuditEntry, type AuditOrigin, type AuditReport } from '../audit';
import EngineDialog from './EngineDialog';
import ExportDialog from './ExportDialog';
import { CommentBubble, CommentsContext, CommentsPanel } from './Comments';
import StepDetail from './StepDetail';
import TypeBuilder from './TypeBuilder';
import { SyncDataIcon, SyncProcessIcon } from './SyncIcons';
import AuditPanel from './AuditPanel';
import SyncPanel from './SyncPanel';
import type { BpmnHandle } from './BpmnEditor';
import { attachDiagramSpec, clearDiagramClip, useClipboard, type PastedElements } from '../clipboard';
import { collectDiagram, overlayPasted } from '../copyPaste';

// Der Modeler ist gross — er kommt erst, wenn das Diagramm gezeigt wird.
const BpmnEditor = lazy(() => import('./BpmnEditor'));

const HEIGHT_KEY = 'orch-spec.diagramHeight';
const PANEL_W_KEY = 'orch-spec.panelWidth';
const COMMENTS_W_KEY = 'orch-spec.commentsWidth';
/** darunter legt sich das Kommentar-Panel über die rechte Spalte, statt Platz zu nehmen */
const OVERLAY_BELOW = 1100;

interface Props {
  slug: string;
  onBack: () => void;
  /** Deep Link: das Kommentar-Panel an der Stelle dieses Kommentars öffnen */
  focusCommentId?: string;
}

/** Die Entra-Suche einmal pro Sitzung erklären, nicht bei jedem «@». */
let directoryWarned = false;

/** Attributwert für einen CSS-Selektor. */
const cssAttr = (s: string) => s.replace(/["\\]/g, '\\$&');

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
const applyToBpmn = (id: string, patch: Partial<Step>, before: Step | undefined, bpmn: BpmnHandle | null, engine?: EngineId) => {
  if (!bpmn) return;
  // Zuständigkeit: FEEL in der Spezifikation, im Diagramm in der Form der Engine
  const assignment = ASSIGNMENT_KEYS.filter(k => k in patch);
  if (assignment.length) {
    bpmn.setAssignment(id, Object.fromEntries(assignment.map(k =>
      [k, patch[k]?.trim() ? engineExpression(patch[k], engine).text : undefined])), engine);
  }
  if (patch.branches) {
    const alt = new Map((before?.branches ?? []).map(b => [b.id, b]));
    for (const b of patch.branches) {
      const old = alt.get(b.id);
      if (old?.label !== b.label) bpmn.setProps(b.id, { name: b.label });
      if (old?.condition !== b.condition) bpmn.setCondition(b.id, b.condition);
    }
  }
  if (patch.errors || 'regexHandledErrors' in patch) {
    // `_handledErrors` führt, was **nicht** allein am Boundary-Event hängt:
    // die schon deklarierten und die hier neu erfassten.
    const held = (patch.errors ?? before?.errors ?? []).filter(e => e.code && (e.declared || !e.boundary));
    const regex = 'regexHandledErrors' in patch ? patch.regexHandledErrors : before?.regexHandledErrors;
    bpmn.setHandledErrors(id, held.map(e => e.code), (regex ?? []).map(r => r.trim()).filter(Boolean), engine);
  }
};

export default function ProcessView({ slug, onBack, focusCommentId }: Props) {
  const { isDark, model, specs, loadSpec, saveSpec, loadAudit, loadBpmn, saveBpmn, knownUsers, searchDirectory, storage } = useStore();
  const auth = useAuth();
  const { canEdit } = usePermissions();
  const author = useAuthor();
  const authorRef = useRef(author);
  authorRef.current = author;
  /** Hinweis über dem Inhalt — z. B. fehlende Berechtigung für Teams */
  const [notice, setNotice] = useState<{ message: string; tone: 'info' | 'warn'; scopes?: string[] } | null>(null);
  const c = cls(isDark);

  const [spec, setSpec] = useState<ProcessSpec | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  /** nur Schritte mit Befund (rotes oder oranges Dreieck) */
  const [findingsOnly, setFindingsOnly] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [engineOpen, setEngineOpen] = useState(false);
  const [saveState, setSaveState] = useState<{ at: string } | { error: string } | null>(null);
  const [report, setReport] = useState<MergeReport | null>(null);
  /** gewähltes BPMN, das in der Vorschau wartet («Mit BPMN abgleichen») */
  const [sync, setSync] = useState<{ raw: string; from: string; mode?: 'bpmn' | 'domain' } | null>(null);
  const [tab, setTab] = useState<'flow' | 'model'>('flow');
  /** Sprung aus dem Ablauf ins Datenmodell — dort wird dieser Typ gezeigt */
  const [focusType, setFocusType] = useState<string | null>(null);
  /** Sprung aus den Kommentaren zu einer Interaktion im Datenmodell */
  const [focusIa, setFocusIa] = useState<string | null>(null);
  /** Kommentar-Panel: offen? welche Stelle? (null = Übersicht) */
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  /** Änderungsprotokoll: offen? für welches Element? (null = alle) */
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditFocus, setAuditFocus] = useState<string | null>(null);
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
  // Kommentar-Panel: eigene Breite, ebenfalls ziehbar; bei schmalem Fenster
  // legt es sich über die rechte Spalte, sonst nimmt es sich seinen Platz
  // vom Eigenschaften-Panel — der Ablauf links bleibt, wie er ist
  const [commentsW, setCommentsW] = useState(() => {
    const n = Number(localStorage.getItem(COMMENTS_W_KEY));
    return Number.isFinite(n) && n >= 300 ? Math.min(n, 640) : 380;
  });
  const [narrow, setNarrow] = useState(() => window.innerWidth < OVERLAY_BELOW);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${OVERLAY_BELOW - 1}px)`);
    const h = () => setNarrow(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  useEffect(() => {
    let alive = true;
    loadSpec(slug).then(r => {
      if (!alive || !r) return;
      setSpec(r.data);
      setVersion(r.version);
      auditBase.current = r.data;
      latest.current = r.data;
      auditQueue.current = [...r.audit];
      // Subprozesse und Fehlerpfade zu Beginn zugeklappt: erst der Überblick
      const start = new Set<string>();
      for (const s of allSteps(r.data.steps)) if (s.kind === 'subprocess') start.add(s.id);
      setCollapsed(start);
    });
    loadBpmn(slug).then(x => { if (alive) { setXml(x); setShowDiagram(!!x); } });
    return () => { alive = false; };
  }, [slug, loadSpec, loadBpmn]);

  // Blosse Typnamen aus einem Import ohne Katalog: sobald der Katalog sie
  // kennt, werden sie zu Verweisen — gespeichert wird das mit dem nächsten
  // Autosave. Nichts zu tun → null, kein Update, keine Schleife.
  useEffect(() => {
    if (!spec || !model || !canEdit) return;
    const healed = healLooseTypes(spec.types ?? [], model);
    if (healed) update({ ...spec, types: healed }, { source: 'load', note: 'Typnamen mit dem Katalog verknüpft' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec?.types, model, canEdit]);

  // Alle Felder eines Service-Aufrufs als Zeilen — Pflicht-Eingaben und gebrauchte
  // Ausgaben angehakt (wie beim Import und Abgleich) — einmal beim Öffnen, sobald
  // der Katalog da ist; gespeichert mit dem Autosave
  const requiredHealed = useRef<string | null>(null);
  useEffect(() => {
    // der Katalog kann nach der Spezifikation kommen — dann noch einmal
    const key = `${slug}:${model?.services.length ?? 0}`;
    if (!spec || !model || !canEdit || requiredHealed.current === key) return;
    requiredHealed.current = key;
    const r = withServiceRows(spec, model);
    if (r.changed) update(r.spec, { source: 'load', note: 'Felder der Services als Zeilen ergänzt (Pflicht-Eingaben angehakt)' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, model, canEdit, slug]);

  // JUEL aus einem älteren Stand bzw. Katalog: was sich übersetzen lässt,
  // wird FEEL — gespeichert mit dem nächsten Autosave; der Rest bleibt JUEL
  // (einmal beim Öffnen — nicht mitten im Tippen)
  const juelHealed = useRef<string | null>(null);
  useEffect(() => {
    if (!spec || !canEdit || juelHealed.current === slug) return;
    juelHealed.current = slug;
    const healed = healJuel(spec);
    if (healed) update(healed, { source: 'conversion', note: 'JUEL in FEEL übersetzt' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, canEdit, slug]);

  // ── Autosave ──────────────────────────────────────────────────────────────
  const timer = useRef<number | null>(null);
  const pending = useRef<ProcessSpec | null>(null);
  const versionRef = useRef<string | null>(null);
  versionRef.current = version;

  // ── Änderungsprotokoll (siehe audit.ts) ───────────────────────────────────
  // `auditBase` ist der Stand beim letzten Schnitt. Geschnitten wird bei jedem
  // Speichern (alles bis dahin war Handarbeit) und vor wie nach einer
  // Änderung mit Herkunft (Abgleich, Umwandlung …) — die wird ein eigener
  // Eintrag. Die Einträge warten, bis die Spezifikation gespeichert ist.
  const auditBase = useRef<ProcessSpec | null>(null);
  const auditQueue = useRef<AuditEntry[]>([]);
  /** der neueste Stand — auch zwischen update() und dem nächsten Rendern */
  const latest = useRef<ProcessSpec | null>(null);
  const cutAudit = useCallback((to: ProcessSpec | null, origin: AuditOrigin = { source: 'manual' }) => {
    const from = auditBase.current;
    if (!from || !to) return;
    const e = makeEntry(from, to, origin, authorRef.current);
    if (e) auditQueue.current.push(e);
    auditBase.current = to;
  }, []);

  const flush = useCallback(async () => {
    const data = pending.current;
    if (!data) return;
    pending.current = null;
    cutAudit(data);
    const audit = auditQueue.current.splice(0);
    const res = await saveSpec(data, versionRef.current, audit);
    // nicht gespeichert (oder nur das Protokoll nicht): mit dem nächsten Speichern nochmals
    if (res.status !== 'saved' || res.auditError) auditQueue.current.unshift(...audit);
    if (res.status === 'saved') {
      setVersion(res.version);
      setSaveState({ at: new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) });
      if (res.auditError) setNotice({ tone: 'warn', message: `Gespeichert, aber das Änderungsprotokoll nicht: ${res.auditError} Es wird mit dem nächsten Speichern nachgeholt.` });
    } else if (res.status === 'conflict') {
      setSaveState({ error: 'Die Datei wurde inzwischen geändert — Seite neu laden.' });
    } else {
      setSaveState({ error: res.message });
    }
  }, [saveSpec, cutAudit]);

  /**
   * Jede Änderung geht hier durch. `origin` sagt, woher eine Änderung kommt,
   * die nicht von Hand ist (oder einen Grund hat) — sie wird ein eigener
   * Eintrag im Protokoll; ohne gilt sie als Handarbeit.
   */
  const update = useCallback((next: ProcessSpec, origin?: AuditOrigin) => {
    const data = { ...next, updatedAt: nowIsoWithTimezone() };
    if (origin) {
      cutAudit(latest.current);
      cutAudit(data, origin);
    }
    latest.current = data;
    setSpec(data);
    pending.current = data;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flush(); }, 1000);
  }, [flush, cutAudit]);

  // beim Verlassen ausstehende Änderungen noch wegschreiben — auch wenn die
  // Seite neu lädt oder in den Hintergrund geht (dann gibt es kein Unmount)
  useEffect(() => {
    const now = () => { if (pending.current) void flush(); };
    const hidden = () => { if (document.visibilityState === 'hidden') now(); };
    window.addEventListener('pagehide', now);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', now);
      document.removeEventListener('visibilitychange', hidden);
      now();
    };
  }, [flush]);

  // Einen Schritt im Baum ersetzen (unveränderlich)
  const patchStep = useCallback((id: string, patch: Partial<Step>) => {
    if (!spec) return;
    if (typeof patch.name === 'string') bpmnRef.current?.rename(id, patch.name);
    applyToBpmn(id, patch, byIdRef.current.get(id), bpmnRef.current, spec.engine);
    // Worker oder Teilprozess gewählt → das Element bekommt die Farbe seines Projekts
    if ('serviceId' in patch || 'topic' in patch || 'calledProcess' in patch) {
      const s = { ...byIdRef.current.get(id), ...patch };
      if (s.kind === 'service' || s.kind === 'call') {
        const ref = s.kind === 'call' ? s.calledProcess ?? s.topic : s.topic ?? s.serviceId;
        bpmnRef.current?.setColor(id, projectColor(ref, spec.project, model?.projects, model?.projectColors));
      }
    }
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
    update({ ...renamePrefix(current, oldPrefix, newPrefix), project: newPrefix },
      { source: 'manual', note: `Firma/Projekt gewechselt: ${oldPrefix} → ${newPrefix}` });
  }, [update, saveBpmn, slug]);

  const byId = useMemo(() => new Map(allSteps(spec?.steps).map(s => [s.id, s])), [spec]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const counts = useMemo(() => (spec ? statusCounts(spec) : null), [spec]);
  const containers = useMemo(() => (spec ? containerIds(spec.steps) : []), [spec]);
  const ancestors = useMemo(() => (spec ? ancestorsOf(spec.steps) : new Map<string, string[]>()), [spec]);
  const ancestorsRef = useRef(ancestors);
  ancestorsRef.current = ancestors;
  // Das gewählte Element im Baum zeigen — auch wenn es im Diagramm gewählt
  // wurde: eingeklappte Zweige darüber öffnen, dann in den Blick scrollen
  // (`nearest`: was schon zu sehen ist, bleibt, wo es ist). Eine eingeklappte
  // Pattern-Zeile öffnet sich selbst (PatternFold).
  useEffect(() => {
    if (!selected) return;
    const oben = ancestorsRef.current.get(selected) ?? [];
    if (oben.length) setCollapsed(prev => (oben.some(id => prev.has(id)) ? new Set([...prev].filter(id => !oben.includes(id))) : prev));
    const timers = [0, 60, 200].map(nach => window.setTimeout(() => {
      document.querySelector(`[data-step="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' });
    }, nach));
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [selected]);

  // ── Kommentare ───────────────────────────────────────────────────────────
  const commentCounts = useMemo(() => (spec ? countIndex(spec) : { exact: new Map(), under: new Map() }), [spec]);
  const targets = useMemo(() => (spec ? commentTargets(spec, allSteps(spec.steps)) : []), [spec]);

  /**
   * Zur Stelle eines Kommentars: Ansicht wechseln, eingeklappte Zweige
   * öffnen, das Element wählen und die Sprechblase in den Blick scrollen.
   */
  const gotoTarget = useCallback((key: string) => {
    const ziel = locate(key);
    if (ziel.kind === 'type') { setFocusType(ziel.id); setTab('model'); }
    else if (ziel.kind === 'ia') { setFocusIa(ziel.id); setTab('model'); }
    else {
      setTab('flow');
      if (ziel.kind === 'process') setSelected(null);
      else {
        // Der Schritt kann in einem eingeklappten Zweig stecken
        const oben = ancestors.get(ziel.id) ?? [];
        if (oben.length) setCollapsed(prev => {
          const next = new Set(prev);
          for (const id of oben) next.delete(id);
          return next;
        });
        setSelected(ziel.id);
      }
    }
    for (const nach of [0, 60, 200, 400]) {
      window.setTimeout(() => {
        if (ziel.kind === 'step') {
          document.querySelector(`[data-step="${CSS.escape(ziel.id)}"]`)?.scrollIntoView({ block: 'nearest' });
        }
        // die rechte Spalte scrollt für sich — dort steht die Stelle vielleicht weit unten
        const bubbles = document.querySelectorAll(`[data-ctarget="${CSS.escape(key)}"]`);
        bubbles[bubbles.length - 1]?.scrollIntoView({ block: 'nearest' });
      }, nach);
    }
  }, [ancestors]);

  const selectComment = useCallback((key: string | null) => {
    setActiveComment(key);
    if (key) gotoTarget(key);
  }, [gotoTarget]);

  /**
   * Klick auf eine Sprechblase. Im Baum zählt sie das ganze Element; hat es
   * selbst nichts Offenes, wohl aber ein Teil davon, geht es gleich dorthin.
   */
  const openComment = useCallback((key: string, aggregate?: boolean) => {
    let ziel = key;
    if (aggregate && !commentCounts.exact.get(key)?.open) {
      const teil = targets.find(t => baseOf(t.key) === key && t.key !== key && commentCounts.exact.get(t.key)?.open);
      if (teil) ziel = teil.key;
    }
    setCommentsOpen(true);
    setAuditOpen(false);
    selectComment(ziel);
  }, [commentCounts, targets, selectComment]);

  const commentsCtx = useMemo(() => ({
    exact: commentCounts.exact, under: commentCounts.under,
    active: commentsOpen ? activeComment : null, open: openComment, isDark,
  }), [commentCounts, commentsOpen, activeComment, openComment, isDark]);
  const offeneKommentare = spec?.comments?.filter(t => !t.resolved).length ?? 0;

  // Deep Link: einmal, sobald die Spezifikation da ist
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!spec || !focusCommentId || focusedRef.current === focusCommentId) return;
    focusedRef.current = focusCommentId;
    const faden = threadOf(spec, focusCommentId);
    if (!faden) { setNotice({ tone: 'warn', message: 'Der verlinkte Kommentar ist nicht mehr da.' }); return; }
    if (faden.resolved) setShowResolved(true);
    openComment(faden.target);
  }, [spec, focusCommentId, openComment]);

  // Personen für «@»: users.json plus Kommentar-Autoren mit E-Mail plus ich
  const mentionUsers = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; email: string }[] = [];
    const add = (name: string, email?: string) => {
      const key = (email ?? '').toLowerCase();
      if (!key || !name || seen.has(key)) return;
      seen.add(key);
      out.push({ name, email: email! });
    };
    knownUsers.forEach(u => add(u.name, u.email));
    add(author.name, author.email);
    for (const t of spec?.comments ?? []) for (const e of t.entries) add(e.author, e.email);
    return out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [knownUsers, author.name, author.email, spec?.comments]);

  // Entra-Suche nicht möglich: einmal pro Sitzung erklären; bekannte Personen bleiben wählbar
  const onDirectoryProblem = useCallback((r: Extract<DirectorySearchResult, { ok: false }>) => {
    if (r.reason === 'noLogin' || directoryWarned) return;
    directoryWarned = true;
    setNotice({
      tone: 'warn', scopes: r.reason === 'consent' ? DIRECTORY_SCOPES : undefined,
      message: `${r.message} Bis dahin schlägt «@» nur Personen vor, die in diesem Ordner schon gearbeitet oder kommentiert haben.`,
    });
  }, []);

  // Teams-Versand (Wartezeit, gesammelt, einmalig). Das Quittieren läuft auch
  // nach dem Verlassen noch — deshalb auf dem letzten Stand und sofort gespeichert.
  const teamsSettings = model?.notifications?.teams;
  const targetLabel = useCallback((t: string) => targets.find(x => x.key === t)?.label ?? t, [targets]);
  useTeamsNotify({
    slug, processName: spec?.title || spec?.name || slug, comments: spec?.comments ?? [],
    me: auth.user?.email ? { id: auth.user.id, name: auth.user.name, email: auth.user.email } : null,
    settings: teamsSettings,
    placeLabel: targetLabel,
    linkSetup: auth.ids && { ...auth.ids, ...(storage?.kind === 'sharepoint' && storage.webUrl ? { folderUrl: storage.webUrl } : {}) },
    onDelivered: done => {
      const base = pending.current ?? specRef.current;
      if (!base) return;
      update(markNotified(base, done));
      void flush();
    },
    tryToken: auth.tryToken,
    onProblem: pr => setNotice({
      tone: 'warn', scopes: pr.reason === 'consent' ? TEAMS_SCOPES : undefined,
      message: `Teams-Benachrichtigung nicht möglich: ${pr.message} Die Kommentare bleiben gespeichert; die Benachrichtigung wird nachgeholt, sobald die Berechtigung da ist.`,
    }),
    onSent: names => setNotice({ tone: 'info', message: `Teams-Nachricht an ${names.join(', ')} gesendet.` }),
    onFailed: message => setNotice({ tone: 'warn', message }),
  });
  // Erfolgsmeldungen verschwinden von selbst
  useEffect(() => {
    if (notice?.tone !== 'info') return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /**
   * Blauer Rahmen um das Element des aktiven Kommentars: die Stelle selbst
   * (`data-cframe`) und — im Baum, in der Typliste — die Zeile des Elements
   * (`data-cframe-base`), damit man es auch dort wiederfindet.
   */
  const aktiv = commentsOpen ? activeComment : null;
  const frameCss = aktiv
    ? `[data-cframe="${cssAttr(aktiv)}"],[data-cframe-base="${cssAttr(baseOf(aktiv))}"]`
      + `{outline:2px solid ${isDark ? 'rgb(96 165 250)' : 'rgb(59 130 246)'};outline-offset:2px;border-radius:4px;background:${isDark ? 'rgb(59 130 246 / 0.12)' : 'rgb(59 130 246 / 0.07)'}}`
    : '';

  // Befunde je Schritt — dieselben Regeln wie im Panel rechts, für das Dreieck
  // in der Zeile; einmal je Stand der Spezifikation gerechnet. Zurückgestellt
  // (useDeferredValue): sie prüfen jeden FEEL-Ausdruck gegen die Typen — das
  // soll das Tippen nicht bremsen, sie folgen, sobald man innehält
  const deferredSpec = useDeferredValue(spec);
  const findings = useMemo(
    () => (deferredSpec ? collectFindings(deferredSpec, model, allSteps(deferredSpec.steps)) : new Map<string, Finding>()),
    [deferredSpec, model],
  );

  // Suche/Filter: passt ein Schritt oder einer seiner Nachfahren?
  const matches = useCallback((s: Step): boolean => {
    const q = query.trim().toLowerCase();
    // gesucht wird auch im Objektnamen der Interaktion und im Namen des
    // Katalog-Services — so findet «Approve» die Aufgabe, deren Schritt
    // «Kartenbestellung prüfen» heisst
    const ia = spec?.interactions?.find(i => i.stepId === s.id);
    const svc = catalogEntry(s, model);
    const haystack = `${s.name} ${s.description ?? ''} ${s.serviceId ?? ''} ${s.topic ?? ''} ${ia?.name ?? ''} ${svc?.name ?? ''} ${s.calledProcess ?? ''}`.toLowerCase();
    const hit = (!q || haystack.includes(q))
      && (!statusFilter || s.status === statusFilter)
      && (!findingsOnly || findings.has(s.id));
    if (hit) return true;
    const sub = [...(s.children ?? []), ...(s.branches ?? []).flatMap(b => b.steps), ...(s.errors ?? []).flatMap(e => e.steps ?? [])];
    return sub.some(matches);
  }, [query, statusFilter, findingsOnly, findings, spec?.interactions, model]);

  const active = query.trim() !== '' || statusFilter !== null || findingsOnly;

  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── BPMN abgleichen ───────────────────────────────────────────────────────
  // Ein Weg für beides: die gewählte Datei und die Änderung im Modeler.
  const specRef = useRef<ProcessSpec | null>(null);
  specRef.current = spec;
  const modelRef = useRef(model);
  modelRef.current = model;

  /**
   * Das Diagramm `raw` mit der Spezifikation zusammenführen — ohne zu
   * speichern. Kommt es aus dem Modeler (`from === 'Diagramm'`), benennt der
   * die Schritte gleich mit um; sonst ist das hier ohne Nebenwirkung und
   * lässt sich für die Vorschau beliebig oft rechnen.
   */
  const planXml = useCallback((raw: string, from: string, st: MergeStatus = DEFAULT_MERGE_STATUS, pasted?: PastedElements) => {
    const current = specRef.current;
    if (!current) return null;
    // Prozess-ID und -Name folgen dem Pool (Konvention, siehe poolIds.ts);
    // eine gewählte Prozess-ID nur, wenn der Name im Diagramm geändert wurde.
    // Ein offener Modeler lädt das angeglichene XML nach.
    const renamed = from === 'Diagramm' && !!xmlRef.current && poolNames(xmlRef.current) !== poolNames(raw);
    let text = alignPoolIds(raw, { renameProcess: renamed }).xml;
    const { spec: fresh } = importBpmn(text, from, { patterns: modelRef.current?.patterns });
    // das vorige BPMN als Bezug: was das Diagramm nicht geändert hat, bleibt
    // wie in der Spezifikation (Service, Mappings — die kommen erst beim Export hinein)
    let base = null;
    try { base = xmlRef.current ? importBpmn(xmlRef.current, from, { patterns: modelRef.current?.patterns }).spec : null; } catch { /* unlesbar — ohne Bezug */ }
    const { spec: merged0, report } = mergeSpec(fresh, current, base, st);
    // Im Diagramm umbenannte Schritte: die ID folgt dem Namen (Konvention).
    // Kommt die Änderung aus dem Modeler, benennt er um — das löst den
    // nächsten Speicherlauf aus, der das BPMN mit den neuen IDs ablegt.
    // Sonst (Pattern, Datei, Titel) zeigt der Modeler noch den alten Stand:
    // dann im neuen XML umbenennen, das er gleich lädt.
    let merged = merged0;
    const renames: Array<[string, string]> = [];
    const vorher = new Map(allSteps(current.steps).map(s => [s.id, s.name]));
    for (const s of allSteps(merged0.steps)) {
      const alt = vorher.get(s.id);
      if (alt === undefined || alt === s.name || !derivable(s)) continue;
      const ids = new Set(allSteps(merged.steps).map(x => x.id));
      const neu = conventionalId(s, x => x !== s.id && ids.has(x));
      if (!neu || neu === s.id) continue;
      if (from === 'Diagramm') {
        if (bpmnRef.current?.setId(s.id, neu) !== 'renamed') continue;
      } else {
        const nx = renameIdInXml(text, s.id, neu);
        if (!nx) continue;
        text = nx;
      }
      // samt Interaktionen und Kommentaren an diesem Schritt
      merged = renameStepId(merged, s.id, neu);
      renames.push([s.id, neu]);
    }
    // Im Modeler eingefügt: die Angaben der Quelle an die neuen Schritte. Die
    // ID der Quelle bleibt, wenn sie hier frei ist — sonst nach Konvention.
    const placed: string[] = [];
    if (pasted && from === 'Diagramm') {
      const o = overlayPasted(merged, pasted);
      merged = o.spec;
      for (const [alt, neu0] of o.placed) {
        const ids = new Set(allSteps(merged.steps).map(x => x.id));
        const step = allSteps(merged.steps).find(x => x.id === neu0);
        let neu = neu0;
        for (const wunsch of [ids.has(alt) ? null : alt, step ? conventionalId(step, x => x !== neu0 && ids.has(x)) : null]) {
          if (!wunsch || wunsch === neu0) continue;
          if (bpmnRef.current?.setId(neu0, wunsch) !== 'renamed') continue;
          merged = renameStepId(merged, neu0, wunsch);
          renames.push([neu0, wunsch]);
          neu = wunsch;
          break;
        }
        placed.push(neu);
      }
    }
    return { spec: merged, text, report, renames, placed };
  }, []);

  /**
   * Das Ergebnis übernehmen und das BPMN ablegen. Kommentare bleiben alle —
   * auch die an Stellen, die es nicht mehr gibt: die stehen im Panel unter
   * «Ohne Stelle», bis jemand sie erledigt.
   */
  const commitPlan = useCallback(async (next: ProcessSpec, text: string, r: MergeReport | null, renames: Array<[string, string]>, origin: AuditOrigin) => {
    for (const [alt, neu] of renames) setSelected(prev => (prev === alt ? neu : prev));
    const before = specRef.current;
    update(before ? { ...next, comments: rememberPlaces(before, next, allSteps(before.steps), allSteps(next.steps)) } : next, origin);
    setXml(text);
    if (r) setReport(r);
    const w = await saveBpmn(slug, text);
    if (!w.ok) setSaveState({ error: w.message });
  }, [update, saveBpmn, slug]);

  /**
   * `quiet`: Bericht nur bei Änderungen; `silent`: gar keiner (Pattern melden selbst).
   * `origin`: woher das Diagramm kommt — ohne ist es «Mit BPMN abgleichen» mit einer Datei.
   */
  const applyXml = useCallback(async (raw: string, from: string, quiet: boolean | 'silent' = false, origin?: AuditOrigin, pasted?: PastedElements) => {
    try {
      const plan = planXml(raw, from, DEFAULT_MERGE_STATUS, pasted);
      if (!plan) return;
      const r = plan.report;
      const show = !quiet || (quiet !== 'silent' && (r.added.length || r.removed.length || r.changed.length));
      const src = pasted?.spec?.source;
      const note = plan.placed.length && src
        ? `Eingefügt aus «${src.title || src.slug}»: ${plan.placed.length} ${plan.placed.length === 1 ? 'Element' : 'Elemente'}`
        : undefined;
      await commitPlan(plan.spec, plan.text, show ? r : null, plan.renames,
        { ...(origin ?? { source: 'bpmn-sync', note: `Mit BPMN abgleichen: ${from}` }), ...(note ? { note } : {}), report: bpmnReport(r) });
      if (plan.placed.length) {
        // Aus der anderen Engine kam nichts Technisches mit: Zuständigkeit,
        // Bedingungen und behandelte Fehler in der Form dieser Engine ins Diagramm
        const engine = plan.spec.engine;
        if (src && (src.engine ?? 'c7') !== (engine ?? 'c7')) {
          const byId = new Map(allSteps(plan.spec.steps).map(s => [s.id, s]));
          for (const id of plan.placed) {
            const s = byId.get(id);
            if (!s) continue;
            // behandelte Fehler nur, wo es welche ohne Boundary-Event gibt — sonst bliebe ein leeres ioMapping
            const held = (s.errors ?? []).some(e => e.code && (e.declared || !e.boundary)) || !!s.regexHandledErrors?.length;
            const patch: Partial<Step> = {
              ...Object.fromEntries(ASSIGNMENT_KEYS.filter(k => s[k]).map(k => [k, s[k]])),
              ...(s.branches ? { branches: s.branches } : {}),
              ...(held ? { errors: s.errors ?? [], regexHandledErrors: s.regexHandledErrors } : {}),
            };
            applyToBpmn(id, patch, undefined, bpmnRef.current, engine);
          }
        }
        setSelected(plan.placed[0]);
      }
    } catch (e) {
      setSaveState({ error: e instanceof Error ? e.message : String(e) });
    }
  }, [planXml, commitPlan]);

  // ── Kopieren ──────────────────────────────────────────────────────────────
  // Im Modeler kopiert (Ctrl+C): zum Baum von bpmn-js kommt, was nur in der
  // Spezifikation steht — eingefügt wird in diesem oder einem anderen Prozess.
  const copyDiagram = useCallback((ids: string[]) => {
    const cur = specRef.current;
    if (!cur) return;
    attachDiagramSpec(collectDiagram(cur, ids, { slug: cur.slug, title: cur.title || cur.name, engine: cur.engine }));
  }, []);
  const clip = useClipboard();

  // ── Pattern ───────────────────────────────────────────────────────────────
  // Ein Pattern wird direkt ins BPMN geschrieben — nicht erst beim Export.
  // Danach liest der Abgleich das Diagramm neu: so steht am Schritt, was im
  // Diagramm steht, und ein offener Modeler lädt das neue XML nach.
  const changePattern = useCallback(async (targetId: string | null, patternId: string, action: 'add' | 'remove' | 'update', params: Record<string, string> = {}, previous?: Record<string, string>) => {
    const x = xmlRef.current, cur = specRef.current, defs = modelRef.current?.patterns ?? [];
    const def = defs.find(d => d.id === patternId);
    if (!x || !cur || !def) {
      setNotice({ tone: 'warn', message: !x ? 'Pattern brauchen das Diagramm — zuerst ein BPMN laden.' : `Pattern «${patternId}» ist im Admin nicht (mehr) definiert.` });
      return;
    }
    const engine = cur.engine ?? 'c7';
    const r = action === 'add' ? applyPattern(x, def, engine, targetId, params)
      : action === 'remove' ? removePattern(x, def, engine, targetId, defs, params)
        : updatePattern(x, def, engine, targetId, params, defs, previous);
    if (!r.changed) { setNotice({ tone: 'warn', message: r.issues.join(' ') || 'Nichts geändert.' }); return; }
    const was = action === 'add' ? 'eingefügt' : action === 'remove' ? 'entfernt' : 'angepasst';
    await applyXml(r.xml, `Pattern ${def.name}`, 'silent', { source: 'manual', note: `Pattern «${def.name}» ${was}` });
    setNotice({ tone: r.issues.length ? 'warn' : 'info', message: [`Pattern «${def.name}» im Diagramm ${was}.`, ...r.issues].join(' ') });
  }, [applyXml]);

  // Pattern im Admin geändert (oder die Spezifikation stammt von vorher):
  // die Pattern-Angaben aus dem Diagramm nachziehen, sonst nichts
  const patternDefs = model?.patterns;
  const loaded = !!spec;
  useEffect(() => {
    const cur = specRef.current;
    if (!loaded || !xml || !cur) return;
    try {
      const next = syncPatterns(cur, importBpmn(xml, cur.slug, { patterns: patternDefs }).spec);
      if (next) update(next, { source: 'load', note: 'Pattern-Angaben aus dem Diagramm nachgezogen' });
    } catch { /* unlesbares BPMN — meldet der Abgleich */ }
  }, [loaded, xml, patternDefs, update]);

  // Engine wechseln: das umgewandelte Diagramm geht den Weg jeder Änderung —
  // der Abgleich liest Engine, Topics und Mappings daraus neu ein
  const convertEngine = useCallback(async (next: string | null, target: EngineId) => {
    const cur = specRef.current;
    if (!cur) return;
    const origin: AuditOrigin = { source: 'conversion', note: `In ${engineLabel(target)} umgewandelt` };
    if (next) await applyXml(next, engineLabel(target), 'silent', origin);
    else update({ ...cur, engine: target }, origin);
    setNotice({ tone: 'info', message: `In ${engineLabel(target)} umgewandelt.` });
  }, [applyXml, update]);

  // Ein Diagramm von vorher, dessen Prozess noch anders heisst als sein Pool:
  // einmal beim Öffnen angleichen (gespeichert wird es wie jede Änderung)
  const aligned = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || !xml || !canEdit || aligned.current === slug) return;
    aligned.current = slug;
    const next = alignPoolIds(xml);
    if (next.xml !== xml) void applyXml(next.xml, 'Pool', 'silent', { source: 'load', note: 'Prozess-ID und -Name an den Pool angeglichen' });
  }, [loaded, xml, canEdit, slug, applyXml]);

  // Die Prozess-ID hat ihr eigenes Feld (der Titel ist fachlich). Sie wird
  // beim Verlassen des Feldes übernommen — nur, wenn sie dem Muster
  // company-projekt-prozessVersion folgt; im Diagramm folgen Prozess-Name
  // und Pool (siehe poolIds.ts).
  const [idDraft, setIdDraft] = useState('');
  useEffect(() => { setIdDraft(spec?.processId ?? ''); }, [spec?.processId]);
  // gegen die bekannten company-projekt — ohne diese Spezifikation, sonst
  // bestätigte ein Tippfehler sich selbst
  const otherPrefixes = useMemo(
    () => knownPrefixes(model, specs.filter(s => s.slug !== slug).map(s => s.data.project)),
    [model, specs, slug]);
  const legacyId = !!spec?.legacyProcessId;
  const idProblem = idDraft.trim() ? checkProcessId(idDraft, otherPrefixes, legacyId) : null;
  // die Markierung nur dort anbieten, wo sie etwas ändert: die Konvention passt nicht (oder sie ist schon gesetzt)
  const offerLegacy = legacyId || (!!idDraft.trim() && !!checkProcessId(idDraft, [], false) && !checkProcessId(idDraft, [], true));
  const commitProcessId = () => {
    const cur = specRef.current, x = xmlRef.current;
    const id = idDraft.trim();
    if (!cur || !canEdit || id === (cur.processId ?? '') || checkProcessId(id, otherPrefixes, !!cur.legacyProcessId)?.level === 'error') return;
    if (x && cur.processId) {
      const next = renameProcess(x, cur.processId, id);
      if (next !== x) void applyXml(next, 'Prozess-ID', 'silent', { source: 'manual', note: `Prozess-ID geändert: ${cur.processId} → ${id}` });
      return;
    }
    // ohne Diagramm: nur die Spezifikation
    const m = /^(.*?)-([A-Za-z][A-Za-z0-9]*V\d+)$/.exec(id) ?? (cur.legacyProcessId ? /^(.*)-([^-]+)$/.exec(id) : null);
    update({ ...cur, processId: id, ...(m ? { project: m[1] } : {}) });
  };

  // Eine gewählte Datei geht nicht direkt hinein: erst die Vorschau mit
  // Domain, Datenmodell und Status — wie beim Anlegen
  const onFile = async (file: File) => {
    setSync({ raw: await file.text(), from: file.name });
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
                  title="Mit BPMN abgleichen — BPMN wählen: der Ablauf aus der Implementation, fachliche Texte bleiben"
                  className={`p-1 rounded border flex-shrink-0 ${c.btn}`}><SyncProcessIcon size={14} /></button>
                {xml && (
                  <button onClick={() => setSync({ raw: xml, from: 'Domain', mode: 'domain' })}
                    title="Mit Domain abgleichen — Klassen und Interaktionen aus der Domain, der Ablauf bleibt"
                    className={`p-1 rounded border flex-shrink-0 ${c.btn}`}><SyncDataIcon size={14} /></button>
                )}
                {clip.diagram && (() => {
                  const n = Object.keys(clip.diagram.spec?.steps ?? {}).length;
                  const src = clip.diagram.spec?.source;
                  const woher = !src ? '' : src.slug === slug ? ' aus diesem Prozess' : ` aus «${src.title || src.slug}»`;
                  const was = n ? `${n} ${n === 1 ? 'Schritt' : 'Schritte'}` : 'Diagramm-Elemente';
                  return (
                    <span title={`Zwischenablage: ${was}${woher}. Einfügen: ins Diagramm klicken, dann Ctrl+V (Mac ⌘V) und ablegen — mit Mappings, Beschreibung und Interaktion.`}
                      className={`flex items-center gap-1 text-[10px] pl-2 pr-1 py-1 rounded border flex-shrink-0 max-w-[16rem] ${c.border} ${c.muted2}`}>
                      <ClipboardPaste size={11} className="flex-shrink-0" />
                      <span className="truncate">{was}{woher}</span>
                      <button onClick={clearDiagramClip} title="Zwischenablage leeren" className={`p-0.5 rounded ${c.muted}`}><X size={10} /></button>
                    </span>
                  );
                })()}
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
          {/* Kommentare: Übersicht und Schrittfolge im Panel rechts */}
          {/* Änderungsprotokoll — für den gewählten Schritt, sonst für alles */}
          <button onClick={() => {
            if (auditOpen) { setAuditOpen(false); return; }
            setAuditFocus(tab === 'flow' && selected ? stepTarget(selected) : null);
            setAuditOpen(true); setCommentsOpen(false); setActiveComment(null);
          }}
            title={auditOpen ? 'Verlauf schliessen' : 'Verlauf — wer hat wann was geändert'}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border transition-colors flex-shrink-0 ${
              auditOpen ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10') : c.btn}`}>
            <History size={12} />
          </button>
          <button onClick={() => { setCommentsOpen(!commentsOpen); if (commentsOpen) setActiveComment(null); else setAuditOpen(false); }}
            title={commentsOpen ? 'Kommentare schliessen' : 'Alle Kommentare — Übersicht und Durchgehen'}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border transition-colors flex-shrink-0 ${
              commentsOpen
                ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10')
                : offeneKommentare
                  ? (isDark ? 'border-blue-500/40 text-blue-300 hover:bg-blue-500/10' : 'border-blue-300 text-blue-700 hover:bg-blue-50')
                  : c.btn}`}>
            <MessageSquare size={12} /> {offeneKommentare || ''}
          </button>
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
      {frameCss && <style>{frameCss}</style>}

      {/* Hinweis: fehlende Berechtigung, Teams gesendet … */}
      {notice && (
        <div className={`flex-shrink-0 flex items-center gap-2 text-[10px] px-3 py-1.5 border-b ${c.border} ${
          notice.tone === 'warn'
            ? (isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-800')
            : (isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-800')}`}>
          <span className="flex-1">{notice.message}</span>
          {notice.scopes && (
            <button onClick={() => void auth.requestConsent(notice.scopes!)}
              className={`flex-shrink-0 px-2 py-0.5 rounded border ${isDark ? 'border-amber-500/40 hover:bg-amber-500/10' : 'border-amber-400 hover:bg-amber-100'}`}>
              Zustimmung erteilen
            </button>
          )}
          <button onClick={() => setNotice(null)} className="flex-shrink-0 opacity-60 hover:opacity-100"><X size={10} /></button>
        </div>
      )}

      {sync && canEdit && (
        <SyncPanel raw={sync.raw} from={sync.from} mode={sync.mode} current={spec} model={model} isDark={isDark} plan={planXml}
          onClose={() => setSync(null)}
          onApply={p => {
            setSync(null);
            setShowDiagram(true);
            // fürs Protokoll: Ablauf und Datenmodell getrennt berichtet
            const teil = (head: string, r: AuditReport) => Object.fromEntries(Object.entries(r).map(([k, v]) => [`${head} ${k}`, v]));
            const origin: AuditOrigin = {
              source: sync.mode === 'domain' ? 'domain-sync' : 'bpmn-sync',
              note: sync.mode === 'domain' ? 'Mit Domain abgleichen' : `Mit BPMN abgleichen: ${sync.from}`,
              report: { ...teil('Ablauf', bpmnReport(p.report)), ...(p.domain ? teil('Datenmodell', domainReport(p.domain)) : {}) },
            };
            // alle Felder der Services als Zeilen, Pflicht-Eingaben angehakt — wie beim Anlegen
            void commitPlan(withServiceRows(p.spec, model).spec, p.text, p.report, p.renames, origin);
          }} />
      )}

      {report && (
        <div className={`flex-shrink-0 text-[10px] px-3 py-1.5 border-b ${c.border} ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
          <div className="flex items-center gap-2">
            <span className={c.muted2}>
              Abgleich: {report.kept} behalten · {report.added.length} neu · {report.changed.length} geändert
              {report.renamed.length ? ` · ${report.renamed.length} umbenannt` : ''} · {report.removed.length} entfallen
              {report.confirmed.length ? ` · ${report.confirmed.length} bestätigt` : ''}
            </span>
            <button onClick={() => setReport(null)} className={`ml-auto ${c.muted}`}><X size={10} /></button>
          </div>
          {[...report.added.map(n => `+ ${n}`), ...report.changed.map(n => `~ ${n}`),
            ...report.renamed.map(n => `✎ ${n}`), ...report.removed.map(n => `− ${n}`), ...report.confirmed.map(n => `✓ ${n}`)]
            .slice(0, 8).map((l, i) => <div key={i} className={`font-mono ${c.muted}`}>{l}</div>)}
        </div>
      )}

      {/* ── Inhalt ─────────────────────────────────────────────────────────── */}
      <CommentsContext.Provider value={commentsCtx}>
      <div className="flex-1 flex min-h-0 relative">
        {tab === 'flow' ? (
          <>
            {/* links: Diagramm über dem Ablauf */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              {showDiagram && xml && (
                <div className={`flex-shrink-0 border-b ${c.border} relative`} style={{ height }}>
                  <Suspense fallback={<div className={`h-full flex items-center justify-center text-xs ${c.muted}`}>Modeler wird geladen …</div>}>
                    <BpmnEditor xml={xml} isDark={isDark} canEdit={canEdit} engine={spec.engine}
                      onChange={(text, pasted) => { void applyXml(text, 'Diagramm', true, { source: 'manual', note: 'Im Diagramm geändert' }, pasted); }}
                      onCopy={copyDiagram}
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
                  findings={findings}
                  interactionOf={id => (spec.interactions ?? []).find(i => i.stepId === id) ?? null}
                  serviceOf={s => catalogEntry(s, model)}
                  processId={spec.processId ?? ''}
                  hasCatalog={!!model?.services?.length}
                  patternName={id => model?.patterns?.find(d => d.id === id)?.name ?? id}
                  onOpenInteraction={ia => { setFocusType(ia.inTypeId ?? ia.outTypeId ?? null); setTab('model'); }} />
                {!spec.steps.length && (
                  <p className={`text-xs ${c.muted}`}>
                    Noch kein Ablauf — «Mit BPMN abgleichen» übernimmt die Struktur aus der Implementation.
                  </p>
                )}
              </div>
            </div>

            {/* rechts: Titel und Filter über den Eigenschaften — die Breite
                lässt sich an der Trennlinie ziehen */}
            <div style={{ width: (commentsOpen || auditOpen) && !narrow ? Math.max(360, panelW - commentsW + 120) : panelW }}
              className={`relative flex-shrink-0 border-l ${c.border} ${c.panel} flex flex-col min-h-0`}>
              <PanelWidthHandle isDark={isDark} width={panelW} onWidth={w => {
                setPanelW(w);
                localStorage.setItem(PANEL_W_KEY, String(w));
              }} />
              <div className={`flex-shrink-0 px-4 py-3 border-b ${c.border}`}>
                <div data-cframe={processTarget} className="flex items-center gap-2">
                  <input value={spec.title} disabled={!canEdit}
                    onChange={e => update({ ...spec, title: e.target.value })}
                    placeholder="Fachlicher Titel"
                    title="Fachlicher Titel"
                    className={`flex-1 min-w-0 bg-transparent outline-none text-base font-semibold ${c.text} disabled:opacity-100`} />
                  <CommentBubble target={processTarget} title="Kommentare zum Prozess" />
                </div>
                <input value={idDraft} disabled={!canEdit}
                  onChange={e => setIdDraft(e.target.value.trim())}
                  onBlur={commitProcessId}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setIdDraft(spec.processId ?? '');
                  }}
                  placeholder="company-projekt-prozessV1"
                  title="Prozess-ID: company-projekt-prozessVersion, z. B. globex-savings-openSavingsV1"
                  className={`mt-1 w-full font-mono text-[11px] px-1.5 py-0.5 rounded border outline-none bg-transparent disabled:opacity-100 ${
                    idProblem?.level === 'error' ? (isDark ? 'border-rose-500/60 text-rose-300' : 'border-rose-400 text-rose-700')
                      : idProblem ? (isDark ? 'border-amber-500/60 text-amber-300' : 'border-amber-400 text-amber-800')
                        : `${c.border2} ${c.text}`}`} />
                {idProblem && (
                  <div className={`mt-0.5 text-[10px] ${idProblem.level === 'error'
                    ? (isDark ? 'text-rose-400' : 'text-rose-600') : (isDark ? 'text-amber-400' : 'text-amber-700')}`}>
                    {idProblem.text}{idProblem.level === 'error' && idDraft !== (spec.processId ?? '') ? ' Nicht übernommen.' : ''}
                  </div>
                )}
                {offerLegacy && (
                  <label className={`mt-0.5 flex items-center gap-1 text-[10px] ${c.muted2}`}
                    title="Ein bestehender Prozess, dessen ID der Konvention company-projekt-prozessVersion nicht folgt und so bleiben muss — die Prüfung entfällt">
                    <input type="checkbox" checked={legacyId} disabled={!canEdit}
                      onChange={e => {
                        const cur = specRef.current;
                        if (!cur) return;
                        update({ ...cur, legacyProcessId: e.target.checked || undefined });
                      }} />
                    alter Name — ohne Namenskonvention
                  </label>
                )}
                <div className={`flex items-center gap-2 mt-1 text-[10px] ${c.muted}`}>
                  {spec.project && <span className="font-mono opacity-70 truncate">{spec.project}</span>}
                  {canEdit
                    ? <button onClick={() => setEngineOpen(true)} title={`In ${engineLabel((spec.engine ?? 'c7') === 'c7' ? 'c8' : 'c7')} umwandeln …`}
                        className="flex-shrink-0 opacity-70 hover:opacity-100 hover:underline">· {engineLabel(spec.engine)}</button>
                    : spec.engine && <span className="flex-shrink-0 opacity-70">· {engineLabel(spec.engine)}</span>}
                  <span className="flex-shrink-0">· {spec.updatedAt.slice(0, 10)}</span>

                </div>

                <div className={`flex items-center gap-1 mt-2 px-2 py-1 rounded border ${c.border2}`}>
                  <Search size={11} className={c.muted} />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Schritt, Objekt, Service, Text …"
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
                    {/* Befunde: nur die Schritte mit Dreieck — rot, wenn Fehler dabei sind */}
                    {findings.size > 0 && (() => {
                      const errs = [...findings.values()].filter(f => f.errors.length).length;
                      const tone = errs
                        ? (isDark ? 'border-rose-500/30 bg-rose-500/15 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700')
                        : (isDark ? 'border-amber-500/30 bg-amber-500/15 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700');
                      return (
                        <button onClick={() => setFindingsOnly(v => !v)}
                          title={`${findings.size} Schritte mit Befund${errs ? `, davon ${errs} mit Fehlern` : ''} — nur diese zeigen`}
                          className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border transition-opacity ${tone} ${
                            !findingsOnly && (statusFilter) ? 'opacity-30' : ''} ${findingsOnly ? 'ring-1 ring-current' : ''}`}>
                          <AlertTriangle size={9} /> {findings.size}
                        </button>
                      );
                    })()}
                    {(statusFilter || findingsOnly) && (
                      <button onClick={() => { setStatusFilter(null); setFindingsOnly(false); }} className={`text-[9px] ${c.muted} hover:underline`}>
                        Filter aus
                      </button>
                    )}
                  </div>
                )}
                <p className={`text-[9px] mt-1 ${c.muted}`}>
                  Klick auf einen Status filtert den Ablauf · <AlertTriangle size={8} className="inline -mt-0.5" /> nur Schritte mit Befund
                </p>
              </div>

              <StepDetail step={selectedStep} spec={spec}
                isDark={isDark} canEdit={canEdit} model={model}
                onPatch={patchStep} onSyncId={syncStepId} onClose={() => setSelected(null)} onGoto={setSelected}
                projectPrefixes={projectPrefixes} onRenameProject={renameProject}
                onSpecChange={next => {
                  if (next.timeToLive !== spec.timeToLive) {
                    bpmnRef.current?.setProps(null, { 'camunda:historyTimeToLive': next.timeToLive || undefined });
                  }
                  update(next);
                }}
                onEditType={id => { setFocusType(id); setTab('model'); }}
                onPattern={canEdit ? (target, id, action, params, previous) => { void changePattern(target, id, action, params, previous); } : undefined}
                hasDiagram={!!xml} />
            </div>
          </>
        ) : (
          <div className="flex-1 min-w-0 min-h-0">
            <TypeBuilder spec={spec} isDark={isDark} canEdit={canEdit} model={model} onChange={update}
              focusTypeId={focusType} onFocused={() => setFocusType(null)}
              focusIaId={focusIa} onFocusedIa={() => setFocusIa(null)} />
          </div>
        )}
        {auditOpen && !commentsOpen && (
          <AuditPanel slug={slug} version={version} spec={spec} isDark={isDark} load={loadAudit}
            focus={auditFocus} onFocus={setAuditFocus} onGoto={gotoTarget}
            onClose={() => setAuditOpen(false)}
            width={commentsW} overlay={narrow}
            onWidth={w => { setCommentsW(w); localStorage.setItem(COMMENTS_W_KEY, String(w)); }} />
        )}
        {commentsOpen && (
          <CommentsPanel spec={spec} isDark={isDark} targets={targets}
            active={activeComment} showResolved={showResolved} onToggleResolved={setShowResolved}
            onSelect={selectComment}
            onClose={() => { setCommentsOpen(false); setActiveComment(null); }}
            canEdit={canEdit} author={author} onChange={update}
            users={mentionUsers} searchUsers={searchDirectory} onDirectoryProblem={onDirectoryProblem}
            teamsEnabled={teamsSettings?.enabled === true}
            width={commentsW} overlay={narrow}
            onWidth={w => { setCommentsW(w); localStorage.setItem(COMMENTS_W_KEY, String(w)); }} />
        )}
      </div>
      </CommentsContext.Provider>

      {engineOpen && <EngineDialog spec={spec} bpmn={xml ?? ''} isDark={isDark} onClose={() => setEngineOpen(false)}
        onConvert={(next, target) => { setEngineOpen(false); void convertEngine(next, target); }} />}
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
// ── Baum ─────────────────────────────────────────────────────────────────────
interface ListProps {
  steps: Step[];
  depth: number;
  isDark: boolean;
  /** Befunde je Schritt-ID — Fehler rot, Warnungen orange (siehe findings.ts) */
  findings: Map<string, Finding>;
  /** die Interaktion eines Schritts — eigener Vertrag, im Baum hervorgehoben */
  interactionOf: (id: string) => Interaction | null;
  /** Katalog-Eintrag eines fremden Services — teal; fehlt er, rot */
  serviceOf: (step: Step) => ServiceDef | null;
  /** springt ins Datenmodell zur Interaktion */
  onOpenInteraction: (ia: Interaction) => void;
  /** die eigene Prozess-ID — trennt eigene Worker von fremden Services */
  processId: string;
  /** gibt es überhaupt einen Katalog? Ohne ihn ist ein fehlender Eintrag kein Befund */
  hasCatalog: boolean;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  byId: Map<string, Step>;
  matches: (s: Step) => boolean;
  filterActive: boolean;
  onStatus?: (id: string, s: Status) => void;
  /** Anzeigename eines Patterns (aus dem Admin) */
  patternName: (id: string) => string;
}

/**
 * Was ein Pattern ins Diagramm bringt — Timer, Link, gemeinsamer Block —
 * ist Verdrahtung, keine Fachlichkeit. Im Baum steht es deshalb als eine
 * Zeile in der Pattern-Farbe; die Schritte darunter erst auf Klick.
 */
function PatternFold({ pattern, what, steps, p }: { pattern: string; what: string; steps: Step[]; p: ListProps }) {
  const c = cls(p.isDark);
  const [open, setOpen] = useState(false);
  // steckt das gewählte Element darin, geht die Zeile auf — sonst sähe man es nicht
  const holdsSelected = useMemo(() => !!p.selected && allSteps(steps).some(s => s.id === p.selected), [steps, p.selected]);
  useEffect(() => { if (holdsSelected) setOpen(true); }, [holdsSelected]);
  const n = countSteps(steps);
  return (
    <div className={`ml-6 pl-3 border-l-2 border-dashed ${p.isDark ? 'border-fuchsia-500/40' : 'border-fuchsia-300'}`}>
      <button onClick={() => setOpen(!open)} title={open ? 'Verdrahtung ausblenden' : 'Verdrahtung zeigen'}
        className={`w-full flex items-center gap-1.5 py-1 text-[10px] text-left ${p.isDark ? 'text-fuchsia-300' : 'text-fuchsia-800'}`}>
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Puzzle size={10} />
        <span className="font-semibold">{p.patternName(pattern)}</span>
        <span className={c.muted}>· {what}</span>
        <span className={`ml-auto flex items-center gap-1.5 ${c.muted}`}>
          {!open && (() => { const f = nestedFindings(steps, p.findings); return <FindingCount errors={f.errors} warnings={f.warnings} title={f.texts.join('\n')} isDark={p.isDark} />; })()}
          {n} Schritt{n === 1 ? '' : 'e'}
        </span>
      </button>
      {open && <StepList {...p} steps={steps} depth={p.depth + 1} />}
    </div>
  );
}

/**
 * Die Schritte einer Ebene — eigene Blöcke (zweiter Start, Link-Ziel) in
 * einer Klammer: der Block beginnt beim Schritt mit `orphan` und reicht
 * bis zum nächsten. Ein Ereignis-Subprozess hat seine Klammer schon selbst.
 */
function StepList(p: ListProps) {
  const c = cls(p.isDark);
  const groups = blockGroups(p.steps.filter(s => !p.filterActive || p.matches(s)));
  return (
    <div className="flex flex-col">
      {groups.map(g => {
        if (!g.head) return g.steps.map(s => <StepRow key={s.id} step={s} {...p} />);
        const start = blockStart(g.head);
        if (g.head.pattern) {
          return (
            <div key={g.head.id} className="mt-2 -ml-6">
              <PatternFold pattern={g.head.pattern} what={`gemeinsamer Block · ${start}`} steps={g.steps} p={p} />
            </div>
          );
        }
        const n = countSteps(g.steps);
        return (
          <div key={g.head.id} className={`mt-2 pl-3 border-l-2 ${p.isDark ? 'border-slate-500/40' : 'border-slate-300'}`}>
            <div className={`flex items-center gap-1.5 py-1 text-[10px] ${p.isDark ? 'text-slate-300' : 'text-slate-600'}`}
              title="Eigener Block: läuft neben dem Hauptablauf, mit eigenem Einstieg">
              <Unlink size={10} />
              <span className="font-semibold">Eigener Block</span>
              <span className={c.muted}>· {start}</span>
              <span className={`ml-auto ${c.muted}`}>{n} Schritt{n === 1 ? '' : 'e'}</span>
            </div>
            {g.steps.map(s => <StepRow key={s.id} step={s} {...p} />)}
          </div>
        );
      })}
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

  const ia = p.interactionOf(step.id);
  const finding = p.findings.get(step.id) ?? null;
  // fremder Service: Katalog-Kennung oder Topic — nicht der eigene Worker, nicht der Init-Worker
  const foreign = !ia && (step.serviceId || step.topic) && step.topic !== p.processId ? (step.serviceId ?? step.topic ?? '') : '';
  const svc = foreign ? p.serviceOf(step) : null;
  const hasCatalog = p.hasCatalog;
  // Ereignisse, Start und Ende sind Verdrahtung — leise
  const quiet = step.kind === 'event' || step.kind === 'start' || step.kind === 'end';
  return (
    <div className="flex flex-col">
      <div data-step={step.id} data-cframe-base={stepTarget(step.id)} onClick={() => p.onSelect(step.id)}
        className={`group flex items-center gap-2 py-1 pr-2 rounded cursor-pointer ${c.hover} ${
          isSelected ? (p.isDark ? 'bg-white/10' : 'bg-black/10') : step.kind === 'gateway' ? (p.isDark ? 'bg-white/[0.03]' : 'bg-black/[0.03]') : ''}`}>
        <button onClick={e => { e.stopPropagation(); if (hasChildren) p.toggle(step.id); }}
          className={`w-4 flex-shrink-0 ${hasChildren ? c.muted2 : 'opacity-0 pointer-events-none'}`}>
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <Icon size={12} className={`flex-shrink-0 ${quiet ? c.muted : c.muted2}`} />
        <span className={`text-xs truncate ${quiet ? c.muted2 : c.text} ${step.kind === 'gateway' ? 'italic' : ''} ${ia ? 'font-semibold' : ''}`}>{step.name}</span>
        {/* Eigener Vertrag: das Objekt als Chip, klickbar ins Datenmodell */}
        {ia && (
          <button onClick={e => { e.stopPropagation(); p.onOpenInteraction(ia); }}
            title={`${INTERACTION_META[ia.kind].label} «${ia.name}» — zum Datenmodell`}
            className={`hidden md:inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[14rem] ${
              p.isDark ? 'border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20' : 'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100'}`}>
            {ia.name}
          </button>
        )}
        {/* Pattern am Schritt */}
        {step.patterns?.map((pt, i) => (
          <span key={`${pt.id}-${i}`} className="hidden md:inline-flex"><PatternChip name={p.patternName(pt.id)} params={pt.params} isDark={p.isDark} /></span>
        ))}
        {/* Fremder Service: die Katalog-Kennung — teal, wenn der Katalog ihn kennt, sonst rot */}
        {!ia && foreign && (
          <span title={svc ? `${svc.name} — im Katalog` : `«${foreign}» steht nicht im Katalog`}
            className={`hidden md:inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[16rem] ${
              svc || !hasCatalog
                ? (p.isDark ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-teal-300 bg-teal-50 text-teal-800')
                : (p.isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700')}`}>
            <Plug size={9} className="flex-shrink-0" />{foreign}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {/* Befund: rot = Fehler, orange = Warnung — die ersten Meldungen im Tooltip.
              Zugeklappt zählen die Befunde der Schritte darunter mit, sonst sähe man sie nicht */}
          {(() => {
            const below = hasChildren && !isOpen ? nestedFindings(stepsBelow(step), p.findings) : { errors: 0, warnings: 0, texts: [] };
            const own = { errors: finding?.errors.length ?? 0, warnings: finding?.warnings.length ?? 0 };
            const texts = [...(finding ? [...finding.errors, ...finding.warnings] : []).slice(0, 4), ...below.texts].slice(0, 6);
            const nBelow = below.errors + below.warnings;
            return <FindingCount errors={own.errors + below.errors} warnings={own.warnings + below.warnings} isDark={p.isDark}
              title={`${texts.join('\n')}${nBelow ? `\n— davon ${nBelow} in den Schritten darunter (zugeklappt)` : ''}`} />;
          })()}
          {step.description && <span className={`text-[9px] ${c.muted}`} title="fachlich beschrieben">✎</span>}
          {/* Kommentare am Schritt samt seiner Teile — ohne erst beim Überfahren */}
          <CommentBubble target={stepTarget(step.id)} aggregate quiet />
          <BlockChip step={step} isDark={p.isDark} />
          <LoopChip step={step} isDark={p.isDark} />
          {!!step.errors?.filter(e => !e.side && !e.pattern).length && <ErrorChip n={step.errors.filter(e => !e.side && !e.pattern).length} isDark={p.isDark} />}
          <StatusChip status={step.status} isDark={p.isDark} muted={step.status === 'implemented'}
            onClick={p.onStatus ? () => p.onStatus!(step.id, nextStatus(step.status)) : undefined} />
        </div>
      </div>

      {isOpen && hasChildren && (
        <div className="flex flex-col">
          {/* Verzweigungen */}
          {step.branches?.map((b, i) => <BranchBlock key={b.id} branch={b} index={i} gatewayId={step.id} {...p} />)}

          {/* Fehler- und Nebenpfade */}
          {step.errors?.filter(e => e.steps?.length && e.pattern).map(e => (
            <PatternFold key={e.code} pattern={e.pattern!} what={e.side ? `Nebenpfad «${e.code}»` : `Fehler «${e.code}»`} steps={e.steps!} p={p} />
          ))}
          {step.errors?.filter(e => e.steps?.length && !e.pattern).map(e => (
            <div key={e.code} className={`ml-6 pl-3 border-l-2 ${
              e.side
                ? (p.isDark ? 'border-indigo-500/40' : 'border-indigo-400')
                : (p.isDark ? 'border-white/20' : 'border-black/20')}`}>
              <div className={`flex items-center gap-1.5 py-1 text-[10px] ${
                e.side
                  ? (p.isDark ? 'text-indigo-300' : 'text-indigo-700')
                  : (p.isDark ? 'text-white/60' : 'text-black/60')}`}>
                {e.side ? <GitFork size={10} /> : <ShieldCheck size={10} />}
                <span className="font-semibold">{e.side ? 'Nebenpfad' : 'Fehler'}</span> «{e.code}»
                {!e.side && e.interrupting === false && <span className={c.muted}>· nicht unterbrechend</span>}
                <span className={`ml-auto ${c.muted}`}>{countSteps(e.steps)} Schritt{countSteps(e.steps) === 1 ? '' : 'e'}</span>
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

function BranchBlock({ branch, index, gatewayId, ...p }: ListProps & { branch: Branch; index: number; gatewayId: string }) {
  const c = cls(p.isDark);
  const col = BRANCH_COLORS[index % BRANCH_COLORS.length];
  const tint = p.isDark ? col.dark : col.light;
  // Die Bedingung als FEEL, ohne das «=» davor — gekürzt, ganz im Tooltip
  const cond = branch.condition ? branch.condition.replace(/^\s*=\s*/, '') : '';
  const n = countSteps(branch.steps);
  return (
    <div className={`ml-6 pl-3 border-l-2 ${tint.split(' ')[0]}`}>
      <div data-cframe={sub(stepTarget(gatewayId), `branch:${branch.id}`)}
        className={`group flex items-center gap-1.5 py-1 text-[10px] ${tint.split(' ')[1]}`}>
        {/* Zweig-Kopf: Beschriftung als Chip in der Zweigfarbe, Standardzweig gestrichelt */}
        <span className={`px-1.5 py-0.5 rounded border font-semibold ${tint.split(' ')[0]} ${branch.isDefault ? 'border-dashed' : ''}`}>
          {branch.label}
        </span>
        {branch.isDefault && <span className={c.muted}>Standard</span>}
        {cond && (
          <span className={`font-mono truncate max-w-[24rem] ${c.muted}`} title={branch.condition}>
            <span className="opacity-60">wenn </span>{cond}
          </span>
        )}
        <span className={`ml-auto flex-shrink-0 ${c.muted}`}>{n ? `${n} Schritt${n === 1 ? '' : 'e'}` : 'direkt weiter'}</span>
        <CommentBubble target={sub(stepTarget(gatewayId), `branch:${branch.id}`)} quiet />
      </div>
      {!!branch.steps.length && <StepList {...p} steps={branch.steps} depth={p.depth + 1} />}
    </div>
  );
}

/** Schritte eines Blocks — ohne Rücksprünge, über alle Ebenen. */
const countSteps = (steps: Step[] | undefined): number => allSteps(steps).filter(s => s.kind !== 'goto').length;

/** Befunde in den Schritten darunter (alle Ebenen) — für Zeilen, die zugeklappt sind */
function nestedFindings(steps: Step[] | undefined, findings: Map<string, Finding>): { errors: number; warnings: number; texts: string[] } {
  let errors = 0, warnings = 0;
  const texts: string[] = [];
  for (const s of allSteps(steps)) {
    const f = findings.get(s.id);
    if (!f) continue;
    errors += f.errors.length; warnings += f.warnings.length;
    for (const t of [...f.errors, ...f.warnings]) if (texts.length < 4) texts.push(`${s.name}: ${t}`);
  }
  return { errors, warnings, texts };
}
/** die Schritte unter einem Schritt — Zweige, Fehler- und Nebenpfade, Subprozess */
const stepsBelow = (step: Step): Step[] =>
  [...(step.branches ?? []).flatMap(b => b.steps), ...(step.errors ?? []).flatMap(e => e.steps ?? []), ...(step.children ?? [])];

/** Dreieck mit Zahl: rot bei Fehlern, sonst orange */
function FindingCount({ errors, warnings, title, isDark }: { errors: number; warnings: number; title: string; isDark: boolean }) {
  if (!errors && !warnings) return null;
  return (
    <span title={title}
      className={`flex items-center gap-0.5 text-[9px] ${errors ? (isDark ? 'text-rose-400' : 'text-rose-600') : (isDark ? 'text-amber-400' : 'text-amber-600')}`}>
      <AlertTriangle size={10} />{errors + warnings}
    </span>
  );
}
