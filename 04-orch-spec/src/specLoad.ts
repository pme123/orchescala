// What happens to a file of the spec folder when it is loaded - the same in the app (store.tsx)
// and in the tools that read a spec folder in Node (spec2export, spec2diff). No React here.
import type { Model, ProcessSpec, Step } from './types.ts';
import { healExecution } from './juelFeel.ts';
import { withoutWiringInteractions } from './interactions.ts';
import { DEFAULT_MODEL } from './defaultModel.ts';

/** The model.json as the app uses it - the defaults for what the file does not set. */
export function normalizeModel(raw: unknown): Model {
  const r = (raw ?? {}) as Partial<Model>;
  return { ...DEFAULT_MODEL, ...r, services: Array.isArray(r.services) ? r.services : [] };
}

/**
 * «Offene Frage» (`open`) and «Technische Notiz» (`notes`) on the step no longer
 * exist — that is what comments are for —, likewise the «Quelle» (`sourceUrl`)
 * on the process, and prepared interactions on pattern steps. Old entries
 * are dropped on load and disappear from the file with the next save.
 */
export function withoutRetiredFields(spec: ProcessSpec): ProcessSpec {
  // `= execution.x` from an older import: FEEL where possible, otherwise back to JUEL
  const heal = (ms: Step['inputs']) => ms?.map(m => { const e = healExecution(m.expression); return e === m.expression ? m : { ...m, expression: e }; });
  const clean = (steps: Step[] | undefined): Step[] | undefined => steps?.map(s => {
    const { open: _o, notes: _n, ...rest } = s as Step & { open?: unknown; notes?: unknown };
    const next: Step = { ...rest };
    if (s.inputs) next.inputs = heal(s.inputs);
    if (s.outputs) next.outputs = heal(s.outputs);
    if (s.children) next.children = clean(s.children);
    if (s.branches) next.branches = s.branches.map(b => ({ ...b, steps: clean(b.steps) ?? [] }));
    if (s.errors) next.errors = s.errors.map(e => (e.steps ? { ...e, steps: clean(e.steps) } : e));
    return next;
  });
  const { sourceUrl: _s, ...rest } = spec as ProcessSpec & { sourceUrl?: unknown };
  // an interaction prepared earlier on a pattern step (see wiringSteps)
  return withoutWiringInteractions({ ...rest, steps: clean(spec.steps) ?? [] });
}
