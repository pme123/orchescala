// Editor für die Tabelle einer DMN Decision — dmn-js von bpmn.io, das
// Gegenstück zum BPMN-Modeler. Er öffnet gleich die Tabelle der Entscheidung
// (nicht das DRD); «Übernehmen» gibt das XML zurück, die Prozessansicht legt
// es ab und gleicht In/Out ab (siehe dmn.ts).
//
// Die Camunda-Erweiterung bleibt dabei: ohne sie verwirft dmn-js beim
// Speichern alle `camunda:`-Attribute (z. B. `camunda:inputVariable`).
import { useEffect, useRef, useState } from 'react';
import 'dmn-js/dist/assets/diagram-js.css';
import 'dmn-js/dist/assets/dmn-js-shared.css';
import 'dmn-js/dist/assets/dmn-js-drd.css';
import 'dmn-js/dist/assets/dmn-js-decision-table.css';
import 'dmn-js/dist/assets/dmn-js-decision-table-controls.css';
import 'dmn-js/dist/assets/dmn-js-literal-expression.css';
import 'dmn-js/dist/assets/dmn-font/css/dmn.css';
import DmnModeler from 'dmn-js/lib/Modeler';
import camundaDmnModdle from 'camunda-dmn-moddle/resources/camunda.json';
import { Check, Loader2, X } from 'lucide-react';
import { cls } from '../ui';

export default function DmnEditor({ xml, decisionId, title, isDark, canEdit, onSave, onClose }: {
  xml: string;
  decisionId: string;
  title: string;
  isDark: boolean;
  canEdit: boolean;
  onSave: (xml: string) => void;
  onClose: () => void;
}) {
  const c = cls(isDark);
  const hostRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<DmnModeler | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;
    let alive = true;
    const modeler = new DmnModeler({ container: hostRef.current, moddleExtensions: { camunda: camundaDmnModdle } });
    modelerRef.current = modeler;
    if (import.meta.env.DEV) (window as unknown as { __dmn?: unknown }).__dmn = modeler;
    (async () => {
      try {
        await modeler.importXML(xml);
        // gleich die Tabelle der Entscheidung — die Schreibweise kann abweichen
        const view = modeler.getViews().find(v => v.type === 'decisionTable' && v.element.id.toLowerCase() === decisionId.toLowerCase())
          ?? modeler.getViews().find(v => v.type === 'decisionTable');
        // jede Änderung — in der Tabelle wie im DRD («View DRD» wechselt die Ansicht)
        const attach = () => modeler.getActiveViewer()?.on('elements.changed', () => { if (alive) setDirty(true); });
        modeler.on('views.changed', attach);
        if (view) await modeler.open(view);
        attach();
        if (alive) setState('ready');
      } catch (e) {
        if (alive) setState({ error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { alive = false; modeler.destroy(); modelerRef.current = null; };
  }, [xml, decisionId]);

  const save = async () => {
    const m = modelerRef.current;
    if (!m) return;
    try {
      const { xml: next } = await m.saveXML({ format: true });
      if (next) onSave(next);
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  const close = () => {
    if (dirty && canEdit && !window.confirm('Änderungen an der Tabelle verwerfen?')) return;
    onClose();
  };

  return (
    // Schliessen nur beim Klick auf den Hintergrund — kein stopPropagation im
    // Dialog: dmn-js (Inferno) hört auf Klicks an `document`, sonst täte z. B.
    // «View DRD» nichts
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className={`w-full h-full max-w-[96rem] flex flex-col rounded-xl border overflow-hidden ${c.border2} ${c.panelStrong}`}>
        <div className={`flex items-center gap-2 px-4 py-2 border-b ${c.border}`}>
          <span className={`text-[10px] uppercase tracking-widest ${c.muted}`}>DMN Decision</span>
          <span className={`text-sm font-semibold font-mono truncate ${c.text}`}>{title}</span>
          <span className={`text-[10px] font-mono truncate ${c.muted}`}>{decisionId}</span>
          {state === 'loading' && <span className={`flex items-center gap-1 text-[10px] ${c.muted}`}><Loader2 size={10} className="animate-spin" /> wird geladen …</span>}
          <span className="ml-auto flex items-center gap-2">
            {canEdit && (
              <button onClick={() => { void save(); }} disabled={state !== 'ready'}
                title="Tabelle übernehmen — In und Out der DMN Decision folgen den Spalten"
                className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded font-semibold disabled:opacity-40 ${c.btnPrimary}`}>
                <Check size={12} /> Übernehmen
              </button>
            )}
            <button onClick={close} title="Schliessen" className={`p-1.5 rounded border ${c.btn}`}><X size={12} /></button>
          </span>
        </div>
        {typeof state === 'object' && (
          <p className={`px-4 py-2 text-[11px] ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>DMN nicht lesbar: {state.error}</p>
        )}
        {/* die Tabelle bleibt in beiden Modi hell — wie das Diagramm */}
        <div ref={hostRef} className={`dmn-host flex-1 min-h-0 overflow-auto bg-white text-black ${canEdit ? '' : 'pointer-events-none'}`} />
      </div>
    </div>
  );
}
