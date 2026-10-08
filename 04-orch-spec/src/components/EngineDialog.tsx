// Engine wechseln: das Diagramm von Camunda 7 nach 8 umwandeln oder zurück.
//
// Der Dialog wandelt erst zur Probe um und zeigt, was dabei offen bleibt —
// umgestellt wird erst auf «Umwandeln». Danach liest der Abgleich das neue
// Diagramm ein wie jede andere Änderung (Engine, Mappings, Topics).
import { useMemo } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, X } from 'lucide-react';
import { convertBpmn } from '../engineConvert';
import { engineLabel } from '../engineLabels';
import type { EngineId, ProcessSpec } from '../types';
import { cls } from '../ui';

export default function EngineDialog({ spec, bpmn, isDark, onConvert, onClose }: {
  spec: ProcessSpec;
  bpmn: string;
  isDark: boolean;
  /** umgewandeltes Diagramm (bzw. null ohne Diagramm) und die Ziel-Engine */
  onConvert: (xml: string | null, target: EngineId) => void;
  onClose: () => void;
}) {
  const c = cls(isDark);
  const from: EngineId = spec.engine ?? 'c7';
  const target: EngineId = from === 'c7' ? 'c8' : 'c7';
  const probe = useMemo(() => (bpmn ? convertBpmn(bpmn, target, { timeToLive: spec.timeToLive }) : null), [bpmn, target, spec.timeToLive]);
  const issues = probe?.issues ?? [];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className={`max-w-2xl w-full max-h-[85vh] flex flex-col rounded-xl border p-5 ${c.border2} ${c.panelStrong}`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 className={`text-sm font-semibold ${c.text}`}>
            {engineLabel(from)} → {engineLabel(target)}
          </h3>
          <button onClick={onClose} className={`p-1 ${c.muted}`}><X size={14} /></button>
        </div>

        <p className={`text-[11px] leading-relaxed mb-3 ${c.muted}`}>
          {bpmn
            ? <>Das Diagramm wird umgewandelt: Layout, IDs und Topics bleiben, die Erweiterungen der Engine
              wechseln die Form ({target === 'c8' ? 'External Tasks → zeebe:taskDefinition, JUEL → FEEL' : 'zeebe:taskDefinition → External Tasks, FEEL → JUEL'}).
              Die fachlichen Texte der Spezifikation bleiben.</>
            : <>Zu dieser Spezifikation liegt kein Diagramm vor — umgestellt wird nur die Engine; Mappings
              schreibt der Export dann in deren Form.</>}
        </p>

        {!!issues.length && (
          <div className={`mb-3 min-h-0 overflow-y-auto text-[10px] px-2 py-1.5 rounded border space-y-0.5 ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
            <div className="flex items-center gap-1 font-semibold"><AlertTriangle size={11} /> {issues.length} Stelle{issues.length === 1 ? '' : 'n'} danach von Hand prüfen</div>
            {issues.map((it, i) => (
              <div key={i}><span className="font-mono">{it.stepId || 'Prozess'}</span> · {it.where}: {it.text}</div>
            ))}
          </div>
        )}
        {probe && !issues.length && (
          <div className={`mb-3 flex items-center gap-1 text-[10px] ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
            <Check size={11} /> Alles lässt sich übertragen.
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <span className={`text-[10px] ${c.muted}`}>Zurück geht es auf demselben Weg.</span>
          <button onClick={onClose} className={`ml-auto text-xs px-3 py-2 rounded border ${c.btn}`}>Abbrechen</button>
          <button onClick={() => onConvert(probe?.xml ?? null, target)}
            className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded font-semibold ${c.btnPrimary}`}>
            <ArrowRightLeft size={12} /> Nach {engineLabel(target)} umwandeln
          </button>
        </div>
      </div>
    </div>
  );
}
