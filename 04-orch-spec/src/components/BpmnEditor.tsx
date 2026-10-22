// BPMN editor above the flow — both show the same process.
//
// What is kept in sync:
//
//  · **Diagram → tree**: every change in the modeler is read in again shortly
//    afterwards; the business texts are kept via the element ID
//    (`mergeSpec`). The BPMN is stored next to the specification.
//  · **Tree → diagram**: a clicked step is selected in the diagram
//    and brought into view; a renamed step is renamed in the diagram.
//
// What is **not** kept in sync: creating or deleting steps only works in the
// diagram. The tree is a derived view — generating a BPMN graph from it
// including layout is a separate step (see README).
//
// The Camunda extension is mandatory: without it bpmn-js discards on
// save all `camunda:` elements — i.e. exactly the mappings.
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

/** What we touch of a moddle element — deliberately kept narrow. */
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
  /** Select a step in the diagram and bring it into view */
  select: (id: string | null) => void;
  /** Rename an element in the diagram (from the tree) */
  rename: (id: string, name: string) => void;
  /**
   * Change the element ID (convention from the business name).
   * 'absent' means: no diagram or element not in it — the
   * specification may rename anyway.
   */
  setId: (oldId: string, newId: string) => 'renamed' | 'conflict' | 'absent';
  /** Set Camunda properties; `id === null` means the process itself */
  setProps: (id: string | null, props: Record<string, unknown>) => void;
  /** Condition of a sequence flow */
  setCondition: (flowId: string, condition: string | undefined) => void;
  /** Background colour of an element — `undefined` removes it */
  setColor: (id: string, fill: string | undefined) => void;
  /** `_handledErrors` of a step */
  setHandledErrors: (id: string, codes: string[], regex?: string[], engine?: EngineId) => void;
  /**
   * Assignment of a user task, already in the engine's form —
   * `undefined` removes the value, missing keys stay as they are
   */
  setAssignment: (id: string, values: Partial<Record<AssignmentKey, string | undefined>>, engine?: EngineId) => void;
}

interface Props {
  xml: string;
  isDark: boolean;
  canEdit: boolean;
  /** Engine of this process — pasted content from the other one loses its engine information */
  engine?: EngineId;
  /**
   * change triggered by the modeler — the tree reads in again. `pasted`: what
   * was pasted since the last time (old → new ID including the specification part)
   */
  onChange: (xml: string, pasted?: PastedElements) => void;
  /** copied in the diagram (Ctrl+C) — the IDs of the elements, without labels */
  onCopy?: (ids: string[]) => void;
  /** clicked in the diagram */
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
  /** last loaded XML — prevents own changes from being re-imported
   *  (that would reset selection and viewport) */
  const loadedRef = useRef<string>('');
  const xmlRef = useRef(xml);
  xmlRef.current = xml;

  /** is an import running? Then destroy only afterwards — otherwise
   *  bpmn-js accesses a canvas that no longer exists */
  const pendingRef = useRef<Promise<unknown>>(Promise.resolve());
  /** last selection requested from outside — applied after the import */
  const gewuenschtRef = useRef<string | null>(null);

  const load = useCallback((modeler: InstanceType<typeof BpmnModeler>, text: string, alive: () => boolean) => {
    loadedRef.current = text;
    setLoading(true);
    // On import the canvas is often **not** measured yet — in the
    // left column layout the width is only fixed after the next paint
    // (height 453, width 0). bpmn-js then computes with NaN and throws.
    // So wait until it has a size, instead of guessing how long that takes.
    const einpassen = () => {
      const host = hostRef.current;
      if (!host?.isConnected || !host.clientWidth || !host.clientHeight) return false;
      try {
        const canvas = modeler.get('canvas') as { zoom: (a: string, b?: string) => void };
        canvas.zoom('fit-viewport', 'auto');
        return true;
      } catch {
        return false;   // Modeler already torn down
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
        } catch { /* Modeler already torn down */ }
      })
      .catch((e: unknown) => { if (alive()) cbs.current.onError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive()) setLoading(false); });
    pendingRef.current = run;
    return run;
  }, []);

  // Build the modeler and load right away. Both in one effect, so that a
  // rebuild (React StrictMode builds twice) imports again —
  // otherwise the canvas would be empty.
  useEffect(() => {
    if (!hostRef.current) return;
    let mounted = true;
    const alive = () => mounted;
    // After teardown the handle must not change anything «erfolgreich» anymore — the
    // destroyed modeler does not always throw, but its changes get lost.
    let destroyed = false;
    const modeler = new BpmnModeler({
      container: hostRef.current,
      // without the Camunda extension saving discards all mappings
      moddleExtensions: { camunda: camundaModdle },
      // Copy and paste across processes and tabs (see bpmnClipboard.ts)
      additionalModules: [{ clipboard: ['type', PersistentClipboard] }],
    });
    modelerRef.current = modeler;
    // Development: access to the modeler, to be able to check the reconciliation
    if (import.meta.env.DEV) (window as unknown as { __bpmn?: unknown }).__bpmn = modeler;

    // Pasted, but not reported yet: old ID → new ID. bpmn-js creates the
    // elements on paste, they only get into the diagram on drop.
    let pendingPaste: Record<string, string> = {};
    let pendingSpec: DiagramSpec | undefined;
    /** what of it is now in the diagram — the rest waits for the drop */
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

    // Every change goes back the same way — also those that came from the tree.
    // Otherwise the rename would be in the diagram, but never in the
    // stored `.bpmn`. The tree already has the new name, the
    // reconciliation only confirms it.
    const push = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        try {
          const { xml: next } = await modeler.saveXML({ format: true });
          // remember as «geladen», otherwise the way back re-imports its own
          // result and throws away selection and viewport
          if (next) { loadedRef.current = next; cbs.current.onChange(next, takePasted()); }
        } catch (e) {
          cbs.current.onError(e instanceof Error ? e.message : String(e));
        }
      }, 700);
    };

    modeler.on('commandStack.changed', push);

    // ── Copy and paste ─────────────────────────────────────────────────────
    // Copied: the process view adds the specification part.
    // A «Duplizieren» (clip: false) does not go into the clipboard.
    modeler.on('copyPaste.elementsCopied', (e: { tree?: Record<string, Array<{ id: string; labelTarget?: string }>>; hints?: { clip?: boolean } }) => {
      if (e.hints?.clip === false || !e.tree) return;
      const ids = Object.values(e.tree).flat().filter(d => !d.labelTarget).map(d => d.id);
      if (ids.length) cbs.current.onCopy?.(ids);
    });
    // A new paste begins: what was never dropped from the previous one expires.
    // The specification part applies as it is in the clipboard now.
    modeler.on('copyPaste.pasteElements', () => {
      pendingPaste = {};
      pendingSpec = getClipboard().diagram?.spec;
    });
    // After bpmn-js (priority 1000) and its references to errors/messages
    // (500): the element is created and has its new ID.
    modeler.on('copyPaste.pasteElement', 250, (e: { descriptor: { id: string; labelTarget?: unknown; businessObject?: { id?: string } & Record<string, unknown> } }) => {
      const d = e.descriptor;
      if (d.labelTarget || !d.businessObject?.id) return;
      pendingPaste[d.id] = d.businessObject.id;
      const from = pendingSpec?.source.engine ?? 'c7';
      if (pendingSpec && from !== (engineRef.current ?? 'c7')) {
        stripEngine(d.businessObject as Parameters<typeof stripEngine>[0]);
        // Condition on the flow: in this engine's notation (`${…}` ⇄ `=…`)
        const cond = d.businessObject.conditionExpression as { body?: string } | undefined;
        if (cond?.body) cond.body = engineExpression(feelIfPossible(cond.body), engineRef.current).text;
      }
    });
    // A click into the canvas — also on an empty spot: then it hits
    // the root element. Only after that is an empty selection a real deselection.
    // The flag only applies during the click: set before the selection of
    // diagram-js (higher priority), cleared afterwards — otherwise it would stay set
    // after a click, and the empty selection on the next import (pattern
    // pasted) would select the process instead of the element.
    let vomNutzer = false;
    modeler.on('element.click', 1500, () => { vomNutzer = true; });
    modeler.on('element.click', 500, () => { vomNutzer = false; });
    modeler.on('selection.changed', (e: { newSelection: Array<{ id: string; type?: string; host?: { id: string } }> }) => {
      // a boundary event is not a step in the specification, but a handled
      // error (side path) of the step it is attached to — that step is shown
      const first = e.newSelection?.[0];
      const id = (first?.type === 'bpmn:BoundaryEvent' ? first.host?.id : first?.id) ?? null;
      const geklickt = vomNutzer;
      vomNutzer = false;
      // On build and on import bpmn-js reports an empty selection. That
      // is the initial state, not a deselection — and would clear a selection
      // that just came from outside (switch data model → flow).
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
          // A step that is not (yet) in the diagram is no reason
          // to throw away the selection in the tree.
          if (!el) { if (!id) selection.select(null); return; }
          // Clicked in the diagram: the selection only comes back — the
          // viewport stays (otherwise an element at the edge moves into view)
          if (selection.get().includes(el)) return;
          // a clicked boundary event of the step stays selected
          if ((selection.get() as Array<{ type?: string; host?: unknown }>).some(x => x.type === 'bpmn:BoundaryEvent' && x.host === el)) return;
          selection.select(el);
          canvas.scrollToElement(el);
        } catch { /* Element not (yet) in the diagram */ }
      },
      setProps: (id, props) => {
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => unknown };
          const canvas = modeler.get('canvas') as { getRootElement: () => unknown };
          const modeling = modeler.get('modeling') as { updateProperties: (el: unknown, p: object) => void };
          const el = id === null ? canvas.getRootElement() : registry.get(id);
          if (el) modeling.updateProperties(el, props);
        } catch { /* Element not in the diagram */ }
      },
      setColor: (id, fill) => {
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => unknown };
          const modeling = modeler.get('modeling') as { setColor: (els: unknown[], c: { fill?: string } | undefined) => void };
          const el = registry.get(id);
          // bpmn-js writes `bioc:fill` and `color:background-color` — like the Camunda Modeler
          if (el) modeling.setColor([el], fill ? { fill } : undefined);
        } catch { /* Element not in the diagram */ }
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
        } catch { /* Flow not in the diagram */ }
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
            // Camunda 8: `zeebe:input` in the `zeebe:ioMapping` — the app does not know the zeebe types, they stay generic elements
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
        } catch { /* Step not in the diagram */ }
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
          // Camunda 8: `zeebe:assignmentDefinition` — a generic element, the app does not know the zeebe types
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
          // without values the element is dropped
          if (!Object.keys(assign).some(k => !k.startsWith('$'))) ext.values = (ext.values ?? []).filter(v => v !== assign);
          modeling.updateProperties(el, { extensionElements: ext });
        } catch { /* Step not in the diagram */ }
      },
      setId: (oldId, newId) => {
        if (destroyed) return 'absent';
        try {
          const registry = modeler.get('elementRegistry') as { get: (id: string) => unknown };
          const modeling = modeler.get('modeling') as { updateProperties: (el: unknown, p: object) => void };
          const el = registry.get(oldId);
          if (!el) return 'absent';
          // In the diagram the target ID may also be on flows or boundary events
          // that the tree does not know — then better not rename at all.
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
        } catch { /* Element not in the diagram */ }
      },
    };
    cbs.current.onReady(handle);
    if (xmlRef.current) load(modeler, xmlRef.current, alive);

    return () => {
      mounted = false;
      destroyed = true;
      if (timer.current) window.clearTimeout(timer.current);
      modelerRef.current = null;
      // wait first, then tear down
      void pendingRef.current.catch(() => {}).then(() => modeler.destroy());
    };
  }, [load]);

  // XML from outside (another file chosen) — own changes are already remembered
  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler || !xml || xml === loadedRef.current) return;
    load(modeler, xml, () => modelerRef.current === modeler);
  }, [xml, load]);

  // Read-only: hide the editing tools
  const readOnly = !canEdit;
  void isDark; // the canvas stays light in both modes (see index.css)

  return (
    <div className={`bpmn-host relative h-full w-full ${readOnly ? 'bpmn-readonly' : ''}`}>
      {/* own stacking context: the context menu of bpmn-js (z-index 100) stays below dialogs */}
      <div ref={hostRef} className="h-full w-full isolate" />
      {loading && (
        <div className={`absolute inset-0 flex items-center justify-center text-xs pointer-events-none ${isDark ? 'text-white/40' : 'text-black/40'}`}>
          Diagramm wird geladen …
        </div>
      )}
    </div>
  );
}
