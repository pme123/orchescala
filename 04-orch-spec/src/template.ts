// Templates for new processes.
//
// A new process does not start with a blank sheet, but with the
// BPMN that is customary in-house — pool, start event, init worker, the
// house error definitions. The templates live as files in
// `public/templates/` and are fetched on creation; which ones exist is listed
// here. Adding one means: drop in the file, add a line.
//
// One per engine, because a C7 and a C8 diagram don't need the same things:
// there external tasks with a topic and `camunda:` extensions, here
// `zeebe:taskDefinition`. A shared template would be wrong for both.
//
// The files contain `COMPANY-PROJECT-PROCESSVERSION` where the process ID
// belongs. On creation it is replaced everywhere — process, pool, topics.
// If it remained, all processes would have the same name, and more depends on that than
// it seems: topics, the mapping to the domain and the file name.

import { C7_LABEL, C8_LABEL } from './engineLabels.ts';
import type { EngineId } from './types.ts';

export interface EngineDef {
  id: EngineId;
  label: string;
  /** what this template is for — shown next to it in the create dialog */
  hint: string;
  /** file below `public/templates/` */
  file: string;
}

export const ENGINES: EngineDef[] = [
  { id: 'c7', label: C7_LABEL, hint: 'External Tasks mit Topic, camunda:-Erweiterungen', file: 'c7.bpmn' },
  { id: 'c8', label: C8_LABEL, hint: 'zeebe:taskDefinition', file: 'c8.bpmn' },
];



/** The placeholder in the templates — see `applyTemplate`. */
export const PLACEHOLDER = 'COMPANY-PROJECT-PROCESSVERSION';

// Once fetched, stays fetched: the templates don't change at runtime.
const geholt = new Map<EngineId, Promise<string>>();

/** Fetch the template of an engine. */
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
  /** ID of the process in the template */
  processId?: string;
  /** number of flow elements (without connections) */
  elements?: number;
}

/** Is this file usable as a template? */
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
 * Adapt the template to a new process.
 *
 * The placeholder is replaced **wherever it occurs** — as a whole attribute
 * or as part of one, element IDs included
 * (`COMPANY-PROJECT-PROCESSVERSION-participant`). That hits exactly the
 * places that mean it: the pool's `processRef`, its name, the
 * diagram plane and the topics of the own workers
 * (`<prozess>.ExtractClientKey`). Because the same thing is replaced in all attributes,
 * the references among each other stay consistent — a list of known
 * places would be shorter, but would miss something with the next template.
 *
 * Upper/lower case doesn't matter here: in the built-in template the pool
 * is called `COMPANY-PROJECT-PROCESSVERSION`, but the ID is lower case.
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
