// Zwischenablage für Kopieren und Einfügen — über Prozesse, Tabs und Fenster
// desselben Browsers hinweg.
//
// **Ablage**: `localStorage` (`orch-spec.clipboard`), damit ein anderer Tab
// derselben App sie sieht; ein Reload überlebt sie auch. Ein Tab erfährt vom
// anderen über das `storage`-Event. Klappt der Speicher nicht (privates
// Fenster, voll), bleibt sie im Tab — kopieren und einfügen geht dann nur dort.
//
// **Zwei Fächer**, weil beides nebeneinander sinnvoll ist:
//  · `diagram` — Elemente aus dem Modeler: der Baum von bpmn-js (serialisiert,
//    siehe bpmnClipboard.ts) und der Anteil der Spezifikation, der nicht im
//    BPMN steht (Beschreibung, Mappings, Interaktion samt Klassen …).
//  · `model` — eine Klasse/Auswahl oder ein einzelnes Feld aus dem Datenmodell,
//    jeweils mit den eigenen Klassen, auf die es verweist.
import { useSyncExternalStore } from 'react';
import type { EngineId, Field, Interaction, Step, TypeDef } from './types';

const KEY = 'orch-spec.clipboard';

/** Woher das Kopierte stammt — für Hinweise und den Verlauf */
export interface ClipSource {
  slug: string;
  title: string;
  engine?: EngineId;
}

/** Der Anteil der Spezifikation an kopierten Diagramm-Elementen */
export interface DiagramSpec {
  source: ClipSource;
  /** die Schritte nach ihrer ID in der Quelle — auch die verschachtelten */
  steps: Record<string, Step>;
  /** Interaktionen der kopierten Schritte */
  interactions: Interaction[];
  /** ihre In/Out-Klassen samt den eigenen Klassen, auf die diese verweisen */
  types: TypeDef[];
}

export interface DiagramClip {
  /** der Baum von bpmn-js, serialisiert */
  tree: string;
  /** fehlt nur kurz: zwischen Kopieren im Modeler und der Antwort der Prozessansicht */
  spec?: DiagramSpec;
}

export type ModelClip =
  | { kind: 'type'; source: ClipSource; typeId: string; types: TypeDef[] }
  | { kind: 'field'; source: ClipSource; field: Field; types: TypeDef[] };

export interface ClipState {
  diagram?: DiagramClip;
  model?: ModelClip;
}

/** Eingefügte Elemente: alte ID in der Quelle → neue ID im Diagramm, dazu der Spezifikationsanteil */
export interface PastedElements {
  ids: Record<string, string>;
  spec?: DiagramSpec;
}

// ── Speicher ─────────────────────────────────────────────────────────────────

/** Fallback ohne localStorage: nur dieser Tab */
let memory: string | null = null;
let memoryOnly = false;

function readRaw(): string | null {
  if (memoryOnly) return memory;
  try { return localStorage.getItem(KEY); } catch { return memory; }
}

// Für useSyncExternalStore muss derselbe Stand dasselbe Objekt sein.
let lastRaw: string | null | undefined;
let lastState: ClipState = {};

export function getClipboard(): ClipState {
  const raw = readRaw();
  if (raw !== lastRaw) {
    lastRaw = raw;
    try { lastState = raw ? JSON.parse(raw) as ClipState : {}; } catch { lastState = {}; }
  }
  return lastState;
}

const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

function write(next: ClipState) {
  const text = JSON.stringify(next);
  memory = text;
  if (!memoryOnly) {
    try { localStorage.setItem(KEY, text); } catch { memoryOnly = true; }
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) listener(); };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Die Zwischenablage — aktualisiert sich auch, wenn ein anderer Tab kopiert */
export function useClipboard(): ClipState {
  return useSyncExternalStore(subscribe, getClipboard, getClipboard);
}

// ── Schreiben ────────────────────────────────────────────────────────────────

/** Der Modeler hat kopiert — der Spezifikationsanteil folgt mit `attachDiagramSpec` */
export function setDiagramTree(tree: string) {
  write({ ...getClipboard(), diagram: { tree } });
}

export function attachDiagramSpec(spec: DiagramSpec) {
  const cur = getClipboard();
  if (!cur.diagram) return;
  write({ ...cur, diagram: { ...cur.diagram, spec } });
}

export function setModelClip(model: ModelClip) {
  write({ ...getClipboard(), model });
}

export function clearDiagramClip() {
  const { diagram: _, ...rest } = getClipboard();
  write(rest);
}

export function clearModelClip() {
  const { model: _, ...rest } = getClipboard();
  write(rest);
}
