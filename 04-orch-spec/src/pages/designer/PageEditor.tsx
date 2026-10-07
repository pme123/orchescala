// The designer of a page (E15): the outline of its blocks, the page live - with the same renderer
// as the app, fed with sample data of the services - and the properties of the selected block.
import {
  AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, Copy, Heading, Info, ListChecks, Loader2, MousePointerClick, Plus,
  RotateCcw, Rows3, SquareDashed, TextCursorInput, Trash2, Type, CalendarRange,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePermissions } from '../../auth';
import { useStore } from '../../store';
import { cls } from '../../ui';
import PageView from '../runtime/PageView';
import type { Gateway } from '../runtime/gatewayTypes';
import type { Component, Page } from '../runtime/spec';
import { BLOCK_LABELS, BlockProps, PageProps } from './BlockProps';
import { IconButton } from './fields';
import {
  blockAt, flatten, insertBlock, moveBlock, newBlock, pageFindings, removeBlock, sampleOf, statePaths, targetsOf,
  updateBlock, type BlockKey, type Targets,
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

/** What the outline shows of a block. */
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

/** The gateway of the preview: sample data of the Out of a service, a start and the rest succeed. */
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
  const [saveState, setSaveState] = useState<{ at?: Date; error?: string }>({});

  // ---- saving: a second after the last change, and when leaving
  const pending = useRef<Page | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const data = pending.current;
    if (!data) return;
    pending.current = null;
    const r = await savePage(slug, data, version.current);
    if (r.status === 'saved') {
      version.current = r.version;
      setSaveState({ at: new Date() });
    } else if (r.status === 'conflict') setSaveState({ error: 'Die Datei wurde inzwischen geändert – Seite neu laden.' });
    else setSaveState({ error: r.message });
  }, [slug, savePage]);
  useEffect(() => () => void flush(), [flush]);
  const update = (next: Page) => {
    if (!canEdit) return;
    setPage(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1000);
  };

  const targets = useMemo(() => (model ? targetsOf(model, specs.map((s) => s.data)) : EMPTY), [model, specs]);
  const gateway = useMemo(() => previewGateway(targets), [targets]);
  const paths = useMemo(() => (page ? statePaths(page, targets) : []), [page, targets]);
  const findings = useMemo(
    () => (page ? pageFindings(page, targets, pages.map((p) => (p.slug === slug ? page : p.data))) : []),
    [page, targets, pages, slug],
  );
  const queryParams = useMemo(() => Object.fromEntries(new URLSearchParams(query)), [query]);

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
  const setBody = (body: Component[]) => update({ ...page, body });
  const add = (type: Component['type']) => {
    const r = insertBlock(page.body, newBlock(type), selected ?? undefined, block?.type === 'section');
    setBody(r.body);
    setSelected(r.key);
    setAdding(false);
  };
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warning').length;

  return (
    <div className="flex flex-col h-full">
      {/* Werkzeugleiste */}
      <div className={`flex-shrink-0 flex items-center gap-3 px-3 py-2 border-b ${c.border} ${c.top}`}>
        <button onClick={() => void flush().then(onBack)} className={`flex items-center gap-1 text-[11px] ${c.muted2}`}>
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
        <span className={`ml-auto text-[10px] ${saveState.error ? (isDark ? 'text-rose-300' : 'text-rose-700') : c.muted}`}>
          {!canEdit ? 'nur lesen' : saveState.error ?? (saveState.at ? `gespeichert ${saveState.at.toLocaleTimeString('de-CH')}` : '')}
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Gliederung */}
        <div className={`w-64 flex-shrink-0 border-r overflow-y-auto ${c.border} ${c.panel}`}>
          <div className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-widest ${c.muted2}`}>Aufbau</div>
          <button onClick={() => setSelected(null)}
            className={`w-full text-left px-3 py-1.5 text-[11px] ${selected === null ? (isDark ? 'bg-sky-500/15 text-sky-200' : 'bg-sky-50 text-sky-900') : c.hover}`}>
            Seite · {page.title}
          </button>
          {outline.map(({ key, block: b, depth }) => (
            <button key={key} onClick={() => setSelected(key)} style={{ paddingLeft: `${12 + depth * 14}px` }}
              className={`w-full flex items-center gap-2 text-left pr-3 py-1.5 text-[11px] ${
                selected === key ? (isDark ? 'bg-sky-500/15 text-sky-200' : 'bg-sky-50 text-sky-900') : c.hover}`}>
              <span className={c.muted}>{ICONS[b.type]}</span>
              <span className="truncate">{summaryOf(b) || BLOCK_LABELS[b.type]}</span>
              {b.visible && <span className={`ml-auto text-[9px] ${c.muted}`} title={`sichtbar, wenn ${b.visible}`}>if</span>}
            </button>
          ))}
          {canEdit && (
            <div className="px-3 py-2 space-y-2">
              {selected !== null && (
                <div className="flex gap-1">
                  <IconButton isDark={isDark} title="nach oben" onClick={() => { const r = moveBlock(page.body, selected, -1); setBody(r.body); setSelected(r.key); }}><ArrowUp size={12} /></IconButton>
                  <IconButton isDark={isDark} title="nach unten" onClick={() => { const r = moveBlock(page.body, selected, 1); setBody(r.body); setSelected(r.key); }}><ArrowDown size={12} /></IconButton>
                  <IconButton isDark={isDark} title="verdoppeln" onClick={() => { if (!block) return; const r = insertBlock(page.body, structuredClone(block), selected); setBody(r.body); setSelected(r.key); }}><Copy size={12} /></IconButton>
                  <IconButton isDark={isDark} title="entfernen" onClick={() => { setBody(removeBlock(page.body, selected)); setSelected(null); }}><Trash2 size={12} /></IconButton>
                </div>
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
            <span className={c.muted}>Beispieldaten aus den Out-Typen der Services</span>
            <label className="ml-auto flex items-center gap-1">
              ?<input value={query} onChange={(e) => setQuery(e.target.value)} title="Die Parameter der URL, z.B. token"
                className={`w-72 font-mono text-[10px] px-1.5 py-0.5 rounded border outline-none ${c.input}`} />
            </label>
            <IconButton isDark={isDark} title="Vorschau neu starten" onClick={() => setRun((r) => r + 1)}><RotateCcw size={11} /></IconButton>
          </div>
          <div className={`flex-1 overflow-y-auto ${isDark ? 'bg-[#0e0f11]' : 'bg-[#f5f4f0]'}`}>
            <PageView key={`${run}:${query}:${JSON.stringify(page)}`} page={page} app={pagesApp?.data ?? {}} isDark={isDark}
              gateway={gateway} query={queryParams}
              user={page.access === 'public' ? undefined : { name: 'Vorschau', roles: page.access.roles }}
              designer={{ selected: selected ?? undefined, onSelect: setSelected }} />
          </div>
        </div>

        {/* Eigenschaften */}
        <div className={`w-[400px] flex-shrink-0 border-l overflow-y-auto ${c.border} ${c.panel}`}>
          {block && selected !== null ? (
            <BlockProps isDark={isDark} block={block} targets={targets} paths={paths}
              onChange={(b) => setBody(updateBlock(page.body, selected, () => b))} />
          ) : (
            <PageProps isDark={isDark} page={page} targets={targets} paths={paths} onChange={update} />
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
