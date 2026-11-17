// «Mit Code abgleichen» of a service orchestration: its CustomWorker back into the steps.
//
// The code is compared with what the export writes for the spec as it is (see workerScan.ts): a
// step whose code is the same keeps everything; where they differ, the code's version goes into the
// step - an input or output of a service call, a line or a case of a mapping - and the step gets the
// status of a change. What the reader does not know is only said (`hints`): it stays as the spec has it.
// Steps the code calls but the flow does not have, and branches, are said too - the flow stays.
import type { CaseLink, FieldLink, Mapping, Status, Step, TypeMapper } from '../types';
import { isNamed, mapperExtension } from '../typeMappers';
import { camelName } from './names';
import { mappingLinks, readWorkerCode, feelOf, type CodeCases, type CodeLink, type WorkerCode, type WorkerItem } from './workerScan';
import type { ServiceRef } from './orchestration';
import type { ServiceProcess } from './serviceProcess';

export interface WorkerSyncReport {
  /** what goes into the spec - one line each */
  changed: string[];
  /** what the code has differently but stays as it is (not readable, a step the flow does not have, a branch) */
  hints: string[];
  /** the steps that changed */
  steps: string[];
}

export interface WorkerSyncContext {
  /** the services it can call, by topic */
  services: Map<string, ServiceRef>;
  /** the type mappers: the model's, the code's, the standard ones */
  mappers: TypeMapper[];
  /** the names of types for the extensions of the mappers */
  nameOf: (ref: string) => string;
  /** extensions the code has beyond them (the project's scan) */
  extensions?: string[];
  /**
   * The paths a mapping can read (its In as a tree) - a path the code reads that is none of them
   * (`client.name.map(_.trim)` read as `client.name.trim`) is said, not taken over. Without: not checked.
   */
  sourcePaths?: (s: Step) => ((path: string) => boolean) | undefined;
}

// a required value resolved first (`!`) is the export's business, not the spec's
const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, '').replace(/!$/, '');
const sameLink = (a: CodeLink | undefined, b: CodeLink | undefined) =>
  !!a === !!b && (!a || (a.from.join('|') === b!.from.join('|') && (a.ext ?? '') === (b!.ext ?? '')));
const sameCases = (a: CodeCases | undefined, b: CodeCases | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The steps of the flow the worker runs one after another - not those of a branch (a block of its own). */
const topLevel = (steps: Step[]) => steps.filter(s => s.kind === 'service' || s.kind === 'script');

function stepsById(steps: Step[], fn: (s: Step) => Step): Step[] {
  return steps.map(s => {
    const n = fn(s);
    return {
      ...n,
      ...(n.branches ? { branches: n.branches.map(b => ({ ...b, steps: stepsById(b.steps, fn) })) } : {}),
      ...(n.children ? { children: stepsById(n.children, fn) } : {}),
    };
  });
}

/** Compare the worker of the code with the one the export writes for `spec`, and bring the differences into it. */
export function syncWorker(spec: ServiceProcess, generated: string, code: string, ctx: WorkerSyncContext, status: Status = 'changed'): { spec: ServiceProcess; report: WorkerSyncReport } {
  const report: WorkerSyncReport = { changed: [], hints: [], steps: [] };
  const gen = readWorkerCode(generated);
  const own = readWorkerCode(code);
  if (!own.items) {
    report.hints.push('runWorkZIO ist nicht in der Form des Exports (for … yield) - nichts übernommen.');
    return { spec, report };
  }
  const exts = new Set([...ctx.mappers.map(m => mapperExtension(m, ctx.nameOf)), ...(ctx.extensions ?? []), 'toString', 'asString']);
  const named = new Map(ctx.mappers.filter(isNamed).map(m => [mapperExtension(m, ctx.nameOf), m.id]));
  const updates = new Map<string, Partial<Step>>();
  const label = (s: Step) => `«${s.name || s.id}»`;

  // the calls of each service in their order - the k-th step of a service is its k-th call
  const calls = (items: WorkerItem[] | null, service: string) => (items ?? []).filter(i => i.kind === 'service' && i.service === service) as Extract<WorkerItem, { kind: 'service' }>[];
  const seen = new Map<string, number>();
  const usedMethods = new Set<string>();
  for (const s of topLevel(spec.steps)) {
    if (s.kind === 'service') {
      const ref = ctx.services.get(s.topic ?? s.serviceId ?? '');
      if (!ref) continue;
      const name = ref.service.name;
      const k = seen.get(name) ?? 0;
      seen.set(name, k + 1);
      const g = calls(gen.items, name)[k];
      const c = calls(own.items, name)[k];
      if (!g) continue;
      // the k-th call is the k-th step only while both have as many - otherwise said, not guessed
      const counts = [calls(gen.items, name).length, calls(own.items, name).length];
      if (counts[0] !== counts[1]) {
        report.hints.push(`${label(s)}: run${name} ruft der Code ${counts[1]}-mal auf, der Ablauf ${counts[0]}-mal - welcher Aufruf zu welchem Schritt gehört, ist offen; nicht übernommen.`);
        continue;
      }
      if (!c) { report.hints.push(`${label(s)}: run${name} gibt es im Code nicht (mehr) - der Schritt bleibt.`); continue; }
      const u = serviceUpdate(s, g, c, exts, report);
      if (u) updates.set(s.id, u);
    } else if (s.kind === 'script' && s.fieldMapping) {
      // camelName gives letters and digits only - safe in the expression below
      const base = camelName((s.name || s.id).replace(/Task$/, ''));
      const g = (gen.items ?? []).find(i => i.kind === 'mapping' && !usedMethods.has(i.method) && (i.method === base || new RegExp(`^${base}\\d+$`).test(i.method))) as Extract<WorkerItem, { kind: 'mapping' }> | undefined;
      if (!g) continue;
      usedMethods.add(g.method);
      const c = (own.items ?? []).find(i => i.kind === 'mapping' && i.method === g.method) as Extract<WorkerItem, { kind: 'mapping' }> | undefined;
      if (!c) { report.hints.push(`${label(s)}: ${g.method} ruft runWorkZIO nicht (mehr) auf - das Mapping bleibt.`); continue; }
      const u = mappingUpdate(s, gen, own, g, c, exts, named, report, ctx.sourcePaths?.(s));
      if (u) updates.set(s.id, u);
    }
  }
  // calls of a service the flow does not have at all (one it has is said at its steps)
  for (const name of new Set((own.items ?? []).flatMap(i => (i.kind === 'service' ? [i.service] : [])))) {
    const extra = calls(own.items, name).length;
    if (!calls(gen.items, name).length) report.hints.push(`run${name} ruft der Code ${extra === 1 ? 'einmal' : `${extra}-mal`} auf, der Ablauf nicht - nicht übernommen (den Schritt im Ablauf anlegen).`);
  }
  // branches: only said
  const blocks = (w: WorkerCode) => (w.items ?? []).filter(i => i.kind === 'block').map(i => norm(i.raw));
  const genBlocks = blocks(gen);
  const ownBlocks = blocks(own);
  if (genBlocks.join('\n') !== ownBlocks.join('\n')) report.hints.push('Verzweigungen oder eigener Code in runWorkZIO weichen ab - nur als Hinweis, der Ablauf bleibt.');

  if (!updates.size) return { spec, report };
  const steps = stepsById(spec.steps, s => {
    const u = updates.get(s.id);
    if (!u) return s;
    report.steps.push(s.id);
    return { ...s, ...u, status };
  });
  return { spec: { ...spec, steps }, report };
}

/** A service call: its inputs and outputs as the code has them. */
function serviceUpdate(s: Step, g: Extract<WorkerItem, { kind: 'service' }>, c: Extract<WorkerItem, { kind: 'service' }>, exts: Set<string>, report: WorkerSyncReport): Partial<Step> | null {
  const label = `«${s.name || s.id}»`;
  let inputs = s.inputs ?? [];
  let outputs = s.outputs ?? [];
  let changed = false;
  if (!c.args) report.hints.push(`${label}: die Inputs von run${c.service} sind nicht lesbar - sie bleiben.`);
  else if (g.args) {
    for (const f of new Set([...g.args.keys(), ...c.args.keys()])) {
      const gv = g.args.get(f);
      const cv = c.args.get(f);
      if (norm(gv) === norm(cv)) continue;
      const next = setMapping(inputs, f, cv, v => feelOf(v, exts));
      if (next === null) { report.hints.push(`${label}: Input ${f} = ${cv} ist nicht lesbar - bleibt.`); continue; }
      inputs = next;
      changed = true;
      report.changed.push(`${label}: Input ${f} ${!cv || cv === 'None' ? 'entfernt' : `= ${feelOf(cv, exts)!.slice(2)}`}`);
    }
  }
  // the outputs read the result: `client = getClient.client` → `= client`
  const asFeel = (v: string) => (v.startsWith(`${c.target}.`) ? feelOf(v.slice(c.target.length + 1), exts) : feelOf(v, exts));
  for (const n of new Set([...g.outputs.keys(), ...c.outputs.keys()])) {
    const gv = g.outputs.get(n);
    const cv = c.outputs.get(n);
    const genFeel = gv === undefined ? undefined : gv.startsWith(`${g.target}.`) ? gv.slice(g.target.length + 1) : gv;
    const ownFeel = cv === undefined ? undefined : cv.startsWith(`${c.target}.`) ? cv.slice(c.target.length + 1) : cv;
    if (norm(genFeel) === norm(ownFeel)) continue;
    const next = setMapping(outputs, n, cv, asFeel);
    if (next === null) { report.hints.push(`${label}: Output ${n} = ${cv} ist nicht lesbar - bleibt.`); continue; }
    outputs = next;
    changed = true;
    report.changed.push(`${label}: Output ${n} ${cv === undefined || cv === 'None' ? 'entfernt' : `= ${asFeel(cv)!.slice(2)}`}`);
  }
  return changed ? { inputs, outputs } : null;
}

/** The rows with `name` set to the code's value - removed without one; null: the value is not readable. */
function setMapping(rows: Mapping[], name: string, value: string | undefined, feel: (v: string) => string | null): Mapping[] | null {
  if (value === undefined || value === 'None') return rows.filter(r => r.name !== name);
  const expression = feel(value);
  if (!expression) return null;
  return rows.some(r => r.name === name)
    ? rows.map(r => (r.name === name ? { ...r, expression, disabled: undefined } : r))
    : [...rows, { name, expression }];
}

/** A mapping: its lines and case tables as the code has them. */
function mappingUpdate(s: Step, gen: WorkerCode, own: WorkerCode, g: Extract<WorkerItem, { kind: 'mapping' }>, c: Extract<WorkerItem, { kind: 'mapping' }>,
  exts: Set<string>, named: Map<string, string>, report: WorkerSyncReport, known?: (path: string) => boolean): Partial<Step> | null {
  const label = `«${s.name || s.id}»`;
  const m = s.fieldMapping!;
  const gl = mappingLinks(gen, g.method, g.names, exts);
  const cl = mappingLinks(own, c.method, c.names, exts);
  let fields: FieldLink[] = m.fields;
  let caseLinks: CaseLink[] = m.caseLinks ?? [];
  let changed = false;
  const unreadable = (path: string) => [...cl.unreadable.keys()].find(u => path === u || path.startsWith(`${u}.`));
  for (const path of new Set([...gl.fields.keys(), ...cl.fields.keys()])) {
    const gv = gl.fields.get(path);
    const cv = cl.fields.get(path);
    if (sameLink(gv, cv)) continue;
    const u = unreadable(path);
    if (u) { report.hints.push(`${label}: ${path} ist im Code nicht lesbar (${cl.unreadable.get(u)!.split('\n')[0].slice(0, 80)}) - bleibt.`); continue; }
    if (!cv) {
      fields = fields.filter(l => l.field !== path);
      report.changed.push(`${label}: ${path} ohne Linie`);
    } else {
      const strange = known ? cv.from.filter(p => !known(p)) : [];
      if (strange.length) { report.hints.push(`${label}: ${path} liest im Code ${strange.join(', ')} - das gibt es im In nicht (eigener Code?), bleibt.`); continue; }
      const mapper = cv.ext ? named.get(cv.ext) : undefined;
      const prev = fields.find(l => l.field === path);
      const line: FieldLink = { field: path, from: cv.from, ...(mapper ? { mapper } : {}) };
      fields = prev ? fields.map(l => (l.field === path ? line : l)) : [...fields, line];
      report.changed.push(`${label}: ${path} ← ${cv.from.join(', ')}${cv.ext ? ` (${cv.ext})` : ''}`);
    }
    changed = true;
  }
  for (const path of new Set([...gl.cases.keys(), ...cl.cases.keys()])) {
    const gv = gl.cases.get(path);
    const cv = cl.cases.get(path);
    if (sameCases(gv, cv)) continue;
    if (!cv) {
      if (unreadable(path)) continue;
      caseLinks = caseLinks.filter(l => l.field !== path);
      report.changed.push(`${label}: ${path} ohne Fälle`);
    } else {
      const prev = caseLinks.find(l => l.field === path);
      // the cases of the source the code does not name: without a target, as before
      const others = (prev?.cases ?? []).filter(x => !cv.cases.some(y => y.from === x.from)).map(x => ({ from: x.from, to: '' }));
      const link: CaseLink = { field: path, from: cv.from, cases: [...cv.cases, ...others] };
      caseLinks = prev ? caseLinks.map(l => (l.field === path ? link : l)) : [...caseLinks, link];
      report.changed.push(`${label}: ${path} Fälle ${cv.cases.map(x => `${x.from} → ${x.to}`).join(', ')}`);
    }
    changed = true;
  }
  for (const [path, text] of cl.unreadable) {
    if (gl.unreadable.get(path) === text) continue;
    if (!report.hints.some(h => h.includes(` ${path} `))) report.hints.push(`${label}: ${path} ist im Code nicht lesbar (${text.split('\n')[0].slice(0, 80)}) - bleibt.`);
  }
  return changed ? { fieldMapping: { ...m, fields, ...(caseLinks.length ? { caseLinks } : { caseLinks: undefined }) } } : null;
}
