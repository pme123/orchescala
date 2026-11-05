// An orchestration of before (`services/<slug>.json`): it is a process in service mode now and
// opens in the process editor. Taking it over writes the process — same flow and diagram — and
// then removes the file under `services/`; until then nothing changes (see takeOver.ts).
import { AlertTriangle, ArrowLeft, Loader2, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePermissions } from '../auth';
import { useStore } from '../store';
import { cls } from '../ui';
import { orchestrationTopic } from './orchestration';
import { callableServices, fromOrchestration, isServiceProcess } from './serviceProcess';
import { removeOld, takeOver as runTakeOver } from './takeOver';
import { useServices } from './store';
import { isCollection, isOrchestration, type ServiceOrchestrationSpec } from './types';

export default function OrchestrationTakeOver({ slug, onBack, onOpenProcess }: { slug: string; onBack: () => void; onOpenProcess: (slug: string) => void }) {
  const { isDark, model, specs, createSpec, saveBpmn, deleteSpec, loadBpmn } = useStore();
  const { loadService, deleteService, services } = useServices();
  const { canEdit } = usePermissions();
  const c = cls(isDark);
  const [loaded, setLoaded] = useState<{ data: ServiceOrchestrationSpec; version: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let gone = false;
    loadService(slug)
      .then(r => {
        if (gone) return;
        if (!r) setError(`services/${slug}.json gibt es nicht (mehr).`);
        else if (!isOrchestration(r.data)) setError(`services/${slug}.json ist keine Orchestrierung.`);
        else setLoaded({ data: r.data, version: r.version });
      })
      .catch(e => { if (!gone) setError(e instanceof Error ? e.message : String(e)); });
    return () => { gone = true; };
  }, [slug, loadService]);
  const collections = useMemo(() => services.map(s => s.data).filter(isCollection), [services]);
  const planned = useMemo(() => (loaded ? fromOrchestration(loaded.data, callableServices(collections, model)) : null), [loaded, collections, model]);
  const existing = planned ? specs.find(s => s.slug === planned.spec.slug) : undefined;
  // taken over already — only the old file is left (removing it failed, or it came back)
  const same = !!existing && isServiceProcess(existing.data) && existing.data.processId === planned?.spec.processId;
  // only with its diagram — a process left without one (a failed take-over) is not one to finish
  const [hasDiagram, setHasDiagram] = useState<boolean | null>(null);
  useEffect(() => {
    if (!same || !planned) { setHasDiagram(null); return; }
    let gone = false;
    loadBpmn(planned.spec.slug).then(x => { if (!gone) setHasDiagram(!!x); }).catch(() => { if (!gone) setHasDiagram(false); });
    return () => { gone = true; };
  }, [same, planned, loadBpmn]);
  const done = same && hasDiagram === true;
  const halfMade = same && hasDiagram === false;
  const taken = same ? undefined : existing;
  const store = { createSpec, saveBpmn, deleteSpec, deleteService };

  const run = async (step: () => ReturnType<typeof removeOld>) => {
    if (!loaded || !planned) return;
    setBusy(true); setError(null);
    let r: Awaited<ReturnType<typeof step>>;
    try { r = await step(); } finally { setBusy(false); }
    // the view goes once it is done — nothing is set on it after that
    if (r.ok) onOpenProcess(planned.spec.slug);
    else setError(r.message);
  };
  const old = { slug, version: loaded?.version ?? '' };
  const takeOver = () => run(() => runTakeOver(store, planned!, old));
  const finish = () => run(() => removeOld(store, old));

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
      <button onClick={onBack} className={`flex items-center gap-1 text-[11px] ${c.muted2} hover:underline`}><ArrowLeft size={12} /> Services</button>
      {!loaded && !error && <div className={`text-xs ${c.muted} flex items-center gap-2`}><Loader2 size={12} className="animate-spin" /> Lade Orchestrierung …</div>}
      {loaded && (
        <div className={`rounded border p-4 space-y-3 ${c.border2} ${c.panel}`}>
          <div className="flex items-center gap-2">
            <Workflow size={16} className={isDark ? 'text-violet-300' : 'text-violet-700'} />
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${c.text}`}>{loaded.data.title || slug}</div>
              <div className={`text-[10px] font-mono ${c.muted}`}>{orchestrationTopic(loaded.data)}</div>
            </div>
          </div>
          <p className={`text-[11px] ${c.text}`}>
            Eine Orchestrierung wird jetzt wie ein Prozess bearbeitet — mit Ablauf, Diagramm, Datenmodell, Kommentaren und Patterns
            des Prozess-Editors. Übernehmen legt sie als Prozess im Service-Modus an, mit demselben Ablauf und Diagramm, und entfernt
            danach <span className="font-mono">services/{slug}.json</span>.
          </p>
          <p className={`text-[10px] ${c.muted}`}>
            Ein Ergebnis eines Services ist dort nicht mehr eine Variable (<span className="font-mono">getClient.etag</span>), sondern seine
            Felder sind es (<span className="font-mono">etag</span>) — die Ausdrücke werden so umgeschrieben, und der Schritt setzt jedes
            Feld, das gelesen wird. Lesen zwei Services ein Feld gleichen Namens, danach die Mappings prüfen.
          </p>
          {planned && planned.issues.length > 0 && !done && (
            <ul className="space-y-1">
              {planned.issues.map((i, n) => (
                <li key={n} className={`text-[10px] flex items-start gap-1.5 ${i.level === 'error' ? 'text-rose-500' : isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                  <AlertTriangle size={10} className="mt-0.5 flex-shrink-0" /> {i.text}
                </li>
              ))}
            </ul>
          )}
          {taken && <p className="text-[11px] text-rose-500">Den Prozess «{taken.data.title || taken.slug}» gibt es schon — zuerst ihn umbenennen oder löschen.</p>}
          {halfMade && (
            <p className="text-[11px] text-rose-500">
              Den Prozess «{existing!.data.title || existing!.slug}» gibt es schon, aber ohne Diagramm — von einer Übernahme, die nicht fertig wurde.
              Ihn unter Prozesse löschen, dann nochmals übernehmen; <span className="font-mono">services/{slug}.json</span> bleibt bis dahin.
            </p>
          )}
          {error && <p className="text-[11px] text-rose-500 flex items-center gap-1.5"><AlertTriangle size={11} /> {error}</p>}
          {done && (
            <div className="space-y-2">
              <p className={`text-[11px] ${c.text}`}>
                Schon als Prozess übernommen — nur <span className="font-mono">services/{slug}.json</span> ist noch da.
              </p>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button disabled={busy} onClick={() => void finish()}
                    className={`text-[11px] px-3 py-1.5 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}>
                    {busy ? 'Wird entfernt …' : 'Alte Datei entfernen und Prozess öffnen'}
                  </button>
                )}
                <button onClick={() => planned && onOpenProcess(planned.spec.slug)} className={`text-[11px] px-3 py-1.5 rounded border ${c.btn}`}>
                  Prozess öffnen
                </button>
              </div>
            </div>
          )}
          {same ? null : canEdit
            ? (
              <button disabled={busy || !!taken} onClick={() => void takeOver()}
                className={`text-[11px] px-3 py-1.5 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}>
                {busy ? 'Wird übernommen …' : 'In den Prozess-Editor übernehmen'}
              </button>
            )
            : <p className={`text-[10px] ${c.muted}`}>Übernehmen kann, wer bearbeiten darf.</p>}
        </div>
      )}
      {!loaded && error && <p className="text-[11px] text-rose-500 flex items-center gap-1.5"><AlertTriangle size={11} /> {error}</p>}
    </div>
  );
}
