// Der Designer einer Seite (E15): die Gliederung ihrer Bausteine, die Seite live - mit demselben Renderer
// wie die App, gespeist mit Beispieldaten der Services - und die Eigenschaften des ausgewählten Bausteins.
import {
  AlertTriangle, ChevronLeft, GripVertical, Heading, Info, ListChecks, Loader2, MousePointerClick, Plus, Redo2,
  RotateCcw, Rows3, SquareDashed, TextCursorInput, Type, CalendarRange, Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePermissions } from '../../auth';
import { useStore } from '../../store';
import { cls } from '../../ui';
import PageView from '../runtime/PageView';
import { themeStyle } from '../runtime/theme';
import type { Gateway } from '../runtime/gatewayTypes';
import type { Component, Page } from '../runtime/spec';
import { BlockActions, type BlockOps } from './BlockActions';
import { BLOCK_LABELS, BlockProps, PageProps } from './BlockProps';
import { DataView } from './DataView';
import { IconButton } from './fields';
import { emptyHistory, record, travel, type History } from './history';
import {
  actionsOf, blockAt, convertBlock, dataOf, flatten, insertBlock, moveBlock, newBlock, pageFindings, placeBlock, relocateBlock, removeBlock,
  sampleOf, statePaths, targetsOf, unwrapSection, updateBlock, wrapInSection, type BlockKey, type Place, type Targets,
} from './model';

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

/** Was die Gliederung von einem Baustein zeigt. */
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

/** Der Gateway der Vorschau: Beispieldaten des Out eines Service, ein Start und der Rest gelingen. */
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

export default function PageEditor({ slug, onBack }: { slug: string; onBack: () => void }) {
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
  // die Tastatur liest immer die Aktionen dieses Renderns (sie hängen an Seite und Auswahl)
  const keys = useRef<{ undo: () => void; redo: () => void; ops: BlockOps | null; deselect: () => void }>(null!);
  const [saveState, setSaveState] = useState<{ at?: Date; error?: string }>({});

  // ---- speichern: eine Sekunde nach der letzten Änderung und beim Verlassen - ein Schreiben nach dem
  // anderen (das nächste braucht die Version des vorigen), ein fehlgeschlagenes bleibt ausstehend
  const pending = useRef<Page | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean>>(Promise.resolve(true));
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    saving.current = saving.current.then(async () => {
      const data = pending.current;
      if (!data) return true;
      pending.current = null;
      const r = await savePage(slug, data, version.current);
      if (r.status === 'saved') {
        version.current = r.version;
        setSaveState({ at: new Date() });
        return true;
      }
      // nicht verlieren: bleibt ausstehend, solange nichts Neueres kam
      pending.current ??= data;
      setSaveState({ error: r.status === 'conflict' ? 'Die Datei wurde inzwischen geändert – Seite neu laden.' : r.message });
      return false;
    });
    return saving.current;
  }, [slug, savePage]);
  useEffect(() => {
    // beim Verlassen der Seite oder des Tabs - React räumt beim Schliessen nicht auf
    const now = () => void flush();
    const hidden = () => document.visibilityState === 'hidden' && now();
    window.addEventListener('pagehide', now);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', now);
      document.removeEventListener('visibilitychange', hidden);
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

  // ---- rückgängig: jede Änderung der Seite; Tippen in einem Feld ist ein Schritt (history.ts). Die Stände
  // gehören zu dieser Seite: der Designer hängt den Editor mit key={slug} ein, eine andere Seite beginnt neu
  // (und das Aufräumen oben speichert, was noch aussteht). Refs, nicht Zustand: zwei Schritte vor dem
  // nächsten Rendern (⌘Z gedrückt gehalten) sehen so je den Stand des vorigen - `page` wäre noch der alte.
  const history = useRef<History<Page>>(emptyHistory());
  const latest = useRef<Page | null>(null);
  latest.current ??= page;
  const [, setHistoryTick] = useState(0);
  const update = (next: Page, coalesce?: string) => {
    const current = latest.current ?? page;
    if (!canEdit || !current) return;
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
    // ein Baustein, den es danach nicht mehr gibt, ist nicht mehr gewählt
    setSelected((s) => (s !== null && blockAt(done.value.body, s) ? s : null));
    setHistoryTick((t) => t + 1);
  };
  const undo = () => step('undo');
  const redo = () => step('redo');

  const targets = useMemo(() => (model ? targetsOf(model, specs.map((s) => s.data)) : EMPTY), [model, specs]);
  const gateway = useMemo(() => previewGateway(targets), [targets]);
  const paths = useMemo(() => (page ? statePaths(page, targets) : []), [page, targets]);
  const findings = useMemo(
    () => (page ? pageFindings(page, targets, pages.map((p) => (p.slug === slug ? page : p.data))) : []),
    [page, targets, pages, slug],
  );
  const queryParams = useMemo(() => Object.fromEntries(new URLSearchParams(query)), [query]);
  const data = useMemo(() => (page ? dataOf(page, targets) : []), [page, targets]);
  const usedServices = useMemo(
    () => (page ? actionsOf(page).flatMap(({ action }) => (action.do === 'call' ? [action.service] : [])) : []),
    [page],
  );

  // ---- Tastatur: ⌘Z / ⇧⌘Z, Entf, ⌘D, ⌥↑/⌥↓, Esc - nicht beim Tippen in einem Feld
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // schon behandelt, beim Tippen in einem Feld, in einem Dialog darüber: nicht für den Designer
      if (e.defaultPrevented) return;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [aria-modal="true"]'))) return;
      const k = keys.current;
      if (!k) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) k.redo(); else k.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); k.redo(); return; }
      if (e.key === 'Escape') { k.deselect(); return; }
      if (!k.ops) return;
      // nur Entf - Backspace auf einem Knopf oder der Seite löschte sonst ungewollt
      // gedrückt gehalten: einmal löschen / verdoppeln, nicht ein Baustein je Wiederholung (⌘Z und ⌥↑↓ dürfen)
      if (e.key === 'Delete') { e.preventDefault(); if (!e.repeat) k.ops.remove(); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (!e.repeat) k.ops.duplicate(); }
      else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); k.ops.move(-1); }
      else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); k.ops.move(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!page) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-6">
        <button onClick={onBack} className={`text-[11px] ${c.muted2}`}>‹ Seiten</button>
        <p className={`mt-4 text-xs ${c.muted}`}>Die Seite «{slug}» gibt es nicht (mehr).</p>
      </div>
    );
  }

  const outline = flatten(page.body);
  const block = selected ? blockAt(page.body, selected) : undefined;
  const setBody = (body: Component[], coalesce?: string) => update({ ...page, body }, coalesce);
  const apply = (r: { body: Component[]; key: BlockKey }) => {
    setBody(r.body);
    setSelected(blockAt(r.body, r.key) ? r.key : null);
  };
  const add = (type: Component['type']) => {
    apply(insertBlock(page.body, newBlock(type), selected ?? undefined, block?.type === 'section'));
    setAdding(false);
  };
  /** Die Aktionen für einen Baustein - in der Vorschau, im Kopf der Eigenschaften, in der Gliederung. */
  const opsFor = (key: BlockKey): BlockOps => ({
    move: (by) => apply(moveBlock(page.body, key, by)),
    duplicate: () => { const b = blockAt(page.body, key); if (b) apply(placeBlock(page.body, structuredClone(b), key, 'after')); },
    remove: () => { setBody(removeBlock(page.body, key)); setSelected(null); },
    convert: (type) => { setBody(updateBlock(page.body, key, (b) => convertBlock(b, type))); setSelected(key); },
    insert: (type, place: Place) => apply(placeBlock(page.body, newBlock(type), key, place)),
    wrap: () => apply(wrapInSection(page.body, key)),
    unwrap: () => apply(unwrapSection(page.body, key)),
  });
  const ops = selected !== null && block ? opsFor(selected) : null;
  keys.current = { undo, redo, ops, deselect: () => setSelected(null) };

  // ---- Drag & Drop in der Gliederung: oben/unten an einer Zeile davor/danach, mitten in einem Abschnitt hinein
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
      {/* Werkzeugleiste */}
      <div className={`flex-shrink-0 flex items-center gap-3 px-3 py-2 border-b ${c.border} ${c.top}`}>
        {/* zurück erst, wenn gespeichert ist - sonst bleibt der Editor mit dem Fehler offen */}
        <button onClick={() => void flush().then((ok) => ok && onBack())} className={`flex items-center gap-1 text-[11px] ${c.muted2}`}>
          <ChevronLeft size={12} /> Seiten
        </button>
        <span className={`text-xs font-semibold ${c.text}`}>{page.title || slug}</span>
        <span className={`text-[10px] font-mono ${c.muted}`}>/{page.path}</span>
        <AccessChip isDark={isDark} page={page} />
        {(errors > 0 || warnings > 0) && (
          <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
            errors ? (isDark ? 'border-rose-500/30 text-rose-300' : 'border-rose-300 text-rose-700') : (isDark ? 'border-amber-500/30 text-amber-300' : 'border-amber-300 text-amber-700')}`}>
            <AlertTriangle size={10} /> {errors + warnings}
          </span>
        )}
        {canEdit && (
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton isDark={isDark} title="rückgängig (⌘Z)" disabled={history.current.past.length === 0} onClick={undo}><Undo2 size={12} /></IconButton>
            <IconButton isDark={isDark} title="wiederholen (⇧⌘Z)" disabled={history.current.future.length === 0} onClick={redo}><Redo2 size={12} /></IconButton>
          </div>
        )}
        <span className={`${canEdit ? '' : 'ml-auto '}text-[10px] ${saveState.error ? (isDark ? 'text-rose-300' : 'text-rose-700') : c.muted}`}>
          {!canEdit ? 'nur lesen' : saveState.error ?? (saveState.at ? `gespeichert ${saveState.at.toLocaleTimeString('de-CH')}` : '')}
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Gliederung */}
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
            Seite · {page.title}
          </button>
          {outline.map(({ key, block: b, depth }) => {
            const over = drag?.over === key ? drag.place : undefined;
            return (
              <div key={key} draggable={canEdit}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); setDrag({ from: key }); }}
                onDragOver={(e) => {
                  if (!drag || drag.from === key || key.startsWith(`${drag.from}.`)) return;
                  e.preventDefault();
                  const place = placeAt(e, b.type === 'section');
                  if (drag.over !== key || drag.place !== place) setDrag({ ...drag, over: key, place });
                }}
                onDragLeave={() => drag?.over === key && setDrag({ from: drag.from })}
                onDrop={(e) => { e.preventDefault(); if (drag?.over && drag.place) apply(relocateBlock(page.body, drag.from, drag.over, drag.place)); setDrag(null); }}
                onDragEnd={() => setDrag(null)}
                onClick={() => setSelected(key)}
                style={{ paddingLeft: `${4 + depth * 14}px` }}
                className={`group relative w-full flex items-center gap-1.5 pr-1 py-1 text-[11px] cursor-pointer border-y-2 ${
                  over === 'before' ? 'border-t-sky-500 border-b-transparent' : over === 'after' ? 'border-b-sky-500 border-t-transparent' : 'border-transparent'} ${
                  over === 'inside' ? 'ring-2 ring-inset ring-sky-500' : ''} ${
                  drag?.from === key ? 'opacity-40' : ''} ${
                  selected === key ? (isDark ? 'bg-sky-500/15 text-sky-200' : 'bg-sky-50 text-sky-900') : c.hover}`}>
                {canEdit && <GripVertical size={11} className={`flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-60 ${c.muted}`} />}
                <span className={c.muted}>{ICONS[b.type]}</span>
                <span className="truncate flex-1">{summaryOf(b) || BLOCK_LABELS[b.type]}</span>
                {b.visible && <span className={`text-[9px] group-hover:hidden ${c.muted}`} title={`sichtbar, wenn ${b.visible}`}>if</span>}
                {canEdit && (
                  <span className="hidden group-hover:flex">
                    <BlockActions isDark={isDark} block={b} ops={opsFor(key)} compact />
                  </span>
                )}
              </div>
            );
          })}
          {canEdit && (
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

        {/* Vorschau - derselbe Renderer wie die App */}
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
          {/* ein Klick neben die Bausteine wählt die Seite - ihre Eigenschaften: Zustand, Laden, Zugang */}
          <div className={`flex-1 overflow-y-auto cursor-default ${isDark ? 'bg-[#0e0f11]' : 'bg-[var(--orch-bg,#f5f4f0)]'} ${
            selected === null ? 'outline-2 -outline-offset-4 outline-sky-500/50' : ''}`}
            style={themeStyle(pagesApp?.data.theme, isDark)}
            onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-designer-block]')) setSelected(null); }}>
            <PageView key={`${run}:${query}:${JSON.stringify(page)}`} page={page} app={pagesApp?.data ?? {}} isDark={isDark}
              gateway={gateway} query={queryParams}
              user={page.access === 'public' ? undefined : { name: 'Vorschau', roles: page.access.roles }}
              designer={{
                selected: selected ?? undefined, onSelect: setSelected,
                toolbar: canEdit ? (key) => { const b = blockAt(page.body, key); return b ? <BlockActions isDark={isDark} block={b} ops={opsFor(key)} compact /> : null; } : undefined,
              }} />
          </div>
        </div>

        {/* Eigenschaften */}
        <div className={`w-[400px] flex-shrink-0 border-l overflow-y-auto ${c.border} ${c.panel}`}>
          {block && selected !== null ? (
            // key: ein anderer Baustein bekommt frische Formulare (kein halber JSON-Text des vorigen)
            <>
              {canEdit && ops && (
                <div className={`sticky top-0 z-20 px-3 py-1.5 border-b space-y-1 ${c.border} ${isDark ? 'bg-[#141518]' : 'bg-[#fbfaf7]'}`}>
                  <div className="flex items-center gap-2">
                    <span className={c.muted}>{ICONS[block.type]}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-widest ${c.muted2}`}>{BLOCK_LABELS[block.type]}</span>
                  </div>
                  <BlockActions isDark={isDark} block={block} ops={ops} />
                </div>
              )}
              <BlockProps key={selected} isDark={isDark} block={block} targets={targets} paths={paths}
                onChange={(b) => setBody(updateBlock(page.body, selected, () => b), `props:${selected}`)} />
            </>
          ) : (
            <PageProps key="page" isDark={isDark} page={page} targets={targets} paths={paths} onChange={(p) => update(p, 'page')} />
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
