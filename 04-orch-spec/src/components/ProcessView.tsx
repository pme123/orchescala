// The process view: on the left the flow as a collapsible tree, on the right the
// details of the selected step.
//
// The tree is the core of the PoC — branches as coloured, labelled
// paths, loops and error paths visible, details collapsed
// by default. Changes are saved automatically (as in arch-review).
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { projectColor } from '../projects';
import {
  ChevronDown, ChevronRight, ChevronLeft, Download, RefreshCw, Search, X, Minimize2, Maximize2, Plug,
  AlertTriangle, ShieldCheck, GitFork, Zap, Repeat, CornerDownRight, Save, Braces, ListTree, Workflow, GripHorizontal, Unlink,
  MessageSquare, Puzzle, History, Database, ClipboardPaste, Loader2, Sparkles,
} from 'lucide-react';
import { useStore } from '../store';
import { useAuth, useAuthor, usePermissions } from '../auth';
import { collectFindings, withServiceRows, type Finding } from '../findings';
import { catalogEntry, healLooseTypes } from '../interactions';
import { baseOf, commentTargets, countIndex, locate, markNotified, processTarget, rememberPlaces, stepTarget, sub, threadOf } from '../comments';
import { TEAMS_SCOPES } from '../teams';
import { DIRECTORY_SCOPES, type DirectorySearchResult } from '../store';
import { useTeamsNotify } from './useTeamsNotify';
import { engineExpression, type JuelOptions } from '../feelJuel';
import { juelOptions } from '../feel';
import { dataBelow, overallStatus, startClasses, statusParts, stepStatuses, withDataStatus } from '../status';
import { ASSIGNMENT_KEYS, DEFAULT_MERGE_STATUS, allSteps, blockGroups, blockStart, boundaryLabel, isEventBoundary, healJuel, importBpmn, mergeSpec, syncBoundaryEvents, syncCorrelationKeys, syncPatterns, syncTimers, type MergeReport, type MergeStatus } from '../bpmn';
import { applyPattern, endVariables, removePattern, updatePattern, withEndOutFields } from '../patterns';
import { conventionalId, derivable, knownPrefixes, renameIdInXml, renamePrefix, renamePrefixInXml, renameStepId } from '../stepIds';
import { conversionNote, engineLabel } from '../engineLabels';
import { alignPoolIds, checkProcessId, poolNames, renameProcess } from '../poolIds';
import { INTERACTION_META, STATUSES, STATUS_META, type Branch, type EngineId, type Interaction, type ProcessSpec, type ServiceDef, type Status, type Step } from '../types';
import { BlockChip, BRANCH_COLORS, ErrorChip, KIND_LABEL, LoopChip, PanelWidthHandle, PatternChip, StatusChip, cls, patternTone, stepIcon } from '../ui';
import { nowIsoWithTimezone } from '../util';
import { bpmnReport, domainReport, makeEntry, type AuditEntry, type AuditOrigin, type AuditReport } from '../audit';
import { findProjectDmns, saveProjectDmns, withDmnFiles } from '../dmnProject';
import EngineDialog from './EngineDialog';
import ExportDialog from './ExportDialog';
import { CommentBubble, CommentsContext, CommentsPanel } from './Comments';
import StepDetail from './StepDetail';
import TypeBuilder from './TypeBuilder';
import { SyncDataIcon, SyncProcessIcon } from './SyncIcons';
import AuditPanel from './AuditPanel';
import { useAiKey } from '../ai/key';
import type { ProcessDraft } from '../ai/processTools';
import type { AcceptOutcome } from '../ai/AiChat';
import SyncPanel from './SyncPanel';
import type { BpmnHandle } from './BpmnEditor';
import { attachDiagramSpec, clearDiagramClip, useClipboard, type PastedElements } from '../clipboard';
import { collectDiagram, overlayPasted } from '../copyPaste';

// The modeler is big — it is only loaded once the diagram is shown.
const BpmnEditor = lazy(() => import('./BpmnEditor'));
// the chat of the AI mode with the Anthropic SDK - only loaded with a key
const ProcessAiPanel = lazy(() => import('../ai/ProcessAiPanel').then(m => ({ default: m.ProcessAiPanel })));

/** The same process apart from the time of the last change (a draft against the state now). Usually the
  * same object; after a reload the JSON - a false «changed» only refuses an accept, it never overwrites. */
const sameSpec = (a: ProcessSpec, b: ProcessSpec) =>
  a === b || JSON.stringify({ ...a, updatedAt: undefined }) === JSON.stringify({ ...b, updatedAt: undefined });

const HEIGHT_KEY = 'orch-spec.diagramHeight';
const PANEL_W_KEY = 'orch-spec.panelWidth';
const COMMENTS_W_KEY = 'orch-spec.commentsWidth';
/** below this the comment panel overlays the right column instead of taking space */
const OVERLAY_BELOW = 1100;

interface Props {
  slug: string;
  onBack: () => void;
  /** Deep link: open the comment panel at the location of this comment */
  focusCommentId?: string;
  /** open at this step (from a page for a user task) */
  focusStepId?: string;
  /** to a page of the app (from a user task) */
  onOpenPage?: (pageSlug: string) => void;
}

/** Explain the Entra search once per session, not on every «@». */
let directoryWarned = false;

/** Attribute value for a CSS selector. */
const cssAttr = (s: string) => s.replace(/["\\]/g, '\\$&');

// All step IDs that have children (for «alles ein-/ausklappen»)
/** Key of a pattern block in the tree (PatternFold) — via its first step */
const foldKey = (steps: Step[]) => `fold:${steps[0]?.id ?? ''}`;

/** The pattern blocks in the tree: shared blocks (steps with `pattern`) and error paths of a pattern */
function foldIds(steps: Step[], out: string[] = []): string[] {
  for (const s of steps) {
    if (s.pattern) out.push(foldKey([s]));
    for (const e of s.errors ?? []) if (e.pattern && e.steps?.length) out.push(foldKey(e.steps));
    for (const b of s.branches ?? []) foldIds(b.steps, out);
    for (const e of s.errors ?? []) foldIds(e.steps ?? [], out);
    foldIds(s.children ?? [], out);
  }
  return out;
}

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
 * For every step its ancestors — the only way to show a step
 * that sits in a collapsed branch.
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

// What the business department sets here also belongs in the BPMN — otherwise
// the next sync with the file overwrites it again.
const applyToBpmn = (id: string, patch: Partial<Step>, before: Step | undefined, bpmn: BpmnHandle | null, engine?: EngineId, juel: JuelOptions = {}) => {
  if (!bpmn) return;
  // Assignment: FEEL in the specification, in the diagram in the form of the engine
  const assignment = ASSIGNMENT_KEYS.filter(k => k in patch);
  if (assignment.length) {
    bpmn.setAssignment(id, Object.fromEntries(assignment.map(k =>
      [k, patch[k]?.trim() ? engineExpression(patch[k], engine, juel).text : undefined])), engine);
  }
  if (patch.branches) {
    const alt = new Map((before?.branches ?? []).map(b => [b.id, b]));
    for (const b of patch.branches) {
      const old = alt.get(b.id);
      if (old?.label !== b.label) bpmn.setProps(b.id, { name: b.label });
      // in the form of the engine — a raw `= …` would be a fixed text in Camunda 7
      if (old?.condition !== b.condition) bpmn.setCondition(b.id, b.condition?.trim() ? engineExpression(b.condition, engine, juel).text : undefined);
    }
  }
  if (patch.errors || 'regexHandledErrors' in patch) {
    // `_handledErrors` lists what does **not** hang on the boundary event alone:
    // the ones already declared and the ones newly entered here.
    const held = (patch.errors ?? before?.errors ?? []).filter(e => e.code && (e.declared || !e.boundary));
    const regex = 'regexHandledErrors' in patch ? patch.regexHandledErrors : before?.regexHandledErrors;
    bpmn.setHandledErrors(id, held.map(e => e.code), (regex ?? []).map(r => r.trim()).filter(Boolean), engine);
  }
};

export default function ProcessView({ slug, onBack, focusCommentId, focusStepId, onOpenPage }: Props) {
  const { isDark, model, specs, loadSpec, saveSpec, loadAudit, loadBpmn, saveBpmn, saveDmn, knownUsers, searchDirectory, storage } = useStore();
  const auth = useAuth();
  const { canEdit: mayEdit } = usePermissions();
  // ── AI mode (E19, E20, stage B): only with a key. While Claude's draft is open, the view shows it
  // (diagram and flow) read only - until the RE accepts or discards it
  const aiKey = useAiKey();
  const [aiDraft, setAiDraft] = useState<ProcessDraft | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  /** the state before the last accepted draft - for undo, as long as nothing else changed */
  const [aiUndo, setAiUndo] = useState<{ spec: ProcessSpec; xml: string; acceptedSpec: ProcessSpec | null; acceptedXml: string } | null>(null);
  // deleting the key turns the AI off at once - the draft is gone too
  // the same without the right to edit (another role after a new login): the panel is gone, so is the draft
  useEffect(() => { if (!aiKey || !mayEdit) { setAiDraft(null); setAiOpen(false); } }, [aiKey, mayEdit]);
  const canEdit = mayEdit && !aiDraft;
  const author = useAuthor();
  const authorRef = useRef(author);
  authorRef.current = author;
  /** Notice above the content — e.g. missing permission for Teams */
  const [notice, setNotice] = useState<{ message: string; tone: 'info' | 'warn'; scopes?: string[] } | null>(null);
  const c = cls(isDark);

  const [spec, setSpec] = useState<ProcessSpec | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  /** only steps with findings (red or orange triangle) */
  const [findingsOnly, setFindingsOnly] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [engineOpen, setEngineOpen] = useState(false);
  const [saveState, setSaveState] = useState<{ at: string } | { error: string } | null>(null);
  const [report, setReport] = useState<MergeReport | null>(null);
  /** selected BPMN waiting in the preview («Mit BPMN abgleichen») */
  const [sync, setSync] = useState<{ raw: string; from: string; mode?: 'bpmn' | 'domain' } | null>(null);
  const [tab, setTab] = useState<'flow' | 'model'>('flow');
  /** Jump from the flow into the data model — this type is shown there */
  const [focusType, setFocusType] = useState<string | null>(null);
  /** Jump from the comments to an interaction in the data model */
  const [focusIa, setFocusIa] = useState<string | null>(null);
  /** Comment panel: open? which location? (null = overview) */
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  /** Change log: open? for which element? (null = all) */
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditFocus, setAuditFocus] = useState<string | null>(null);
  const [xml, setXml] = useState<string | null>(null);
  const xmlRef = useRef<string | null>(null);
  xmlRef.current = xml;
  const [showDiagram, setShowDiagram] = useState(false);
  const [height, setHeight] = useState(() => Number(localStorage.getItem(HEIGHT_KEY)) || 340);
  const bpmnRef = useRef<BpmnHandle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Properties panel: width draggable at the divider (like the height
  // between diagram and flow) — the setting persists for the session.
  const [panelW, setPanelW] = useState(() => {
    const n = Number(localStorage.getItem(PANEL_W_KEY));
    return Number.isFinite(n) && n >= 320 ? Math.min(n, 800) : 416;
  });
  // Comment panel: its own width, also draggable; in a narrow window
  // it overlays the right column, otherwise it takes its space
  // from the properties panel — the flow on the left stays as it is
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
      // Subprocesses and error paths collapsed at first: overview first
      // the pattern blocks too — their wiring is only shown when needed
      const start = new Set<string>(foldIds(r.data.steps));
      for (const s of allSteps(r.data.steps)) if (s.kind === 'subprocess') start.add(s.id);
      setCollapsed(start);
    });
    loadBpmn(slug).then(x => { if (alive) { setXml(x); setShowDiagram(!!x); } });
    return () => { alive = false; };
  }, [slug, loadSpec, loadBpmn]);

  // Bare type names from an import without a catalog: as soon as the catalog
  // knows them, they become references — this is saved with the next
  // autosave. Nothing to do → null, no update, no loop.
  useEffect(() => {
    if (!spec || !model || !canEdit) return;
    const healed = healLooseTypes(spec.types ?? [], model);
    if (healed) update({ ...spec, types: healed }, { source: 'load', note: 'Typnamen mit dem Katalog verknüpft' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec?.types, model, canEdit]);

  // All fields of a service call as rows — required inputs and used
  // outputs checked (as on import and sync) — once on opening, as soon as
  // the catalog is there; saved with the autosave
  const requiredHealed = useRef<string | null>(null);
  useEffect(() => {
    // the catalog may arrive after the specification — then once more
    const key = `${slug}:${model?.services.length ?? 0}`;
    if (!spec || !model || !canEdit || requiredHealed.current === key) return;
    requiredHealed.current = key;
    const r = withServiceRows(spec, model);
    if (r.changed) update(r.spec, { source: 'load', note: 'Felder der Services als Zeilen ergänzt (Pflicht-Eingaben angehakt)' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, model, canEdit, slug]);

  // JUEL from an older state or catalog: what can be translated
  // becomes FEEL — saved with the next autosave; the rest stays JUEL
  // (once on opening — not in the middle of typing)
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

  // ── Change log (see audit.ts) ─────────────────────────────────────────────
  // `auditBase` is the state at the last cut. A cut is made on every
  // save (everything up to then was manual work) and before and after a
  // change with an origin (sync, conversion …) — that becomes its own
  // entry. The entries wait until the specification is saved.
  const auditBase = useRef<ProcessSpec | null>(null);
  const auditQueue = useRef<AuditEntry[]>([]);
  /** the latest state — also between update() and the next render */
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
    // not saved (or only the log was not): again with the next save
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
   * Every change goes through here. `origin` says where a change comes from
   * that is not manual (or has a reason) — it becomes its own
   * entry in the log; without it, it counts as manual work.
   */
  const update = useCallback((next: ProcessSpec, origin?: AuditOrigin) => {
    // the status of the specification is the lowest of its parts — never set by hand
    const data = { ...next, status: overallStatus(next), updatedAt: nowIsoWithTimezone() };
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

  // on leaving, still write out pending changes — even when the
  // page reloads or goes into the background (then there is no unmount)
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

  // Replace a step in the tree (immutably)
  const patchStep = useCallback((id: string, patch: Partial<Step>) => {
    if (!spec) return;
    if (typeof patch.name === 'string') bpmnRef.current?.rename(id, patch.name);
    applyToBpmn(id, patch, byIdRef.current.get(id), bpmnRef.current, spec.engine, juelOptions(spec, model));
    // Worker or subprocess selected → the element gets the colour of its project
    if ('serviceId' in patch || 'topic' in patch || 'calledProcess' in patch) {
      const s = { ...byIdRef.current.get(id), ...patch };
      if (s.kind === 'service' || s.kind === 'call') {
        const ref = s.kind === 'call' ? s.calledProcess ?? s.topic : s.topic ?? s.serviceId;
        bpmnRef.current?.setColor(id, projectColor(ref, spec.project, model?.projects, model?.projectColors));
      }
    }
    // A new status also applies to everything below — paths, subprocess, error and side paths —
    // and to the data model of these steps (interaction with In/Out; at the start the classes of the process)
    const status = patch.status;
    let below = 0;
    const touched = new Set<string>([id]);
    const deep = (steps: Step[]): Step[] => steps.map(s => {
      below++;
      touched.add(s.id);
      const next: Step = { ...s, status: status! };
      if (s.children) next.children = deep(s.children);
      if (s.branches) next.branches = s.branches.map(b => ({ ...b, steps: deep(b.steps) }));
      if (s.errors) next.errors = s.errors.map(e => (e.steps ? { ...e, steps: deep(e.steps) } : e));
      return next;
    });
    const walk = (steps: Step[]): Step[] => steps.map(s => {
      if (s.id === id) {
        const own: Step = { ...s, ...patch };
        if (!status) return own;
        if (own.children) own.children = deep(own.children);
        if (own.branches) own.branches = own.branches.map(b => ({ ...b, steps: deep(b.steps) }));
        if (own.errors) own.errors = own.errors.map(e => (e.steps ? { ...e, steps: deep(e.steps) } : e));
        return own;
      }
      const next: Step = { ...s };
      if (s.children) next.children = walk(s.children);
      if (s.branches) next.branches = s.branches.map(b => ({ ...b, steps: walk(b.steps) }));
      if (s.errors) next.errors = s.errors.map(e => (e.steps ? { ...e, steps: walk(e.steps) } : e));
      return next;
    });
    const steps = walk(spec.steps);
    const name = byIdRef.current.get(id)?.name || id;
    const next = status ? withDataStatus({ ...spec, steps }, touched, status) : { ...spec, steps };
    update(next, status && below
      ? { source: 'manual', note: `Status «${STATUS_META[status].label}» für «${name}» und ${below} Schritt${below === 1 ? '' : 'e'} darunter` }
      : undefined);
  }, [spec, update]);

  // A step selected in the tree is also selected in the diagram
  useEffect(() => { bpmnRef.current?.select(selected); }, [selected]);

  /**
   * Derive the ID from the business name according to house convention and
   * update it everywhere — diagram, tree, interactions, comments. Runs on
   * leaving the name field (not per keystroke) and after renames
   * in the diagram.
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
      // Modeler not open — update the saved BPMN directly, otherwise
      // the next sync would no longer find the step
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

  // ── Change company/project ────────────────────────────────────────────────
  // All known `company-projekt` prefixes for the selection on the process
  const projectPrefixes = useMemo(
    () => knownPrefixes(model, specs.map(s => s.data.project)),
    [model, specs]);

  /**
   * The new prefix replaces the old one in all business IDs
   * (`{company}-{project}-*`) — in the specification and in the BPMN. The
   * file name stays; the app deliberately does not rename files.
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
        setXml(nx);   // the open modeler reloads the new XML itself
        void saveBpmn(slug, nx).then(w => { if (!w.ok) setSaveState({ error: w.message }); });
      }
    }
    update({ ...renamePrefix(current, oldPrefix, newPrefix), project: newPrefix },
      { source: 'manual', note: `Firma/Projekt gewechselt: ${oldPrefix} → ${newPrefix}` });
  }, [update, saveBpmn, slug]);

  const byId = useMemo(() => new Map(allSteps(spec?.steps).map(s => [s.id, s])), [spec]);
  // what the view shows: Claude's draft while there is one
  const shownSpec = aiDraft?.spec ?? spec;
  const shownById = useMemo(() => (aiDraft ? new Map(allSteps(aiDraft.spec.steps).map(s => [s.id, s])) : byId), [aiDraft, byId]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  // per status the steps (with interaction and its classes) and the classes without a step —
  // so every overall status finds its filter
  const counts = useMemo(() => (spec ? statusParts(spec) : null), [spec]);
  const containers = useMemo(() => (spec ? [...containerIds(spec.steps), ...foldIds(spec.steps)] : []), [spec]);
  const ancestors = useMemo(() => (spec ? ancestorsOf(spec.steps) : new Map<string, string[]>()), [spec]);
  const ancestorsRef = useRef(ancestors);
  ancestorsRef.current = ancestors;
  // Show the selected element in the tree — also when it was selected in the
  // diagram: open collapsed branches above it, then scroll it into view
  // (`nearest`: what is already visible stays where it is). A collapsed
  // pattern row opens itself (PatternFold).
  useEffect(() => {
    if (!selected) return;
    const oben = ancestorsRef.current.get(selected) ?? [];
    if (oben.length) setCollapsed(prev => (oben.some(id => prev.has(id)) ? new Set([...prev].filter(id => !oben.includes(id))) : prev));
    const timers = [0, 60, 200].map(nach => window.setTimeout(() => {
      document.querySelector(`[data-step="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' });
    }, nach));
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [selected]);

  // ── Comments ─────────────────────────────────────────────────────────────
  const commentCounts = useMemo(() => (spec ? countIndex(spec) : { exact: new Map(), under: new Map() }), [spec]);
  const targets = useMemo(() => (spec ? commentTargets(spec, allSteps(spec.steps)) : []), [spec]);

  /**
   * To the location of a comment: switch view, open collapsed
   * branches, select the element and scroll the speech bubble into view.
   */
  const gotoTarget = useCallback((key: string) => {
    const ziel = locate(key);
    if (ziel.kind === 'type') { setFocusType(ziel.id); setTab('model'); }
    else if (ziel.kind === 'ia') { setFocusIa(ziel.id); setTab('model'); }
    else {
      setTab('flow');
      if (ziel.kind === 'process') setSelected(null);
      else {
        // The step may sit in a collapsed branch
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
        // the right column scrolls on its own — the location may be far down there
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
   * Click on a speech bubble. In the tree it counts the whole element; if it
   * has nothing open itself, but one of its parts does, go straight there.
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

  // Deep link: once, as soon as the specification is there
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!spec || !focusCommentId || focusedRef.current === focusCommentId) return;
    focusedRef.current = focusCommentId;
    const faden = threadOf(spec, focusCommentId);
    if (!faden) { setNotice({ tone: 'warn', message: 'Der verlinkte Kommentar ist nicht mehr da.' }); return; }
    if (faden.resolved) setShowResolved(true);
    openComment(faden.target);
  }, [spec, focusCommentId, openComment]);

  // From a page for a user task: once per step, as soon as the specification is there
  const stepFocusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!spec || !focusStepId || stepFocusedRef.current === focusStepId) return;
    stepFocusedRef.current = focusStepId;
    gotoTarget(stepTarget(focusStepId));
  }, [spec, focusStepId, gotoTarget]);

  // People for «@»: users.json plus comment authors with e-mail plus me
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

  // Entra search not possible: explain once per session; known people remain selectable
  const onDirectoryProblem = useCallback((r: Extract<DirectorySearchResult, { ok: false }>) => {
    if (r.reason === 'noLogin' || directoryWarned) return;
    directoryWarned = true;
    setNotice({
      tone: 'warn', scopes: r.reason === 'consent' ? DIRECTORY_SCOPES : undefined,
      message: `${r.message} Bis dahin schlägt «@» nur Personen vor, die in diesem Ordner schon gearbeitet oder kommentiert haben.`,
    });
  }, []);

  // Teams sending (delay, batched, once). Acknowledging still runs
  // after leaving — therefore on the latest state and saved immediately.
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
  // Success messages disappear by themselves
  useEffect(() => {
    if (notice?.tone !== 'info') return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /**
   * Blue frame around the element of the active comment: the location itself
   * (`data-cframe`) and — in the tree, in the type list — the row of the element
   * (`data-cframe-base`), so that it can be found there too.
   */
  const aktiv = commentsOpen ? activeComment : null;
  const frameCss = aktiv
    ? `[data-cframe="${cssAttr(aktiv)}"],[data-cframe-base="${cssAttr(baseOf(aktiv))}"]`
      + `{outline:2px solid ${isDark ? 'rgb(96 165 250)' : 'rgb(59 130 246)'};outline-offset:2px;border-radius:4px;background:${isDark ? 'rgb(59 130 246 / 0.12)' : 'rgb(59 130 246 / 0.07)'}}`
    : '';

  // Findings per step — the same rules as in the panel on the right, for the triangle
  // in the row; computed once per state of the specification. Deferred
  // (useDeferredValue): they check every FEEL expression against the types — that
  // should not slow down typing, they follow as soon as one pauses
  const deferredSpec = useDeferredValue(shownSpec);
  const findings = useMemo(
    () => (deferredSpec ? collectFindings(deferredSpec, model, allSteps(deferredSpec.steps)) : new Map<string, Finding>()),
    [deferredSpec, model],
  );

  // Search/filter: does a step match itself — and (matches) it or one of its descendants?
  const matchesSelf = useCallback((s: Step): boolean => {
    const q = query.trim().toLowerCase();
    // the search also covers the object name of the interaction and the name of the
    // catalog service — so «Approve» finds the task whose step
    // is called «Kartenbestellung prüfen»
    const ia = spec?.interactions?.find(i => i.stepId === s.id);
    const svc = catalogEntry(s, model);
    const haystack = `${s.name} ${s.description ?? ''} ${s.serviceId ?? ''} ${s.topic ?? ''} ${ia?.name ?? ''} ${svc?.name ?? ''} ${s.calledProcess ?? ''}`.toLowerCase();
    return (!q || haystack.includes(q))
      && (!statusFilter || (spec ? stepStatuses(s, spec) : [s.status]).includes(statusFilter))
      && (!findingsOnly || findings.has(s.id));
  }, [query, statusFilter, findingsOnly, findings, spec, model]);
  const matches = useCallback((s: Step): boolean => {
    if (matchesSelf(s)) return true;
    const sub = [...(s.children ?? []), ...(s.branches ?? []).flatMap(b => b.steps), ...(s.errors ?? []).flatMap(e => e.steps ?? [])];
    return sub.some(matches);
  }, [matchesSelf]);

  const active = query.trim() !== '' || statusFilter !== null || findingsOnly;

  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── Sync BPMN ─────────────────────────────────────────────────────────────
  // One path for both: the selected file and the change in the modeler.
  const specRef = useRef<ProcessSpec | null>(null);
  specRef.current = spec;
  const modelRef = useRef(model);
  modelRef.current = model;

  /**
   * Merge the diagram `raw` with the specification — without
   * saving. If it comes from the modeler (`from === 'Diagramm'`), the modeler
   * renames the steps right away; otherwise this has no side effects and
   * can be computed for the preview as often as needed.
   */
  const planXml = useCallback((raw: string, from: string, st: MergeStatus = DEFAULT_MERGE_STATUS, pasted?: PastedElements) => {
    const current = specRef.current;
    if (!current) return null;
    // Process ID and name follow the pool (convention, see poolIds.ts);
    // a chosen process ID only if the name was changed in the diagram.
    // An open modeler reloads the aligned XML.
    const renamed = from === 'Diagramm' && !!xmlRef.current && poolNames(xmlRef.current) !== poolNames(raw);
    let text = alignPoolIds(raw, { renameProcess: renamed }).xml;
    const { spec: fresh } = importBpmn(text, from, { patterns: modelRef.current?.patterns });
    // the previous BPMN as reference: what the diagram did not change stays
    // as in the specification (service, mappings — they only go in on export)
    let base = null;
    try { base = xmlRef.current ? importBpmn(xmlRef.current, from, { patterns: modelRef.current?.patterns }).spec : null; } catch { /* unreadable — without reference */ }
    const { spec: merged0, report } = mergeSpec(fresh, current, base, st);
    // Steps renamed in the diagram: the ID follows the name (convention).
    // If the change comes from the modeler, it renames — that triggers the
    // next save run, which stores the BPMN with the new IDs.
    // Otherwise (pattern, file, title) the modeler still shows the old state:
    // then rename in the new XML, which it loads right away.
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
      // including interactions and comments on this step
      merged = renameStepId(merged, s.id, neu);
      renames.push([s.id, neu]);
    }
    // Pasted in the modeler: the details of the source go to the new steps. The
    // ID of the source stays if it is free here — otherwise by convention.
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
   * Apply the result and store the BPMN. All comments stay —
   * also those on locations that no longer exist: they appear in the panel under
   * «Ohne Stelle» until someone resolves them.
   */
  const commitPlan = useCallback(async (next: ProcessSpec, text: string, r: MergeReport | null, renames: Array<[string, string]>, origin: AuditOrigin) => {
    for (const [alt, neu] of renames) setSelected(prev => (prev === alt ? neu : prev));
    const before = specRef.current;
    update(before ? { ...next, comments: rememberPlaces(before, next, allSteps(before.steps), allSteps(next.steps)) } : next, origin);
    setXml(text);
    if (r) setReport(r);
    const w = await saveBpmn(slug, text);
    if (!w.ok) setSaveState({ error: w.message });
    return w.ok;
  }, [update, saveBpmn, slug]);

  /**
   * After a sync: the tables of the matched decisions without one, right from
   * the own project folder — editable at the step then. Written create-only
   * (a table already stored beside the spec stays as it is) and only then
   * linked, on the spec as it is by now.
   */
  const linkProjectDmns = useCallback(async (from: ProcessSpec) => {
    const { found, failed } = await findProjectDmns(from, model);
    const saved = await saveProjectDmns(from.slug, found, saveDmn, { createOnly: true });
    const linked = [...saved.saved, ...saved.kept];
    // `latest` is what `update` set last (also before its debounced save) — the
    // interaction ids of `from` are those of the committed spec: withServiceRows only adds rows to steps
    const now = latest.current ?? specRef.current;
    // meanwhile another spec in this view: its tables are stored, linked by the next sync of it
    if (now && now.slug !== from.slug) return;
    if (linked.length && now) {
      // the problems go into the log entry too — the autosave of this update replaces the save state
      const report: AuditReport = {
        ...(saved.saved.length ? { 'aus dem Projekt': saved.saved.map(d => d.name) } : {}),
        ...(saved.kept.length ? { 'vorhanden, verknüpft': saved.kept.map(d => d.name) } : {}),
        ...(failed.length ? { 'nicht gelesen': failed } : {}),
        ...(saved.failed.length ? { 'nicht gespeichert': saved.failed } : {}),
      };
      update(withDmnFiles(now, linked), { source: 'domain-sync', note: 'DMN-Tabellen aus dem Projekt', report });
    }
    const problems = [...failed.map(f => `nicht gelesen: ${f}`), ...saved.failed.map(f => `nicht gespeichert: ${f}`)];
    if (problems.length) setSaveState({ error: `DMN-Tabelle ${problems.join('; ')}` });
  }, [model, saveDmn, update]);

  /**
   * `quiet`: report only on changes; `silent`: none at all (patterns report themselves).
   * `origin`: where the diagram comes from — without it, it is «Mit BPMN abgleichen» with a file.
   */
  const applyXml = useCallback(async (raw: string, from: string, quiet: boolean | 'silent' = false, origin?: AuditOrigin, pasted?: PastedElements,
    /** what belongs in the data model with the same change (the `Out` of a pattern …) */
    adjust?: (s: ProcessSpec) => ProcessSpec) => {
    try {
      const planned = planXml(raw, from, DEFAULT_MERGE_STATUS, pasted);
      if (!planned) return;
      const plan = adjust ? { ...planned, spec: adjust(planned.spec) } : planned;
      const r = plan.report;
      const show = !quiet || (quiet !== 'silent' && (r.added.length || r.removed.length || r.changed.length));
      const src = pasted?.spec?.source;
      const note = plan.placed.length && src
        ? `Eingefügt aus «${src.title || src.slug}»: ${plan.placed.length} ${plan.placed.length === 1 ? 'Element' : 'Elemente'}`
        : undefined;
      await commitPlan(plan.spec, plan.text, show ? r : null, plan.renames,
        { ...(origin ?? { source: 'bpmn-sync', note: `Mit BPMN abgleichen: ${from}` }), ...(note ? { note } : {}), report: bpmnReport(r) });
      if (plan.placed.length) {
        // Nothing technical came along from the other engine: assignment,
        // conditions and handled errors into the diagram in the form of this engine
        const engine = plan.spec.engine;
        if (src && (src.engine ?? 'c7') !== (engine ?? 'c7')) {
          const byId = new Map(allSteps(plan.spec.steps).map(s => [s.id, s]));
          for (const id of plan.placed) {
            const s = byId.get(id);
            if (!s) continue;
            // handled errors only where there are some without a boundary event — otherwise an empty ioMapping would remain
            const held = (s.errors ?? []).some(e => e.code && (e.declared || !e.boundary)) || !!s.regexHandledErrors?.length;
            const patch: Partial<Step> = {
              ...Object.fromEntries(ASSIGNMENT_KEYS.filter(k => s[k]).map(k => [k, s[k]])),
              ...(s.branches ? { branches: s.branches } : {}),
              ...(held ? { errors: s.errors ?? [], regexHandledErrors: s.regexHandledErrors } : {}),
            };
            applyToBpmn(id, patch, undefined, bpmnRef.current, engine, juelOptions(plan.spec, modelRef.current));
          }
        }
        setSelected(plan.placed[0]);
      }
    } catch (e) {
      setSaveState({ error: e instanceof Error ? e.message : String(e) });
    }
  }, [planXml, commitPlan]);

  // ── Copy ──────────────────────────────────────────────────────────────────
  // Copied in the modeler (Ctrl+C): bpmn-js's tree gets what only exists in the
  // specification — it is pasted into this or another process.
  const copyDiagram = useCallback((ids: string[]) => {
    const cur = specRef.current;
    if (!cur) return;
    attachDiagramSpec(collectDiagram(cur, ids, { slug: cur.slug, title: cur.title || cur.name, engine: cur.engine }));
  }, []);
  const clip = useClipboard();

  // ── Pattern ───────────────────────────────────────────────────────────────
  // A pattern is written directly into the BPMN — not only on export.
  // Afterwards the sync reads the diagram again: so the step shows what is in the
  // diagram, and an open modeler reloads the new XML.
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
    // if the pattern sets a variable at the end (`processStatus`), it belongs in the Out
    const ends = action === 'remove' ? [] : endVariables(def, engine, params);
    await applyXml(r.xml, `Pattern ${def.name}`, 'silent', { source: 'manual', note: `Pattern «${def.name}» ${was}` }, undefined,
      ends.length ? s => withEndOutFields(s, ends) : undefined);
    setNotice({ tone: r.issues.length ? 'warn' : 'info', message: [`Pattern «${def.name}» im Diagramm ${was}.`, ...r.issues].join(' ') });
  }, [applyXml]);

  // Pattern changed in the admin (or the specification dates from before):
  // update the pattern details from the diagram, nothing else
  const patternDefs = model?.patterns;
  const loaded = !!spec;
  useEffect(() => {
    const cur = specRef.current;
    if (!loaded || !xml || !cur) return;
    try {
      const fresh = importBpmn(xml, cur.slug, { patterns: patternDefs }).spec;
      const withPatterns = syncPatterns(cur, fresh);
      // a specification from before the import of timers gets them from the diagram
      const withTimers = syncTimers(withPatterns ?? cur, fresh);
      // likewise the correlation keys of the waiting messages
      const withKeys = syncCorrelationKeys(withTimers ?? withPatterns ?? cur, fresh);
      // and signal / message on boundary events — an older one listed them as errors
      const withEvents = syncBoundaryEvents(withKeys ?? withTimers ?? withPatterns ?? cur, fresh);
      const next = withEvents ?? withKeys ?? withTimers ?? withPatterns;
      const what = [withPatterns && 'Pattern', withTimers && 'Timer', withKeys && 'Korrelations', withEvents && 'Ereignis'].filter(Boolean).join('- und ');
      if (next) update(next, { source: 'load', note: `${what}-Angaben aus dem Diagramm nachgezogen` });
    } catch { /* unreadable BPMN — the sync reports it */ }
  }, [loaded, xml, patternDefs, update]);

  // Switch engine: the converted diagram goes the way of every change —
  // the sync reads engine, topics and mappings from it again
  const convertEngine = useCallback(async (next: string | null, target: EngineId) => {
    const cur = specRef.current;
    if (!cur) return;
    const origin: AuditOrigin = { source: 'conversion', note: conversionNote(target) };
    if (next) await applyXml(next, engineLabel(target), 'silent', origin);
    else update({ ...cur, engine: target }, origin);
    setNotice({ tone: 'info', message: `${conversionNote(target)}.` });
  }, [applyXml, update]);

  // A diagram from before whose process is still named differently from its pool:
  // align once on opening (it is saved like every change)
  const aligned = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || !xml || !canEdit || aligned.current === slug) return;
    aligned.current = slug;
    const next = alignPoolIds(xml);
    if (next.xml !== xml) void applyXml(next.xml, 'Pool', 'silent', { source: 'load', note: 'Prozess-ID und -Name an den Pool angeglichen' });
  }, [loaded, xml, canEdit, slug, applyXml]);

  // The process ID has its own field (the title is business-facing). It is
  // applied on leaving the field — only if it follows the pattern
  // company-projekt-prozessVersion; in the diagram the process name
  // and pool follow (see poolIds.ts).
  const [idDraft, setIdDraft] = useState('');
  useEffect(() => { setIdDraft(spec?.processId ?? ''); }, [spec?.processId]);
  // against the known company-projekt — without this specification, otherwise
  // a typo would confirm itself
  const otherPrefixes = useMemo(
    () => knownPrefixes(model, specs.filter(s => s.slug !== slug).map(s => s.data.project)),
    [model, specs, slug]);
  const legacyId = !!spec?.legacyProcessId;
  const idProblem = idDraft.trim() ? checkProcessId(idDraft, otherPrefixes, legacyId) : null;
  // only offer the marker where it changes something: the convention does not fit (or it is already set)
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
    // without a diagram: only the specification
    const m = /^(.*?)-([A-Za-z][A-Za-z0-9]*V\d+)$/.exec(id) ?? (cur.legacyProcessId ? /^(.*)-([^-]+)$/.exec(id) : null);
    update({ ...cur, processId: id, ...(m ? { project: m[1] } : {}) });
  };

  // A selected file does not go in directly: first the preview with
  // domain, data model and status — as when creating
  const onFile = async (file: File) => {
    setSync({ raw: await file.text(), from: file.name });
  };

  if (!spec) return <div className={`h-full flex items-center justify-center text-xs ${c.muted}`}>Lade Spezifikation …</div>;

  const selectedStep = selected ? shownById.get(selected) ?? null : null;

  // Claude's draft accepted: the way of a change in the diagram (commitPlan) - with the source «KI» in the
  // change log and the requests of the RE as note. Undo once, as long as nothing else changed.
  // Refused when the process changed since the draft began (reloaded, synced) - the draft would overwrite that.
  const acceptAi = async (d: ProcessDraft, requests: string[]): Promise<AcceptOutcome> => {
    const before = { spec: specRef.current ?? d.base.spec, xml: xmlRef.current ?? '' };
    if (before.xml !== d.base.xml || !sameSpec(before.spec, d.base.spec))
      return { refused: 'Der Prozess hat sich seit dem Entwurf geändert (neu geladen oder abgeglichen) – Entwurf verwerfen und Claude nochmals fragen.' };
    const note = `Mit KI (Claude): ${requests.map(r => `«${r}»`).join(' · ')}`;
    const ok = await commitPlan(d.spec, d.xml, null, [], { source: 'ai', note: note.length > 400 ? `${note.slice(0, 399)}…` : note });
    // `latest` is the spec that commitPlan set - any later change (also one only in the spec) makes it another object
    setAiUndo(ok ? { ...before, acceptedSpec: latest.current, acceptedXml: d.xml } : null);
    return ok ? undefined : { saveError: 'das Diagramm (BPMN) – siehe Speicherstatus oben' };
  };
  const aiUndoable = !!aiUndo && xml === aiUndo.acceptedXml && spec === aiUndo.acceptedSpec;
  const undoAi = async (): Promise<AcceptOutcome> => {
    if (!aiUndo) return { refused: 'Es gibt nichts mehr rückgängig zu machen.' };
    setAiUndo(null);
    const ok = await commitPlan(aiUndo.spec, aiUndo.xml, null, [], { source: 'ai', note: 'KI-Änderung rückgängig gemacht' });
    return ok ? undefined : { saveError: 'das Diagramm (BPMN) – siehe Speicherstatus oben' };
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Toolbar: navigation, view, tools, status ─────────────────────────── */}
      <div className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b ${c.border} ${c.top}`}>
        <button onClick={onBack} className={`flex items-center gap-1 text-[11px] flex-shrink-0 ${c.muted} hover:underline`}>
          <ChevronLeft size={12} /> Prozesse
        </button>
        <Divider isDark={isDark} />

        {/* View */}
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

        {/* right: save state, export, status */}
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
          {/* Comments: overview and step sequence in the panel on the right */}
          {/* Change log — for the selected step, otherwise for everything */}
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
          {aiKey && mayEdit && (
            <button onClick={() => { setAiOpen(o => !o); setCommentsOpen(false); setAuditOpen(false); }}
              title="Claude – den Ablauf im Gespräch ändern (KI-Modus)"
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border transition-colors flex-shrink-0 ${
                aiOpen || aiDraft ? (isDark ? 'border-violet-400/50 bg-violet-500/15 text-violet-200' : 'border-violet-400 bg-violet-50 text-violet-800') : c.btn}`}>
              <Sparkles size={12} /> Claude
            </button>
          )}
          <button onClick={() => setExportOpen(true)}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border flex-shrink-0 ${c.btn}`}>
            <Download size={12} /> Export
          </button>
          {/* the state of the whole: the lowest status of the steps and the data model — a click filters by it */}
          <StatusChip status={overallStatus(spec)} isDark={isDark}
            title={`Status der Spezifikation: der kleinste Status aller Schritte und Klassen (${STATUSES.map(s => STATUS_META[s].label).join(' → ')}) — klicken zeigt, welche`}
            onClick={() => setStatusFilter(overallStatus(spec))} />
        </div>
      </div>

      {/* Report of the last sync — across the full width, dismissible */}
      {frameCss && <style>{frameCss}</style>}

      {/* Notice: missing permission, Teams sent … */}
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
          onApply={async p => {
            setSync(null);
            setShowDiagram(true);
            // for the log: flow and data model reported separately
            const teil = (head: string, r: AuditReport) => Object.fromEntries(Object.entries(r).map(([k, v]) => [`${head} ${k}`, v]));
            const origin: AuditOrigin = {
              source: sync.mode === 'domain' ? 'domain-sync' : 'bpmn-sync',
              note: sync.mode === 'domain' ? 'Mit Domain abgleichen' : `Mit BPMN abgleichen: ${sync.from}`,
              report: { ...teil('Ablauf', bpmnReport(p.report)), ...(p.domain ? teil('Datenmodell', domainReport(p.domain)) : {}) },
            };
            try {
              // all fields of the services as rows, required inputs checked — as when creating
              const ok = await commitPlan(withServiceRows(p.spec, model, { importing: true }).spec, p.text, p.report, p.renames, origin);
              // the tables of the matched decisions — only once the plan is taken over
              if (ok) await linkProjectDmns(p.spec);
            } catch (e) {
              setSaveState({ error: e instanceof Error ? e.message : String(e) });
            }
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

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <CommentsContext.Provider value={commentsCtx}>
      <div className="flex-1 flex min-h-0 relative">
        {tab === 'flow' ? (
          <>
            {/* left: diagram above the flow */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              {showDiagram && xml && (
                <div className={`flex-shrink-0 border-b ${c.border} relative`} style={{ height }}>
                  <Suspense fallback={<div className={`h-full flex items-center justify-center text-xs ${c.muted}`}>Modeler wird geladen …</div>}>
                    <BpmnEditor xml={aiDraft?.xml ?? xml} isDark={isDark} canEdit={canEdit} engine={spec.engine}
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
                <StepList steps={(shownSpec ?? spec).steps} depth={0} isDark={isDark} collapsed={collapsed} toggle={toggle}
                  selected={selected} onSelect={setSelected} byId={shownById}
                  matches={matches} matchesSelf={matchesSelf} filterActive={active}
                  onStatus={canEdit ? (id, s) => patchStep(id, { status: s }) : undefined}
                  findings={findings}
                  interactionOf={id => (spec.interactions ?? []).find(i => i.stepId === id) ?? null}
                  dataBelowOf={s => dataBelow(s, spec)}
                  startClassesOf={s => startClasses(s, spec)}
                  serviceOf={s => catalogEntry(s, model)}
                  processId={spec.processId ?? ''}
                  hasCatalog={!!model?.services?.length}
                  patternName={id => model?.patterns?.find(d => d.id === id)?.name ?? id}
                  onOpenInteraction={ia => { setFocusType(ia.inTypeId ?? ia.outTypeId ?? null); setTab('model'); }}
                  onOpenType={id => { setFocusType(id); setTab('model'); }} />
                {!spec.steps.length && (
                  <p className={`text-xs ${c.muted}`}>
                    Noch kein Ablauf — «Mit BPMN abgleichen» übernimmt die Struktur aus der Implementation.
                  </p>
                )}
              </div>
            </div>

            {/* right: title and filter above the properties — the width
                can be dragged at the divider */}
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
                    {STATUSES.filter(s => counts[s].steps > 0 || counts[s].model.length > 0).map(s => (
                      <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                        title={`Nur «${STATUS_META[s].label}» zeigen — Schritte mit diesem Status, auch über ihre Interaktion${
                          counts[s].model.length ? `; im Datenmodell ohne Schritt: ${counts[s].model.join(', ')}` : ''}`}
                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-opacity ${isDark ? STATUS_META[s].dark : STATUS_META[s].light} ${
                          statusFilter && statusFilter !== s ? 'opacity-30' : ''}`}>
                        {STATUS_META[s].label} {counts[s].steps}{counts[s].model.length ? ` · ${counts[s].model.length} Datenmodell` : ''}
                      </button>
                    ))}
                    {/* Findings: only the steps with a triangle — red if there are errors */}
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

              <StepDetail step={selectedStep} spec={shownSpec ?? spec}
                isDark={isDark} canEdit={canEdit} model={model}
                onPatch={patchStep} onSyncId={syncStepId} onClose={() => setSelected(null)} onGoto={setSelected} onOpenPage={onOpenPage}
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
          <AuditPanel slug={slug} version={version} places={targets} isDark={isDark} load={loadAudit}
            focus={auditFocus} onFocus={setAuditFocus} onGoto={gotoTarget}
            onClose={() => setAuditOpen(false)}
            width={commentsW} overlay={narrow}
            onWidth={w => { setCommentsW(w); localStorage.setItem(COMMENTS_W_KEY, String(w)); }} />
        )}
        {/* Claude (only with a key) - stays mounted while hidden, so the conversation is kept */}
        {aiKey && mayEdit && (
          <div className={`w-[400px] flex-shrink-0 border-l ${c.border} ${c.panel} ${(aiOpen || aiDraft) && !commentsOpen && !auditOpen ? '' : 'hidden'}`}>
            <Suspense fallback={<Loader2 size={14} className="animate-spin m-4" />}>
              <ProcessAiPanel isDark={isDark} apiKey={aiKey} spec={spec} xml={xml ?? ''} model={model} specs={specs.map(x => x.data)}
                draft={aiDraft} onDraft={d => { setAiDraft(d); if (d) { setTab('flow'); setShowDiagram(true); } }}
                onAccept={acceptAi}
                undo={aiUndoable ? { label: 'Den Stand vor der letzten KI-Änderung wiederherstellen', run: undoAi } : null}
                onSelect={setSelected} />
            </Suspense>
          </div>
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

// Vertical separator in the toolbar
function Divider({ isDark }: { isDark: boolean }) {
  return <div className={`w-px h-4 flex-shrink-0 ${isDark ? 'bg-white/15' : 'bg-black/15'}`} />;
}

// Drag the height of the diagram — the setting persists beyond the session.
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

// Drag the width of the properties — the same pattern as between diagram
// and flow, only vertical: the left edge of the panel is the handle.
// ── Tree ─────────────────────────────────────────────────────────────────────
interface ListProps {
  steps: Step[];
  depth: number;
  isDark: boolean;
  /** Findings per step ID — errors red, warnings orange (see findings.ts) */
  findings: Map<string, Finding>;
  /** the interaction of a step — its own contract, highlighted in the tree */
  interactionOf: (id: string) => Interaction | null;
  /** the data model of the step (interaction with classes, at the start those of the process), if it ranks lower */
  dataBelowOf: (step: Step) => { status: Status; typeId: string | null; label: string } | null;
  /** jumps into the data model to a class */
  onOpenType: (id: string) => void;
  /** at the start of the process: In, InitIn, InConfig (and lower-ranking classes) — see status.ts */
  startClassesOf: (step: Step) => Array<{ id: string; name: string; status: Status | null; below: boolean }>;
  /** Catalog entry of an external service — teal; if missing, red */
  serviceOf: (step: Step) => ServiceDef | null;
  /** jumps into the data model to the interaction */
  onOpenInteraction: (ia: Interaction) => void;
  /** the own process ID — separates own workers from external services */
  processId: string;
  /** is there a catalog at all? Without one, a missing entry is not a finding */
  hasCatalog: boolean;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  byId: Map<string, Step>;
  matches: (s: Step) => boolean;
  /** does the step itself match (without descendants)? */
  matchesSelf: (s: Step) => boolean;
  filterActive: boolean;
  onStatus?: (id: string, s: Status) => void;
  /** Display name of a pattern (from the admin) */
  patternName: (id: string) => string;
}

/** Deeper than this the tree stops — a guard: a block that contains itself must not fill the memory */
const MAX_TREE_DEPTH = 40;

/**
 * What a pattern brings into the diagram — timer, link, shared block —
 * is wiring, not business logic. In the tree it is therefore shown as one
 * row in the pattern colour; the steps below only on click.
 *
 * `head`: the step the block starts with (its head, or the first step of the error path) —
 * the list of its content must not open the same block again, otherwise it contains itself.
 */
function PatternFold({ pattern, what, steps, head, p }: { pattern: string; what: string; steps: Step[]; head: string; p: ListProps }) {
  const c = cls(p.isDark);
  // opens and closes like every level (collapsed) — «Alles ausklappen» reaches it too
  const key = foldKey(steps);
  const open = !p.collapsed.has(key);
  const setOpen = (next: boolean) => { if (next !== open) p.toggle(key); };
  // if the selected element is inside, the row opens — otherwise it would not be visible
  const holdsSelected = useMemo(() => !!p.selected && allSteps(steps).some(s => s.id === p.selected), [steps, p.selected]);
  // only when the selection changes — otherwise the block would reopen right after collapsing
  useEffect(() => { if (holdsSelected && p.collapsed.has(key)) p.toggle(key); }, [holdsSelected]);
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
      {open && <StepList {...p} steps={steps} depth={p.depth + 1} foldOf={head} />}
    </div>
  );
}

/**
 * The steps of a level — own blocks (second start, link target) in
 * a bracket: the block begins at the step with `orphan` and extends
 * to the next one. An event subprocess already has its own bracket.
 * `foldOf`: the head of the pattern block this list is the content of — it does not open the
 * block again. Not part of ListProps, so it applies to this one list only and never travels on
 * with the props to the lists below (children, branches, paths).
 */
function StepList({ foldOf, ...p }: ListProps & { foldOf?: string }) {
  const c = cls(p.isDark);
  if (p.depth > MAX_TREE_DEPTH) {
    return <p className={`text-[10px] ${c.muted}`}>… zu tief verschachtelt — weitere Ebenen ausgeblendet</p>;
  }
  const groups = blockGroups(p.steps.filter(s => !p.filterActive || p.matches(s)), foldOf);
  return (
    <div className="flex flex-col">
      {groups.map(g => {
        if (!g.head) return g.steps.map(s => <StepRow key={s.id} step={s} {...p} />);
        const start = blockStart(g.head);
        if (g.head.pattern) {
          return (
            <div key={g.head.id} className="mt-2 -ml-6">
              <PatternFold pattern={g.head.pattern} what={`gemeinsamer Block · ${start}`} steps={g.steps} head={g.head.id} p={p} />
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
  const Icon = stepIcon(step);
  const isOpen = !p.collapsed.has(step.id);
  const hasChildren = !!(step.branches?.length || step.children?.length || step.errors?.some(e => e.steps?.length));
  // when filtering: a path stays if something in it matches — or the step itself matches
  const shows = (steps: Step[] | undefined) => !p.filterActive || p.matchesSelf(step) || (steps ?? []).some(p.matches);
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
  // the data model (interaction with classes, at the start those of the process) ranks lower — its status on the chip
  const below = p.dataBelowOf(step);
  const iaBelow = below?.status ?? null;
  const finding = p.findings.get(step.id) ?? null;
  // external service: catalog identifier or topic — not the own worker, not the init worker
  const foreign = !ia && (step.serviceId || step.topic) && step.topic !== p.processId ? (step.serviceId ?? step.topic ?? '') : '';
  const svc = foreign ? p.serviceOf(step) : null;
  const hasCatalog = p.hasCatalog;
  // Events, start and end are wiring — quiet
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
        {/* Own contract: the object as a chip, clickable into the data model */}
        {ia && (
          <button onClick={e => { e.stopPropagation(); p.onOpenInteraction(ia); }}
            title={`${INTERACTION_META[ia.kind].label} «${ia.name}»${iaBelow ? ` — im Datenmodell erst «${STATUS_META[iaBelow].label}»` : ''} — zum Datenmodell`}
            className={`hidden md:inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[14rem] ${
              p.isDark ? 'border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20' : 'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100'}`}>
            <span className="truncate">{ia.name}</span>
            {iaBelow && <span className={`flex-shrink-0 px-1 rounded border ${p.isDark ? STATUS_META[iaBelow].dark : STATUS_META[iaBelow].light}`}>{STATUS_META[iaBelow].label}</span>}
          </button>
        )}
        {/* the start of the process: In, InitIn, InConfig — with status where it ranks lower than the start */}
        {!ia && p.startClassesOf(step).map(k => (
          <button key={k.id} onClick={e => { e.stopPropagation(); p.onOpenType(k.id); }}
            title={`Datenmodell des Prozesses: «${k.name}»${k.below && k.status ? ` erst «${STATUS_META[k.status].label}»` : ''} — zum Datenmodell`}
            className={`hidden md:inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[14rem] ${
              p.isDark ? 'border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20' : 'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100'}`}>
            <span className="truncate">{k.name}</span>
            {k.below && k.status && <span className={`flex-shrink-0 px-1 rounded border ${p.isDark ? STATUS_META[k.status].dark : STATUS_META[k.status].light}`}>{STATUS_META[k.status].label}</span>}
          </button>
        ))}
        {/* Pattern on the step */}
        {step.patterns?.map((pt, i) => (
          <span key={`${pt.id}-${i}`} className="hidden md:inline-flex"><PatternChip name={p.patternName(pt.id)} params={pt.params} isDark={p.isDark} /></span>
        ))}
        {/* External service: the catalog identifier — teal if the catalog knows it, otherwise red */}
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
          {/* Finding: red = error, orange = warning — the first messages in the tooltip.
              When collapsed, the findings of the steps below are counted too, otherwise they would not be visible */}
          {(() => {
            const below = hasChildren && !isOpen ? nestedFindings(stepsBelow(step), p.findings) : { errors: 0, warnings: 0, texts: [] };
            const own = { errors: finding?.errors.length ?? 0, warnings: finding?.warnings.length ?? 0 };
            const texts = [...(finding ? [...finding.errors, ...finding.warnings] : []).slice(0, 4), ...below.texts].slice(0, 6);
            const nBelow = below.errors + below.warnings;
            return <FindingCount errors={own.errors + below.errors} warnings={own.warnings + below.warnings} isDark={p.isDark}
              title={`${texts.join('\n')}${nBelow ? `\n— davon ${nBelow} in den Schritten darunter (zugeklappt)` : ''}`} />;
          })()}
          {step.description && <span className={`text-[9px] ${c.muted}`} title="fachlich beschrieben">✎</span>}
          {/* Comments on the step including its parts — without waiting for hover */}
          <CommentBubble target={stepTarget(step.id)} aggregate quiet />
          <BlockChip step={step} isDark={p.isDark} />
          <LoopChip step={step} isDark={p.isDark} />
          {!!step.errors?.filter(e => !e.side && !e.pattern && !isEventBoundary(e)).length && <ErrorChip n={step.errors.filter(e => !e.side && !e.pattern && !isEventBoundary(e)).length} isDark={p.isDark} />}
          <StatusChip status={step.status} isDark={p.isDark} muted={step.status === 'implemented'}
            onClick={p.onStatus ? () => p.onStatus!(step.id, nextStatus(step.status)) : undefined} />
        </div>
      </div>

      {isOpen && hasChildren && (
        <div className="flex flex-col">
          {/* Branches */}
          {/* when filtering only the paths with a hit — if the gateway itself matches, all */}
          {step.branches?.map((b, i) => (shows(b.steps) ? <BranchBlock key={b.id} branch={b} index={i} gatewayId={step.id} {...p} /> : null))}

          {/* Error and side paths */}
          {step.errors?.filter(e => e.steps?.length && e.pattern && shows(e.steps)).map(e => (
            <PatternFold key={e.code} pattern={e.pattern!} what={`${boundaryLabel(e)} «${e.code}»`} steps={e.steps!} head={e.steps![0].id} p={p} />
          ))}
          {step.errors?.filter(e => e.steps?.length && !e.pattern && shows(e.steps)).map(e => (
            <div key={e.code} className={`ml-6 pl-3 border-l-2 ${
              e.side
                ? (p.isDark ? 'border-indigo-500/40' : 'border-indigo-400')
                : (p.isDark ? 'border-white/20' : 'border-black/20')}`}>
              <div className={`flex items-center gap-1.5 py-1 text-[10px] ${
                e.side
                  ? (p.isDark ? 'text-indigo-300' : 'text-indigo-700')
                  : (p.isDark ? 'text-white/60' : 'text-black/60')}`}>
                {isEventBoundary(e) ? <Zap size={10} /> : e.side ? <GitFork size={10} /> : <ShieldCheck size={10} />}
                <span className="font-semibold">{boundaryLabel(e)}</span> «{e.code}»
                {!e.side && e.interrupting === false && <span className={c.muted}>· nicht unterbrechend</span>}
                <span className={`ml-auto ${c.muted}`}>{countSteps(e.steps)} Schritt{countSteps(e.steps) === 1 ? '' : 'e'}</span>
              </div>
              <StepList {...p} steps={e.steps!} depth={p.depth + 1} />
            </div>
          ))}

          {/* Subprocess */}
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
  // The condition as FEEL, without the «=» in front — shortened, in full in the tooltip
  const cond = branch.condition ? branch.condition.replace(/^\s*=\s*/, '') : '';
  const n = countSteps(branch.steps);
  return (
    <div className={`ml-6 pl-3 border-l-2 ${tint.split(' ')[0]}`}>
      <div data-cframe={sub(stepTarget(gatewayId), `branch:${branch.id}`)}
        className={`group flex items-center gap-1.5 py-1 text-[10px] ${tint.split(' ')[1]}`}>
        {/* Branch header: label as a chip in the branch colour, default branch dashed */}
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

/** Steps of a block — without jumps back, across all levels. */
const countSteps = (steps: Step[] | undefined): number => allSteps(steps).filter(s => s.kind !== 'goto').length;

/** Findings in the steps below (all levels) — for rows that are collapsed */
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
/** the steps below a step — branches, error and side paths, subprocess */
const stepsBelow = (step: Step): Step[] =>
  [...(step.branches ?? []).flatMap(b => b.steps), ...(step.errors ?? []).flatMap(e => e.steps ?? []), ...(step.children ?? [])];

/** Triangle with number: red for errors, otherwise orange */
function FindingCount({ errors, warnings, title, isDark }: { errors: number; warnings: number; title: string; isDark: boolean }) {
  if (!errors && !warnings) return null;
  return (
    <span title={title}
      className={`flex items-center gap-0.5 text-[9px] ${errors ? (isDark ? 'text-rose-400' : 'text-rose-600') : (isDark ? 'text-amber-400' : 'text-amber-600')}`}>
      <AlertTriangle size={10} />{errors + warnings}
    </span>
  );
}
