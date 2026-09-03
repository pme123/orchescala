// Vorlagen für neue Prozesse.
//
// Ein neuer Prozess startet nicht mit einem leeren Blatt, sondern mit dem
// BPMN, das im Haus üblich ist — Pool, Startereignis, Init-Worker, die
// eigenen Fehlerdefinitionen. Die Vorlagen liegen als Dateien in
// `public/templates/` und werden beim Anlegen geholt; welche es gibt, steht
// hier. Eine dazunehmen heisst: Datei ablegen, Zeile ergänzen.
//
// Eine je Engine, weil ein C7- und ein C8-Diagramm nicht dasselbe brauchen:
// dort External Tasks mit Topic und `camunda:`-Erweiterungen, hier
// `zeebe:taskDefinition`. Eine gemeinsame Vorlage wäre für beide falsch.
//
// In den Dateien steht `COMPANY-PROJECT-PROCESSVERSION`, wo die Prozess-ID
// hingehört. Beim Anlegen wird sie überall ersetzt — Prozess, Pool, Topics.
// Bliebe sie stehen, hiessen alle Prozesse gleich, und daran hängt mehr, als
// es aussieht: Topics, die Zuordnung zur Domain und der Dateiname.

import type { EngineId } from './types.ts';

export interface EngineDef {
  id: EngineId;
  label: string;
  /** wozu diese Vorlage gehört — steht im Anlegen-Dialog daneben */
  hint: string;
  /** Datei unterhalb von `public/templates/` */
  file: string;
}

export const ENGINES: EngineDef[] = [
  { id: 'c7', label: 'Camunda 7', hint: 'External Tasks mit Topic, camunda:-Erweiterungen', file: 'c7.bpmn' },
  { id: 'c8', label: 'Camunda 8', hint: 'zeebe:taskDefinition', file: 'c8.bpmn' },
];

export const DEFAULT_ENGINE: EngineId = 'c7';

export const engineLabel = (id: EngineId | undefined) =>
  ENGINES.find(e => e.id === id)?.label ?? String(id ?? DEFAULT_ENGINE);

/** Der Platzhalter in den Vorlagen — siehe `applyTemplate`. */
export const PLACEHOLDER = 'COMPANY-PROJECT-PROCESSVERSION';

// Einmal geholt, bleibt geholt: die Vorlagen ändern sich zur Laufzeit nicht.
const geholt = new Map<EngineId, Promise<string>>();

/** Die Vorlage einer Engine holen. */
export function loadTemplate(engine: EngineId): Promise<string> {
  const vorhanden = geholt.get(engine);
  if (vorhanden) return vorhanden;
  const def = ENGINES.find(e => e.id === engine);
  if (!def) return Promise.reject(new Error(`Für «${engine}» gibt es keine Vorlage.`));
  const url = `${import.meta.env.BASE_URL}templates/${def.file}`;
  const lauf = fetch(url)
    .then(res => {
      if (!res.ok) throw new Error(`Vorlage ${def.file} liess sich nicht laden (HTTP ${res.status}).`);
      return res.text();
    })
    .catch(e => { geholt.delete(engine); throw e; });
  geholt.set(engine, lauf);
  return lauf;
}

function localName(el: Element): string {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
}

function findAll(root: Element, name: string): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    if (localName(el) === name) out.push(el);
    for (const kind of Array.from(el.children)) walk(kind);
  };
  walk(root);
  return out;
}

export interface TemplateCheck {
  ok: boolean;
  message: string;
  /** ID des Prozesses in der Vorlage */
  processId?: string;
  /** Zahl der Ablauf-Elemente (ohne Verbindungen) */
  elements?: number;
}

/** Taugt diese Datei als Vorlage? */
export function checkTemplate(xml: string): TemplateCheck {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    return { ok: false, message: 'Die Datei liess sich nicht als XML lesen.' };
  }
  if (doc.querySelector?.('parsererror')) {
    return { ok: false, message: 'Die Datei ist kein gültiges XML.' };
  }
  const root = doc.documentElement;
  if (!root || localName(root) !== 'definitions') {
    return { ok: false, message: 'Das ist keine BPMN-Datei (es fehlt das <definitions>-Element).' };
  }
  const proc = findAll(root, 'process')[0];
  if (!proc) return { ok: false, message: 'In der Datei steht kein <process>.' };
  const elements = Array.from(proc.children)
    .filter(k => !['sequenceFlow', 'extensionElements', 'documentation'].includes(localName(k))).length;
  if (!elements) return { ok: false, message: 'Der Prozess in der Vorlage ist leer.' };
  return { ok: true, message: '', processId: proc.getAttribute('id') ?? '', elements };
}

/**
 * Die Vorlage auf einen neuen Prozess münzen.
 *
 * Ersetzt wird der Platzhalter **überall, wo er steht** — als Attribut ganz
 * oder als Teil davon, Element-IDs eingeschlossen
 * (`COMPANY-PROJECT-PROCESSVERSIONParticipant`). Das trifft genau die
 * Stellen, die ihn meinen: `processRef` des Pools, dessen Name, die
 * Diagramm-Ebene und die Topics der eigenen Worker
 * (`<prozess>.ExtractClientKey`). Weil in allen Attributen dasselbe ersetzt
 * wird, bleiben die Verweise untereinander stimmig — eine Liste bekannter
 * Stellen wäre kürzer, würde aber bei der nächsten Vorlage etwas übersehen.
 *
 * Gross-/Kleinschreibung zählt dabei nicht: in der eingebauten Vorlage heisst
 * der Pool `COMPANY-PROJECT-PROCESSVERSION`, die ID aber klein.
 */
export function applyTemplate(xml: string, ziel: { processId: string; title?: string }): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  const proc = findAll(root, 'process')[0];
  if (!proc) throw new Error('In der Vorlage steht kein <process>.');
  const alt = proc.getAttribute('id') ?? '';

  if (alt) {
    const suche = new RegExp(alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const ersetzen = (el: Element) => {
      for (const attr of Array.from(el.attributes)) {
        if (suche.test(attr.value)) {
          el.setAttribute(attr.name, attr.value.replace(suche, ziel.processId));
        }
      }
      for (const kind of Array.from(el.children)) ersetzen(kind);
    };
    ersetzen(root);
  }

  proc.setAttribute('id', ziel.processId);
  proc.setAttribute('name', ziel.title || ziel.processId);
  return new XMLSerializer().serializeToString(doc);
}
