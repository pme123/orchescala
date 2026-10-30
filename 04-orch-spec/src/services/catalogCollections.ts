// Existing collections — the services a project already has.
//
// The service catalog knows them by their topic, `<project>-<api>V<n>.<Name>`
// (`acme-crm-clientV1.GetClient`). A collection is what one OpenAPI offers — in
// the catalog that is a project with its APIs (`client.v1`, `crm.v2`, …); the
// user takes all of them or some. The domain catalog has the `In` and `Out` of
// each service with the real Scala types; without it, the names of the catalog
// entry (as `String`).
//
// What the catalog does not know is the request: method, path, parameters,
// body. A service from the catalog therefore has no path yet — an OpenAPI
// read in afterwards completes it (same name) instead of adding a second one.
import { fieldFromScala } from '../interactions';
import { objectOf } from '../serviceTypes';
import type { Field, Model, ServiceDef, TypeDef } from '../types';
import { uid } from '../util';
import { apiOf, newCollection, serviceTopic, type ApiRef } from './collection';
import type { CollectionService, ServiceCollectionSpec } from './types';

const TOPIC = /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+)-([a-z][A-Za-z0-9]*)V(\d+)\.([A-Z][A-Za-z0-9]*)$/;

export interface CatalogApi extends ApiRef {
  /** `acme-crm-clientV1` */
  prefix: string;
  services: ServiceDef[];
}

export interface CatalogProject {
  project: string;
  /** the group of the catalog entries, e.g. «Acme CRM» */
  group?: string;
  apis: CatalogApi[];
}

/** The projects of the catalog with their APIs — the service workers grouped by their topic. */
export function catalogProjects(model: Model | null): CatalogProject[] {
  const projects = new Map<string, CatalogProject>();
  for (const s of model?.services ?? []) {
    if (s.kind && s.kind !== 'service') continue;
    const m = TOPIC.exec(s.topic ?? s.id);
    if (!m) continue;
    const [, project, api, version] = m;
    const p = projects.get(project) ?? { project, ...(s.group ? { group: s.group } : {}), apis: [] };
    const prefix = `${project}-${api}V${version}`;
    let a = p.apis.find(x => x.prefix === prefix);
    if (!a) { a = { prefix, project, api, apiVersion: Number(version), services: [] }; p.apis.push(a); }
    if (!a.services.some(x => x.id === s.id)) a.services.push(s);
    projects.set(project, p);
  }
  for (const p of projects.values()) {
    p.apis.sort((a, b) => a.prefix.localeCompare(b.prefix));
    // the name of the project: the group most of its entries carry
    const count = new Map<string, number>();
    for (const s of p.apis.flatMap(a => a.services)) if (s.group) count.set(s.group, (count.get(s.group) ?? 0) + 1);
    const group = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (group) p.group = group;
  }
  return [...projects.values()].sort((a, b) => a.project.localeCompare(b.project));
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

function servicesOf(api: CatalogApi, model: Model | null): { services: CollectionService[]; types: TypeDef[] } {
  const types: TypeDef[] = [];
  const services: CollectionService[] = [];
  for (const svc of api.services) {
    const name = TOPIC.exec(svc.topic ?? svc.id)![4];
    const id = uid('svc');
    const inType = member(svc, 'In', model, id);
    const outType = member(svc, 'Out', model, id);
    types.push(inType, outType);
    services.push({
      id, name, api: api.api, apiVersion: api.apiVersion, status: 'implemented',
      ...(svc.description ? { description: svc.description } : {}),
      method: 'GET', path: '', params: [],
      inTypeId: inType.id, outTypeId: outType.id,
    });
  }
  return { services, types };
}

const capitalize = (s: string) => s.replace(/^(.)/, c => c.toUpperCase());

/**
 * The name of a collection from a project: the project for all its APIs, otherwise
 * the project and the chosen APIs — «Acme CRM PaymentRule», «Acme CRM Client + Crm».
 * The version only where the project has the same API in two versions.
 */
export function catalogTitle(project: CatalogProject, apis: CatalogApi[]): string {
  const base = project.group || project.project;
  if (!apis.length || apis.length === project.apis.length) return base;
  const name = (a: CatalogApi) =>
    `${capitalize(a.api)}${project.apis.filter(x => x.api === a.api).length > 1 ? ` V${a.apiVersion}` : ''}`;
  return `${base} ${apis.map(name).join(' + ')}`;
}

/** A collection from the chosen APIs of a project — its services exist, so they are «Umgesetzt». */
export function collectionFromCatalog(project: CatalogProject, apis: CatalogApi[], model: Model | null, title?: string): ServiceCollectionSpec {
  const first = apis[0] ?? project.apis[0];
  const c = newCollection({ title: title?.trim() || catalogTitle(project, apis), project: project.project, api: first.api, apiVersion: first.apiVersion });
  const parts = apis.map(a => servicesOf(a, model));
  return {
    ...c, status: 'implemented',
    types: parts.flatMap(p => p.types),
    services: parts.flatMap(p => p.services),
    ...(project.group ? { source: { title: project.group } } : {}),
  };
}

/** Where a service of the catalog is described already: topic → title of the collection. */
export function describedTopics(collections: ServiceCollectionSpec[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of collections) for (const s of c.services) out.set(serviceTopic(apiOf(c, s), s), c.title || c.slug);
  return out;
}
