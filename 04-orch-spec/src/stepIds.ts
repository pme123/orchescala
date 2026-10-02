// Element-IDs nach Hauskonvention — abgelesen an den bestehenden
// Globex-Prozessen: PascalCase des fachlichen Namens plus Typ-Suffix,
// OHNE company-projekt-Prefix. Den Prefix tragen nur Prozess-IDs, Topics,
// Message-Namen und DMN-Referenzen — Ablauf-Elemente (auch Benutzeraufgaben)
// heissen nur nach ihrem Namen:
//
//   Get Account           (service) → GetAccountTask
//   Approval              (user)    → ApprovalTask
//   Send Process Event    (call)    → SendProcessEventCallActivity
//   Has Responsible User  (gateway) → HasResponsibleUserGateway
//   heatmap               (event)   → HeatmapEvent
//   Account opened        (end)     → AccountOpenedEndEvent
//   start                 (start)   → StartStartEvent
//
// Umlaute verlieren dabei nur ihre Zeichen («Kartenbestellung prüfen (Backoffice)» →
// KartenbestellungPrufenBackofficeTask) — genau wie in den bestehenden IDs, und anders
// als bei den Scala-Objektnamen (dort ä → ae, siehe `pascal` in
// interactions.ts). Doppelte IDs zählen ohne Trenner hoch (HeatmapEvent1).

import type { Model, ProcessSpec, Step, StepKind } from './types';

const SUFFIX: Partial<Record<StepKind, string>> = {
  start: 'StartEvent',
  end: 'EndEvent',
  service: 'Task',
  user: 'Task',
  rule: 'Task',
  script: 'Task',
  manual: 'Task',
  send: 'Task',
  receive: 'Task',
  call: 'CallActivity',
  subprocess: 'SubProcess',
  gateway: 'Gateway',
  event: 'Event',
};

/** «Kartenbestellung prüfen (Backoffice)» → `KartenbestellungPrufenBackoffice` */
export function idPascal(text: string): string {
  const ascii = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u00df/g, 'ss');
  const parts = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return parts.map(p => (/^[A-Z0-9]+$/.test(p) ? p : p.replace(/^(.)/, c => c.toUpperCase()))).join('');
}

/**
 * Die ID, die dieser Schritt nach Konvention trägt — oder null, wenn sich
 * keine ableiten lässt (Verweis-Schritte, leerer Name). `taken` sagt, ob eine
 * Kandidaten-ID schon vergeben ist; die eigene ID zählt dabei nicht.
 */
export function conventionalId(
  step: Pick<Step, 'kind' | 'name'>,
  taken: (id: string) => boolean,
): string | null {
  const suffix = SUFFIX[step.kind];
  if (!suffix) return null;
  const base = idPascal(step.name ?? '');
  if (!base) return null;
  // Endet der Name schon auf das Suffix («Approval Task»), nicht doppeln —
  // und eine ID darf nicht mit einer Ziffer beginnen (XML-NCName).
  let id = base.endsWith(suffix) ? base : `${base}${suffix}`;
  if (/^\d/.test(id)) id = `N${id}`;
  if (!taken(id)) return id;
  for (let i = 1; i < 100; i++) if (!taken(`${id}${i}`)) return `${id}${i}`;
  return null;
}

/**
 * Ein Name, den niemand gewählt hat: leer, die eigene ID (Import-Fallback)
 * oder genau eine vom Modeler vergebene ID (`Activity_14pc7cv` — Elementart,
 * Unterstrich, sieben Zeichen). Ein angepasster Name zählt nie dazu, auch
 * nicht einer mit Unterstrich (`Check_balance`).
 */
const MODELER_ID = /^(Activity|Task|Event|Gateway|StartEvent|EndEvent|SubProcess|CallActivity|Process)_[0-9a-z]{7}$/;
export function unnamed(step: Pick<Step, 'name' | 'id'>): boolean {
  const n = (step.name ?? '').trim();
  return !n || n === step.id || MODELER_ID.test(n);
}

/**
 * Der Name eines Schritts aus dem gewählten Service bzw. Prozess — die
 * Kennung in Wörtern, ohne Projekt, Version und Platzhalter:
 *
 *   valiant-fil-is-accountAndPortfolioV3.GetAccountsAccountKey → Get Accounts Account Key
 *   valiant-vollmacht-getAccountsV2                            → Get Accounts
 *   valiant-documents-print-document                           → Print Document
 *   valiant-depot-updateContractsV1-UpdateContract             → Update Contract
 *
 * `prefixes`: die bekannten `firma-projekt` (siehe knownPrefixes) — ohne sie
 * gelten die ersten beiden Teile als Projekt.
 */
export function nameFromService(ref: string, prefixes: string[] = []): string {
  let tail: string;
  const p0 = [...prefixes].sort((a, b) => b.length - a.length).find(x => ref.startsWith(`${x}-`));
  // Signal, Nachricht, Benutzeraufgabe: was hinter dem letzten Punkt steht
  if (/\.(signal|message|userTask)\./.test(ref)) tail = ref.slice(ref.lastIndexOf('.') + 1);
  else if (ref.includes('.')) {
    // Service und Operation (`…accountAndPortfolioV3.GetAccounts`, `…eventStatus.get`)
    const own = p0 ? ref.slice(p0.length + 1) : ref.split('-').slice(2).join('-') || ref;
    const dot = own.indexOf('.');
    const service = own.slice(0, dot), op = own.slice(dot + 1);
    // nur ein Verb (`get`, `post`) sagt allein nichts — dann mit dem Service davor
    tail = /^[a-z]+$/.test(op) ? `${service.replace(/V\d+$/, '')} ${op}` : op;
  }
  // der Prozess ist das Projekt selbst (`valiant-addresschange`)
  else if (prefixes.includes(ref)) tail = ref.slice(ref.lastIndexOf('-') + 1);
  else {
    const rest = p0 ? ref.slice(p0.length + 1) : ref.split('-').slice(2).join('-') || ref;
    // eigener Worker eines Prozesses: `<prozess>[V1]-<Operation>` → die Operation
    tail = /^[a-z][A-Za-z0-9]*-([A-Z].*)$/.exec(rest)?.[1] ?? /^[A-Za-z0-9]*V\d+-(.+)$/.exec(rest)?.[1] ?? rest;
  }
  const words = tail
    .replace(/-?\{+[^}]*\}+/g, '')               // Platzhalter ({{…}}, {…})
    .replace(/V\d+$/, '')                          // Version
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s._-]+/).filter(Boolean);
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Lohnt es sich, für diesen Schritt eine ID abzuleiten? Nicht bei Namen, die
 * nur der Import-Fallback sind (namenlose Elemente tragen ihre ID als Namen,
 * siehe `defaultName` in bpmn.ts).
 */
export function derivable(step: Pick<Step, 'kind' | 'name' | 'id'>): boolean {
  return !!step.name && step.name !== step.id && step.kind !== 'goto';
}

/**
 * Eine Element-ID direkt im BPMN-XML umbenennen — für den Fall, dass der
 * Modeler gerade nicht offen ist. Ersetzt wird jedes Attribut, das die ID
 * exakt trägt (`id`, `sourceRef`, `targetRef`, `attachedToRef`,
 * `bpmnElement`, …) — so bleiben alle Verweise stimmig. Gibt null zurück,
 * wenn die alte ID nicht vorkommt oder die neue schon vergeben ist.
 */
export function renameIdInXml(xml: string, oldId: string, newId: string, name?: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || doc.querySelector?.('parsererror')) return null;
  let found = false;
  let clash = false;
  const walk = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'id' && attr.value === newId) clash = true;
      if (attr.value === oldId) {
        el.setAttribute(attr.name, newId);
        found = true;
        // Der fachliche Name gehört auch ins BPMN — ohne offenen Modeler wäre
        // die Umbenennung sonst nur in der Spezifikation und fiele beim
        // nächsten Abgleich zurück.
        if (attr.name === 'id' && name !== undefined) el.setAttribute('name', name);
      }
    }
    for (const kind of Array.from(el.children)) walk(kind);
  };
  walk(root);
  if (!found || clash) return null;
  return new XMLSerializer().serializeToString(doc);
}

/**
 * Eine Schritt-ID überall in der Spezifikation nachziehen: im Baum (samt
 * `gotoId`-Verweisen), in den Interaktionen (bei Benutzeraufgaben ist die ID
 * auch der Schlüssel) und in den Kommentar-Zielen.
 */
export function renameStepId<T extends {
  steps: Step[];
  interactions?: Array<{ stepId: string; key: string; [k: string]: unknown }>;
  comments?: Array<{ target: string; [k: string]: unknown }>;
}>(spec: T, oldId: string, newId: string): T {
  const walk = (steps: Step[]): Step[] => steps.map(s => {
    const next: Step = { ...s };
    if (s.id === oldId) next.id = newId;
    if (s.gotoId === oldId) next.gotoId = newId;
    if (s.children) next.children = walk(s.children);
    if (s.branches) next.branches = s.branches.map(b => ({ ...b, steps: walk(b.steps) }));
    if (s.errors) next.errors = s.errors.map(e => (e.steps ? { ...e, steps: walk(e.steps) } : e));
    return next;
  });
  return {
    ...spec,
    steps: walk(spec.steps),
    ...(spec.interactions ? {
      interactions: spec.interactions.map(i => (i.stepId === oldId
        ? { ...i, stepId: newId, ...(i.key === oldId ? { key: newId } : {}) }
        : i)),
    } : {}),
    ...(spec.comments ? {
      // auch die Teile des Schritts: `step:<id>#in:name` …
      comments: spec.comments.map(t => (t.target === `step:${oldId}` || t.target.startsWith(`step:${oldId}#`)
        ? { ...t, target: `step:${newId}${t.target.slice(`step:${oldId}`.length)}` }
        : t)),
    } : {}),
  };
}

// ── Firma und Projekt (`company-projekt`-Prefix) ─────────────────────────────

/** `globex-core-banking` → { company: 'globex', project: 'core-banking' } */
export function splitPrefix(prefix: string): { company: string; project: string } {
  const [company, ...rest] = prefix.split('-').filter(Boolean);
  return { company: company ?? '', project: rest.join('-') };
}

/**
 * Alle bekannten `company-projekt`-Prefixe: die Projekt-Ordner des Katalogs
 * (model.projects), die Prozesse im Domain-Katalog (`processName`) und die
 * Projekte der vorhandenen Spezifikationen.
 */
export function knownPrefixes(model: Model | null, specProjects: Array<string | undefined>): string[] {
  const out = new Set<string>();
  for (const p of model?.projects ?? []) if (p.name?.includes('-')) out.add(p.name);
  for (const t of model?.domainTypes ?? []) {
    const m = t.processName ? /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+)-[a-z][A-Za-z0-9]*V\d+$/.exec(t.processName) : null;
    if (m) out.add(m[1]);
  }
  for (const p of specProjects) if (p?.includes('-')) out.add(p);
  return [...out].sort();
}

/**
 * Firma/Projekt eines Prozesses wechseln: der alte Prefix wird in allen
 * fachlichen IDs ersetzt — Prozess-ID, Topics eigener Worker, DMN-Referenzen,
 * gerufene eigene Prozesse, Nachrichten-/Signalnamen, Interaktions-Schlüssel,
 * und auch in Beschreibungen, wo die IDs erwähnt sind. Fremde Services tragen
 * einen anderen Prefix und bleiben unberührt. Der Dateiname (slug) bleibt —
 * Dateien benennt die App bewusst nicht um.
 */
export function renamePrefix(spec: ProcessSpec, oldPrefix: string, newPrefix: string): ProcessSpec {
  const alt = `${oldPrefix}-`;
  const neu = `${newPrefix}-`;
  const ersetzen = (v: string) => (v === oldPrefix ? newPrefix : v.split(alt).join(neu));
  const walk = (val: unknown): unknown => {
    if (typeof val === 'string') return ersetzen(val);
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) out[k] = walk(v);
      return out;
    }
    return val;
  };
  return { ...(walk(spec) as ProcessSpec), slug: spec.slug };
}

/**
 * Dasselbe im BPMN: der Prefix steckt in Attributen (Prozess-ID, Pool,
 * Topics, decisionRef, calledElement, Message-Namen) und vereinzelt in
 * Ausdrücken (Text-Knoten). Gibt null zurück, wenn nichts zu ersetzen war.
 */
export function renamePrefixInXml(xml: string, oldPrefix: string, newPrefix: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || doc.querySelector?.('parsererror')) return null;
  const alt = `${oldPrefix}-`;
  const neu = `${newPrefix}-`;
  const ersetzen = (v: string) => (v === oldPrefix ? newPrefix : v.split(alt).join(neu));
  let found = false;
  const walk = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      const v = ersetzen(attr.value);
      if (v !== attr.value) { el.setAttribute(attr.name, v); found = true; }
    }
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
        const v = ersetzen(node.nodeValue);
        if (v !== node.nodeValue) { node.nodeValue = v; found = true; }
      }
    }
    for (const kind of Array.from(el.children)) walk(kind);
  };
  walk(root);
  return found ? new XMLSerializer().serializeToString(doc) : null;
}
