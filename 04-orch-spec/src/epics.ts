// Epics: a bracket over several processes, e.g. a change.
//
// The definitions live in the `model.json` (only admins write there),
// the process only carries their IDs. If an ID is missing in the model (deleted), it is
// not shown — the specifications stay untouched, an epic created again
// with the same ID shows up there again.
import type { EpicDef, Model, ProcessSpec } from './types.ts';
import { slugify } from './util.ts';

/** The epics of a process — in the order of the model, unknown IDs are dropped. */
export function epicsOf(spec: Pick<ProcessSpec, 'epics'>, model: Model | null): EpicDef[] {
  const ids = new Set(spec.epics ?? []);
  return ids.size ? (model?.epics ?? []).filter(e => ids.has(e.id)) : [];
}

/** A free ID from the name: `Change XY` → `change-xy`, otherwise `change-xy-2` … */
export function newEpicId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(name) || 'epic';
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}

/** Assign or remove — the list stays without duplicates, empty means `undefined`. */
export function toggleEpic(spec: ProcessSpec, id: string, on: boolean): ProcessSpec {
  const cur = spec.epics ?? [];
  const next = on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter(x => x !== id);
  return { ...spec, epics: next.length ? next : undefined };
}
