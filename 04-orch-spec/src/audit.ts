// Change log — who changed what in a specification and when, and
// why. Since the sync with BPMN and domain overwrites values of the specification,
// this has to remain traceable.
//
// **Storage**: next to the specification, never in it — `processes/<slug>.audit.jsonl`,
// one line per entry, append only. The list of specifications only reads
// `.json`, the exports do not know the file. Appending is done by reading
// and writing against the version (ETag) — as with `users.json`, on a
// conflict once more. If the file gets too long, the older part moves to an
// archive `processes/<slug>.audit-<timestamp>.jsonl` (see `appendAudit`).
//
// **What is logged** results from comparing two states
// (`diffSpecs`) — one place that captures everything: fields on the step, mappings,
// errors, mocks, types and fields, process ID, status, pattern … The
// process view slices the states (see ProcessView): what was changed by hand between two
// save runs becomes an entry `manual`; an
// automatic change (sync, conversion, loading) becomes a separate
// entry with its source, note and — for a sync — the report.
//
// The places are the same keys as for the comments
// (`step:<id>#in:<name>`, `type:<id>#field:<id>` …), plus the readable name
// at the time of the change — the place can disappear later.
//
// Comments are not in the log: they are a history themselves.

import type { Branch, ErrorHandling, Field, Interaction, Mapping, ProcessSpec, Step, TypeDef, Variable } from './types.ts';
import { STATUS_META, type Status } from './types.ts';
import { KIND_LABEL } from './ui.tsx';
import { iaTarget, processTarget, stepTarget, sub, typeTarget } from './comments.ts';
import { nowIsoWithTimezone, uid } from './util.ts';

export type AuditSource = 'manual' | 'bpmn-sync' | 'domain-sync' | 'conversion' | 'load';

export const SOURCE_LABEL: Record<AuditSource, string> = {
  manual: 'Von Hand',
  'bpmn-sync': 'Abgleich BPMN',
  'domain-sync': 'Abgleich Domain',
  conversion: 'Umwandlung',
  load: 'Beim Laden',
};

export interface AuditChange {
  /** place as for the comments */
  target: string;
  /** readable name of the place, when it existed */
  label: string;
  op: 'add' | 'remove' | 'change';
  /** the changed field, readable — missing for add/remove of the whole place */
  field?: string;
  before?: string;
  after?: string;
}

/** report of a sync — heading → names (e.g. «neu» → [«Check data»]) */
export type AuditReport = Record<string, string[]>;

export interface AuditEntry {
  id: string;
  at: string;
  author: string;
  email?: string;
  source: AuditSource;
  /** why — e.g. «Mit BPMN abgleichen: openSavings-impl.bpmn» */
  note?: string;
  report?: AuditReport;
  changes: AuditChange[];
  /** this many more changes than are in the entry (see MAX_CHANGES) */
  more?: number;
}

/** what a caller knows about an automatic (or named) change. */
export interface AuditOrigin {
  source: AuditSource;
  note?: string;
  report?: AuditReport;
}

export interface AuditAuthor { name: string; email?: string }

export const auditPath = (dir: string, slug: string) => `${dir}/${slug}.audit.jsonl`;
const archivePath = (dir: string, slug: string, stamp: string) => `${dir}/${slug}.audit-${stamp}.jsonl`;

/** at most this many changes per entry — a sync can bring hundreds */
const MAX_CHANGES = 300;
/** a value in the log — a whole mock need not be in there */
const MAX_VALUE = 400;
/** from this many entries on, archiving starts … */
const MAX_LINES = 2000;
/** … and this many stay in the current file */
const KEEP_LINES = 1000;

// ── Values and field names ───────────────────────────────────────────────────

const FIELD_LABEL: Record<string, string> = {
  name: 'Name', title: 'Titel', processId: 'Prozess-ID', project: 'Projekt', legacyProcessId: 'alter Name',
  status: 'Status', description: 'Beschreibung', descr: 'Beschreibung', sourceUrl: 'Quelle',
  timeToLive: 'Aufbewahrung', engine: 'Engine', epics: 'Epics', patterns: 'Pattern', pattern: 'Pattern', version: 'Version',
  kind: 'Art', serviceId: 'Service', topic: 'Topic', calledProcess: 'Gerufener Prozess',
  inVariant: 'Variante In', outVariant: 'Variante Out', regexHandledErrors: 'Behandelte Fehler (Regex)',
  mock: 'Mock', mockKind: 'Mock-Art', gatewayType: 'Verzweigungsart', loop: 'Schleife',
  multiInstance: 'Mehrfach-Instanz', gotoId: 'Ziel', back: 'Rücksprung', eventKind: 'Ereignisart',
  eventDirection: 'Richtung', messageName: 'Nachricht', candidateGroups: 'Gruppen', candidateUsers: 'Benutzer', assignee: 'Zuständig',
  orphan: 'ohne Verbindung', eventSubprocess: 'Ereignis-Subprozess',
  expression: 'Ausdruck', disabled: 'deaktiviert', label: 'Bezeichnung', condition: 'Bedingung',
  isDefault: 'Standardzweig', interrupting: 'unterbrechend', declared: 'deklariert', boundary: 'am Rand',
  side: 'Nebenpfad', code: 'Code', type: 'Typ', optional: 'optional', collection: 'Liste', map: 'Map',
  enumCase: 'Fall', constraint: 'Einschränkung', default: 'Vorgabe', example: 'Beispiel',
  root: 'Prozess-In', processOut: 'Prozess-Out', interactionId: 'Interaktion', initIn: 'InitIn',
  inConfig: 'InConfig', key: 'Schlüssel', inTypeId: 'In-Typ', outTypeId: 'Out-Typ', stepId: 'Schritt',
  open: 'Offene Frage', notes: 'Technische Notiz',
};
const fieldLabel = (key: string) => FIELD_LABEL[key] ?? key;

const cut = (s: string) => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s);

/** a value as it appears in the log — empty is `undefined`. */
function show(key: string, v: unknown): string | undefined {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return undefined;
  if (key === 'status' && typeof v === 'string' && v in STATUS_META) return STATUS_META[v as Status].label;
  if (typeof v === 'string') return cut(v);
  if (typeof v === 'boolean') return v ? 'ja' : 'nein';
  if (typeof v === 'number') return String(v);
  return cut(JSON.stringify(v));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** empty and missing are the same — otherwise every `description: ''` reports a change */
const blank = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length);

// ── Comparison ───────────────────────────────────────────────────────────────

interface Place { target: string; label: string; summary?: string }

class Collector {
  out: AuditChange[] = [];

  /** compare the simple fields of two objects (without `skip`). */
  fields(target: string, label: string, a: object, b: object, skip: ReadonlySet<string>) {
    const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (skip.has(k)) continue;
      const va = ra[k], vb = rb[k];
      if ((blank(va) && blank(vb)) || same(va, vb)) continue;
      this.out.push({ target, label, op: 'change', field: fieldLabel(k), before: show(k, va), after: show(k, vb) });
    }
  }

  /**
   * Compare two lists by a key: new, removed, changed.
   * `place` gives place and name per element, `inner` compares an
   * element that remained.
   */
  keyed<T>(a: T[] | undefined, b: T[] | undefined, key: (x: T) => string | undefined,
           place: (x: T) => Place, inner: (x: T, y: T, p: Place) => void) {
    const ma = new Map<string, T>(), mb = new Map<string, T>();
    for (const x of a ?? []) { const k = key(x); if (k) ma.set(k, x); }
    for (const x of b ?? []) { const k = key(x); if (k) mb.set(k, x); }
    for (const [k, x] of ma) {
      if (mb.has(k)) continue;
      const p = place(x);
      this.out.push({ target: p.target, label: p.label, op: 'remove', ...(p.summary ? { before: p.summary } : {}) });
    }
    for (const [k, y] of mb) {
      const x = ma.get(k);
      const p = place(y);
      if (!x) this.out.push({ target: p.target, label: p.label, op: 'add', ...(p.summary ? { after: p.summary } : {}) });
      else if (!same(x, y)) inner(x, y, p);
    }
  }
}

const SPEC_SKIP = new Set(['comments', 'updatedAt', 'createdAt', 'steps', 'types', 'interactions', 'variables', 'initOutputs']);
const STEP_SKIP = new Set(['id', 'children', 'branches', 'errors', 'inputs', 'outputs']);
const BRANCH_SKIP = new Set(['id', 'steps']);
const ERROR_SKIP = new Set(['code', 'steps']);
const NAME_SKIP = new Set(['name']);
const TYPE_SKIP = new Set(['id', 'fields', 'values']);
const ID_SKIP = new Set(['id']);
const VALUE_SKIP = new Set(['name', 'fields']);

/** all steps including error and side paths, branches and subprocesses. */
function flatSteps(steps: Step[], out: Step[] = []): Step[] {
  for (const s of steps) {
    out.push(s);
    if (s.children) flatSteps(s.children, out);
    for (const b of s.branches ?? []) flatSteps(b.steps, out);
    for (const e of s.errors ?? []) if (e.steps) flatSteps(e.steps, out);
  }
  return out;
}

const stepName = (s: Step) => s.name || s.id;
const stepLabel = (s: Step) => `${KIND_LABEL[s.kind] ?? s.kind} ${stepName(s)}`;

function diffMappings(col: Collector, base: string, owner: string, part: 'in' | 'out', a?: Mapping[], b?: Mapping[]) {
  const word = part === 'in' ? 'Eingabe' : 'Ausgabe';
  col.keyed(a, b, m => m.name || undefined,
    m => ({ target: sub(base, `${part}:${m.name}`), label: `${owner} · ${word} ${m.name}`, summary: show('expression', m.expression) }),
    (x, y, p) => col.fields(p.target, p.label, x, y, NAME_SKIP));
}

function diffStep(col: Collector, x: Step, y: Step) {
  const base = stepTarget(y.id);
  const owner = stepName(y);
  col.fields(base, stepLabel(y), x, y, STEP_SKIP);
  diffMappings(col, base, owner, 'in', x.inputs, y.inputs);
  diffMappings(col, base, owner, 'out', x.outputs, y.outputs);
  col.keyed<Branch>(x.branches, y.branches, b => b.id,
    b => ({ target: sub(base, `branch:${b.id}`), label: `${owner} · Zweig «${b.label || b.id}»`, summary: show('condition', b.condition) }),
    (p, q, pl) => col.fields(pl.target, pl.label, p, q, BRANCH_SKIP));
  col.keyed<ErrorHandling>(x.errors, y.errors, e => e.code || undefined,
    e => ({ target: sub(base, `error:${e.code}`), label: `${owner} · Fehler «${e.code}»`, summary: show('label', e.label) }),
    (p, q, pl) => col.fields(pl.target, pl.label, p, q, ERROR_SKIP));
}

function diffFields(col: Collector, base: string, owner: string, a?: Field[], b?: Field[]) {
  col.keyed<Field>(a, b, f => f.id,
    f => ({ target: sub(base, `field:${f.id}`), label: `${owner}.${f.name || f.id}`, summary: show('type', f.type) }),
    (x, y, p) => col.fields(p.target, p.label, x, y, ID_SKIP));
}

function diffType(col: Collector, x: TypeDef, y: TypeDef) {
  const base = typeTarget(y.id);
  const name = y.name || y.id;
  col.fields(base, name, x, y, TYPE_SKIP);
  diffFields(col, base, name, x.fields, y.fields);
  col.keyed(x.values, y.values, v => v.name || undefined,
    v => ({ target: sub(base, `value:${v.name}`), label: `${name}.${v.name}` }),
    (p, q, pl) => {
      col.fields(pl.target, pl.label, p, q, VALUE_SKIP);
      diffFields(col, base, `${name}.${q.name}`, p.fields, q.fields);
    });
}

/**
 * What changed from `a` to `b` — place by place. Comments and
 * the timestamps do not count.
 */
export function diffSpecs(a: ProcessSpec, b: ProcessSpec): AuditChange[] {
  const col = new Collector();
  const titel = b.title || b.name || 'Prozess';
  col.fields(processTarget, titel, a, b, SPEC_SKIP);
  col.keyed<Variable>(a.variables, b.variables, v => v.name || undefined,
    v => ({ target: sub(processTarget, `var:${v.name}`), label: `Variable ${v.name}`, summary: show('type', v.type) }),
    (x, y, p) => col.fields(p.target, p.label, x, y, NAME_SKIP));
  col.keyed<Mapping>(a.initOutputs, b.initOutputs, m => m.name || undefined,
    m => ({ target: processTarget, label: `${titel} · Init-Ausgabe ${m.name}`, summary: show('expression', m.expression) }),
    (x, y, p) => col.fields(p.target, p.label, x, y, NAME_SKIP));
  // references («weiter bei …») are wiring, not a step
  const steps = (s: Step[] | undefined) => flatSteps(s ?? []).filter(x => x.kind !== 'goto');
  col.keyed<Step>(steps(a.steps), steps(b.steps), s => s.id,
    s => ({ target: stepTarget(s.id), label: stepLabel(s) }),
    (x, y) => diffStep(col, x, y));
  col.keyed<Interaction>(a.interactions, b.interactions, i => i.id,
    i => ({ target: iaTarget(i.id), label: `Interaktion ${i.name || i.id}` }),
    (x, y, p) => col.fields(p.target, p.label, x, y, ID_SKIP));
  col.keyed<TypeDef>(a.types, b.types, t => t.id,
    t => ({ target: typeTarget(t.id), label: t.name || t.id, summary: t.kind === 'enum' ? 'Auswahl' : 'Klasse' }),
    (x, y) => diffType(col, x, y));
  return col.out;
}

const hasReport = (r?: AuditReport) => !!r && Object.values(r).some(v => v.length);

/** an entry from a comparison — `null` if nothing changed. */
export function makeEntry(a: ProcessSpec, b: ProcessSpec, origin: AuditOrigin, author: AuditAuthor): AuditEntry | null {
  const changes = diffSpecs(a, b);
  const report = hasReport(origin.report) ? Object.fromEntries(Object.entries(origin.report!).filter(([, v]) => v.length)) : undefined;
  // a sync without effect is not worth an entry — not even with a note
  if (!changes.length) return null;
  return {
    id: uid('au'),
    at: nowIsoWithTimezone(),
    author: author.name,
    ...(author.email ? { email: author.email } : {}),
    source: origin.source,
    ...(origin.note ? { note: origin.note } : {}),
    ...(report ? { report } : {}),
    changes: changes.slice(0, MAX_CHANGES),
    ...(changes.length > MAX_CHANGES ? { more: changes.length - MAX_CHANGES } : {}),
  };
}

/** the report of «Mit BPMN abgleichen» (`mergeSpec`) for the log. */
export const bpmnReport = (r: { added: string[]; removed: string[]; changed: string[]; renamed: string[]; confirmed?: string[] }): AuditReport => ({
  neu: r.added, entfallen: r.removed, geändert: r.changed, umbenannt: r.renamed, bestätigt: r.confirmed ?? [],
});

/** the report of the sync with the domain (`mergeDomain`) for the log. */
export const domainReport = (r: { added: string[]; changed: string[]; stale: string[]; confirmed: string[]; prepared?: string[] }): AuditReport => ({
  neu: r.added, geändert: r.changed, 'nur in der Spezifikation': r.stale, bestätigt: r.confirmed, vorbereitet: r.prepared ?? [],
});

// ── File ─────────────────────────────────────────────────────────────────────

/** read the lines of the file — a broken line only costs itself. */
export function parseAudit(text: string): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as AuditEntry;
      if (e && typeof e.at === 'string' && Array.isArray(e.changes)) out.push(e);
    } catch { /* skip */ }
  }
  return out;
}

/** what `appendAudit` needs from the storage. */
export interface AuditFiles {
  read(path: string): Promise<{ text: string; version: string } | null>;
  write(path: string, text: string, opts?: { ifMatch?: string; createOnly?: boolean }):
    Promise<{ ok: true; version: string } | { ok: false; reason: string; message: string }>;
}

const stampOf = (iso: string) => iso.replace(/[^0-9]/g, '').slice(0, 14);

/**
 * Append entries. Whoever writes at the same time gets a conflict and
 * reads again — at most a few times. If the file gets too long, the
 * older part goes into an archive that is never overwritten (`createOnly`).
 */
export async function appendAudit(files: AuditFiles, dir: string, slug: string, entries: AuditEntry[]): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!entries.length) return { ok: true };
  const path = auditPath(dir, slug);
  const neu = entries.map(e => JSON.stringify(e));
  let last = 'Protokoll konnte nicht geschrieben werden.';
  for (let attempt = 0; attempt < 4; attempt++) {
    let cur: { text: string; version: string } | null;
    try { cur = await files.read(path); } catch { cur = null; }
    let lines = [...(cur?.text.split('\n').filter(l => l.trim()) ?? []), ...neu];
    if (lines.length > MAX_LINES) {
      const old = lines.slice(0, lines.length - KEEP_LINES);
      const a = await files.write(archivePath(dir, slug, stampOf(nowIsoWithTimezone())), `${old.join('\n')}\n`, { createOnly: true });
      // if archiving fails, everything stays in the current file
      if (a.ok) lines = lines.slice(-KEEP_LINES);
    }
    const w = await files.write(path, `${lines.join('\n')}\n`, cur ? { ifMatch: cur.version } : { createOnly: true });
    if (w.ok) return { ok: true };
    last = w.message;
    if (w.reason !== 'conflict' && w.reason !== 'exists') break;
  }
  return { ok: false, message: last };
}

// ── Display ──────────────────────────────────────────────────────────────────

/**
 * For display: consecutive manual entries by the same person
 * within `windowMin` minutes become one — with the first «vorher»
 * and the last «nachher» per place and field. The file stays as it
 * is (each save run one line); this only combines the typing.
 * Expects the entries **oldest first**, returns them newest first.
 */
export function coalesce(entries: AuditEntry[], windowMin = 10): AuditEntry[] {
  const out: AuditEntry[] = [];
  const keyOf = (c: AuditChange) => `${c.target}|${c.field ?? ''}`;
  for (const e of entries) {
    const prev = out[out.length - 1];
    const close = !!prev && prev.source === 'manual' && e.source === 'manual' && !prev.note && !e.note
      && prev.author === e.author
      && new Date(e.at).getTime() - new Date(prev.at).getTime() <= windowMin * 60_000;
    if (!close) { out.push({ ...e, changes: [...e.changes] }); continue; }
    const idx = new Map(prev.changes.map((c, i) => [keyOf(c), i]));
    for (const c of e.changes) {
      const i = idx.get(keyOf(c));
      if (i === undefined) { idx.set(keyOf(c), prev.changes.length); prev.changes.push(c); continue; }
      const p = prev.changes[i];
      // first created, then removed again: as if it had never existed
      if (p.op === 'add' && c.op === 'remove') { prev.changes[i] = { ...p, op: 'change', before: undefined, after: undefined }; continue; }
      prev.changes[i] = { ...c, op: p.op === 'add' ? 'add' : p.op === 'remove' && c.op === 'add' ? 'change' : c.op, before: p.before };
    }
    prev.at = e.at;
    if (e.more) prev.more = (prev.more ?? 0) + e.more;
    // back to the old value: nothing changed
    prev.changes = prev.changes.filter(c => !(c.op === 'change' && c.before === c.after));
  }
  return out.filter(e => e.changes.length).reverse();
}

/** the element behind a place — like `baseOf` for the comments. */
export const auditBase = (target: string) => target.split('#')[0];
