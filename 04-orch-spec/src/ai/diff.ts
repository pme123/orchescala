// The differences between a page and its draft - what the RE sees before accepting: building blocks
// new, changed, moved, removed, and the properties of the page. Building blocks have no ids (their
// key is the index path), so they are matched by content: the longest common sequence stays,
// the same block elsewhere has moved, a block of the same type at the same key has changed.
import { blockName, blockTitle as titleOf, flatten, type BlockKey } from '../pages/designer/model';
import { lcs } from '../util';

export { blockName };
import type { Component, Page } from '../pages/runtime/spec';
import { allSteps } from '../bpmn';
import type { ProcessSpec, Step } from '../types';

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

/** A block without the content of a section - a section with a changed child has not changed itself. */
const signature = (b: Component) => {
  const { body: _body, ...own } = b as Component & { body?: unknown };
  return JSON.stringify(own);
};


/** What changed in a fields block or a summary - the labels of the entries. */
function detailOf(before: Component, after: Component): string | undefined {
  const entries = (b: Component) =>
    b.type === 'fields' ? b.fields.map((f) => f.label) : b.type === 'summary' ? b.items.map((i) => i.label)
      : b.type === 'choice' ? b.options.map((o) => o.label) : null;
  const was = entries(before);
  const now = entries(after);
  if (!was || !now) return undefined;
  const added = now.filter((l) => !was.includes(l));
  const removed = was.filter((l) => !now.includes(l));
  const parts = [...added.map((l) => `«${l}» neu`), ...removed.map((l) => `«${l}» entfernt`)];
  return parts.length ? parts.join(', ') : undefined;
}

const PAGE_PROPS: { prop: keyof Page; label: string }[] = [
  { prop: 'title', label: 'Titel' }, { prop: 'path', label: 'Pfad' }, { prop: 'access', label: 'Zugang' },
  { prop: 'state', label: 'Anfangszustand' }, { prop: 'load', label: 'Aktionen beim Laden' },
];

export function pageDiff(before: Page, after: Page): PageChange[] {
  const props: PageChange[] = PAGE_PROPS
    .filter(({ prop }) => JSON.stringify(before[prop] ?? null) !== JSON.stringify(after[prop] ?? null))
    .map(({ prop, label }) => ({
      kind: 'page', label,
      ...(typeof after[prop] === 'string' || typeof before[prop] === 'string' ? { detail: `«${String(before[prop] ?? '')}» → «${String(after[prop] ?? '')}»` } : {}),
    }));

  const flat = (p: Page): Flat[] => flatten(p.body).map(({ key, block }) => ({ key, block, sig: signature(block) }));
  const a = flat(before);
  const b = flat(after);
  const common = lcs(a.map((x) => x.sig), b.map((x) => x.sig));
  const keptA = new Set(common.map(([i]) => i));
  const keptB = new Set(common.map(([, j]) => j));
  const restA = a.filter((_, i) => !keptA.has(i));
  const restB = b.filter((_, j) => !keptB.has(j));

  // pair the rest: the same content elsewhere has moved, the same type at the same key has changed
  const paired = restB.reduce<{ changes: PageChange[]; left: Flat[] }>((acc, x) => {
    const same = acc.left.find((y) => y.sig === x.sig);
    if (same) return { changes: [...acc.changes, { kind: 'moved', key: x.key, label: blockName(x.block), detail: `von ${same.key}` }], left: acc.left.filter((y) => y !== same) };
    // the same type with the same title (keys shift when something is inserted before), else at the same key
    const was = acc.left.find((y) => y.block.type === x.block.type && titleOf(y.block) === titleOf(x.block))
      ?? acc.left.find((y) => y.key === x.key && y.block.type === x.block.type)
      // the only one of its type that is left - a button with a new label after an insert before it
      ?? (acc.left.filter((y) => y.block.type === x.block.type).length === 1 && restB.filter((z) => z.block.type === x.block.type).length === 1
        ? acc.left.find((y) => y.block.type === x.block.type) : undefined);
    if (was) {
      const detail = detailOf(was.block, x.block);
      return { changes: [...acc.changes, { kind: 'changed', key: x.key, label: blockName(x.block), ...(detail ? { detail } : {}) }], left: acc.left.filter((y) => y !== was) };
    }
    return { changes: [...acc.changes, { kind: 'added', key: x.key, label: blockName(x.block) }], left: acc.left };
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
  return [...changed, ...[...a.values()].filter((s) => !b.has(s.id)).map((s): ProcessChange => ({ kind: 'removed', id: s.id, label: name(s) }))];
}
