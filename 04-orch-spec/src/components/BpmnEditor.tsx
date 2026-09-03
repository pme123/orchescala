// BPMN-Editor über dem Ablauf — beides zeigt denselben Prozess.
//
// Was synchron läuft:
//
//  · **Diagramm → Baum**: jede Änderung im Modeler wird kurz danach neu
//    eingelesen; die fachlichen Texte bleiben über die Element-ID erhalten
//    (`mergeSpec`). Das BPMN wird dabei neben der Spezifikation gespeichert.
//  · **Baum → Diagramm**: ein angeklickter Schritt wird im Diagramm ausgewählt
//    und ins Bild geholt; ein umbenannter Schritt wird im Diagramm umbenannt.
//
// Was **nicht** synchron läuft: Schritte anlegen oder löschen geht nur im
// Diagramm. Der Baum ist eine abgeleitete Sicht — aus ihm einen BPMN-Graphen
// samt Layout zu erzeugen, ist ein eigener Schritt (siehe README).
//
// Die Camunda-Erweiterung ist zwingend: ohne sie verwirft bpmn-js beim
// Speichern alle `camunda:`-Elemente — also genau die Mappings.
import { useCallback, useEffect, useRef, useState } from 'react';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import camundaModdle from 'camunda-bpmn-moddle/resources/camunda.json';

/** Was wir von einem moddle-Element anfassen — bewusst schmal gehalten. */
interface Moddle {
  $type?: string;
  name?: string;
  values?: Moddle[];
  inputParameters?: Moddle[];
  [key: string]: unknown;
}
interface Moddled { businessObject?: { extensionElements?: Moddle } }

export interface BpmnHandle {
  /** Schritt im Diagramm auswählen und ins Bild holen */
  select: (id: string | null) => void;
  /** Element im Diagramm umbenennen (aus dem Baum heraus) */
  rename: (id: string, name: string) => void;
  /**
   * Element-ID ändern (Konvention aus dem fachlichen Namen).
   * 'absent' heisst: kein Diagramm bzw. Element nicht darin — die
   * Spezifikation darf trotzdem umbenennen.
   */
  setId: (oldId: string, newId: string) => 'renamed' | 'conflict' | 'absent';
  /** Camunda-Eigenschaften setzen; `id === null` meint den Prozess selbst */
  setProps: (id: string | null, props: Record<string, unknown>) => void;
  /** Bedingung eines Sequenzflusses */
  setCondition: (flowId: string, condition: string | undefined) => void;
  /** `_handledErrors` eines Schritts */
  setHandledErrors: (id: string, codes: string[]) => void;
}

interface Props {
  xml: string;
  isDark: boolean;
  canEdit: boolean;
  /** vom Modeler ausgelöste Änderung — der Baum liest neu ein */
  onChange: (xml: string) => void;
  /** im Diagramm angeklickt */
  onSelect: (id: string | null) => void;
  onReady: (handle: BpmnHandle) => void;
  onError: (message: string) => void;
}

export default function BpmnEditor({ xml, isDark, canEdit, onChange, onSelect, onReady, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<InstanceType<typeof BpmnModeler> | null>(null);
  const timer = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);

  const cbs = useRef({ onChange, onSelect, onReady, onError });
  cbs.current = { onChange, onSelect, onReady, onError };
  /** zuletzt geladenes XML — verhindert, dass eigene Änderungen neu importiert
   *  werden (das würde Auswahl und Bildausschnitt zurücksetzen) */
  const loadedRef = useRef<string>('');
  const xmlRef = useRef(xml);
  xmlRef.current = xml;

  /** läuft gerade ein Import? Dann erst danach zerstören — sonst greift
   *  bpmn-js auf eine Zeichenfläche zu, die es nicht mehr gibt */
  const pendingRef = useRef<Promise<unknown>>(Promise.resolve());
  /** zuletzt von aussen gewünschte Auswahl — nach dem Import nachgezogen */
  const gewuenschtRef = useRef<string | null>(null);

  const load = useCallback((modeler: InstanceType<typeof BpmnModeler>, text: string, alive: () => boolean) => {
    loadedRef.current = text;
    setLoading(true);
    // Beim Import ist die Zeichenfläche oft noch **nicht** vermessen — im
    // linken Spaltenlayout steht die Breite erst nach dem nächsten Anstrich
    // fest (Höhe 453, Breite 0). bpmn-js rechnet dann mit NaN und wirft.
    // Also warten, bis sie eine Grösse hat, statt zu raten wie lange das dauert.
    const einpassen = () => {
      const host = hostRef.current;
      if (!host?.isConnected || !host.clientWidth || !host.clientHeight) return false;
      try {
        const canvas = modeler.get('canvas') as { zoom: (a: string, b?: string) => void };
        canvas.zoom('fit-viewport', 'auto');
        return true;
      } catch {
        return false;   // Modeler schon abgebaut
      }
    };

    const einpassenSobaldVermessen = (bis = Date.now() + 5000) => {
      if (einpassen() || Date.now() > bis) return;
      requestAnimationFrame(() => einpassenSobaldVermessen(bis));
    };

    const run = modeler.importXML(text)
      .then(() => {
        einpassenSobaldVermessen();
        const id = gewuenschtRef.current;
        if (!id) return;
        try {
          const el = (modeler.get('elementRegistry') as { get: (i: string) => unknown }).get(id);
          if (el) (modeler.get('selection') as { select: (e: unknown) => void }).select(el);
        } catch { /* Modeler schon abgebaut */ }
      })
      .catch((e: unknown) => { if (alive()) cbs.current.onError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive()) setLoading(false); });
    pendingRef.current = run;
    return run;
  }, []);

  // Modeler aufbauen und gleich laden. Beides in einem Effekt, damit ein
  // erneutes Aufbauen (React StrictMode baut zweimal auf) wieder importiert —
  // sonst stünde die Zeichenfläche leer.
  useEffect(() => {
    if (!hostRef.current) return;
    let mounted = true;
    const alive = () => mounted;
    // Nach dem Abbau darf der Handle nichts mehr «erfolgreich» ändern — der
    // zerstörte Modeler wirft nicht immer, seine Änderungen gehen aber verloren.
    let destroyed = false;
    const modeler = new BpmnModeler({
      container: hostRef.current,
      // ohne die Camunda-Erweiterung verwirft das Speichern alle Mappings
      moddleExtensions: { camunda: camundaModdle },
    });
    modelerRef.current = modeler;
    // Entwicklung: Zugriff auf den Modeler, um den Abgleich prüfen zu können
    if (import.meta.env.DEV) (window as unknown as { __bpmn?: unknown }).__bpmn = modeler;

    // Jede Änderung geht denselben Weg zurück — auch die, die aus dem Baum
    // kam. Sonst stünde die Umbenennung zwar im Diagramm, aber nie in der
    // gespeicherten `.bpmn`. Der Baum hat den neuen Namen bereits, der
    // Abgleich bestätigt ihn nur.
    const push = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        try {
          const { xml: next } = await modeler.saveXML({ format: true });
          // als «geladen» merken, sonst importiert der Rückweg das eigene
          // Ergebnis neu und wirft Auswahl und Ausschnitt weg
          if (next) { loadedRef.current = next; cbs.current.onChange(next); }
        } catch (e) {
          cbs.current.onError(e instanceof Error ? e.message : String(e));
        }
      }, 700);
    };

    modeler.on('commandStack.changed', push);
    // Ein Klick in die Zeichenfläche — auch auf leere Stelle: dann trifft er
    // das Wurzelelement. Nur danach ist eine leere Auswahl eine echte Abwahl.
    let vomNutzer = false;
    modeler.on('element.click', () => { vomNutzer = true; });
    modeler.on('selection.changed', (e: { newSelection: Array<{ id: string }> }) => {
      const id = e.newSelection?.[0]?.id ?? null;
      const geklickt = vomNutzer;
      vomNutzer = false;
      // Beim Aufbauen und beim Import meldet bpmn-js eine leere Auswahl. Das
      // ist der Anfangszustand, keine Abwahl — und würde eine Auswahl
      // löschen, die gerade von aussen kam (Wechsel Datenmodell → Ablauf).
      if (!id && !geklickt) return;
      cbs.current.onSelect(id);
    });

    const handle: BpmnHandle = {
      select: (id) => {
        gewuenschtRef.current = id;
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => unknown };
          const selection = modeler.get('selection') as { select: (el: unknown) => void };
          const canvas = modeler.get('canvas') as { scrollToElement: (el: unknown) => void };
          const el = id ? registry.get(id) : null;
          // Ein Schritt, der im Diagramm (noch) nicht liegt, ist kein Grund,
          // die Auswahl im Baum wegzuwerfen.
          if (!el) { if (!id) selection.select(null); return; }
          selection.select(el);
          canvas.scrollToElement(el);
        } catch { /* Element (noch) nicht im Diagramm */ }
      },
      setProps: (id, props) => {
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => unknown };
          const canvas = modeler.get('canvas') as { getRootElement: () => unknown };
          const modeling = modeler.get('modeling') as { updateProperties: (el: unknown, p: object) => void };
          const el = id === null ? canvas.getRootElement() : registry.get(id);
          if (el) modeling.updateProperties(el, props);
        } catch { /* Element nicht im Diagramm */ }
      },
      setCondition: (flowId, condition) => {
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => unknown };
          const modeling = modeler.get('modeling') as { updateProperties: (el: unknown, p: object) => void };
          const moddle = modeler.get('moddle') as { create: (t: string, p: object) => unknown };
          const el = registry.get(flowId);
          if (!el) return;
          modeling.updateProperties(el, {
            conditionExpression: condition
              ? moddle.create('bpmn:FormalExpression', { body: condition })
              : undefined,
          });
        } catch { /* Fluss nicht im Diagramm */ }
      },
      setHandledErrors: (id, codes) => {
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => Moddled | undefined };
          const modeling = modeler.get('modeling') as { updateProperties: (el: unknown, p: object) => void };
          const moddle = modeler.get('moddle') as { create: (t: string, p: object) => Moddle };
          const el = registry.get(id);
          const bo = el?.businessObject;
          if (!bo) return;
          const ext = bo.extensionElements ?? moddle.create('bpmn:ExtensionElements', { values: [] });
          let io = ext.values?.find(v => v.$type === 'camunda:InputOutput');
          if (!io) {
            io = moddle.create('camunda:InputOutput', { inputParameters: [], outputParameters: [] });
            ext.values = [...(ext.values ?? []), io];
          }
          const others = (io.inputParameters ?? []).filter(p => p.name !== '_handledErrors');
          io.inputParameters = codes.length
            ? [...others, moddle.create('camunda:InputParameter', { name: '_handledErrors', value: codes.join(', ') })]
            : others;
          modeling.updateProperties(el, { extensionElements: ext });
        } catch { /* Schritt nicht im Diagramm */ }
      },
      setId: (oldId, newId) => {
        if (destroyed) return 'absent';
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => unknown };
          const modeling = modeler.get('modeling') as { updateProperties: (el: unknown, p: object) => void };
          const el = registry.get(oldId);
          if (!el) return 'absent';
          // Im Diagramm kann die Ziel-ID auch an Flüssen oder Boundary-Events
          // hängen, die der Baum nicht kennt — dann lieber gar nicht umbenennen.
          if (registry.get(newId)) return 'conflict';
          modeling.updateProperties(el, { id: newId });
          return 'renamed';
        } catch {
          return 'absent';
        }
      },
      rename: (id, name) => {
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => { businessObject?: { name?: string } } | undefined };
          const modeling = modeler.get('modeling') as { updateProperties: (el: unknown, p: object) => void };
          const el = registry.get(id);
          if (!el || el.businessObject?.name === name) return;
          modeling.updateProperties(el, { name });
        } catch { /* Element nicht im Diagramm */ }
      },
    };
    cbs.current.onReady(handle);
    if (xmlRef.current) load(modeler, xmlRef.current, alive);

    return () => {
      mounted = false;
      destroyed = true;
      if (timer.current) window.clearTimeout(timer.current);
      modelerRef.current = null;
      // erst abwarten, dann abbauen
      void pendingRef.current.catch(() => {}).then(() => modeler.destroy());
    };
  }, [load]);

  // XML von aussen (andere Datei gewählt) — eigene Änderungen sind schon gemerkt
  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler || !xml || xml === loadedRef.current) return;
    load(modeler, xml, () => modelerRef.current === modeler);
  }, [xml, load]);

  // Nur-Lesen: die Bearbeitungswerkzeuge ausblenden
  const readOnly = !canEdit;
  void isDark; // die Zeichenfläche bleibt in beiden Modi hell (siehe index.css)

  return (
    <div className={`bpmn-host relative h-full w-full ${readOnly ? 'bpmn-readonly' : ''}`}>
      <div ref={hostRef} className="h-full w-full" />
      {loading && (
        <div className={`absolute inset-0 flex items-center justify-center text-xs pointer-events-none ${isDark ? 'text-white/40' : 'text-black/40'}`}>
          Diagramm wird geladen …
        </div>
      )}
    </div>
  );
}

/** Erlaubt dem Aufrufer, den Modeler zu laden, bevor der Nutzer ihn aufklappt. */
export const preload = () => import('bpmn-js/lib/Modeler');
