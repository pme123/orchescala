// The labels of the engines - without runtime imports, so that any module can use them (even the
// parsers). c7 is the BPMN of Camunda 7: Operaton runs it unchanged.
import type { EngineId } from './types';

/** The engine of a specification without one given. */
export const DEFAULT_ENGINE: EngineId = 'c7';

export const C7_LABEL = 'Camunda 7 / Operaton';
export const C8_LABEL = 'Camunda 8';

// one label per engine - a new EngineId without an entry does not compile
const LABELS: Record<EngineId, string> = { c7: C7_LABEL, c8: C8_LABEL };

/** The label of an engine - if not given (also `null` from a file) the default c7; an
  * unknown value (a hand-edited file) stays visible instead of appearing as c7. */
export function engineLabel(id: EngineId | null | undefined): string {
  const key = id ?? DEFAULT_ENGINE;
  return Object.hasOwn(LABELS, key) ? LABELS[key] : String(key);
}

/** The note of a conversion in the change log - it stays there. */
export const conversionNote = (target: EngineId): string => `In ${engineLabel(target)} umgewandelt`;
