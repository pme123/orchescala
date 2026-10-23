// Sync the data model with the domain — on «Mit BPMN abgleichen».
//
// On creation the data model is built from the domain (`enrichSpec`). On
// sync there already is one: maintained, commented, with status. That is why
// it is not replaced here but **merged** — as with the flow:
//
//  · The **structure** comes from the domain: fields, types, Optional/Seq/Map,
//    constraint, values of the selections; name and key of the interactions.
//  · What the specification defines **stays**: descriptions, examples —
//    not defaults: those apply from the domain, because on implementation
//    they are adjusted there — and above all the
//    **IDs** of types, fields and interactions. The
//    comments (`type:<id>#field:<id>`, `ia:<id>`) and the references hang on them.
//  · What the domain does not know (any more) stays and is reported —
//    removed only on request (`removeStale`), and even then only what had
//    already been implemented once; a draft is ahead of the domain, not stale.
//
// Matching is done without guessing: the process classes by their role (In, Out,
// InitIn, InConfig), the In/Out of an interaction by the step in the
// flow, everything else by name.

import type { EnumValue, Field, Interaction, ProcessSpec, Status, TypeDef } from './types';
import { settle, type MergeStatus } from './bpmn';

export interface DomainMergeReport {
  added: string[];
  changed: string[];
  /** what the domain does not know (any more) — removed or only reported, depending on `removeStale` */
  stale: string[];
  /** interactions prepared as a draft (steps without a domain object) */
  prepared: string[];
  /** were on «Angepasst», match the domain — get the chosen status */
  confirmed: string[];
  kept: number;
}

export interface DomainMergeOptions {
  status: MergeStatus;
  /** Remove what the domain does not know (any more) and had already been implemented */
  removeStale?: boolean;
  /** Prepare steps without interaction as a draft (as on creation) */
  prepare?: boolean;
}

/** Prepared on import — no domain object behind it. */
const isPrepared = (x: { status?: Status }) => x.status === 'draft';
/** already implemented once — if it is missing in the domain, it has been dropped */
const wasImplemented = (x: { status?: Status }) => x.status === 'implemented' || x.status === 'accepted' || x.status === 'changed';

const ROLES = ['root', 'processOut', 'initIn', 'inConfig'] as const;
const roleOf = (t: TypeDef) => ROLES.find(r => !!t[r]);

/**
 * `previous` is the specification after the sync of the flow (with its
 * previous data model), `fresh` the same one, enriched from the domain
 * (`enrichSpec`) — or `null` without a domain: then at most the
 * missing interactions are prepared (`preparedOnly`).
 */
export function mergeDomain(previous: ProcessSpec, fresh: ProcessSpec, opts: DomainMergeOptions): { spec: ProcessSpec; report: DomainMergeReport } {
  const report: DomainMergeReport = { added: [], changed: [], stale: [], prepared: [], confirmed: [], kept: 0 };
  const pTypes = previous.types ?? [];
  const pIas = previous.interactions ?? [];
  const pById = new Map(pTypes.map(t => [t.id, t]));
  const fById = new Map((fresh.types ?? []).map(t => [t.id, t]));

  // ── Interactions: via the step ──────────────────────────────────────
  const pByStep = new Map(pIas.map(i => [i.stepId, i]));
  const dropTypes = new Set<string>();
  const freshIas: Interaction[] = [];
  for (const ia of fresh.interactions ?? []) {
    const prev = pByStep.get(ia.stepId);
    // prepared although the specification already has one (or should not):
    // the one of the specification applies
    if (isPrepared(ia) && (prev || !opts.prepare)) {
      for (const id of [ia.inTypeId, ia.outTypeId]) if (id) dropTypes.add(id);
      continue;
    }
    freshIas.push(ia);
  }
  // Two steps can share a prepared object — its types
  // stay as long as one of the interactions stays
  for (const ia of freshIas) for (const id of [ia.inTypeId, ia.outTypeId]) if (id) dropTypes.delete(id);

  // ── Match types: fresh ID → previous ID ───────────────────────────
  const pair = new Map<string, string>();
  const paired = new Set<string>();
  const link = (f: string | undefined, p: string | undefined) => {
    if (!f || !p || pair.has(f) || paired.has(p) || !fById.has(f) || !pById.has(p)) return;
    pair.set(f, p);
    paired.add(p);
  };
  for (const r of ROLES) link((fresh.types ?? []).find(t => t[r])?.id, pTypes.find(t => t[r])?.id);
  for (const ia of freshIas) {
    const prev = pByStep.get(ia.stepId);
    if (!prev) continue;
    link(ia.inTypeId, prev.inTypeId);
    link(ia.outTypeId, prev.outTypeId);
  }
  // Two previous types with the same name (a duplicate of an earlier sync): the one
  // reachable from the roots and interactions gets the domain — not just the first in
  // the list. References from stale types (or from the copy itself) do not count.
  let reachable: Set<string> | undefined;
  const reachableIds = () => {
    if (reachable) return reachable;
    reachable = new Set();
    const todo = [...pTypes.filter(roleOf).map(t => t.id), ...pIas.flatMap(ia => [ia.inTypeId, ia.outTypeId])];
    while (todo.length) {
      const id = todo.pop();
      const t = id ? pById.get(id) : undefined;
      if (!t || reachable.has(t.id)) continue;
      reachable.add(t.id);
      for (const x of [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])]) todo.push(x.type);
    }
    return reachable;
  };
  for (const f of fresh.types ?? []) {
    if (pair.has(f.id) || dropTypes.has(f.id) || roleOf(f)) continue;
    const candidates = pTypes.filter(t => !paired.has(t.id) && !roleOf(t) && t.name === f.name);
    const p = candidates.length > 1 ? candidates.find(t => reachableIds().has(t.id)) ?? candidates[0] : candidates[0];
    if (p) link(f.id, p.id);
  }
  const mapType = (type: string) => pair.get(type) ?? type;

  // ── Merge interactions ─────────────────────────────────────────
  const iaIds = new Map<string, string>(); // fresh interaction ID → previous one
  const interactions: Interaction[] = [];
  const touched = new Set<string>();
  for (const f of freshIas) {
    const prev = pByStep.get(f.stepId);
    if (!prev) {
      const ia: Interaction = { ...f, status: isPrepared(f) ? 'draft' : opts.status.added };
      interactions.push(ia);
      (isPrepared(f) ? report.prepared : report.added).push(f.name);
      continue;
    }
    touched.add(prev.id);
    iaIds.set(f.id, prev.id);
    const inTypeId = f.inTypeId ? mapType(f.inTypeId) : undefined;
    const outTypeId = f.outTypeId ? mapType(f.outTypeId) : undefined;
    const changed = prev.name !== f.name || prev.key !== f.key || prev.kind !== f.kind
      || (prev.inTypeId ?? '') !== (inTypeId ?? '') || (prev.outTypeId ?? '') !== (outTypeId ?? '')
      || isPrepared(prev);
    const { inTypeId: _i, outTypeId: _o, ...rest } = prev;
    interactions.push({
      ...rest,
      kind: f.kind, name: f.name, key: f.key,
      ...(prev.descr || f.descr ? { descr: prev.descr || f.descr } : {}),
      // the expression belongs to the text that applies
      descrExpr: prev.descr ? prev.descrExpr : f.descrExpr,
      descrImports: prev.descr ? prev.descrImports : f.descrImports,
      ...(inTypeId ? { inTypeId } : {}),
      ...(outTypeId ? { outTypeId } : {}),
      status: changed ? opts.status.changed : settle(prev.status, opts.status),
    });
    if (changed) report.changed.push(f.name === prev.name ? f.name : `${prev.name} → ${f.name}`);
    else if (settle(prev.status, opts.status) !== prev.status) report.confirmed.push(f.name);
    else report.kept++;
  }
  // the remaining ones of the specification stay — even without a step in the flow
  // (the class builder marks them and offers to remove them)
  for (const ia of pIas) if (!touched.has(ia.id)) interactions.push(ia);

  // ── Merge types ─────────────────────────────────────────────────
  const types: TypeDef[] = [];
  const fromFresh = new Set<string>();
  for (const f of fresh.types ?? []) {
    if (dropTypes.has(f.id)) continue;
    const iaId = f.interactionId ? (iaIds.get(f.interactionId) ?? f.interactionId) : undefined;
    const pid = pair.get(f.id);
    const prev = pid ? pById.get(pid) : undefined;
    if (!prev) {
      const t = remap({ ...f, ...(iaId ? { interactionId: iaId } : {}) }, mapType);
      t.status = isPrepared(f) ? 'draft' : opts.status.added;
      types.push(t);
      if (!isPrepared(f)) report.added.push(f.name);
      continue;
    }
    fromFresh.add(prev.id);
    const stale: string[] = [];
    const m = mergeType(prev, remap(f, mapType), stale, !!opts.removeStale);
    if (iaId) m.type.interactionId = iaId;
    const changed = m.changed || (isPrepared(prev) && !isPrepared(f));
    m.type.status = changed ? (isPrepared(f) ? 'draft' : opts.status.changed) : settle(prev.status, opts.status);
    types.push(m.type);
    report.stale.push(...stale.map(s => `${f.name}.${s}`));
    if (changed) report.changed.push(f.name);
    else if (m.type.status !== prev.status) report.confirmed.push(f.name);
    else report.kept++;
  }
  // what the domain does not know: stays — unless it was implemented, is no longer
  // needed and should go
  const rest = pTypes.filter(t => !fromFresh.has(t.id));
  const used = new Set<string>();
  const use = (fs: Field[] | undefined) => { for (const x of fs ?? []) used.add(x.type); };
  for (const t of [...types, ...rest]) {
    use(t.fields);
    for (const v of t.values ?? []) use(v.fields);
  }
  for (const ia of interactions) for (const id of [ia.inTypeId, ia.outTypeId]) if (id) used.add(id);
  for (const t of rest) {
    const gone = !!fresh.types?.length && wasImplemented(t) && !used.has(t.id);
    if (gone) report.stale.push(t.name);
    if (gone && opts.removeStale) continue;
    types.push(t);
  }

  // the label per language belongs to the domain
  const processLabels = fresh.processLabels ?? previous.processLabels;
  // the starting situation belongs to the specification — only an empty one comes from the domain (`descr`)
  const description = previous.description?.trim() ? previous.description : fresh.description?.trim() ? fresh.description : previous.description;
  return { spec: { ...previous, types, interactions, ...(processLabels ? { processLabels } : {}), ...(description ? { description } : {}) }, report };
}

/** Redirect type references in fields (and cases) to the previous IDs. */
function remap(t: TypeDef, mapType: (id: string) => string): TypeDef {
  const fields = (fs: Field[] | undefined) => fs?.map(f => ({ ...f, type: mapType(f.type) }));
  return {
    ...t,
    ...(t.fields ? { fields: fields(t.fields) } : {}),
    ...(t.values ? { values: t.values.map(v => (v.fields ? { ...v, fields: fields(v.fields) } : v)) } : {}),
  };
}

/** What makes up the structure of a field — text and example belong to the specification. */
const fieldSig = (f: Field) =>
  JSON.stringify([f.type, !!f.optional, f.noneAlias ?? '', !!f.collection, !!f.map, f.enumCase ?? '', f.constraint ?? '', f.default ?? '']);

/**
 * The same type, written two ways: a union alias in the process object was a catalog
 * reference before (`dom:…v1.SendEvent.In.ReceivingSystems`), today the field keeps
 * the alias (`SendEvent.In.ReceivingSystems`). That is no change of the field — but
 * only if the reference points to exactly that alias: in the package of the type the
 * field belongs to, or any package above it (`pkg`, from its `domainId`).
 */
const sameType = (a: string, b: string, pkg?: string) => a === b || aliasOf(a, b, pkg) || aliasOf(b, a, pkg);
const aliasOf = (ref: string, name: string, pkg?: string) => {
  if (!pkg || !ref.startsWith('dom:') || !ref.endsWith(`.${name}`)) return false;
  const refPkg = ref.slice(4, -name.length - 1);
  return pkg === refPkg || pkg.startsWith(`${refPkg}.`);
};
/** The package of a domain type: its id without the object path (`…v1.SendEvent.In` → `…v1`) */
const packageOfId = (id: string | undefined) => {
  if (!id) return undefined;
  const parts = id.split('.');
  const at = parts.findIndex(p => /^[A-Z]/.test(p));
  return at > 0 ? parts.slice(0, at).join('.') : undefined;
};
const sameField = (a: Field, b: Field, pkg?: string) => sameType(a.type, b.type, pkg) && fieldSig({ ...a, type: '' }) === fieldSig({ ...b, type: '' });

/**
 * Fields by name: the domain determines which exist and what they look like
 * — the default too: if it has none (any more), the old one is dropped; on
 * implementation it is adjusted in the domain, that is where it applies. ID, description
 * and example come from the specification.
 */
function mergeFields(prev: Field[] | undefined, fresh: Field[] | undefined, where: string, stale: string[], removeStale: boolean, wasImpl: boolean, pkg?: string): { fields: Field[]; changed: boolean } {
  const before = new Map((prev ?? []).filter(f => f.name).map(f => [f.name, f]));
  let changed = false;
  const fields: Field[] = (fresh ?? []).map(f => {
    const p = before.get(f.name);
    if (!p) { changed = true; return f; }
    before.delete(f.name);
    // the description of the specification takes precedence — including its expression (`clientKeyDescr`)
    const described = p.description ? p : f;
    const merged: Field = {
      ...f,
      id: p.id,
      ...(described.description ? { description: described.description } : {}),
      ...(described.descriptionExpr ? { descriptionExpr: described.descriptionExpr } : {}),
      ...(described.descriptionExpr && described.descriptionImports ? { descriptionImports: described.descriptionImports } : {}),
      ...(p.example || f.example ? { example: p.example || f.example } : {}),
      // the imports belong to the example that applies
      exampleImports: p.example ? p.exampleImports : f.exampleImports,
      ...(f.default ? { default: f.default } : {}),
    };
    if (!sameField(merged, p, pkg)) changed = true;
    return merged;
  });
  // only in the specification: reported; removed only if the type had already
  // been implemented and it is requested — unfinished fields stay anyway
  for (const p of prev ?? []) {
    if (!p.name) { fields.push(p); continue; }
    if (!before.has(p.name)) continue;
    stale.push(`${where}${p.name}`);
    if (removeStale && wasImpl) { changed = true; continue; }
    fields.push(p);
  }
  return { fields, changed };
}

function mergeType(prev: TypeDef, fresh: TypeDef, stale: string[], removeStale: boolean): { type: TypeDef; changed: boolean } {
  const wasImpl = wasImplemented(prev);
  let changed = prev.kind !== fresh.kind;
  const pkg = packageOfId(fresh.domainId);
  const common = mergeFields(prev.fields, fresh.fields, '', stale, removeStale, wasImpl, pkg);
  changed ||= common.changed;
  let values: EnumValue[] | undefined;
  if (fresh.kind === 'enum') {
    const before = new Map((prev.values ?? []).map(v => [v.name, v]));
    values = (fresh.values ?? []).map(v => {
      const p = before.get(v.name);
      if (!p) { changed = true; return v; }
      before.delete(v.name);
      const fs = mergeFields(p.fields, v.fields, `${v.name}.`, stale, removeStale, wasImpl, pkg);
      changed ||= fs.changed;
      // only reordered in the code — that is a change too (the order of the parameters); a
      // specification without `order` (from before) does not know it — that alone is not a change
      changed ||= !!p.order && JSON.stringify(p.order) !== JSON.stringify(v.order ?? null);
      return {
        ...v,
        ...(p.description || v.description ? { description: p.description || v.description } : {}),
        ...(fs.fields.length ? { fields: fs.fields } : {}),
      };
    });
    for (const p of prev.values ?? []) {
      if (!before.has(p.name) || !p.name) continue;
      stale.push(p.name);
      if (removeStale && wasImpl) { changed = true; continue; }
      values.push(p);
    }
  }
  const { fields: _f, values: _v, ...head } = fresh;
  const type: TypeDef = {
    ...prev,
    ...head,
    id: prev.id,
    ...(prev.description || fresh.description ? { description: prev.description || fresh.description } : {}),
  };
  delete type.fields;
  delete type.values;
  if (common.fields.length) type.fields = common.fields;
  if (values) type.values = values;
  return { type, changed };
}
