// «Mit Code abgleichen» of a service orchestration - first the preview, then apply. The project's
// sources come from its remembered folder (or a chosen folder or ZIP): the CustomTask object gives
// In, Out and its classes, the CustomWorker its service calls and mapping lines (see codeSync.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileCode2, FolderOpen, Loader2, Upload, X } from 'lucide-react';
import { findProjectSources, readProjectDir, readProjectZip, rememberOwnFolder, type ProjectFile } from '../projectImport';
import { STATUSES, STATUS_META, type Model, type Status } from '../types';
import { cls } from '../ui';
import { planCodeSync, workerFileOf, type CodeSyncPlan } from '../services/codeSync';
import { serviceProcessTopic, type ServiceProcess } from '../services/serviceProcess';
import type { ServiceCollectionSpec } from '../services/types';

interface Props {
  current: ServiceProcess;
  model: Model | null;
  collections: ServiceCollectionSpec[];
  isDark: boolean;
  onApply: (plan: CodeSyncPlan, from: string) => void;
  onClose: () => void;
}

function Lines({ items, isDark }: { items: string[]; isDark: boolean }) {
  const c = cls(isDark);
  if (!items.length) return null;
  return (
    <ul className={`text-[10px] font-mono max-h-48 overflow-auto space-y-0.5 ${c.muted}`}>
      {items.map((x, i) => <li key={i} className="break-all">{x}</li>)}
    </ul>
  );
}

export default function CodeSyncPanel({ current, model, collections, isDark, onApply, onClose }: Props) {
  const c = cls(isDark);
  const warn = isDark ? 'text-amber-400' : 'text-amber-600';
  const zipRef = useRef<HTMLInputElement>(null);
  const project = current.project;
  const topic = serviceProcessTopic(current);
  // undefined = being searched, null = none found
  const [sources, setSources] = useState<{ files: ProjectFile[]; source: string } | null | undefined>(undefined);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>('Projekt wird gesucht …');
  const [error, setError] = useState('');
  const [changedStatus, setChangedStatus] = useState<Status>('changed');

  useEffect(() => {
    let alive = true;
    findProjectSources(project, model, t => alive && setBusy(t))
      .then(r => {
        if (!alive) return;
        if (r && 'blocked' in r) { setSources(null); setUnreadable(r.unreadable); } else setSources(r);
      })
      .catch(e => { if (alive) { setSources(null); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (alive) setBusy(null); });
    return () => { alive = false; };
    // the project once - a change of the spec does not search again
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The sources from a chosen folder or ZIP - a folder with the worker is remembered as the project's. */
  const sourcesFrom = async (read: () => Promise<ProjectFile[]>, source: string, dir?: FileSystemDirectoryHandle) => {
    try {
      setBusy(`${source} wird gelesen …`);
      const files = await read();
      if (!workerFileOf(files, current)) {
        setError(`In ${source} gibt es keinen ${current.service.name}Worker.scala.`);
        return;
      }
      if (dir) await rememberOwnFolder(model, project, dir);
      setError(''); setUnreadable([]); setSources({ files, source });
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const pickDir = async () => {
    if (!('showDirectoryPicker' in window)) { setError('Ordner wählen geht nur in Chrome oder Edge — als Alternative ein ZIP wählen.'); return; }
    const dir = await window.showDirectoryPicker({ mode: 'read' }).catch(() => null);
    if (dir) await sourcesFrom(() => readProjectDir(dir), `Ordner ${dir.name}`, dir);
  };

  const plan = useMemo(() => {
    if (!sources) return null;
    try {
      return { plan: planCodeSync(current, sources.files, model, collections, { added: 'implemented', changed: changedStatus }), error: '' };
    } catch (e) {
      return { plan: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [sources, current, model, collections, changedStatus]);
  const p = plan?.plan ?? null;
  const dom = p?.domain?.report;
  const nothing = !!p && !p.worker?.changed.length && !dom?.added.length && !dom?.changed.length;

  return (
    <div className={`flex-shrink-0 border-b ${c.border} ${isDark ? 'bg-white/5' : 'bg-black/5'} px-3 py-2 space-y-2`}>
      <div className="flex items-center gap-2">
        <FileCode2 size={12} className={c.muted2} />
        <span className={`text-[11px] font-semibold ${c.text}`}>Mit Code abgleichen</span>
        <span className={`text-[10px] font-mono truncate ${c.muted}`}>{topic}</span>
        <button onClick={onClose} className={`ml-auto p-0.5 rounded ${c.btn}`} title="Schliessen"><X size={12} /></button>
      </div>

      {busy && <p className={`text-[10px] flex items-center gap-1 ${c.muted2}`}><Loader2 size={10} className="animate-spin" /> {busy}</p>}
      {error && <p className={`text-[10px] ${warn}`}><AlertTriangle size={10} className="inline mr-1 -mt-0.5" />{error}</p>}
      {plan?.error && <p className={`text-[10px] ${warn}`}><AlertTriangle size={10} className="inline mr-1 -mt-0.5" />{plan.error}</p>}

      {sources === null && !busy && (
        <div className="space-y-1.5">
          <p className={`text-[10px] ${warn}`}>
            <AlertTriangle size={10} className="inline mr-1 -mt-0.5" />
            {unreadable.length
              ? <>Der Projekt-Ordner {unreadable.map(n => `«${n}»`).join(', ')} liess sich nicht lesen — der Browser merkt sich den Zugriff je Adresse der App</>
              : <>Für <span className="font-mono">{project}</span> ist kein Projekt-Ordner gemerkt</>} — Projekt-Ordner oder ZIP wählen.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={pickDir} disabled={!!busy}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border disabled:opacity-40 ${c.btn}`}>
              <FolderOpen size={12} /> Projekt-Ordner wählen
            </button>
            <input ref={zipRef} type="file" accept=".zip" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void sourcesFrom(async () => readProjectZip(new Uint8Array(await f.arrayBuffer())), f.name);
                e.target.value = '';
              }} />
            <button onClick={() => zipRef.current?.click()} disabled={!!busy}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border disabled:opacity-40 ${c.btn}`}>
              <Upload size={12} /> ZIP wählen
            </button>
          </div>
        </div>
      )}

      {p && sources && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1 min-w-0">
            <p className={`text-[10px] font-semibold ${c.text}`}>Worker</p>
            {!p.worker
              ? <p className={`text-[10px] ${warn}`}>In {sources.source} gibt es keinen {current.service.name}Worker.scala.</p>
              : <>
                <p className={`text-[10px] font-mono truncate ${c.muted}`} title={p.workerPath}>{p.workerPath}</p>
                <p className={`text-[10px] ${c.muted2}`}>{p.worker.changed.length ? `${p.worker.changed.length} geändert` : 'wie in der Spezifikation'}</p>
                <Lines isDark={isDark} items={p.worker.changed.map(x => `~ ${x}`)} />
                {!!p.worker.hints.length && (
                  <div className={`text-[10px] space-y-0.5 ${warn}`}>
                    {p.worker.hints.map((h, i) => <div key={i} className="flex items-start gap-1"><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{h}</span></div>)}
                  </div>
                )}
              </>}
          </div>
          <div className="space-y-1 min-w-0">
            <p className={`text-[10px] font-semibold ${c.text}`}>In, Out und Klassen</p>
            {!dom
              ? <p className={`text-[10px] ${warn}`}>Kein Objekt mit <span className="font-mono">topicName = "{topic}"</span> in {sources.source}.</p>
              : <>
                <p className={`text-[10px] ${c.muted2}`}>{dom.kept} unverändert · {dom.added.length} neu · {dom.changed.length} geändert</p>
                <Lines isDark={isDark} items={[...dom.added.map(n => `+ ${n}`), ...dom.changed.map(n => `~ ${n}`), ...dom.stale.map(n => `? ${n} — nur in der Spezifikation`)]} />
                {!!p.domain!.unresolved.length && <p className={`text-[10px] ${warn}`}>Typen weder im Projekt noch im Katalog: {p.domain!.unresolved.join(', ')}</p>}
              </>}
          </div>
        </div>
      )}

      {p && sources && (
        <div className="flex items-center gap-2">
          <label className={`flex items-center gap-1.5 text-[10px] ${c.muted2}`}>
            Geänderte Schritte:
            <select value={changedStatus} onChange={e => setChangedStatus(e.target.value as Status)}
              className={`text-[10px] px-1 py-0.5 rounded border ${c.input}`}>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </label>
          <button onClick={() => onApply(p, sources.source)} disabled={nothing}
            title={nothing ? 'Der Code ist wie die Spezifikation' : undefined}
            className={`ml-auto text-[11px] px-2.5 py-1 rounded border disabled:opacity-40 ${c.btn}`}>
            Übernehmen
          </button>
        </div>
      )}
    </div>
  );
}
