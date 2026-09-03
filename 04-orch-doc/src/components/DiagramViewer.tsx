// BPMN/DMN viewer for the diagrams referenced in the API descriptions —
// the same inline rendering the Redoc page does with bpmn-js/dmn-js.
// The heavy libraries load lazily (own chunk), only when a diagram is shown.
// The canvas stays light in dark mode — inverting would falsify the colours.
import { Download, ImageDown, Maximize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cls } from '../ui';

interface Viewer { destroy(): void; saveSvg?: () => Promise<string> }

async function renderBpmn(container: HTMLElement, xml: string): Promise<Viewer> {
  await Promise.all([
    import('bpmn-js/dist/assets/diagram-js.css'),
    import('bpmn-js/dist/assets/bpmn-js.css'),
    import('bpmn-js/dist/assets/bpmn-font/css/bpmn.css'),
  ]);
  const { default: NavigatedViewer } = await import('bpmn-js/lib/NavigatedViewer');
  const viewer = new NavigatedViewer({ container });
  await viewer.importXML(xml);
  (viewer.get('canvas') as { zoom(v: string, center?: string): void }).zoom('fit-viewport', 'auto');
  const v = viewer as unknown as Viewer & { saveSVG(): Promise<{ svg: string }> };
  v.saveSvg = async () => (await v.saveSVG()).svg;
  return v;
}

async function renderDmn(container: HTMLElement, xml: string): Promise<Viewer> {
  await Promise.all([
    import('dmn-js/dist/assets/diagram-js.css'),
    import('dmn-js/dist/assets/dmn-js-shared.css'),
    import('dmn-js/dist/assets/dmn-js-drd.css'),
    import('dmn-js/dist/assets/dmn-js-decision-table.css'),
    import('dmn-js/dist/assets/dmn-js-decision-table-controls.css'),
    import('dmn-js/dist/assets/dmn-js-literal-expression.css'),
    import('dmn-js/dist/assets/dmn-font/css/dmn.css'),
  ]);
  const { default: DmnViewer } = await import('dmn-js/lib/NavigatedViewer');
  const viewer = new DmnViewer({ container }) as unknown as {
    destroy(): void;
    importXML(xml: string): Promise<unknown>;
    getViews(): { type: string }[];
    open(view: { type: string }): Promise<unknown>;
    getActiveViewer(): { get(name: string): { zoom(v: string): void } } | undefined;
  };
  await viewer.importXML(xml);
  // a single decision table is more useful than a DRD with one box
  const views = viewer.getViews();
  const decisions = views.filter(v => v.type !== 'drd');
  if (decisions.length === 1) await viewer.open(decisions[0]);
  try { viewer.getActiveViewer()?.get('canvas')?.zoom('fit-viewport'); } catch { /* decision tables have no canvas */ }
  const v = viewer as unknown as Viewer & { getActiveViewer(): { saveSVG?(): Promise<{ svg: string }> } | undefined };
  v.saveSvg = async () => {
    const active = v.getActiveViewer();
    if (!active?.saveSVG) throw new Error('SVG export works on the DRD view — switch via «View DRD»');
    return (await active.saveSVG()).svg;
  };
  return v;
}

export default function DiagramViewer({ url, name, isDark }: { url: string; name: string; isDark: boolean }) {
  const c = cls(isDark);
  const ref = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer>(undefined);
  const [state, setState] = useState<'loading' | 'ok' | string>('loading');
  const [exportErr, setExportErr] = useState('');
  const [tall, setTall] = useState(false);
  const isDmn = name.endsWith('.dmn');

  const exportSvg = async () => {
    setExportErr('');
    try {
      const svg = await viewerRef.current?.saveSvg?.();
      if (!svg) return;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name.replace(/\.(bpmn|dmn)$/i, '.svg');
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setExportErr(String((e as Error).message ?? e)); }
  };

  useEffect(() => {
    let alive = true;
    let viewer: Viewer | undefined;
    setState('loading');
    (async () => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      if (!alive || !ref.current) return;
      ref.current.innerHTML = '';
      viewer = await (isDmn ? renderDmn(ref.current, xml) : renderBpmn(ref.current, xml));
      viewerRef.current = viewer;
      if (alive) setState('ok');
    })().catch(e => alive && setState(String((e as Error).message ?? e)));
    return () => { alive = false; viewer?.destroy(); viewerRef.current = undefined; };
  }, [url, isDmn, tall]);

  return (
    <div className={`rounded-lg border overflow-hidden mb-3 ${c.border}`}>
      <div className={`flex items-center gap-2 px-2.5 py-1.5 border-b ${c.border} ${isDark ? 'bg-white/3' : 'bg-black/3'}`}>
        <span className={`text-[9px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
          isDmn
            ? isDark ? 'bg-teal-500/15 text-teal-300 border-teal-500/30' : 'bg-teal-50 text-teal-700 border-teal-300'
            : isDark ? 'bg-violet-500/15 text-violet-300 border-violet-500/30' : 'bg-violet-50 text-violet-700 border-violet-300'
        }`}>{isDmn ? 'DMN' : 'BPMN'}</span>
        <span className={`text-[10.5px] font-semibold truncate ${c.text}`}>{name}</span>
        {state !== 'ok' && state !== 'loading' && <span className={`text-[10px] ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>{state}</span>}
        {exportErr && <span className={`text-[10px] truncate ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>{exportErr}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={exportSvg} title="Export as SVG" disabled={state !== 'ok'}
            className={`flex items-center gap-1 p-1 rounded transition-colors disabled:opacity-30 ${isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'}`}>
            <ImageDown size={11} /><span className="text-[9px]">SVG</span>
          </button>
          <button onClick={() => setTall(t => !t)} title={tall ? 'Smaller' : 'Larger'}
            className={`p-1 rounded transition-colors ${isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'}`}>
            <Maximize2 size={11} />
          </button>
          <a href={url} download={name} title="Download"
            className={`p-1 rounded transition-colors ${isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'}`}>
            <Download size={11} />
          </a>
        </div>
      </div>
      <div className="relative bg-white" style={{ height: tall ? 640 : isDmn ? 420 : 340 }}>
        {state === 'loading' && <div className="absolute inset-0 flex items-center justify-center text-[10px] text-black/40">Loading diagram …</div>}
        <div ref={ref} className="h-full w-full diagram-host" />
      </div>
    </div>
  );
}
