// An orchestration of before (`services/<slug>.json`): it is a process in service mode now and
// opens in the process editor. Taking it over writes the process — same flow and diagram — and
// then removes the file under `services/`; until then nothing changes.
import { AlertTriangle, ArrowLeft, Loader2, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePermissions } from '../auth';
import { useStore } from '../store';
import { cls } from '../ui';
import { orchestrationTopic } from './orchestration';
import { callableServices, fromOrchestration } from './serviceProcess';
import { useServices } from './store';
import { isCollection, isOrchestration, type ServiceOrchestrationSpec } from './types';

export default function OrchestrationTakeOver({ slug, onBack, onOpenProcess }: { slug: string; onBack: () => void; onOpenProcess: (slug: string) => void }) {
  const { isDark, model, specs, createSpec, saveBpmn } = useStore();
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
  const taken = planned ? specs.find(s => s.slug === planned.spec.slug) : undefined;

  const takeOver = async () => {
    if (!loaded || !planned) return;
    setBusy(true); setError(null);
    try {
      const r = await createSpec(planned.spec);
      if (!r.ok) { setError(r.message); return; }
      const w = await saveBpmn(planned.spec.slug, planned.xml);
      if (!w.ok) { setError(`Prozess angelegt, aber das Diagramm nicht: ${w.message} — services/${slug}.json bleibt.`); return; }
      const d = await deleteService(slug, loaded.version);
      if (!d.ok) { setError(`Übernommen — aber services/${slug}.json ist noch da: ${d.message}`); return; }
      onOpenProcess(planned.spec.slug);
    } finally { setBusy(false); }
  };

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
          {taken && <p className="text-[11px] text-rose-500">Den Prozess «{taken.data.title || taken.slug}» gibt es schon — zuerst ihn umbenennen oder löschen.</p>}
          {error && <p className="text-[11px] text-rose-500 flex items-center gap-1.5"><AlertTriangle size={11} /> {error}</p>}
          {canEdit
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
