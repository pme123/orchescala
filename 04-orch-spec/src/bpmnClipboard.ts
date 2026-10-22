// The bpmn-js clipboard — shared by all modelers, even in
// other tabs.
//
// On copy, bpmn-js puts a tree of moddle objects into its service
// `clipboard` — held only in the memory of this one modeler, which is torn down
// when the process changes. `PersistentClipboard` replaces this service: it
// puts the tree as JSON into the shared clipboard (clipboard.ts) and
// rebuilds it on paste with the moddle of the target modeler — following the
// pattern from bpmn-js-examples/copy-paste. The built-in Ctrl+C/V thus works
// across processes and tabs.
import { getClipboard, setDiagramTree } from './clipboard';

interface ModdleLike {
  create: (type: string, attrs?: object) => ModdleObject;
  createAny: (name: string, nsUri: string, attrs?: object) => ModdleObject;
}
interface ModdleObject {
  $type: string;
  $attrs?: Record<string, unknown>;
  $descriptor?: { isGeneric?: boolean; ns?: { uri?: string } };
  [key: string]: unknown;
}

/** Namespaces of the extensions the app does not know as types (zeebe stays generic) */
const KNOWN_NS: Record<string, string> = {
  zeebe: 'http://camunda.org/schema/zeebe/1.0',
  modeler: 'http://camunda.org/schema/modeler/1.0',
};
const nsOf = (type: string) => {
  const prefix = type.split(':')[0];
  return KNOWN_NS[prefix] ?? `http://${prefix}`;
};

const isModdle = (v: unknown): v is ModdleObject =>
  !!v && typeof v === 'object' && typeof (v as { $type?: unknown }).$type === 'string';

/**
 * The tree as JSON. moddle keeps some things non-enumerable: `$attrs` (foreign
 * attributes such as colours) and, for generic elements, the namespace — both
 * are included explicitly. `$parent` stays out (otherwise a cycle).
 */
export function serializeTree(tree: unknown): string {
  return JSON.stringify(tree, (_key, value: unknown) => {
    if (!isModdle(value)) return value;
    const out: Record<string, unknown> = { ...value };
    if (value.$attrs && Object.keys(value.$attrs).length) out.$attrs = { ...value.$attrs };
    if (value.$descriptor?.isGeneric) out.$ns = value.$descriptor.ns?.uri;
    return out;
  });
}

/**
 * Rebuild the tree with the moddle of the target modeler. The same object
 * (e.g. an element and the reference to it in the diagram part) becomes the
 * same again via type and ID.
 */
export function reviveTree(text: string, moddle: ModdleLike): unknown {
  const cache = new Map<string, ModdleObject>();
  return JSON.parse(text, (_key, value: unknown) => {
    if (!isModdle(value)) return value;
    const { $type, $attrs, $ns, ...props } = value as ModdleObject & { $ns?: string };
    const key = typeof props.id === 'string' ? `${$type}#${props.id}` : null;
    const hit = key ? cache.get(key) : undefined;
    if (hit) return hit;
    let el: ModdleObject;
    if ($ns) el = moddle.createAny($type, $ns, props);
    else {
      try { el = moddle.create($type, props); } catch { el = moddle.createAny($type, nsOf($type), props); }
    }
    if ($attrs && el.$attrs) Object.assign(el.$attrs, $attrs);
    if (key) cache.set(key, el);
    return el;
  });
}

/** Replacement for the `clipboard` service of diagram-js */
export class PersistentClipboard {
  static $inject = ['moddle'];
  private readonly moddle: ModdleLike;

  constructor(moddle: ModdleLike) {
    this.moddle = moddle;
  }

  get(): unknown {
    const d = getClipboard().diagram;
    if (!d) return undefined;
    try { return reviveTree(d.tree, this.moddle); } catch { return undefined; }
  }

  set(tree: unknown) {
    // Ctrl+C without a selection yields an empty tree — the copied content then stays
    if (!tree || typeof tree !== 'object' || !Object.keys(tree).length) return;
    setDiagramTree(serializeTree(tree));
  }

  clear(): unknown {
    // diagram-js does not clear the clipboard after pasting — not needed here either
    return this.get();
  }

  isEmpty(): boolean {
    return !getClipboard().diagram;
  }
}

/**
 * A pasted element without the settings of the other engine: Camunda 7
 * attributes (`camunda:…`) and extensions (mappings, assignment, errors).
 * Whatever of these the specification holds, the app then writes back in the
 * form of the target engine, or the export does.
 */
export function stripEngine(bo: ModdleObject & { set?: (k: string, v: unknown) => void; $descriptor?: { properties?: Array<{ name: string; ns?: { prefix?: string } }> } }) {
  if (bo.extensionElements) bo.set?.('extensionElements', undefined);
  for (const p of bo.$descriptor?.properties ?? []) {
    if (p.ns?.prefix === 'camunda' && bo[p.name] !== undefined) bo.set?.(p.name, undefined);
  }
  for (const k of Object.keys(bo.$attrs ?? {})) {
    if (/^(camunda|zeebe):/.test(k)) delete bo.$attrs![k];
  }
}
