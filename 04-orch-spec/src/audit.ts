// Änderungsprotokoll — wer hat wann was an einer Spezifikation geändert, und
// warum. Seit der Abgleich mit BPMN und Domain Werte der Spezifikation
// überschreibt, muss das nachvollziehbar bleiben.
//
// **Ablage**: neben der Spezifikation, nie in ihr — `processes/<slug>.audit.jsonl`,
// eine Zeile je Eintrag, nur angehängt. Die Liste der Spezifikationen liest
// nur `.json`, die Exporte kennen die Datei nicht. Angehängt wird mit Lesen
// und Schreiben gegen die Version (ETag) — wie bei `users.json`, bei einem
// Konflikt nochmals. Wird die Datei zu lang, wandert der ältere Teil in ein
// Archiv `processes/<slug>.audit-<Zeitstempel>.jsonl` (siehe `appendAudit`).
//
// **Was protokolliert wird**, ergibt sich aus dem Vergleich zweier Stände
// (`diffSpecs`) — eine Stelle, die alles erfasst: Felder am Schritt, Mappings,
// Fehler, Mocks, Typen und Felder, Prozess-ID, Status, Pattern … Die
// Prozess-Ansicht schneidet die Stände (siehe ProcessView): was zwischen zwei
// Speicherläufen von Hand geändert wurde, wird ein Eintrag `manual`; eine
// automatische Änderung (Abgleich, Umwandlung, Laden) wird ein eigener
// Eintrag mit ihrer Quelle, Notiz und — beim Abgleich — dem Bericht.
//
// Die Stellen sind dieselben Schlüssel wie bei den Kommentaren
// (`step:<id>#in:<name>`, `type:<id>#field:<id>` …), dazu der lesbare Name
// zum Zeitpunkt der Änderung — die Stelle kann später verschwinden.
//
// Kommentare stehen nicht im Protokoll: sie sind selbst ein Verlauf.

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
  /** Stelle wie bei den Kommentaren */
  target: string;
  /** lesbarer Name der Stelle, als es sie gab */
  label: string;
  op: 'add' | 'remove' | 'change';
  /** das geänderte Feld, lesbar — fehlt bei add/remove der ganzen Stelle */
  field?: string;
  before?: string;
  after?: string;
}

/** Bericht eines Abgleichs — Überschrift → Namen (z. B. «neu» → [«Check data»]) */
export type AuditReport = Record<string, string[]>;

export interface AuditEntry {
  id: string;
  at: string;
  author: string;
  email?: string;
  source: AuditSource;
  /** warum — z. B. «Mit BPMN abgleichen: openSavings-impl.bpmn» */
  note?: string;
  report?: AuditReport;
  changes: AuditChange[];
  /** so viele Änderungen mehr, als im Eintrag stehen (siehe MAX_CHANGES) */
  more?: number;
}

/** Was ein Aufrufer über eine automatische (oder benannte) Änderung weiss. */
export interface AuditOrigin {
  source: AuditSource;
  note?: string;
  report?: AuditReport;
}

export interface AuditAuthor { name: string; email?: string }

export const auditPath = (dir: string, slug: string) => `${dir}/${slug}.audit.jsonl`;
const archivePath = (dir: string, slug: string, stamp: string) => `${dir}/${slug}.audit-${stamp}.jsonl`;

/** höchstens so viele Änderungen je Eintrag — ein Abgleich kann Hunderte bringen */
const MAX_CHANGES = 300;
/** ein Wert im Protokoll — ein ganzer Mock braucht dort nicht zu stehen */
const MAX_VALUE = 400;
/** ab so vielen Einträgen wird archiviert … */
const MAX_LINES = 2000;
/** … und so viele bleiben in der laufenden Datei */
const KEEP_LINES = 1000;

// ── Werte und Feldnamen ──────────────────────────────────────────────────────

const FIELD_LABEL: Record<string, string> = {
  name: 'Name', title: 'Titel', processId: 'Prozess-ID', project: 'Projekt', legacyProcessId: 'alter Name',
  status: 'Status', description: 'Beschreibung', descr: 'Beschreibung', sourceUrl: 'Quelle',
  timeToLive: 'Aufbewahrung', engine: 'Engine', patterns: 'Pattern', pattern: 'Pattern', version: 'Version',
  kind: 'Art', serviceId: 'Service', topic: 'Topic', calledProcess: 'Gerufener Prozess',
  inVariant: 'Variante In', outVariant: 'Variante Out', regexHandledErrors: 'Behandelte Fehler (Regex)',
  mock: 'Mock', mockKind: 'Mock-Art', gatewayType: 'Verzweigungsart', loop: 'Schleife',
  multiInstance: 'Mehrfach-Instanz', gotoId: 'Ziel', back: 'Rücksprung', eventKind: 'Ereignisart',
  eventDirection: 'Richtung', messageName: 'Nachricht', candidateGroups: 'Gruppen', assignee: 'Zuständig',
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

/** Ein Wert, wie er im Protokoll steht — leer ist `undefined`. */
function show(key: string, v: unknown): string | undefined {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return undefined;
  if (key === 'status' && typeof v === 'string' && v in STATUS_META) return STATUS_META[v as Status].label;
  if (typeof v === 'string') return cut(v);
  if (typeof v === 'boolean') return v ? 'ja' : 'nein';
  if (typeof v === 'number') return String(v);
  return cut(JSON.stringify(v));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** leer und fehlend sind dasselbe — sonst meldet jedes `description: ''` eine Änderung */
const blank = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length);

// ── Vergleich ────────────────────────────────────────────────────────────────

interface Place { target: string; label: string; summary?: string }

class Collector {
  out: AuditChange[] = [];

  /** Die einfachen Felder zweier Objekte vergleichen (ohne `skip`). */
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
   * Zwei Listen über einen Schlüssel vergleichen: neu, entfallen, geändert.
   * `place` gibt Stelle und Namen je Element, `inner` vergleicht ein
   * gebliebenes Element.
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

/** Alle Schritte samt Fehler- und Nebenpfaden, Zweigen und Subprozessen. */
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
 * Was sich von `a` nach `b` geändert hat — Stelle für Stelle. Kommentare und
 * die Zeitstempel zählen nicht.
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
  // Verweise («weiter bei …») sind Verdrahtung, kein Schritt
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

/** Ein Eintrag aus einem Vergleich — `null`, wenn sich nichts geändert hat. */
export function makeEntry(a: ProcessSpec, b: ProcessSpec, origin: AuditOrigin, author: AuditAuthor): AuditEntry | null {
  const changes = diffSpecs(a, b);
  const report = hasReport(origin.report) ? Object.fromEntries(Object.entries(origin.report!).filter(([, v]) => v.length)) : undefined;
  // ein Abgleich ohne Wirkung ist keinen Eintrag wert — auch nicht mit Notiz
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

/** Der Bericht von «Mit BPMN abgleichen» (`mergeSpec`) fürs Protokoll. */
export const bpmnReport = (r: { added: string[]; removed: string[]; changed: string[]; renamed: string[]; confirmed?: string[] }): AuditReport => ({
  neu: r.added, entfallen: r.removed, geändert: r.changed, umbenannt: r.renamed, bestätigt: r.confirmed ?? [],
});

/** Der Bericht des Abgleichs mit der Domain (`mergeDomain`) fürs Protokoll. */
export const domainReport = (r: { added: string[]; changed: string[]; stale: string[]; confirmed: string[]; prepared?: string[] }): AuditReport => ({
  neu: r.added, geändert: r.changed, 'nur in der Spezifikation': r.stale, bestätigt: r.confirmed, vorbereitet: r.prepared ?? [],
});

// ── Datei ────────────────────────────────────────────────────────────────────

/** Die Zeilen der Datei lesen — eine kaputte Zeile kostet nur sich selbst. */
export function parseAudit(text: string): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as AuditEntry;
      if (e && typeof e.at === 'string' && Array.isArray(e.changes)) out.push(e);
    } catch { /* überspringen */ }
  }
  return out;
}

/** Was `appendAudit` vom Speicher braucht. */
export interface AuditFiles {
  read(path: string): Promise<{ text: string; version: string } | null>;
  write(path: string, text: string, opts?: { ifMatch?: string; createOnly?: boolean }):
    Promise<{ ok: true; version: string } | { ok: false; reason: string; message: string }>;
}

const stampOf = (iso: string) => iso.replace(/[^0-9]/g, '').slice(0, 14);

/**
 * Einträge anhängen. Wer gleichzeitig schreibt, bekommt einen Konflikt und
 * liest neu — höchstens ein paar Mal. Wird die Datei zu lang, kommt der
 * ältere Teil in ein Archiv, das nie überschrieben wird (`createOnly`).
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
      // klappt das Archiv nicht, bleibt alles in der laufenden Datei
      if (a.ok) lines = lines.slice(-KEEP_LINES);
    }
    const w = await files.write(path, `${lines.join('\n')}\n`, cur ? { ifMatch: cur.version } : { createOnly: true });
    if (w.ok) return { ok: true };
    last = w.message;
    if (w.reason !== 'conflict' && w.reason !== 'exists') break;
  }
  return { ok: false, message: last };
}

// ── Anzeige ──────────────────────────────────────────────────────────────────

/**
 * Für die Anzeige: aufeinanderfolgende Einträge von Hand derselben Person
 * innerhalb von `windowMin` Minuten werden einer — mit dem ersten «vorher»
 * und dem letzten «nachher» je Stelle und Feld. Die Datei bleibt, wie sie
 * ist (jeder Speicherlauf eine Zeile); das hier fasst nur das Tippen zusammen.
 * Erwartet die Einträge **älteste zuerst**, gibt sie neueste zuerst zurück.
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
      // erst angelegt, dann wieder entfernt: als hätte es nie bestanden
      if (p.op === 'add' && c.op === 'remove') { prev.changes[i] = { ...p, op: 'change', before: undefined, after: undefined }; continue; }
      prev.changes[i] = { ...c, op: p.op === 'add' ? 'add' : p.op === 'remove' && c.op === 'add' ? 'change' : c.op, before: p.before };
    }
    prev.at = e.at;
    if (e.more) prev.more = (prev.more ?? 0) + e.more;
    // zurück auf den alten Wert: nichts geändert
    prev.changes = prev.changes.filter(c => !(c.op === 'change' && c.before === c.after));
  }
  return out.filter(e => e.changes.length).reverse();
}

/** Das Element hinter einer Stelle — wie `baseOf` bei den Kommentaren. */
export const auditBase = (target: string) => target.split('#')[0];
