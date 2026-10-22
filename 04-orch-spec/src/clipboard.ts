// Clipboard for copy and paste — across processes, tabs and windows
// of the same browser.
//
// **Storage**: `localStorage` (`orch-spec.clipboard`), so that another tab
// of the same app sees it; it also survives a reload. A tab learns about
// the other via the `storage` event. If storage does not work (private
// window, full), it stays in the tab — copy and paste then only work there.
//
// **Two compartments**, because both make sense side by side:
//  · `diagram` — elements from the modeler: the tree of bpmn-js (serialized,
//    see bpmnClipboard.ts) and the part of the specification that is not in the
//    BPMN (description, mappings, interaction including classes …).
//  · `model` — a class/choice or a single field from the data model,
//    each with the own classes it references.
import { useSyncExternalStore } from 'react';
import type { EngineId, Field, Interaction, Step, TypeDef } from './types';

const KEY = 'orch-spec.clipboard';

/** Where the copied content comes from — for hints and the history */
export interface ClipSource {
  slug: string;
  title: string;
  engine?: EngineId;
}

/** The specification part of copied diagram elements */
export interface DiagramSpec {
  source: ClipSource;
  /** the steps by their ID in the source — also the nested ones */
  steps: Record<string, Step>;
  /** Interactions of the copied steps */
  interactions: Interaction[];
  /** their In/Out classes together with the own classes these reference */
  types: TypeDef[];
}

export interface DiagramClip {
  /** the tree of bpmn-js, serialized */
  tree: string;
  /** missing only briefly: between copying in the modeler and the answer of the process view */
  spec?: DiagramSpec;
}

export type ModelClip =
  | { kind: 'type'; source: ClipSource; typeId: string; types: TypeDef[] }
  | { kind: 'field'; source: ClipSource; field: Field; types: TypeDef[] };

export interface ClipState {
  diagram?: DiagramClip;
  model?: ModelClip;
}

/** Pasted elements: old ID in the source → new ID in the diagram, plus the specification part */
export interface PastedElements {
  ids: Record<string, string>;
  spec?: DiagramSpec;
}

// ── Storage ──────────────────────────────────────────────────────────────────

/** Fallback without localStorage: this tab only */
let memory: string | null = null;
let memoryOnly = false;

function readRaw(): string | null {
  if (memoryOnly) return memory;
  try { return localStorage.getItem(KEY); } catch { return memory; }
}

// For useSyncExternalStore the same state must be the same object.
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

/** The clipboard — also updates when another tab copies */
export function useClipboard(): ClipState {
  return useSyncExternalStore(subscribe, getClipboard, getClipboard);
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** The modeler copied — the specification part follows with `attachDiagramSpec` */
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
