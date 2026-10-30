// Existing collections — the services a project already has.
//
// The service catalog knows them by their topic, `<project>-<api>V<n>.<Name>`
// (`acme-crm-clientV1.GetClient`): grouped by everything before the dot, they
// are the APIs. The domain catalog has their `In` and `Out` with the real
// Scala types; without it, the names of the catalog entry (as `String`).
//
// What the catalog does not know is the request: method, path, parameters,
// body. A service from the catalog therefore has no path yet — an OpenAPI
// read in afterwards completes it (same name) instead of adding a second one.
import { fieldFromScala } from '../interactions';
import { objectOf } from '../serviceTypes';
import type { Field, Model, ServiceDef, TypeDef } from '../types';
import { uid } from '../util';
import { collectionSlug, newCollection } from './collection';
import type { CollectionService, ServiceCollectionSpec } from './types';

const TOPIC = /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+)-([a-z][A-Za-z0-9]*)V(\d+)\.([A-Z][A-Za-z0-9]*)$/;

export interface CatalogApi {
  /** `acme-crm-clientV1` */
  prefix: string;
  project: string;
  api: string;
  apiVersion: number;
  /** the group of the catalog entries, e.g. «Acme CRM» */
  group?: string;
  services: ServiceDef[];
}

/** The APIs of the catalog — the service workers grouped by the prefix of their topic. */
export function catalogApis(model: Model | null): CatalogApi[] {
  const byPrefix = new Map<string, CatalogApi>();
  for (const s of model?.services ?? []) {
    if (s.kind && s.kind !== 'service') continue;
    const m = TOPIC.exec(s.topic ?? s.id);
    if (!m) continue;
    const [, project, api, version] = m;
    const prefix = `${project}-${api}V${version}`;
    const entry = byPrefix.get(prefix) ?? { prefix, project, api, apiVersion: Number(version), ...(s.group ? { group: s.group } : {}), services: [] };
    if (!entry.services.some(x => x.id === s.id)) entry.services.push(s);
    byPrefix.set(prefix, entry);
  }
  return [...byPrefix.values()].sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/** In or Out of a catalog service: from the domain catalog, otherwise the names of the entry. */
function member(svc: ServiceDef, which: 'In' | 'Out', model: Model | null, serviceId: string): TypeDef {
  const { object, pkg } = objectOf(svc.id, model);
  const dom = (model?.domainTypes ?? []).find(t => t.id === `${pkg}.${object}.${which}`);
  const params = (which === 'In' ? svc.inputs : svc.outputs) ?? [];
  const fields: Field[] = dom?.fields?.length
    ? dom.fields.map(f => fieldFromScala(f, model, dom.pkg))
    : params.map(p => ({
        id: uid('f'), name: p.name, type: 'String',
        ...(p.required ? {} : { optional: true }),
        ...(p.description ? { description: p.description } : {}),
      }));
  return { id: uid('t'), name: which, kind: 'case', status: 'implemented', interactionId: serviceId, fields };
}

/** A collection from an API of the catalog — its services exist, so they are «Umgesetzt». */
export function collectionFromCatalog(api: CatalogApi, model: Model | null, title?: string): ServiceCollectionSpec {
  const c = newCollection({ title: title || api.group || api.prefix, project: api.project, api: api.api, apiVersion: api.apiVersion });
  const types: TypeDef[] = [];
  const services: CollectionService[] = [];
  for (const svc of api.services) {
    const name = TOPIC.exec(svc.topic ?? svc.id)![4];
    const id = uid('svc');
    const inType = member(svc, 'In', model, id);
    const outType = member(svc, 'Out', model, id);
    types.push(inType, outType);
    services.push({
      id, name, status: 'implemented',
      ...(svc.description ? { description: svc.description } : {}),
      method: 'GET', path: '', params: [],
      inTypeId: inType.id, outTypeId: outType.id,
    });
  }
  return { ...c, status: 'implemented', types, services, source: { title: api.group } };
}

/** Is there already a collection for this API? */
export const collectionOf = (api: CatalogApi, slugs: string[]): boolean =>
  slugs.includes(collectionSlug(api));
