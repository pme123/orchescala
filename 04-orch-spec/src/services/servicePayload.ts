// What the helper gets for services - the same in the app (the export of a collection or an
// orchestration) and in the export of a whole spec folder (specExport.ts, tools/spec2export.ts).
// No React here: it runs in Node too.
import type { Model } from '../types';
import { withServiceApis } from './collection.ts';
import { collectionBundle } from './scalaCollection.ts';
import { orchestrationBundle } from './scalaOrchestration.ts';
import { isCollection, type ServiceSpec } from './types.ts';

/** The folder of the services in the spec folder - `services/<slug>.json`. */
export const SERVICES_DIR = 'services';

/** Older collections have the API only on the collection - an orchestration stays as it is. */
export const migrateService = (s: ServiceSpec): ServiceSpec => (isCollection(s) ? withServiceApis(s) : s);

/**
 * «Process from Spec» of services (version 2, so that an older helper refuses it instead of
 * taking the services for a process). An orchestration calls the services of the collections
 * in `all`.
 */
export interface ServicePayload { v: 2; kind: ServiceSpec['kind']; scala: string }

export function servicePayload(s: ServiceSpec, all: ServiceSpec[], model: Model | null): ServicePayload {
  return {
    v: 2,
    kind: s.kind,
    scala: isCollection(s) ? collectionBundle(s, model) : orchestrationBundle(s, all, model),
  };
}
