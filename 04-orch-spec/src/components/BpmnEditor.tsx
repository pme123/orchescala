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
import type { EngineId } from '../types';
import type { ASSIGNMENT_KEYS } from '../bpmn';
import { errorListSource } from '../errorCodes';
import { getClipboard, type DiagramSpec, type PastedElements } from '../clipboard';
import { PersistentClipboard, stripEngine } from '../bpmnClipboard';
import { engineExpression } from '../feelJuel';
import { feelIfPossible } from '../juelFeel';

/** Was wir von einem moddle-Element anfassen — bewusst schmal gehalten. */
interface Moddle {
  $type?: string;
  name?: string;
  values?: Moddle[];
  inputParameters?: Moddle[];
  [key: string]: unknown;
}
interface Moddled { businessObject?: { extensionElements?: Moddle } }
type AssignmentKey = typeof ASSIGNMENT_KEYS[number];

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
  /** Hintergrundfarbe eines Elements — `undefined` nimmt sie weg */
  setColor: (id: string, fill: string | undefined) => void;
  /** `_handledErrors` eines Schritts */
  setHandledErrors: (id: string, codes: string[], regex?: string[], engine?: EngineId) => void;
  /**
   * Zuständigkeit einer Benutzeraufgabe, schon in der Form der Engine —
   * `undefined` nimmt den Wert weg, fehlende Schlüssel bleiben, wie sie sind
   */
  setAssignment: (id: string, values: Partial<Record<AssignmentKey, string | undefined>>, engine?: EngineId) => void;
}

interface Props {
  xml: string;
  isDark: boolean;
  canEdit: boolean;
  /** Engine dieses Prozesses — Eingefügtes aus der anderen verliert seine Engine-Angaben */
  engine?: EngineId;
  /**
   * vom Modeler ausgelöste Änderung — der Baum liest neu ein. `pasted`: was
   * seit dem letzten Mal eingefügt wurde (alte → neue ID samt Spezifikationsanteil)
   */
  onChange: (xml: string, pasted?: PastedElements) => void;
  /** im Diagramm kopiert (Ctrl+C) — die IDs der Elemente, ohne Beschriftungen */
  onCopy?: (ids: string[]) => void;
  /** im Diagramm angeklickt */
  onSelect: (id: string | null) => void;
  onReady: (handle: BpmnHandle) => void;
  onError: (message: string) => void;
}

export default function BpmnEditor({ xml, isDark, canEdit, engine, onChange, onCopy, onSelect, onReady, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<InstanceType<typeof BpmnModeler> | null>(null);
  const timer = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);

  const cbs = useRef({ onChange, onCopy, onSelect, onReady, onError });
  cbs.current = { onChange, onCopy, onSelect, onReady, onError };
  const engineRef = useRef(engine);
  engineRef.current = engine;
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
      // Kopieren und Einfügen über Prozesse und Tabs hinweg (siehe bpmnClipboard.ts)
      additionalModules: [{ clipboard: ['type', PersistentClipboard] }],
    });
    modelerRef.current = modeler;
    // Entwicklung: Zugriff auf den Modeler, um den Abgleich prüfen zu können
    if (import.meta.env.DEV) (window as unknown as { __bpmn?: unknown }).__bpmn = modeler;

    // Eingefügt, aber noch nicht gemeldet: alte ID → neue ID. bpmn-js legt die
    // Elemente beim Einfügen an, ins Diagramm kommen sie erst beim Ablegen.
    let pendingPaste: Record<string, string> = {};
    let pendingSpec: DiagramSpec | undefined;
    /** was davon jetzt im Diagramm liegt — der Rest wartet aufs Ablegen */
    const takePasted = (): PastedElements | undefined => {
      const registry = modeler.get('elementRegistry') as { get: (id: string) => unknown };
      const ids: Record<string, string> = {};
      for (const [alt, neu] of Object.entries(pendingPaste)) {
        if (!registry.get(neu)) continue;
        ids[alt] = neu;
        delete pendingPaste[alt];
      }
      return Object.keys(ids).length ? { ids, spec: pendingSpec } : undefined;
    };

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
          if (next) { loadedRef.current = next; cbs.current.onChange(next, takePasted()); }
        } catch (e) {
          cbs.current.onError(e instanceof Error ? e.message : String(e));
        }
      }, 700);
    };

    modeler.on('commandStack.changed', push);

    // ── Kopieren und Einfügen ──────────────────────────────────────────────
    // Kopiert: die Prozessansicht legt den Anteil der Spezifikation dazu.
    // Ein «Duplizieren» (clip: false) geht nicht in die Zwischenablage.
    modeler.on('copyPaste.elementsCopied', (e: { tree?: Record<string, Array<{ id: string; labelTarget?: string }>>; hints?: { clip?: boolean } }) => {
      if (e.hints?.clip === false || !e.tree) return;
      const ids = Object.values(e.tree).flat().filter(d => !d.labelTarget).map(d => d.id);
      if (ids.length) cbs.current.onCopy?.(ids);
    });
    // Ein neues Einfügen beginnt: was vom vorigen nie abgelegt wurde, verfällt.
    // Der Spezifikationsanteil gilt so, wie er jetzt in der Zwischenablage steht.
    modeler.on('copyPaste.pasteElements', () => {
      pendingPaste = {};
      pendingSpec = getClipboard().diagram?.spec;
    });
    // Nach bpmn-js (Priorität 1000) und dessen Verweisen auf Fehler/Nachrichten
    // (500): das Element ist angelegt und hat seine neue ID.
    modeler.on('copyPaste.pasteElement', 250, (e: { descriptor: { id: string; labelTarget?: unknown; businessObject?: { id?: string } & Record<string, unknown> } }) => {
      const d = e.descriptor;
      if (d.labelTarget || !d.businessObject?.id) return;
      pendingPaste[d.id] = d.businessObject.id;
      const from = pendingSpec?.source.engine ?? 'c7';
      if (pendingSpec && from !== (engineRef.current ?? 'c7')) {
        stripEngine(d.businessObject as Parameters<typeof stripEngine>[0]);
        // Bedingung am Fluss: in der Schreibweise dieser Engine (`${…}` ⇄ `=…`)
        const cond = d.businessObject.conditionExpression as { body?: string } | undefined;
        if (cond?.body) cond.body = engineExpression(feelIfPossible(cond.body), engineRef.current).text;
      }
    });
    // Ein Klick in die Zeichenfläche — auch auf leere Stelle: dann trifft er
    // das Wurzelelement. Nur danach ist eine leere Auswahl eine echte Abwahl.
    // Der Merker gilt nur während des Klicks: gesetzt vor der Auswahl von
    // diagram-js (höhere Priorität), gelöscht danach — sonst bliebe er nach
    // einem Klick stehen, und die leere Auswahl beim nächsten Import (Pattern
    // eingefügt) wählte den Prozess statt des Elements.
    let vomNutzer = false;
    modeler.on('element.click', 1500, () => { vomNutzer = true; });
    modeler.on('element.click', 500, () => { vomNutzer = false; });
    modeler.on('selection.changed', (e: { newSelection: Array<{ id: string; type?: string; host?: { id: string } }> }) => {
      // ein Boundary-Event ist in der Spezifikation kein Schritt, sondern ein behandelter
      // Fehler (Nebenpfad) des Schritts, an dem es hängt — gezeigt wird dieser Schritt
      const first = e.newSelection?.[0];
      const id = (first?.type === 'bpmn:BoundaryEvent' ? first.host?.id : first?.id) ?? null;
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
          const selection = modeler.get('selection') as { select: (el: unknown) => void; get: () => unknown[] };
          const canvas = modeler.get('canvas') as { scrollToElement: (el: unknown) => void };
          const el = id ? registry.get(id) : null;
          // Ein Schritt, der im Diagramm (noch) nicht liegt, ist kein Grund,
          // die Auswahl im Baum wegzuwerfen.
          if (!el) { if (!id) selection.select(null); return; }
          // Im Diagramm angeklickt: die Auswahl kommt nur zurück — der
          // Ausschnitt bleibt (sonst rückt ein Element am Rand ins Bild)
          if (selection.get().includes(el)) return;
          // ein angeklicktes Boundary-Event des Schritts bleibt gewählt
          if ((selection.get() as Array<{ type?: string; host?: unknown }>).some(x => x.type === 'bpmn:BoundaryEvent' && x.host === el)) return;
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
      setColor: (id, fill) => {
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => unknown };
          const modeling = modeler.get('modeling') as { setColor: (els: unknown[], c: { fill?: string } | undefined) => void };
          const el = registry.get(id);
          // bpmn-js schreibt `bioc:fill` und `color:background-color` — wie der Camunda Modeler
          if (el) modeling.setColor([el], fill ? { fill } : undefined);
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
      setHandledErrors: (id, codes, regex, engine) => {
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => Moddled | undefined };
          const modeling = modeler.get('modeling') as { updateProperties: (el: unknown, p: object) => void };
          const moddle = modeler.get('moddle') as { create: (t: string, p: object) => Moddle; createAny: (n: string, ns: string, p: object) => Moddle };
          const el = registry.get(id);
          const bo = el?.businessObject;
          if (!bo) return;
          const ext = bo.extensionElements ?? moddle.create('bpmn:ExtensionElements', { values: [] });
          if (engine === 'c8') {
            // Camunda 8: `zeebe:input` im `zeebe:ioMapping` — die App kennt die zeebe-Typen nicht, sie bleiben generische Elemente
            const ZEEBE = 'http://camunda.org/schema/zeebe/1.0';
            let zio = ext.values?.find(v => v.$type === 'zeebe:ioMapping') as (Moddle & { $children?: Moddle[] }) | undefined;
            if (!zio) {
              zio = moddle.createAny('zeebe:ioMapping', ZEEBE, {}) as Moddle & { $children?: Moddle[] };
              ext.values = [...(ext.values ?? []), zio];
            }
            const rest = (zio.$children ?? []).filter(k => k.target !== '_handledErrors' && k.target !== '_regexHandledErrors');
            const put = (target: string, values: string[]) => moddle.createAny('zeebe:input', ZEEBE, { source: errorListSource(values, 'c8'), target });
            zio.$children = [
              ...rest,
              ...(codes.length ? [put('_handledErrors', codes)] : []),
              ...(regex?.length ? [put('_regexHandledErrors', regex)] : []),
            ];
            modeling.updateProperties(el, { extensionElements: ext });
            return;
          }
          let io = ext.values?.find(v => v.$type === 'camunda:InputOutput');
          if (!io) {
            io = moddle.create('camunda:InputOutput', { inputParameters: [], outputParameters: [] });
            ext.values = [...(ext.values ?? []), io];
          }
          const others = (io.inputParameters ?? []).filter(p => p.name !== '_handledErrors' && p.name !== '_regexHandledErrors');
          const param = (name: string, value: string) => [moddle.create('camunda:InputParameter', { name, value })];
          io.inputParameters = [
            ...others,
            ...(codes.length ? param('_handledErrors', errorListSource(codes, 'c7')) : []),
            ...(regex?.length ? param('_regexHandledErrors', errorListSource(regex, 'c7')) : []),
          ];
          modeling.updateProperties(el, { extensionElements: ext });
        } catch { /* Schritt nicht im Diagramm */ }
      },
      setAssignment: (id, values, engine) => {
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => Moddled | undefined };
          const modeling = modeler.get('modeling') as { updateProperties: (el: unknown, p: object) => void };
          const moddle = modeler.get('moddle') as { create: (t: string, p: object) => Moddle; createAny: (n: string, ns: string, p: object) => Moddle };
          const el = registry.get(id);
          const bo = el?.businessObject;
          if (!bo) return;
          if (engine !== 'c8') {
            modeling.updateProperties(el, Object.fromEntries(Object.entries(values).map(([k, v]) => [`camunda:${k}`, v || undefined])));
            return;
          }
          // Camunda 8: `zeebe:assignmentDefinition` — ein generisches Element, die App kennt die zeebe-Typen nicht
          const ZEEBE = 'http://camunda.org/schema/zeebe/1.0';
          const ext = bo.extensionElements ?? moddle.create('bpmn:ExtensionElements', { values: [] });
          let assign = ext.values?.find(v => v.$type === 'zeebe:assignmentDefinition');
          if (!assign) {
            assign = moddle.createAny('zeebe:assignmentDefinition', ZEEBE, {});
            ext.values = [...(ext.values ?? []), assign];
          }
          for (const [k, v] of Object.entries(values)) {
            if (v) assign[k] = v;
            else delete assign[k];
          }
          // ohne Werte fällt das Element weg
          if (!Object.keys(assign).some(k => !k.startsWith('$'))) ext.values = (ext.values ?? []).filter(v => v !== assign);
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
      {/* eigener Stapelkontext: das Kontextmenü von bpmn-js (z-index 100) bleibt unter Dialogen */}
      <div ref={hostRef} className="h-full w-full isolate" />
      {loading && (
        <div className={`absolute inset-0 flex items-center justify-center text-xs pointer-events-none ${isDark ? 'text-white/40' : 'text-black/40'}`}>
          Diagramm wird geladen …
        </div>
      )}
    </div>
  );
}
