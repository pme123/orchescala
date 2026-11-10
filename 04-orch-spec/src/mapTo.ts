// «umwandeln in» of an output row (service orchestration) - what the panel needs without React.
import type { Mapping } from './types';

/** Does the change take the type away (✕)? Only then «umwandeln in» closes - not for a case. */
export const clearsMapTo = (patch: Partial<Mapping>): boolean => 'mapTo' in patch && !patch.mapTo;
