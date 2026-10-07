// Der Status der Spezifikation wird nicht gesetzt — er ist der kleinste Status
// ihrer Teile (Reihenfolge STATUSES): die Schritte des Ablaufs und, was im
// Datenmodell einen Status trägt (Klassen, Interaktionen). Steht ein Schritt
// noch auf «Entwurf», ist die ganze Spezifikation ein Entwurf.
import { STATUSES, type ProcessSpec, type Status } from './types';
import { allSteps } from './bpmn';

const rank = (s: Status) => STATUSES.indexOf(s);

/** Der kleinste Status aller Teile — ohne Teile mit Status der zuletzt gespeicherte (sonst «Entwurf»). */
export function overallStatus(spec: Pick<ProcessSpec, 'steps' | 'types' | 'interactions' | 'status'>): Status {
  const all = [
    ...allSteps(spec.steps ?? []).filter(s => s.kind !== 'goto').map(s => s.status),
    ...(spec.types ?? []).map(t => t.status),
    ...(spec.interactions ?? []).map(i => i.status),
  ].filter((s): s is Status => !!s && rank(s) >= 0);
  if (!all.length) return spec.status ?? 'draft';
  return all.reduce((min, s) => (rank(s) < rank(min) ? s : min));
}
