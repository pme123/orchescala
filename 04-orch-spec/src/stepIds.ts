// Element IDs according to house convention — read off the existing
// Globex processes: PascalCase of the business name plus type suffix,
// WITHOUT the company-projekt prefix. Only process IDs, topics,
// message names and DMN references carry the prefix — flow elements (including user tasks)
// are named only after their name:
//
//   Get Account           (service) → GetAccountTask
//   Approval              (user)    → ApprovalTask
//   Send Process Event    (call)    → SendProcessEventCallActivity
//   Has Responsible User  (gateway) → HasResponsibleUserGateway
//   heatmap               (event)   → HeatmapEvent
//   Account opened        (end)     → AccountOpenedEndEvent
//   start                 (start)   → StartStartEvent
//
// Umlauts just lose their marks («Kartenbestellung prüfen (Backoffice)» →
// KartenbestellungPrufenBackofficeTask) — exactly as in the existing IDs, and unlike
// the Scala object names (there ä → ae, see `pascal` in
// interactions.ts). Duplicate IDs count up without a separator (HeatmapEvent1).

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
 * The ID this step carries by convention — or null if none
 * can be derived (reference steps, empty name). `taken` says whether a
 * candidate ID is already taken; the own ID does not count.
 */
export function conventionalId(
  step: Pick<Step, 'kind' | 'name'>,
  taken: (id: string) => boolean,
): string | null {
  const suffix = SUFFIX[step.kind];
  if (!suffix) return null;
  const base = idPascal(step.name ?? '');
  if (!base) return null;
  // If the name already ends with the suffix («Approval Task»), do not double it —
  // and an ID must not start with a digit (XML NCName).
  let id = base.endsWith(suffix) ? base : `${base}${suffix}`;
  if (/^\d/.test(id)) id = `N${id}`;
  if (!taken(id)) return id;
  for (let i = 1; i < 100; i++) if (!taken(`${id}${i}`)) return `${id}${i}`;
  return null;
}

/**
 * A name nobody chose: empty, the own ID (import fallback)
 * or exactly an ID assigned by the modeler (`Activity_14pc7cv` — element kind,
 * underscore, seven characters). An adjusted name never counts, not
 * even one with an underscore (`Check_balance`).
 */
const MODELER_ID = /^(Activity|Task|Event|Gateway|StartEvent|EndEvent|SubProcess|CallActivity|Process)_[0-9a-z]{7}$/;
export function unnamed(step: Pick<Step, 'name' | 'id'>): boolean {
  const n = (step.name ?? '').trim();
  return !n || n === step.id || MODELER_ID.test(n);
}

/**
 * The name of a step from the selected service or process — the
 * identifier in words, without project, version and placeholders:
 *
 *   acme-fil-is-accountAndPortfolioV3.GetAccountsAccountKey → Get Accounts Account Key
 *   acme-vollmacht-getAccountsV2                            → Get Accounts
 *   acme-documents-print-document                           → Print Document
 *   acme-depot-updateContractsV1-UpdateContract             → Update Contract
 *
 * `prefixes`: the known `firma-projekt` (see knownPrefixes) — without them
 * the first two parts count as the project.
 */
export function nameFromService(ref: string, prefixes: string[] = []): string {
  let tail: string;
  const p0 = [...prefixes].sort((a, b) => b.length - a.length).find(x => ref.startsWith(`${x}-`));
  // Signal, message, user task: whatever is after the last dot
  if (/\.(signal|message|userTask)\./.test(ref)) tail = ref.slice(ref.lastIndexOf('.') + 1);
  else if (ref.includes('.')) {
    // Service and operation (`…accountAndPortfolioV3.GetAccounts`, `…eventStatus.get`)
    const own = p0 ? ref.slice(p0.length + 1) : ref.split('-').slice(2).join('-') || ref;
    const dot = own.indexOf('.');
    const service = own.slice(0, dot), op = own.slice(dot + 1);
    // a verb alone (`get`, `post`) says nothing — then with the service in front
    tail = /^[a-z]+$/.test(op) ? `${service.replace(/V\d+$/, '')} ${op}` : op;
  }
  // the process is the project itself (`acme-addresschange`)
  else if (prefixes.includes(ref)) tail = ref.slice(ref.lastIndexOf('-') + 1);
  else {
    const rest = p0 ? ref.slice(p0.length + 1) : ref.split('-').slice(2).join('-') || ref;
    // own worker of a process: `<prozess>[V1]-<Operation>` → the operation
    tail = /^[a-z][A-Za-z0-9]*-([A-Z].*)$/.exec(rest)?.[1] ?? /^[A-Za-z0-9]*V\d+-(.+)$/.exec(rest)?.[1] ?? rest;
  }
  const words = tail
    .replace(/-?\{+[^}]*\}+/g, '')               // placeholders ({{…}}, {…})
    .replace(/V\d+$/, '')                          // Version
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s._-]+/).filter(Boolean);
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Is it worth deriving an ID for this step? Not for names that
 * are only the import fallback (nameless elements carry their ID as name,
 * see `defaultName` in bpmn.ts).
 */
export function derivable(step: Pick<Step, 'kind' | 'name' | 'id'>): boolean {
  return !!step.name && step.name !== step.id && step.kind !== 'goto';
}

/**
 * Rename an element ID directly in the BPMN XML — for the case that the
 * modeler is not open right now. Every attribute that carries the ID
 * exactly is replaced (`id`, `sourceRef`, `targetRef`, `attachedToRef`,
 * `bpmnElement`, …) — so all references stay consistent. Returns null
 * if the old ID does not occur or the new one is already taken.
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
        // The business name also belongs in the BPMN — without an open modeler the
        // rename would otherwise only be in the specification and would revert on the
        // next sync.
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
 * Update a step ID everywhere in the specification: in the tree (including
 * `gotoId` references), in the interactions (for user tasks the ID is
 * also the key) and in the comment targets.
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
      // also the parts of the step: `step:<id>#in:name` …
      comments: spec.comments.map(t => (t.target === `step:${oldId}` || t.target.startsWith(`step:${oldId}#`)
        ? { ...t, target: `step:${newId}${t.target.slice(`step:${oldId}`.length)}` }
        : t)),
    } : {}),
  };
}

// ── Company and project (`company-projekt` prefix) ───────────────────────────

/** `globex-core-banking` → { company: 'globex', project: 'core-banking' } */
export function splitPrefix(prefix: string): { company: string; project: string } {
  const [company, ...rest] = prefix.split('-').filter(Boolean);
  return { company: company ?? '', project: rest.join('-') };
}

/**
 * All known `company-projekt` prefixes: the project folders of the catalog
 * (model.projects), the processes in the domain catalog (`processName`) and the
 * projects of the existing specifications.
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
 * Change the company/project of a process: the old prefix is replaced in all
 * business IDs — process ID, topics of own workers, DMN references,
 * called own processes, message/signal names, interaction keys,
 * and also in descriptions where the IDs are mentioned. External services carry
 * a different prefix and stay untouched. The file name (slug) stays —
 * the app deliberately does not rename files.
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
 * The same in the BPMN: the prefix sits in attributes (process ID, pool,
 * topics, decisionRef, calledElement, message names) and occasionally in
 * expressions (text nodes). Returns null if there was nothing to replace.
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
