// Die Bezeichnungen der Engines - ohne Laufzeit-Imports, damit jedes Modul sie nutzen kann (auch die
// Parser). c7 ist das BPMN von Camunda 7: Operaton führt es unverändert aus.
import type { EngineId } from './types';

export const C7_LABEL = 'Camunda 7 / Operaton';
export const C8_LABEL = 'Camunda 8';

/** Die Bezeichnung einer Engine - ohne Angabe die Vorgabe c7. */
export const engineLabel = (id: EngineId | undefined): string => (id === 'c8' ? C8_LABEL : C7_LABEL);
