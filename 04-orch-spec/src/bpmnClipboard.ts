// Die Zwischenablage von bpmn-js — gemeinsam für alle Modeler, auch in
// anderen Tabs.
//
// bpmn-js legt beim Kopieren einen Baum aus moddle-Objekten in seinen Dienst
// `clipboard` — nur im Speicher dieses einen Modelers, der beim Wechsel des
// Prozesses abgebaut wird. `PersistentClipboard` ersetzt diesen Dienst: er
// legt den Baum als JSON in die gemeinsame Zwischenablage (clipboard.ts) und
// baut ihn beim Einfügen mit dem moddle des Ziel-Modelers wieder auf — nach dem
// Muster aus bpmn-js-examples/copy-paste. Das eingebaute Ctrl+C/V funktioniert
// so über Prozesse und Tabs hinweg.
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

/** Namensräume der Erweiterungen, die die App nicht als Typen kennt (zeebe bleibt generisch) */
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
 * Den Baum als JSON. moddle hält einiges nicht aufzählbar: `$attrs` (fremde
 * Attribute wie Farben) und bei generischen Elementen den Namensraum — beides
 * kommt ausdrücklich mit. `$parent` bleibt draussen (sonst ein Kreis).
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
 * Den Baum mit dem moddle des Ziel-Modelers wieder aufbauen. Dasselbe Objekt
 * (z. B. ein Element und der Verweis darauf im Diagramm-Teil) wird über Typ
 * und ID wieder dasselbe.
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

/** Ersatz für den Dienst `clipboard` von diagram-js */
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
    // Ctrl+C ohne Auswahl liefert einen leeren Baum — das Kopierte bleibt dann
    if (!tree || typeof tree !== 'object' || !Object.keys(tree).length) return;
    setDiagramTree(serializeTree(tree));
  }

  clear(): unknown {
    // diagram-js leert die Ablage nach dem Einfügen nicht — hier auch nicht nötig
    return this.get();
  }

  isEmpty(): boolean {
    return !getClipboard().diagram;
  }
}

/**
 * Ein eingefügtes Element ohne die Angaben der anderen Engine: Camunda-7-
 * Attribute (`camunda:…`) und Erweiterungen (Mappings, Zuständigkeit, Fehler).
 * Was davon die Spezifikation führt, schreibt die App danach in der Form der
 * Ziel-Engine hinein bzw. der Export.
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
