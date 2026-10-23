// The designer of a page (E15): the outline of its building blocks, the page live - with the same renderer
// as the app, fed with sample data of the services - and the properties of the selected building block.
import {
  AlertTriangle, ArrowUpRight, ChevronLeft, ClipboardCheck, GripVertical, Heading, Info, ListChecks, Loader2, MousePointerClick, Plus, Redo2,
  RotateCcw, Rows3, SquareDashed, Sparkles, TextCursorInput, Type, CalendarRange, Undo2,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { changedKeys, pageDiff } from '../../ai/diff';
import { useAiKey } from '../../ai/key';
import type { PageDraft } from '../../ai/pageTools';
import { usePermissions } from '../../auth';
import { useStore } from '../../store';
import { userTasksOfPage, userTaskStep } from '../taskLinks';
import { cls } from '../../ui';
import PageView from '../runtime/PageView';
import { themeStyle } from '../runtime/theme';
import type { Gateway } from '../runtime/gatewayTypes';
import type { Component, Page } from '../runtime/spec';
import { BlockActions, type BlockOps } from './BlockActions';
import { BLOCK_LABELS, BlockProps, PageProps } from './BlockProps';
import { DataView } from './DataView';
import { IconButton } from './fields';
import { coalesceKey, emptyHistory, record, travel, type History } from './history';
import { designerKey, type DesignerKey } from './keys';
import {
  actionsOf, blockAt, convertBlock, dataOf, flatten, insertBlock, moveBlock, newBlock, pageFindings, placeBlock, relocateBlock, removeBlock,
  sampleOf, statePaths, targetsOf, unwrapSection, updateBlock, wrapInSection, type BlockKey, type Place, type Targets,
} from './model';

// the chat of the AI mode with the Anthropic SDK - only loaded with a key
const AiPanel = lazy(() => import('../../ai/AiPanel').then((m) => ({ default: m.AiPanel })));

const ICONS: Record<Component['type'], React.ReactNode> = {
  heading: <Heading size={12} />,
  text: <Type size={12} />,
  choice: <ListChecks size={12} />,
  pick: <CalendarRange size={12} />,
  fields: <TextCursorInput size={12} />,
  summary: <Rows3 size={12} />,
  button: <MousePointerClick size={12} />,
  section: <SquareDashed size={12} />,
  loading: <Loader2 size={12} />,
};

/** What the outline shows of a building block. */
function summaryOf(b: Component): string {
  switch (b.type) {
    case 'heading':
    case 'text':
      return b.text;
    case 'choice':
    case 'pick':
      return b.label ?? b.bind;
    case 'fields':
      return b.label ?? b.fields.map((f) => f.label).join(', ');
    case 'summary':
      return b.label ?? b.items.map((i) => i.label).join(', ');
    case 'button':
      return b.label;
    case 'section':
      return b.label ?? '';
    case 'loading':
      return b.text ?? '';
  }
}

/** The gateway of the preview: sample data of a service's Out, a start and everything else succeed. */
function previewGateway(targets: Targets): Gateway {
  const wait = () => new Promise((r) => setTimeout(r, 250));
  return {
    call: async (service) => {
      await wait();
      const svc = targets.services.find((s) => s.topic === service);
      return svc ? sampleOf(svc.out) : {};
    },
    start: async () => (await wait(), { processInstanceId: 'vorschau', status: 'Active' }),
    message: async () => (await wait(), { id: 'vorschau' }),
    completeTask: async () => (await wait(), null),
  };
}

const EMPTY: Targets = { services: [], processes: [], messages: [], userTasks: [] };

export default function PageEditor({ slug, onBack, aiPrompt, onOpenTask }: {
  slug: string; onBack: () => void; aiPrompt?: string;
  /** to the user task this page completes - the process at its step */
  onOpenTask?: (specSlug: string, stepId: string) => void;
}) {
  const { isDark, model, specs, pages, pagesApp, savePage } = useStore();
  const { canEdit } = usePermissions();
  const c = cls(isDark);
  const item = pages.find((p) => p.slug === slug);
  const [page, setPage] = useState<Page | null>(item?.data ?? null);
  const version = useRef<string | null>(item?.version ?? null);
  const [selected, setSelected] = useState<BlockKey | null>(null);
  const [query, setQuery] = useState('token=0b1c9a4e-7a43-4f0e-9d39-3a3f6c2d8e11');
  const [run, setRun] = useState(0);
  const [adding, setAdding] = useState(false);
  const [left, setLeft] = useState<'outline' | 'data'>('outline');
  const [drag, setDrag] = useState<{ from: BlockKey; over?: BlockKey; place?: Place } | null>(null);
  // the keyboard always reads the actions of this render (they depend on page and selection)
  const keys = useRef<{
    undo: () => void; redo: () => void; ops: BlockOps | null; deselect: () => void; canEdit: boolean; can: { undo: boolean; redo: boolean };
  }>(null!);
  const [saveState, setSaveState] = useState<{ at?: Date; error?: string }>({});
  // ---- the AI mode (E19, E20): only with a key. Claude's draft is shown instead of the page - in the
  // outline and the preview, read only - until the RE accepts (one step of undo) or discards it
  const aiKey = useAiKey();
  const [draft, setDraft] = useState<PageDraft | null>(null);
  const [aiOpen, setAiOpen] = useState(!!aiPrompt);
  // the description of a new page for Claude - sent once, then dropped (a later mount of the chat does not send it again)
  const [pendingPrompt, setPendingPrompt] = useState(aiPrompt);
  // deleting the key turns the AI off at once - the draft is gone too
  // also without the right to edit (another role after a new login): the chat panel is gone, so is the draft
  useEffect(() => { if (!aiKey || !canEdit) { setDraft(null); setAiOpen(false); } }, [aiKey, canEdit]);
  const shown = draft?.page ?? page;
  const editable = canEdit && !draft;

  // ---- save: one second after the last change and on leaving - one write after the
  // other (the next needs the version of the previous one), a failed one stays pending
  const pending = useRef<Page | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean>>(Promise.resolve(true));
  const retries = useRef(0);
  const closed = useRef(false); // after leaving: the last attempt during cleanup, no further ones
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    saving.current = saving.current.then(async () => {
      const data = pending.current;
      if (!data) return true;
      pending.current = null;
      const r = await savePage(slug, data, version.current);
      if (r.status === 'saved') {
        retries.current = 0;
        version.current = r.version;
        if (!closed.current) setSaveState({ at: new Date() }); // the last attempt on leaving: nobody sees it
        return true;
      }
      // don't lose it: stays pending as long as nothing newer came
      pending.current ??= data;
      if (!closed.current)
        setSaveState({ error: r.status === 'conflict' ? 'Die Datei wurde inzwischen geändert – Seite neu laden.' : r.message });
      // a connection error: retry automatically, less and less often (2 s … 30 s) - not a conflict,
      // only reloading the page resolves that
      if (r.status !== 'conflict' && !timer.current && !closed.current) {
        const wait = Math.min(30000, 2000 * 2 ** retries.current++);
        timer.current = setTimeout(() => void flush(), wait);
      }
      return false;
    });
    return saving.current;
  }, [slug, savePage]);
  useEffect(() => {
    // mounted (again - StrictMode unmounts and remounts in development): attempts allowed again
    closed.current = false;
    // on leaving the page or the tab - React does not clean up on close
    const now = () => void flush();
    const hidden = () => document.visibilityState === 'hidden' && now();
    window.addEventListener('pagehide', now);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', now);
      document.removeEventListener('visibilitychange', hidden);
      closed.current = true;
      now();
    };
  }, [flush]);
  const store = (next: Page) => {
    setPage(next);
    latest.current = next;
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1000);
  };

  // ---- undo: every change of the page; typing in a field is one step (history.ts). The states
  // belong to this page: the designer mounts the editor with key={slug}, another page starts fresh
  // (and the cleanup above saves what is still pending). Refs, not state: two steps before the
  // next render (⌘Z held down) thus each see the state of the previous one - `page` would still be the old one.
  const history = useRef<History<Page>>(emptyHistory());
  const latest = useRef<Page | null>(null);
  // the latest state during render: setPage only comes from store, which has already set latest - this also covers
  // a page that is only loaded after mounting
  latest.current = page;
  const [, setHistoryTick] = useState(0);
  const update = (next: Page, coalesce?: string) => {
    const current = latest.current ?? page;
    if (!canEdit || !current) return;
    // nothing changed (a drop at the same place, moving at the edge): no step, no save
    if (next === current || JSON.stringify(next) === JSON.stringify(current)) return;
    history.current = record(history.current, current, coalesce, Date.now());
    store(next);
    setHistoryTick((t) => t + 1);
  };
  const step = (dir: 'undo' | 'redo') => {
    const current = latest.current ?? page;
    if (!canEdit || !current) return;
    const done = travel(history.current, current, dir);
    if (!done) return;
    history.current = done.history;
    store(done.value);
    // a building block that no longer exists afterwards is no longer selected
    setSelected((s) => (s !== null && blockAt(done.value.body, s) ? s : null));
    setHistoryTick((t) => t + 1);
  };
  const undo = () => step('undo');
  const redo = () => step('redo');

  const targets = useMemo(() => (model ? targetsOf(model, specs.map((s) => s.data)) : EMPTY), [model, specs]);
  const gateway = useMemo(() => previewGateway(targets), [targets]);
  const paths = useMemo(() => (shown ? statePaths(shown, targets) : []), [shown, targets]);
  const findings = useMemo(
    () => (shown ? pageFindings(shown, targets, pages.map((p) => (p.slug === slug ? shown : p.data))) : []),
    [shown, targets, pages, slug],
  );
  const drafted = useMemo(() => (draft ? changedKeys(pageDiff(draft.base, draft.page)) : new Set<string>()), [draft]);
  const queryParams = useMemo(() => Object.fromEntries(new URLSearchParams(query)), [query]);
  const data = useMemo(() => (shown ? dataOf(shown, targets) : []), [shown, targets]);
  const usedServices = useMemo(
    () => (shown ? actionsOf(shown).flatMap(({ action }) => (action.do === 'call' ? [action.service] : [])) : []),
    [shown],
  );

  // ---- keyboard: ⌘Z / ⇧⌘Z, Del, ⌘D, ⌥↑/⌥↓, Esc - not while typing in a field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (!k) return;
      const t = e.target as HTMLElement | null;
      const inField = !!t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [aria-modal="true"]');
      const hit = designerKey(e, inField, k.canEdit, !!k.ops, k.can);
      if (!hit) return;
      if (hit.action !== 'deselect') e.preventDefault();
      if (!hit.run) return;
      const run: Record<DesignerKey, () => void> = {
        undo: k.undo, redo: k.redo, deselect: k.deselect,
        remove: () => k.ops?.remove(), duplicate: () => k.ops?.duplicate(),
        up: () => k.ops?.move(-1), down: () => k.ops?.move(1),
      };
      run[hit.action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!page || !shown) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-6">
        <button onClick={onBack} className={`text-[11px] ${c.muted2}`}>‹ Seiten</button>
        <p className={`mt-4 text-xs ${c.muted}`}>Die Seite «{slug}» gibt es nicht (mehr).</p>
      </div>
    );
  }

  const outline = flatten(shown.body);
  const block = selected ? blockAt(shown.body, selected) : undefined;
  // the latest state, not that of the render - two actions before the next render build on each other
  const body = () => (latest.current ?? page).body;
  const setBody = (next: Component[], coalesce?: string) => update({ ...(latest.current ?? page), body: next }, coalesce);
  const apply = (r: { body: Component[]; key: BlockKey }) => {
    setBody(r.body);
    setSelected(blockAt(r.body, r.key) ? r.key : null);
  };
  const add = (type: Component['type']) => {
    apply(insertBlock(body(), newBlock(type), selected ?? undefined, block?.type === 'section'));
    setAdding(false);
  };
  /** The actions for a building block - in the preview, in the header of the properties, in the outline. */
  const opsFor = (key: BlockKey): BlockOps => ({
    move: (by) => apply(moveBlock(body(), key, by)),
    duplicate: () => { const b = blockAt(body(), key); if (b) apply(placeBlock(body(), structuredClone(b), key, 'after')); },
    remove: () => { setBody(removeBlock(body(), key)); setSelected(null); },
    convert: (type) => { setBody(updateBlock(body(), key, (b) => convertBlock(b, type))); setSelected(key); },
    insert: (type, place: Place) => apply(placeBlock(body(), newBlock(type), key, place)),
    wrap: () => apply(wrapInSection(body(), key)),
    unwrap: () => apply(unwrapSection(body(), key)),
  });
  const ops = selected !== null && block ? opsFor(selected) : null;
  keys.current = {
    undo, redo, ops, deselect: () => setSelected(null), canEdit: editable,
    // read on key press - two ⌘Z before the next render each see the state of the previous one
    get can() { return { undo: history.current.past.length > 0, redo: history.current.future.length > 0 }; },
  };

  // ---- drag & drop in the outline: top/bottom of a row before/after it, middle of a section into it
  const placeAt = (e: React.DragEvent, isSection: boolean): Place => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (isSection) return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    return y < 0.5 ? 'before' : 'after';
  };
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warning').length;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className={`flex-shrink-0 flex items-center gap-3 px-3 py-2 border-b ${c.border} ${c.top}`}>
        {/* back only once saved - otherwise the editor stays open with the error */}
        <button onClick={() => void flush().then((ok) => ok && onBack())} className={`flex items-center gap-1 text-[11px] ${c.muted2}`}>
          <ChevronLeft size={12} /> Seiten
        </button>
        <span className={`text-xs font-semibold ${c.text}`}>{page.title || slug}</span>
        <span className={`text-[10px] font-mono ${c.muted}`}>/{page.path}</span>
        <AccessChip isDark={isDark} page={shown} />
        {/* a page for a user task: the way to it in the process (saved first, like «back») */}
        {userTasksOfPage(page).map((key) => {
          const at = userTaskStep(key, specs);
          const tone = isDark ? 'border-sky-500/30 bg-sky-500/15 text-sky-200' : 'border-sky-300 bg-sky-50 text-sky-800';
          return at && onOpenTask ? (
            <button key={key} onClick={() => void flush().then((ok) => ok && onOpenTask(at.slug, at.stepId))}
              title={`Diese Seite schliesst den Benutzer-Task «${at.step}» im Prozess «${at.process}» ab – Klick: zum Schritt`}
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border hover:underline ${tone}`}>
              <ClipboardCheck size={10} /> {at.step} <ArrowUpRight size={10} />
            </button>
          ) : (
            <span key={key} title={`Der Benutzer-Task «${key}» ist in keinem Prozess zu finden`}
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${tone}`}>
              <ClipboardCheck size={10} /> {key}
            </span>
          );
        })}
        {draft && (
          <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${isDark ? 'border-violet-500/40 bg-violet-500/15 text-violet-200' : 'border-violet-300 bg-violet-50 text-violet-800'}`}
            title="Die Vorschau zeigt den Entwurf von Claude - übernehmen oder verwerfen im Panel rechts">
            <Sparkles size={10} /> Entwurf
          </span>
        )}
        {(errors > 0 || warnings > 0) && (
          <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
            errors ? (isDark ? 'border-rose-500/30 text-rose-300' : 'border-rose-300 text-rose-700') : (isDark ? 'border-amber-500/30 text-amber-300' : 'border-amber-300 text-amber-700')}`}>
            <AlertTriangle size={10} /> {errors + warnings}
          </span>
        )}
        {canEdit && (
          <div className="ml-auto flex items-center gap-0.5">
            {aiKey && (
              <button onClick={() => setAiOpen((o) => !o)} title="Claude - die Seite im Gespräch ändern (KI-Modus)"
                className={`mr-1.5 flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${
                  aiOpen || draft ? (isDark ? 'border-violet-400/50 bg-violet-500/15 text-violet-200' : 'border-violet-400 bg-violet-50 text-violet-800') : c.btn}`}>
                <Sparkles size={11} /> Claude
              </button>
            )}
            <IconButton isDark={isDark} title="rückgängig (⌘Z)" disabled={!editable || history.current.past.length === 0} onClick={undo}><Undo2 size={12} /></IconButton>
            <IconButton isDark={isDark} title="wiederholen (⇧⌘Z)" disabled={!editable || history.current.future.length === 0} onClick={redo}><Redo2 size={12} /></IconButton>
          </div>
        )}
        <span className={`${canEdit ? '' : 'ml-auto '}text-[10px] ${saveState.error ? (isDark ? 'text-rose-300' : 'text-rose-700') : c.muted}`}>
          {!canEdit ? 'nur lesen' : saveState.error ?? (saveState.at ? `gespeichert ${saveState.at.toLocaleTimeString('de-CH')}` : '')}
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Outline */}
        <div className={`${left === 'data' ? 'w-80' : 'w-64'} flex-shrink-0 border-r overflow-y-auto ${c.border} ${c.panel}`}>
          <div className={`sticky top-0 z-10 flex border-b ${c.border} ${isDark ? 'bg-[#141518]' : 'bg-[#fbfaf7]'}`}>
            {(['outline', 'data'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setLeft(t)}
                className={`flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest border-b-2 ${
                  left === t ? 'border-sky-500 ' + c.text : 'border-transparent ' + c.muted2}`}>
                {t === 'outline' ? 'Aufbau' : 'Daten'}
              </button>
            ))}
          </div>
          {left === 'data' ? (
            <DataView isDark={isDark} nodes={data} targets={targets} usedServices={usedServices}
              onSelect={(key) => { setSelected(key); setLeft('outline'); }} />
          ) : (<>
          <button onClick={() => setSelected(null)}
            className={`w-full text-left px-3 py-1.5 text-[11px] ${selected === null ? (isDark ? 'bg-sky-500/15 text-sky-200' : 'bg-sky-50 text-sky-900') : c.hover}`}>
            Seite · {shown.title}
          </button>
          {outline.map(({ key, block: b, depth }) => {
            const over = drag?.over === key ? drag.place : undefined;
            return (
              <div key={key} draggable={editable}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); setDrag({ from: key }); }}
                onDragOver={(e) => {
                  if (!drag || drag.from === key || key.startsWith(`${drag.from}.`)) return;
                  e.preventDefault();
                  const place = placeAt(e, b.type === 'section');
                  if (drag.over !== key || drag.place !== place) setDrag({ ...drag, over: key, place });
                }}
                // only when leaving the row - not when moving to its icon, its text, its buttons
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  if (drag?.over === key) setDrag({ from: drag.from });
                }}
                onDrop={(e) => { e.preventDefault(); if (drag?.over && drag.place) apply(relocateBlock(body(), drag.from, drag.over, drag.place)); setDrag(null); }}
                onDragEnd={() => setDrag(null)}
                onClick={() => setSelected(key)}
                style={{ paddingLeft: `${4 + depth * 14}px` }}
                className={`group relative w-full flex items-center gap-1.5 pr-1 py-1 text-[11px] cursor-pointer border-y-2 ${
                  over === 'before' ? 'border-t-sky-500 border-b-transparent' : over === 'after' ? 'border-b-sky-500 border-t-transparent' : 'border-transparent'} ${
                  over === 'inside' ? 'ring-2 ring-inset ring-sky-500' : ''} ${
                  drag?.from === key ? 'opacity-40' : ''} ${
                  selected === key ? (isDark ? 'bg-sky-500/15 text-sky-200' : 'bg-sky-50 text-sky-900') : c.hover}`}>
                {editable && <GripVertical size={11} className={`flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-60 ${c.muted}`} />}
                <span className={drafted.has(key) ? (isDark ? 'text-violet-300' : 'text-violet-600') : c.muted}
                  title={drafted.has(key) ? 'im Entwurf neu oder geändert' : undefined}>{ICONS[b.type]}</span>
                <span className="truncate flex-1">{summaryOf(b) || BLOCK_LABELS[b.type]}</span>
                {b.visible && <span className={`text-[9px] group-hover:hidden ${c.muted}`} title={`sichtbar, wenn ${b.visible}`}>if</span>}
                {editable && (
                  <span className="hidden group-hover:flex">
                    <BlockActions isDark={isDark} block={b} ops={opsFor(key)} compact />
                  </span>
                )}
              </div>
            );
          })}
          {editable && (
            <div className="px-3 py-2 space-y-2">
              {outline.length > 1 && (
                <p className={`text-[9px] leading-snug ${c.muted}`}>
                  Ziehen zum Verschieben (mitten auf einen Abschnitt: hinein) · Entf löscht · ⌘D verdoppelt · ⌥↑↓ verschiebt · ⌘Z rückgängig
                </p>
              )}
              <div className="relative">
                <button onClick={() => setAdding((a) => !a)}
                  className={`w-full flex items-center justify-center gap-1 text-[11px] px-2 py-1.5 rounded border ${c.btn}`}>
                  <Plus size={11} /> Baustein {block?.type === 'section' ? 'in den Abschnitt' : selected !== null ? 'danach' : ''}
                </button>
                {adding && (
                  <div className={`absolute z-10 mt-1 w-full rounded border shadow-lg ${c.border2} ${c.panelStrong}`}>
                    {(Object.keys(BLOCK_LABELS) as Component['type'][]).map((t) => (
                      <button key={t} onClick={() => add(t)} className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-[11px] ${c.hover}`}>
                        <span className={c.muted}>{ICONS[t]}</span> {BLOCK_LABELS[t]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          </>)}
          {findings.length > 0 && (
            <div className={`border-t px-3 py-2 space-y-1.5 ${c.border}`}>
              <div className={`text-[10px] font-semibold uppercase tracking-widest ${c.muted2}`}>Befunde</div>
              {findings.map((f, i) => (
                <button key={i} onClick={() => f.key !== undefined && setSelected(f.key)}
                  className={`w-full flex gap-1.5 text-left text-[10px] leading-snug ${
                    f.level === 'error' ? (isDark ? 'text-rose-300' : 'text-rose-700')
                      : f.level === 'warning' ? (isDark ? 'text-amber-300' : 'text-amber-700') : c.muted}`}>
                  {f.level === 'info' ? <Info size={10} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={10} className="mt-0.5 flex-shrink-0" />}
                  <span>{f.message}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Preview - the same renderer as the app */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b text-[10px] ${c.border} ${c.muted2}`}>
            <span className="font-semibold uppercase tracking-widest">Vorschau</span>
            <span className={c.muted} title="Services liefern Beispieldaten aus ihrem Out-Typ; Starts, Messages und Tasks gelingen nur zum Schein. Echt bucht die App (/app/… über den Gateway).">
              Beispieldaten · nichts wird gebucht oder gesendet
            </span>
            <label className="ml-auto flex items-center gap-1">
              ?<input value={query} onChange={(e) => setQuery(e.target.value)} title="Die Parameter der URL, z.B. token"
                className={`w-72 font-mono text-[10px] px-1.5 py-0.5 rounded border outline-none ${c.input}`} />
            </label>
            <IconButton isDark={isDark} title="Vorschau neu starten" onClick={() => setRun((r) => r + 1)}><RotateCcw size={11} /></IconButton>
          </div>
          {/* a click next to the building blocks selects the page - its properties: state, loading, access */}
          <div className={`flex-1 overflow-y-auto cursor-default ${isDark ? 'bg-[var(--orch-bg,#0e0f11)]' : 'bg-[var(--orch-bg,#f5f4f0)]'} ${
            selected === null ? 'outline-2 -outline-offset-4 outline-sky-500/50' : ''}`}
            style={themeStyle(pagesApp?.data.theme, isDark)}
            onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-designer-block]')) setSelected(null); }}>
            {/* restarted when what the page reads at start changes (state, loading, access) - not on
                every keystroke in a text: it shows that anyway */}
            <PageView key={`${run}:${query}:${JSON.stringify([shown.state, shown.load, shown.access])}`} page={shown} app={pagesApp?.data ?? {}} isDark={isDark}
              gateway={gateway} query={queryParams}
              user={shown.access === 'public' ? undefined : { name: 'Vorschau', roles: shown.access.roles }}
              designer={{
                selected: selected ?? undefined, onSelect: setSelected,
                toolbar: editable ? (key) => { const b = blockAt(shown.body, key); return b ? <BlockActions isDark={isDark} block={b} ops={opsFor(key)} compact /> : null; } : undefined,
              }} />
          </div>
        </div>

        {/* Claude (only with a key) - stays mounted while hidden, so the conversation is kept */}
        {aiKey && canEdit && (
          <div className={`w-[400px] flex-shrink-0 border-l ${c.border} ${c.panel} ${aiOpen || draft ? '' : 'hidden'}`}>
            <Suspense fallback={<Loader2 size={14} className="animate-spin m-4" />}>
            <AiPanel isDark={isDark} apiKey={aiKey} slug={slug} page={page} app={pagesApp?.data} targets={targets}
              pages={pages.map((p) => ({ slug: p.slug, page: p.slug === slug ? page : p.data }))}
              draft={draft} onDraft={setDraft} onSelect={(key) => { setSelected(key); setLeft('outline'); }}
              onAccept={(next) => { update(next); setSelected((s) => (s !== null && blockAt(next.body, s) ? s : null)); }}
              initialPrompt={pendingPrompt} onInitialPrompt={() => setPendingPrompt(undefined)} />
            </Suspense>
          </div>
        )}
        {/* Properties */}
        <div className={`w-[400px] flex-shrink-0 border-l overflow-y-auto ${c.border} ${c.panel} ${aiKey && canEdit && (aiOpen || draft) ? 'hidden' : ''}`}>
          {block && selected !== null ? (
            // key: another building block gets fresh forms (no half JSON text of the previous one)
            <>
              {editable && ops && (
                <div className={`sticky top-0 z-20 px-3 py-1.5 border-b space-y-1 ${c.border} ${isDark ? 'bg-[#141518]' : 'bg-[#fbfaf7]'}`}>
                  <div className="flex items-center gap-2">
                    <span className={c.muted}>{ICONS[block.type]}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-widest ${c.muted2}`}>{BLOCK_LABELS[block.type]}</span>
                  </div>
                  <BlockActions isDark={isDark} block={block} ops={ops} />
                </div>
              )}
              <BlockProps key={selected} isDark={isDark} block={block} targets={targets} paths={paths}
                onChange={(b) => setBody(updateBlock(body(), selected, () => b), coalesceKey(`props:${selected}`, blockAt(body(), selected), b))} />
            </>
          ) : (
            <PageProps key="page" isDark={isDark} page={page} targets={targets} paths={paths} onChange={(p) => update(p, coalesceKey('page', latest.current ?? page, p))} />
          )}
        </div>
      </div>
    </div>
  );
}

export function AccessChip({ isDark, page }: { isDark: boolean; page: Page }) {
  return page.access === 'public' ? (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${isDark ? 'border-emerald-500/30 text-emerald-300' : 'border-emerald-300 text-emerald-800'}`}
      title="ohne Login - der Gateway gibt die Aufrufe öffentlich frei">öffentlich</span>
  ) : (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${isDark ? 'border-blue-500/30 text-blue-300' : 'border-blue-300 text-blue-700'}`}
      title="mit Login">{page.access.roles.join(', ') || 'Login'}</span>
  );
}
