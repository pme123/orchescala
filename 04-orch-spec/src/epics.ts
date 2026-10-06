// Epics: eine Klammer über mehrere Prozesse, z. B. ein Change.
//
// Die Definitionen liegen in der `model.json` (nur Admins schreiben dort),
// der Prozess trägt nur ihre IDs. Fehlt eine ID im Modell (gelöscht), wird
// sie nicht gezeigt — die Spezifikationen bleiben unberührt, ein erneut
// angelegtes Epic mit derselben ID taucht dort wieder auf.
import type { EpicDef, Model, ProcessSpec } from './types.ts';
import { slugify } from './util.ts';

/** Die Epics eines Prozesses — in der Reihenfolge des Modells, unbekannte IDs fallen weg. */
export function epicsOf(spec: Pick<ProcessSpec, 'epics'>, model: Model | null): EpicDef[] {
  const ids = new Set(spec.epics ?? []);
  return ids.size ? (model?.epics ?? []).filter(e => ids.has(e.id)) : [];
}

/** Eine freie ID aus dem Namen: `Change XY` → `change-xy`, sonst `change-xy-2` … */
export function newEpicId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(name) || 'epic';
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}

/** Zuordnen oder entfernen — die Liste bleibt ohne Doppel, leer heisst `undefined`. */
export function toggleEpic(spec: ProcessSpec, id: string, on: boolean): ProcessSpec {
  const cur = spec.epics ?? [];
  const next = on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter(x => x !== id);
  return { ...spec, epics: next.length ? next : undefined };
}
