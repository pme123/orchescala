// The differences between a page and its draft - what the RE sees before accepting - and between a
// process and its draft.
import { blockName, blockTitle } from '../pages/designer/model';
import { flatten, type BlockKey } from '../pages/pageActions';
import type { Component, Page } from '../pages/runtime/spec';
import { allSteps } from '../bpmn';
import type { ProcessSpec, Step, TypeDef } from '../types';
import { lcs } from '../util';

export { blockName };

export type PageChange = {
  kind: 'added' | 'removed' | 'changed' | 'moved' | 'page';
  /** the key in the draft - for removed ones the key in the page before */
  key?: BlockKey;
  /** «Eingabefelder «Kontakt»», «Titel» */
  label: string;
  /** what changed in detail: «Filiale» neu */
  detail?: string;
};

type Flat = { key: BlockKey; block: Component; sig: string };

const PAGE_PROPS: { prop: keyof Page; label: string }[] = [
  { prop: 'title', label: 'Titel' }, { prop: 'path', label: 'Pfad' }, { prop: 'access', label: 'Zugang' },
  { prop: 'state', label: 'Anfangszustand' }, { prop: 'load', label: 'Aktionen beim Laden' },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A hand-edited page may lack a list or hold something else where a list belongs - then it is empty. */
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const typeOf = (b: Component): string => (typeof b.type === 'string' ? b.type : '');

/** A block without the content of a section - a section with a changed child has not changed itself. */
const signature = (b: Component) => {
  const { body: _body, ...own } = b as Component & { body?: unknown };
  return JSON.stringify(own);
};

/** A value of a property as text: a text itself, nothing as empty. */
const text = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

/** What changed in a fields block, a summary or a choice - the labels of the entries. */
function detailOf(before: Component, after: Component): string | undefined {
  const entries = (b: Component): string[] | undefined => {
    const type = typeOf(b);
    const list = type === 'fields' ? 'fields' : type === 'summary' ? 'items' : type === 'choice' ? 'options' : undefined;
    return list === undefined ? undefined
      : listOf((b as unknown as Record<string, unknown>)[list]).map((e) => (isRecord(e) && typeof e.label === 'string' ? e.label : ''));
  };
  const was = entries(before);
  const now = entries(after);
  if (!was || !now) return undefined;
  const parts = [
    ...now.filter((l) => !was.includes(l)).map((l) => `«${l}» neu`),
    ...was.filter((l) => !now.includes(l)).map((l) => `«${l}» entfernt`),
  ];
  return parts.length ? parts.join(', ') : undefined;
}

/** The differences between a page and its draft: building blocks new, changed, moved, removed, and the
  * properties of the page. Building blocks have no ids (their key is the index path), so they are
  * matched by content: the longest common sequence stays, the same block elsewhere has moved, a block
  * of the same type at the same key has changed.
  *
  * Content is compared as JSON text, the keys in their order: the same block with its keys in another
  * order counts as changed, the same state as a change of the page. orch-spec writes pages in one
  * order, so this is no difference in practice.
  *
  * The pairing is a heuristic (the RE has seen it since the AI mode): a block with the same type and
  * title has changed; else one at the same key; else - if it is the only one of its type left on both
  * sides - that one (a button with a new label after an insert before it). It reads «changed» where
  * «removed» and «added» would be exact, on purpose: the RE sees one change instead of two.
  * Something else than an object counts as an empty page. */
export function pageDiff(before: Page, after: Page): PageChange[] {
  const was = isRecord(before) ? before : ({} as Partial<Page>);
  const now = isRecord(after) ? after : ({} as Partial<Page>);
  const props = PAGE_PROPS
    .filter(({ prop }) => JSON.stringify(was[prop] ?? null) !== JSON.stringify(now[prop] ?? null))
    .map(({ prop, label }): PageChange => ({
      kind: 'page', label,
      ...(typeof was[prop] === 'string' || typeof now[prop] === 'string' ? { detail: `«${text(was[prop])}» → «${text(now[prop])}»` } : {}),
    }));

  const flat = (p: Partial<Page>): Flat[] => flatten(p.body as Component[]).map(({ key, block }) => ({ key, block, sig: signature(block) }));
  const a = flat(was);
  const b = flat(now);
  const common = lcs(a.map((x) => x.sig), b.map((x) => x.sig));
  const keptA = new Set(common.map(([i]) => i));
  const keptB = new Set(common.map(([, j]) => j));
  const restA = a.filter((_, i) => !keptA.has(i));
  const restB = b.filter((_, j) => !keptB.has(j));
  const sameType = (x: Flat) => (y: Flat) => typeOf(y.block) === typeOf(x.block);

  // pair the rest: the same content elsewhere has moved, the same type at the same key has changed
  const paired = restB.reduce<{ changes: PageChange[]; left: Flat[] }>(({ changes, left }, x) => {
    const same = left.find((y) => y.sig === x.sig);
    if (same) return { changes: [...changes, { kind: 'moved', key: x.key, label: blockName(x.block), detail: `von ${same.key}` }], left: left.filter((y) => y.key !== same.key) };
    // the same type with the same title (keys shift when something is inserted before), else at the same key
    const old = left.find((y) => sameType(x)(y) && blockTitle(y.block) === blockTitle(x.block))
      ?? left.find((y) => y.key === x.key && sameType(x)(y))
      // the only one of its type that is left - a button with a new label after an insert before it
      ?? (left.filter(sameType(x)).length === 1 && restB.filter(sameType(x)).length === 1 ? left.find(sameType(x)) : undefined);
    if (old) {
      const detail = detailOf(old.block, x.block);
      return { changes: [...changes, { kind: 'changed', key: x.key, label: blockName(x.block), ...(detail ? { detail } : {}) }], left: left.filter((y) => y.key !== old.key) };
    }
    return { changes: [...changes, { kind: 'added', key: x.key, label: blockName(x.block) }], left };
  }, { changes: [], left: restA });

  return [...props, ...paired.changes, ...paired.left.map((y): PageChange => ({ kind: 'removed', key: y.key, label: blockName(y.block) }))];
}

/** The keys in the draft that are new, changed or moved - the outline marks them. */
export const changedKeys = (changes: PageChange[]) =>
  new Set(changes.flatMap((c) => (c.kind !== 'removed' && c.kind !== 'page' && c.key !== undefined ? [c.key] : [])));

// ---------------------------------------------------------------- processes

export type ProcessChange = { kind: 'added' | 'removed' | 'renamed' | 'changed'; id: string; label: string; detail?: string };

const STEP_KIND: Partial<Record<Step['kind'], string>> = {
  user: 'Benutzer-Task', service: 'Service', manual: 'manuell', gateway: 'Entscheid', end: 'Ende', event: 'Ereignis', rule: 'Entscheidung (DMN)',
};
const DETAILS: { key: keyof Step; label: string }[] = [
  { key: 'description', label: 'Beschreibung' }, { key: 'candidateGroups', label: 'Gruppen' },
  { key: 'candidateUsers', label: 'Personen' }, { key: 'assignee', label: 'zugewiesen' }, { key: 'topic', label: 'Topic' },
];

/** The differences between a process and its draft - steps by ID: new, removed, renamed, details changed;
  * error paths and branches of a step count as a change of it. */
export function processDiff(before: ProcessSpec, after: ProcessSpec): ProcessChange[] {
  const real = (s: ProcessSpec) => new Map(allSteps(s.steps).filter((x) => x.kind !== 'goto').map((x) => [x.id, x]));
  const a = real(before);
  const b = real(after);
  const name = (s: Step) => `${STEP_KIND[s.kind] ?? s.kind} «${s.name || s.id}»`;
  const sig = (s: Step) => JSON.stringify([(s.errors ?? []).map((e) => e.code), (s.branches ?? []).map((x) => [x.label, x.condition ?? '', !!x.isDefault])]);
  const changed = [...b.values()].flatMap((s): ProcessChange[] => {
    const old = a.get(s.id);
    if (!old) return [{ kind: 'added', id: s.id, label: name(s) }];
    const details = DETAILS.filter(({ key }) => (old[key] ?? '') !== (s[key] ?? '')).map(({ label }) => label);
    const paths = sig(old) !== sig(s) ? ['Zweige/Fehlerpfade'] : [];
    return [
      ...(old.name !== s.name ? [{ kind: 'renamed' as const, id: s.id, label: name(s), detail: `vorher «${old.name}»` }] : []),
      ...(details.length || paths.length ? [{ kind: 'changed' as const, id: s.id, label: name(s), detail: [...details, ...paths].join(', ') }] : []),
    ];
  });
  return [
    ...changed,
    ...[...a.values()].filter((s) => !b.has(s.id)).map((s): ProcessChange => ({ kind: 'removed', id: s.id, label: name(s) })),
    ...typeDiff(before.types ?? [], after.types ?? []),
  ];
}

/** The id of a type in a change - not a step, nothing to select in the flow. */
export const TYPE_CHANGE = 'type:';

/** The classes and choices of the data model: new, removed, renamed, changed (fields, cases, kind). */
function typeDiff(before: TypeDef[], after: TypeDef[]): ProcessChange[] {
  const label = (t: TypeDef) =>
    `${t.root ? 'In des Prozesses' : t.processOut ? 'Out des Prozesses' : t.kind === 'enum' ? 'Auswahl' : 'Klasse'} «${t.name}»`;
  const content = (t: TypeDef) => JSON.stringify([t.kind, t.description ?? '', t.fields ?? [], t.values ?? []]);
  const old = new Map(before.map((t) => [t.id, t]));
  return [
    ...after.flatMap((t): ProcessChange[] => {
      const o = old.get(t.id);
      const id = `${TYPE_CHANGE}${t.id}`;
      if (!o) return [{ kind: 'added', id, label: label(t) }];
      return [
        ...(o.name !== t.name ? [{ kind: 'renamed' as const, id, label: label(t), detail: `vorher «${o.name}»` }] : []),
        ...(content(o) !== content(t) ? [{ kind: 'changed' as const, id, label: label(t), detail: o.kind !== t.kind ? 'Art, Felder' : 'Felder/Fälle' }] : []),
      ];
    }),
    ...before.filter((t) => !after.some((x) => x.id === t.id)).map((t): ProcessChange => ({ kind: 'removed', id: `${TYPE_CHANGE}${t.id}`, label: label(t) })),
  ];
}
