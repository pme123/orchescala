// The differences between a page and its draft - what the RE sees before accepting - and between a
// process and its draft. The pages come from orch-spec-core (Scala, shared with the platform server).
import { blockName } from '../pages/designer/model';
import { pageDiff, type PageChange } from '../core/core';
import { allSteps } from '../bpmn';
import type { ProcessSpec, Step, TypeDef } from '../types';

export { blockName, pageDiff, type PageChange };

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
