// The comparison of two spec folders in business terms - what the RE changed: processes and their
// steps, the data model down to the fields (new, removed, type or optional changed, enum cases,
// the shared fields of an ADT), the interactions, the diagrams and DMN tables, the pages.
//
// One function for the dialog before «in den Code übernehmen» and for the tool
// (tools/spec2diff.ts, which Orchescala's `processFromSpec --check` shows before the merge plan).
// Place by place it is the comparison of the change log (audit.ts: diffSpecs, diffPages) - the
// same words as in the history of a process.
import type { ProcessSpec, TypeDef } from './types.ts';
import { diffPages, diffSpecs, type AuditChange } from './audit.ts';
import { loadSpecs, type SpecFolder } from './specExport.ts';
import { dmnPath } from './dmn.ts';
import type { Page } from './pages/runtime/spec.ts';

export type DiffOp = 'add' | 'remove' | 'change';

/** The changes of a process, by area - each one a place with what changed there. */
export interface ProcessDiff {
  slug: string;
  title: string;
  processId: string;
  op: DiffOp;
  /** the process itself: title, ID, engine, status, variables, init outputs, pattern … */
  process: AuditChange[];
  /** steps: new, removed, changed field by field, their mappings, branches and errors */
  steps: AuditChange[];
  /** the data model: types and their fields, enum cases, the fields of the cases */
  dataModel: AuditChange[];
  /** the interactions (user task, custom task, signal, message, decision) */
  interactions: AuditChange[];
  /** the diagram (`<slug>.bpmn`) changed - in the layout or the flow */
  diagram?: DiffOp;
  /** the DMN tables of the process by decision */
  dmns: Array<{ key: string; op: DiffOp }>;
}

export interface PageDiff { file: string; title: string; op: DiffOp; changes: AuditChange[] }

/** Another file of the spec (config, themes, catalog, app.json …) - only that it changed. */
export interface FileDiff { path: string; op: DiffOp }

export interface SpecDiff {
  processes: ProcessDiff[];
  pages: PageDiff[];
  files: FileDiff[];
}

const PROCESSES = 'processes';
const PAGES = 'pages';

const opOf = (a: unknown, b: unknown): DiffOp | null =>
  a == null && b == null ? null : a == null ? 'add' : b == null ? 'remove' : a === b ? null : 'change';

/** The name of a type in the report: an interaction's `In` as `CheckOrder.In`. */
function typeNames(...specs: Array<ProcessSpec | undefined>): Map<string, string> {
  const out = new Map<string, string>();
  for (const spec of specs) {
    const ia = new Map((spec?.interactions ?? []).map(i => [i.id, i.name]));
    for (const t of spec?.types ?? []) {
      const owner = t.interactionId ? ia.get(t.interactionId) : undefined;
      out.set(t.id, owner ? `${owner}.${t.name || t.id}` : t.name || t.id);
    }
  }
  return out;
}

/** An own type is referenced by its id - in the report it gets its name, and an interaction's
 *  types carry the name of the interaction. */
function withTypeNames(changes: AuditChange[], a?: ProcessSpec, b?: ProcessSpec): AuditChange[] {
  const names = typeNames(a, b);
  const name = (v?: string) => (v != null && names.has(v) ? names.get(v)! : v);
  const plain = new Map([...(a?.types ?? []), ...(b?.types ?? [])].map(t => [t.id, t.name || t.id]));
  return changes.map(c => {
    const typeId = /^type:([^#]+)/.exec(c.target)?.[1];
    const own = typeId ? plain.get(typeId) : undefined;
    const label = typeId && own && c.label.startsWith(own) ? `${names.get(typeId)}${c.label.slice(own.length)}` : c.label;
    const typed = c.field === 'Typ' || c.field === 'In-Typ' || c.field === 'Out-Typ' || c.op !== 'change';
    return {
      ...c, label,
      ...(typed && c.before != null ? { before: name(c.before) } : {}),
      ...(typed && c.after != null ? { after: name(c.after) } : {}),
    };
  });
}

/** A new type brings its fields and cases - compared with itself without them. */
function fieldsOfNewTypes(a: ProcessSpec | undefined, b: ProcessSpec): AuditChange[] {
  const had = new Set((a?.types ?? []).map(t => t.id));
  const added = (b.types ?? []).filter(t => !had.has(t.id));
  if (!added.length) return [];
  const base: ProcessSpec = { ...(a ?? emptySpec(b)), types: [...(a?.types ?? []), ...added.map(t => ({ ...t, fields: [], values: [] }))] };
  const ids = new Set(added.map(t => `type:${t.id}#`));
  return diffSpecs(base, b).filter(c => [...ids].some(id => c.target.startsWith(id)));
}

/** the empty process a new one is compared with - so a new one lists what it brings */
const emptySpec = (s: ProcessSpec): ProcessSpec => ({ ...s, steps: [], types: [], interactions: [], variables: [], initOutputs: [] });

function processDiff(slug: string, a: ProcessSpec | undefined, b: ProcessSpec | undefined, before: SpecFolder, after: SpecFolder): ProcessDiff | null {
  const spec = (b ?? a)!;
  const op: DiffOp = !a ? 'add' : !b ? 'remove' : 'change';
  const own = op === 'remove' ? [] : diffSpecs(a ?? emptySpec(b!), b!);
  // the fields of a new type right after it
  const fields = op === 'remove' ? [] : fieldsOfNewTypes(a, b!);
  const ordered = own.flatMap(c => [c, ...(c.op === 'add' && /^type:[^#]+$/.test(c.target) ? fields.filter(f => f.target.startsWith(`${c.target}#`)) : [])]);
  const changes = withTypeNames(ordered, a, b);
  const area = (prefix: string) => changes.filter(c => c.target.startsWith(prefix));
  const diagram = opOf(before.read(`${PROCESSES}/${slug}.bpmn`), after.read(`${PROCESSES}/${slug}.bpmn`));
  const keys = [...new Set([...before.list(`${PROCESSES}/${slug}`), ...after.list(`${PROCESSES}/${slug}`)])]
    .filter(n => n.endsWith('.dmn')).map(n => n.replace(/\.dmn$/, '')).sort();
  const dmns = keys.flatMap(key => {
    const o = opOf(before.read(dmnPath(PROCESSES, slug, key)), after.read(dmnPath(PROCESSES, slug, key)));
    return o ? [{ key, op: o }] : [];
  });
  const d: ProcessDiff = {
    slug, title: spec.title || spec.name || slug, processId: spec.processId ?? '', op,
    process: changes.filter(c => c.target.startsWith('process')),
    steps: area('step:'),
    dataModel: area('type:'),
    interactions: area('ia:'),
    ...(diagram ? { diagram } : {}),
    dmns,
  };
  const changed = op !== 'change' || d.process.length || d.steps.length || d.dataModel.length || d.interactions.length || d.diagram || d.dmns.length;
  return changed ? d : null;
}

const json = (text: string | null): unknown => {
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
};

/** the pages (`pages/*.json`) - `app.json` is a file of its own */
function pageDiffs(before: SpecFolder, after: SpecFolder): PageDiff[] {
  const names = [...new Set([...before.list(PAGES), ...after.list(PAGES)])].filter(n => n.endsWith('.json') && n !== 'app.json').sort();
  return names.flatMap((name): PageDiff[] => {
    const file = `${PAGES}/${name}`;
    const a = json(before.read(file)) as Page | null;
    const b = json(after.read(file)) as Page | null;
    if (!a && !b) return [];
    const page = (b ?? a)!;
    const title = page.title || page.path || name.replace(/\.json$/, '');
    if (!a) return [{ file, title, op: 'add' as const, changes: diffPages({ path: '', title: '', access: 'public', body: [] } as unknown as Page, b!) }];
    if (!b) return [{ file, title, op: 'remove' as const, changes: [] }];
    const changes = diffPages(a, b);
    return changes.length ? [{ file, title, op: 'change' as const, changes }] : [];
  });
}

/** every file of the folder, relative - for those that are neither process nor page */
function allFiles(folder: SpecFolder, dir = '', depth = 0): string[] {
  const here = folder.list(dir).map(n => (dir ? `${dir}/${n}` : n));
  const dirs = (folder.dirs?.(dir) ?? []).map(n => (dir ? `${dir}/${n}` : n));
  return depth > 6 ? here : [...here, ...dirs.flatMap(d => allFiles(folder, d, depth + 1))];
}

const isProcessOrPage = (p: string) =>
  (p.startsWith(`${PROCESSES}/`) && !p.endsWith('.jsonl')) || (p.startsWith(`${PAGES}/`) && p !== `${PAGES}/app.json` && p.endsWith('.json'));
/** the change log and the comments are history, not spec */
const isHistory = (p: string) => p.endsWith('.jsonl');

/** What changed from the spec folder `before` to `after` - in business terms. */
export function diffSpecFolders(before: SpecFolder, after: SpecFolder): SpecDiff {
  const a = new Map(loadSpecs(before).map(x => [x.slug, x.spec]));
  const b = new Map(loadSpecs(after).map(x => [x.slug, x.spec]));
  const slugs = [...new Set([...a.keys(), ...b.keys()])].sort();
  const processes = slugs.flatMap(slug => processDiff(slug, a.get(slug), b.get(slug), before, after) ?? []);
  const paths = [...new Set([...allFiles(before), ...allFiles(after)])].filter(p => !isProcessOrPage(p) && !isHistory(p)).sort();
  const files = paths.flatMap(path => {
    const op = opOf(before.read(path), after.read(path));
    return op ? [{ path, op }] : [];
  });
  return { processes, pages: pageDiffs(before, after), files };
}

export const isEmptyDiff = (d: SpecDiff) => !d.processes.length && !d.pages.length && !d.files.length;

// ── As text ──────────────────────────────────────────────────────────────────

const OP_SIGN: Record<DiffOp, string> = { add: '+', remove: '-', change: '~' };
const OP_WORD: Record<DiffOp, string> = { add: 'neu', remove: 'entfernt', change: 'geändert' };

function changeLine(c: AuditChange): string {
  if (c.op !== 'change') return `${OP_SIGN[c.op]} ${c.label}${c.op === 'add' && c.after ? ` (${c.after})` : c.op === 'remove' && c.before ? ` (${c.before})` : ''}`;
  return `~ ${c.label}${c.field ? ` · ${c.field}` : ''}: ${c.before ?? '—'} → ${c.after ?? '—'}`;
}

/** The comparison as text - for the console (spec2diff, `processFromSpec --check`). */
export function formatSpecDiff(d: SpecDiff): string {
  if (isEmptyDiff(d)) return 'Keine Änderungen in der Spezifikation.\n';
  const out: string[] = [];
  const section = (title: string, changes: AuditChange[]) => {
    if (!changes.length) return;
    out.push(`  ${title}`);
    for (const c of changes) out.push(`    ${changeLine(c)}`);
  };
  for (const p of d.processes) {
    out.push(`${OP_SIGN[p.op]} Prozess ${p.title} (${p.processId || p.slug}) — ${OP_WORD[p.op]}`);
    section('Prozess', p.process);
    section('Schritte', p.steps);
    section('Datenmodell', p.dataModel);
    section('Interaktionen', p.interactions);
    if (p.diagram) out.push(`  Diagramm ${OP_WORD[p.diagram]}`);
    for (const t of p.dmns) out.push(`  DMN ${t.key} ${OP_WORD[t.op]}`);
  }
  for (const p of d.pages) {
    out.push(`${OP_SIGN[p.op]} Seite ${p.title} (${p.file}) — ${OP_WORD[p.op]}`);
    for (const c of p.changes) out.push(`    ${changeLine(c)}`);
  }
  for (const f of d.files) out.push(`${OP_SIGN[f.op]} ${f.path} — ${OP_WORD[f.op]}`);
  return `${out.join('\n')}\n`;
}
