// Die Bezeichnungen der Engines - ohne Laufzeit-Imports, damit jedes Modul sie nutzen kann (auch die
// Parser). c7 ist das BPMN von Camunda 7: Operaton führt es unverändert aus.
import type { EngineId } from './types';

/** Die Engine einer Spezifikation ohne Angabe. */
export const DEFAULT_ENGINE: EngineId = 'c7';

export const C7_LABEL = 'Camunda 7 / Operaton';
export const C8_LABEL = 'Camunda 8';

// je Engine eine Bezeichnung - eine neue EngineId ohne Eintrag übersetzt nicht
const LABELS: Record<EngineId, string> = { c7: C7_LABEL, c8: C8_LABEL };

/** Die Bezeichnung einer Engine - ohne Angabe (auch `null` aus einer Datei) die Vorgabe c7; ein
  * unbekannter Wert (eine Datei von Hand) bleibt sichtbar, statt als c7 zu erscheinen. */
export const engineLabel = (id: EngineId | undefined): string =>
  Object.hasOwn(LABELS, id ?? DEFAULT_ENGINE) ? LABELS[id ?? DEFAULT_ENGINE] : String(id);

/** Der Vermerk einer Umwandlung im Änderungsprotokoll - er bleibt dort stehen. */
export const conversionNote = (target: EngineId): string => `In ${engineLabel(target)} umgewandelt`;
