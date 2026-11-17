// Copy and paste between two places of Orch Spec - a process (also one in service mode, an
// orchestration) or a collection as text: copied in one app (local development), pasted into the
// other (the productive one). The text carries what the item needs: a process its BPMN and its DMN
// tables, a collection its OpenAPI, both the type mappers and the patterns of the model they use.
//
// Pasting first plans (planPaste): per item new or already there (then overwritten or skipped),
// the type mappers and patterns the model lacks taken along, what the target lacks otherwise said.
import type { ServiceCollectionSpec } from './services/types';
import { servicesByTopic } from './services/orchestration';
import type { OpenApiFile } from './services/openApiFile';
import type { Model, PatternDef, ProcessSpec, Step, TypeMapper } from './types';

export const TRANSFER_KIND = 'orch-spec-transfer';

export type TransferItem =
  | { kind: 'process'; slug: string; spec: ProcessSpec; bpmn?: string; dmns?: Record<string, string> }
  | { kind: 'collection'; slug: string; spec: ServiceCollectionSpec; openApi?: OpenApiFile };

export interface Transfer {
  kind: typeof TRANSFER_KIND;
  v: 1;
  exportedAt: string;
  items: TransferItem[];
  /** the type mappers of the model the items use (a line of a mapping chooses one) */
  typeMappers?: TypeMapper[];
  /** the patterns of the model the items use - not the built-in ones */
  patterns?: PatternDef[];
}

function allSteps(steps: Step[], out: Step[] = []): Step[] {
  for (const s of steps) {
    out.push(s);
    for (const b of (s.branches ?? []) as Array<{ steps: Step[] }>) allSteps(b.steps, out);
    allSteps((s.children ?? []) as Step[], out);
  }
  return out;
}

/** The ids of the type mappers and patterns a process uses. */
export function usedBy(spec: ProcessSpec): { mappers: Set<string>; patterns: Set<string> } {
  const mappers = new Set<string>();
  const patterns = new Set<string>();
  for (const p of spec.patterns ?? []) patterns.add(p.id);
  for (const s of allSteps(spec.steps ?? [])) {
    for (const l of s.fieldMapping?.fields ?? []) if (l.mapper) mappers.add(l.mapper);
    for (const p of s.patterns ?? []) patterns.add(p.id);
    if (typeof s.pattern === 'string' && s.pattern) patterns.add(s.pattern);
  }
  return { mappers, patterns };
}

/** The text for the clipboard: the items and what of the model they use. */
export function transferOf(items: TransferItem[], model: Model | null, now = new Date().toISOString()): Transfer {
  const mappers = new Set<string>();
  const patterns = new Set<string>();
  for (const i of items) {
    if (i.kind !== 'process') continue;
    const u = usedBy(i.spec);
    u.mappers.forEach(m => mappers.add(m));
    u.patterns.forEach(p => patterns.add(p));
  }
  const typeMappers = (model?.typeMappers ?? []).filter(m => mappers.has(m.id));
  const usedPatterns = (model?.patterns ?? []).filter(p => patterns.has(p.id) && !p.builtin);
  return {
    kind: TRANSFER_KIND, v: 1, exportedAt: now, items,
    ...(typeMappers.length ? { typeMappers } : {}),
    ...(usedPatterns.length ? { patterns: usedPatterns } : {}),
  };
}

export const transferText = (t: Transfer): string => JSON.stringify(t, null, 2);

/** What was pasted - or why it is none. */
export function readTransfer(text: string): Transfer | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return { error: 'Das ist kein kopierter Inhalt von Orch Spec (kein JSON).' };
  }
  const t = raw as Partial<Transfer> | null;
  if (!t || typeof t !== 'object' || t.kind !== TRANSFER_KIND) return { error: 'Das ist kein kopierter Inhalt von Orch Spec.' };
  if (t.v !== 1) return { error: `Version ${String(t.v)} kennt diese App nicht - zuerst die App aktualisieren.` };
  if (!Array.isArray(t.items) || !t.items.length) return { error: 'Der kopierte Inhalt ist leer.' };
  for (const i of t.items) {
    const ok = i && typeof i === 'object' && typeof i.slug === 'string' && i.spec && typeof i.spec === 'object'
      && (i.kind === 'process' ? Array.isArray((i.spec as ProcessSpec).steps)
        : i.kind === 'collection' ? (i.spec as ServiceCollectionSpec).kind === 'serviceCollection' && Array.isArray((i.spec as ServiceCollectionSpec).services) : false);
    if (!ok) return { error: `«${String((i as { slug?: unknown })?.slug ?? '?')}» ist unvollständig - nicht eingefügt.` };
  }
  return {
    kind: TRANSFER_KIND, v: 1, exportedAt: String(t.exportedAt ?? ''), items: t.items as TransferItem[],
    ...(Array.isArray(t.typeMappers) ? { typeMappers: t.typeMappers } : {}),
    ...(Array.isArray(t.patterns) ? { patterns: t.patterns } : {}),
  };
}

export type PasteAction = 'create' | 'overwrite' | 'skip';

export interface PasteRow {
  item: TransferItem;
  title: string;
  /** what is there under its slug - its last change */
  existing?: { updatedAt?: string; version: string };
  action: PasteAction;
}

export interface PastePlan {
  rows: PasteRow[];
  /** what the model lacks - added with the items */
  typeMappers: TypeMapper[];
  patterns: PatternDef[];
  /** of the same id, but not the same: the model's stays */
  differing: string[];
  /** what the target lacks otherwise - only said */
  hints: string[];
}

const titleOf = (i: TransferItem) => (i.kind === 'process' ? i.spec.title || i.slug : i.spec.title || i.slug);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What pasting does: a new item is created, one already there is overwritten (or skipped, see
 * `action`), the type mappers and patterns the model lacks come along. `known`: the topics the
 * target can call - a service step of a process calling another is said.
 */
export function planPaste(t: Transfer, existing: { processes: Map<string, { updatedAt?: string; version: string }>; collections: Map<string, { updatedAt?: string; version: string }> },
  model: Model | null, known?: Set<string>): PastePlan {
  // what the pasted collections bring - the topics their services have
  const pastedTopics = new Set(servicesByTopic(t.items.flatMap(i => (i.kind === 'collection' ? [i.spec] : []))).keys());
  const rows: PasteRow[] = t.items.map(item => {
    const there = (item.kind === 'process' ? existing.processes : existing.collections).get(item.slug);
    return { item, title: titleOf(item), ...(there ? { existing: there } : {}), action: there ? 'overwrite' : 'create' };
  });
  const own = new Map((model?.typeMappers ?? []).map(m => [m.id, m]));
  const typeMappers: TypeMapper[] = [];
  const differing: string[] = [];
  for (const m of t.typeMappers ?? []) {
    const there = own.get(m.id);
    if (!there) typeMappers.push(m);
    else if (!same(there, m)) differing.push(`Typ-Mapper ${m.name?.trim() || m.id}`);
  }
  const ownPatterns = new Map((model?.patterns ?? []).map(p => [p.id, p]));
  const patterns: PatternDef[] = [];
  for (const p of t.patterns ?? []) {
    const there = ownPatterns.get(p.id);
    if (!there) patterns.push(p);
    else if (!same(there, p)) differing.push(`Pattern ${String(p.name ?? p.id)}`);
  }
  const hints: string[] = [];
  if (known) {
    for (const i of t.items) {
      if (i.kind !== 'process') continue;
      const missing = [...new Set(allSteps(i.spec.steps ?? []).filter(s => s.kind === 'service' && s.topic).map(s => s.topic!))]
        .filter(x => !known.has(x) && !pastedTopics.has(x));
      if (missing.length) hints.push(`«${titleOf(i)}» ruft auf, was es hier nicht gibt: ${missing.join(', ')} - die Collection auch kopieren oder den Katalog neu aufbauen.`);
    }
  }
  return { rows, typeMappers, patterns, differing, hints };
}

/** The model with what the paste takes along. */
export function withPasted(model: Model, plan: Pick<PastePlan, 'typeMappers' | 'patterns'>): Model {
  if (!plan.typeMappers.length && !plan.patterns.length) return model;
  return {
    ...model,
    ...(plan.typeMappers.length ? { typeMappers: [...(model.typeMappers ?? []), ...plan.typeMappers] } : {}),
    ...(plan.patterns.length ? { patterns: [...(model.patterns ?? []), ...plan.patterns] } : {}),
  };
}
