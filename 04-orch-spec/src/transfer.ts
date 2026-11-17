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
import { cleanMapper } from './typeMappers';

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
  // one of a kind and name each - a second one would be created twice
  const keys = t.items.map(i => `${String((i as { kind?: unknown })?.kind)}:${String((i as { slug?: unknown })?.slug)}`);
  const twice = keys.find((k, n) => keys.indexOf(k) !== n);
  if (twice) return { error: `«${twice.split(':').slice(1).join(':')}» ist zweimal darin - nicht eingefügt.` };
  for (const i of t.items) {
    const ok = i && typeof i === 'object' && typeof i.slug === 'string' && i.spec && typeof i.spec === 'object'
      && (i.kind === 'process' ? Array.isArray((i.spec as ProcessSpec).steps)
        : i.kind === 'collection' ? (i.spec as ServiceCollectionSpec).kind === 'serviceCollection' && Array.isArray((i.spec as ServiceCollectionSpec).services) : false);
    if (!ok) return { error: `«${String((i as { slug?: unknown })?.slug ?? '?')}» ist unvollständig - nicht eingefügt.` };
    // the text comes from outside: a slug names a file - only one as the app writes them, the one of its spec
    if (!SLUG.test(i.slug) || (i.spec as { slug?: unknown }).slug !== i.slug) return { error: `«${i.slug}» ist kein Name, wie ihn Orch Spec schreibt - nicht eingefügt.` };
    const dmns = i.kind === 'process' ? i.dmns : undefined;
    if (dmns !== undefined && (!dmns || typeof dmns !== 'object' || Array.isArray(dmns) || Object.entries(dmns).some(([id, xml]) => !DECISION_ID.test(id) || typeof xml !== 'string'))) {
      return { error: `«${i.slug}»: eine DMN-Tabelle hat keinen gültigen Namen - nicht eingefügt.` };
    }
    if (i.kind === 'process' && i.bpmn !== undefined && typeof i.bpmn !== 'string') return { error: `«${i.slug}»: das BPMN ist kein Text - nicht eingefügt.` };
    if (i.kind === 'process' && !wholeSteps(i.spec.steps)) return { error: `«${i.slug}»: der Ablauf ist unvollständig - nicht eingefügt.` };
    if (i.kind === 'collection' && i.openApi !== undefined
      && (!i.openApi || typeof i.openApi !== 'object' || typeof i.openApi.file !== 'string' || typeof i.openApi.text !== 'string')) {
      return { error: `«${i.slug}»: die OpenAPI ist unvollständig - nicht eingefügt.` };
    }
  }
  // where a collection keeps its OpenAPI is this place's business - never a path from the text
  const items = (t.items as TransferItem[]).map(i => (i.kind === 'collection' && i.spec.source?.stored
    ? { ...i, spec: { ...i.spec, source: { ...i.spec.source, stored: undefined } } } : i));
  // what goes into the model: only whole ones, as the Administration stores them
  const typeMappers = Array.isArray(t.typeMappers) ? t.typeMappers.map(m => cleanMapper(m)).filter((m): m is TypeMapper => !!m && typeof m.id === 'string' && !!m.id) : [];
  if (Array.isArray(t.typeMappers) && typeMappers.length !== t.typeMappers.length) return { error: 'Ein mitkopierter Typ-Mapper ist unvollständig - nicht eingefügt.' };
  const patterns = Array.isArray(t.patterns) ? t.patterns : [];
  if (patterns.some(p => !p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string')) return { error: 'Ein mitkopiertes Pattern ist unvollständig - nicht eingefügt.' };
  // a built-in one is never copied - one claiming to be is none of this app's
  if (patterns.some(p => p.builtin)) return { error: 'Ein mitkopiertes Pattern gibt sich als eingebaut aus - nicht eingefügt.' };
  return {
    kind: TRANSFER_KIND, v: 1, exportedAt: String(t.exportedAt ?? ''), items,
    ...(typeMappers.length ? { typeMappers } : {}),
    ...(patterns.length ? { patterns } : {}),
  };
}

/** The steps as the app has them: objects with an id, their branches and children steps again. */
function wholeSteps(steps: unknown): boolean {
  if (!Array.isArray(steps)) return false;
  return steps.every(s => !!s && typeof s === 'object' && typeof (s as Step).id === 'string'
    && ((s as Step).branches === undefined || (Array.isArray((s as Step).branches) && ((s as Step).branches as unknown[]).every(b => !!b && typeof b === 'object' && wholeSteps((b as { steps: unknown }).steps))))
    && ((s as Step).children === undefined || wholeSteps((s as Step).children)));
}

/** a slug as the app writes it (slugify): no path, no dots */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** the id of a decision - the name of its DMN file */
const DECISION_ID = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9_][\w-]*$/;

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

const titleOf = (i: TransferItem) => i.spec.title || i.slug;
/** the same content - whatever the order of the keys */
const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
/** the key of a row - a process and a collection may have the same slug */
export const rowKey = (i: TransferItem) => `${i.kind}:${i.slug}`;

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
