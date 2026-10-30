// Existing collections — the services a project already has.
//
// The service catalog knows them by their topic, `<project>-<api>V<n>.<Name>`
// (`acme-crm-clientV1.GetClient`). A collection is what one OpenAPI offers — in
// the catalog that is a project with its APIs (`client.v1`, `crm.v2`, …); the
// user takes all of them or some. The domain catalog has the `In` and `Out` of
// each service with the real Scala types; without it, the names of the catalog
// entry (as `String`).
//
// The request comes from the ServiceTask as far as the domain says it: method
// and path (`val path = "GET: /clients/{clientKey}"`, the placeholders become
// path parameters) and the bodies (`type ServiceIn` / `type ServiceOut`). Query,
// headers and the mappings of the body are not in the domain — an OpenAPI read
// in afterwards completes the service (same name or same method and path)
// instead of adding a second one. Without `val path` (an older catalog) the
// service has no path yet.
//
// The types of the API (`…crm.v2.schema.ProductGroup`) become types of the
// collection, as the BPMN import does it for a process. A start all paths share up
// to a placeholder no `In` has (`/banks/{bankNumber}`) is the base the company puts
// into `serviceBasePath` — no parameter of the services.
import { resolveType } from '../interactions';
import { Converter } from '../projectImport';
import { isCompoundType, typeShape, type TypeShape } from '../scalaTypes';
import { domainRef, objectOf } from '../serviceTypes';
import { SCALA_TYPES, type DomainType, type Field, type Model, type ServiceDef, type TypeDef } from '../types';
import { uid } from '../util';
import { apiOf, apisOf, basePathParams, collectionPackage, newCollection, sameApi, serviceTopic, suggestPathBase, type ApiRef } from './collection';
import { camelName } from './openApiRest';
import { HTTP_METHODS, type BodyRef, type CollectionService, type HttpMethod, type RequestParam, type ServiceCollectionSpec } from './types';

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

/**
 * A worker of the project that wraps no REST call (`UpdateClientsClientKey` — a GET and a
 * PUT in a CustomTask): the domain knows its object, but it has no `ServiceIn` / `ServiceOut`.
 * Without a domain — or one that names no request at all — everything counts as a service.
 */
function isCustomWorker(s: ServiceDef, model: Model | null, knowsRequests: boolean): boolean {
  const inDom = domainMember(s, 'In', model) ?? domainMember(s, 'Out', model);
  if (!inDom) return false;
  if (inDom.dsl) return inDom.dsl !== 'ServiceTask';
  return knowsRequests && !inDom.ownerPath && !domainMember(s, 'ServiceIn', model) && !domainMember(s, 'ServiceOut', model);
}

/** The projects of the catalog with their APIs — the service workers grouped by their topic. */
export function catalogProjects(model: Model | null): CatalogProject[] {
  const projects = new Map<string, CatalogProject>();
  const knowsRequests = (model?.domainTypes ?? []).some(t => t.ownerPath || /\.Service(In|Out)$/.test(t.name));
  for (const s of model?.services ?? []) {
    if (s.kind && s.kind !== 'service') continue;
    if (isCustomWorker(s, model, knowsRequests)) continue;
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

/** In or Out of a catalog service without a domain: the names of the catalog entry (as `String`). */
function memberFromEntry(svc: ServiceDef, which: 'In' | 'Out', serviceId: string): TypeDef {
  const params = (which === 'In' ? svc.inputs : svc.outputs) ?? [];
  const fields: Field[] = params.map(p => ({
    id: uid('f'), name: p.name, type: 'String',
    ...(p.required ? {} : { optional: true }),
    ...(p.description ? { description: p.description } : {}),
  }));
  return { id: uid('t'), name: which, kind: 'case', status: 'implemented', interactionId: serviceId, fields };
}

/** The domain type of a member of the service object — `GetClient.In`, `GetClient.ServiceOut`. */
function domainMember(svc: ServiceDef, which: string, model: Model | null): DomainType | undefined {
  const { object, pkg } = objectOf(svc.id, model);
  return (model?.domainTypes ?? []).find(t => t.id === `${pkg}.${object}.${which}`);
}

/** `ProductGroups` with `type ProductGroups = Seq[ProductGroup]` → `Seq[ProductGroup]` (the shape across aliases). */
function unalias(expr: string, pkg: string, model: Model | null): TypeShape {
  let shape = typeShape(expr);
  for (let depth = 0; depth < 5; depth++) {
    if ((SCALA_TYPES as readonly string[]).includes(shape.base)) break;
    const alias = resolveType(shape.base, model, pkg);
    if (alias?.kind !== 'alias' || !alias.target || isCompoundType(alias.target)) break;
    const inner = typeShape(alias.target);
    shape = { ...inner, collection: shape.collection || inner.collection, optional: shape.optional || inner.optional };
    pkg = alias.pkg;
  }
  return shape;
}

/**
 * `type ServiceOut = Seq[PaymentRule]` → the body; `NoInput` / `NoOutput` → none. A type of
 * the API becomes a type of the collection (see `servicesOf`), others point into the catalog.
 */
function bodyOf(t: DomainType | undefined, model: Model | null, conv: Converter): BodyRef | undefined {
  if (!t) return undefined;
  if (t.kind !== 'alias') return { type: domainRef(t.id) };
  const shape = unalias(t.target ?? '', t.pkg, model);
  if (!shape.base || /^No(Input|Output)$/.test(shape.base)) return undefined;
  return {
    type: conv.fieldType(shape.base, t.pkg, 0, t.owner, t.imports).type,
    ...(shape.collection ? { collection: true } : {}),
    ...(shape.optional ? { optional: true } : {}),
  };
}

/** `GET: clients/{clientKey}` → method and path (always with a leading `/`). */
export function parseServicePath(raw: string | undefined): { method: HttpMethod; path: string } | null {
  const m = /^\s*([A-Za-z]+)\s*:\s*(\S*)\s*$/.exec(raw ?? '');
  const method = m?.[1].toUpperCase() as HttpMethod | undefined;
  if (!m || !method || !(HTTP_METHODS as readonly string[]).includes(method)) return null;
  return { method, path: m[2].startsWith('/') ? m[2] : `/${m[2]}` };
}

/**
 * The services of an API with their types. What lives in the package of the API
 * (`…crm.v2.schema.ProductGroup`) becomes a type of the collection — as in the project;
 * types of other packages point into the catalog.
 */
function servicesOf(api: CatalogApi, model: Model | null): { services: CollectionService[]; types: TypeDef[] } {
  const conv = new Converter(model?.domainTypes ?? [], collectionPackage(api), model);
  const extra: TypeDef[] = [];
  const services: CollectionService[] = [];
  const memberOf = (svc: ServiceDef, which: 'In' | 'Out', serviceId: string): TypeDef => {
    const dom = domainMember(svc, which, model);
    if (!dom?.fields?.length) {
      const t = memberFromEntry(svc, which, serviceId);
      extra.push(t);
      return t;
    }
    const id = conv.convert(dom, { interactionId: serviceId }, which);
    const t = conv.types.find(x => x.id === id)!;
    // In and Out live in the service object — not a class of their own in the domain
    delete t.domainId;
    return t;
  };
  for (const svc of api.services) {
    const name = TOPIC.exec(svc.topic ?? svc.id)![4];
    const id = uid('svc');
    const inType = memberOf(svc, 'In', id);
    const outType = memberOf(svc, 'Out', id);
    // the request as far as the ServiceTask says it: method, path, its placeholders, the bodies
    const inDom = domainMember(svc, 'In', model);
    const request = parseServicePath(inDom?.ownerPath);
    const params: RequestParam[] = request
      ? [...request.path.matchAll(/\{([^}]+)\}/g)].map(m => {
          const field = (inType.fields ?? []).find(f => f.name === camelName(m[1]) || f.name === m[1]);
          return { name: m[1], in: 'path' as const, type: field?.type ?? 'String', required: true, expression: field ? `= ${field.name}` : '' };
        })
      : [];
    const serviceIn = bodyOf(domainMember(svc, 'ServiceIn', model), model, conv);
    const serviceOut = bodyOf(domainMember(svc, 'ServiceOut', model), model, conv);
    services.push({
      id, name, api: api.api, apiVersion: api.apiVersion, status: 'implemented',
      ...(svc.description ? { description: svc.description } : {}),
      method: request?.method ?? 'GET', path: request?.path ?? '', params,
      ...(serviceIn ? { serviceIn } : {}),
      ...(serviceOut ? { serviceOut } : {}),
      ...(request ? { fromCatalog: true } : {}),
      inTypeId: inType.id, outTypeId: outType.id,
    });
  }
  return { services, types: [...conv.types, ...extra] };
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
  const spec: ServiceCollectionSpec = {
    ...c, status: 'implemented',
    types: parts.flatMap(p => p.types),
    services: parts.flatMap(p => p.services),
    ...(project.group ? { source: { title: project.group } } : {}),
  };
  // the start the company puts into serviceBasePath (`/banks/{bankNumber}`): its
  // placeholders are no parameters of the services
  const pathBase = suggestPathBase(spec);
  if (!pathBase) return spec;
  const withBase = { ...spec, pathBase };
  return {
    ...withBase,
    services: withBase.services.map(s => {
      const fromBase = basePathParams(withBase, s);
      return { ...s, params: s.params.filter(p => !(p.in === 'path' && fromBase.has(p.name))) };
    }),
  };
}

/** Where a service of the catalog is described already: topic → title of the collection. */
export function describedTopics(collections: ServiceCollectionSpec[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of collections) for (const s of c.services) out.set(serviceTopic(apiOf(c, s), s), c.title || c.slug);
  return out;
}

// ── Abgleich: a collection against the catalog ─────────────────────────────

export interface CatalogSync {
  spec: ServiceCollectionSpec;
  /** new services of its APIs */
  added: string[];
  /** services whose request, In/Out or types changed */
  updated: string[];
  /** workers that are no REST service (a CustomTask) — taken over by an older import */
  removed: string[];
  /** types of the API new in the collection */
  addedTypes: string[];
}

const fieldTypes = (t: TypeDef, map: (type: string) => string): TypeDef => ({
  ...t,
  ...(t.fields ? { fields: t.fields.map(f => ({ ...f, type: map(f.type) })) } : {}),
  ...(t.values ? { values: t.values.map(v => (v.fields ? { ...v, fields: v.fields.map(f => ({ ...f, type: map(f.type) })) } : v)) } : {}),
});

/**
 * Compare a collection with the catalog of its project — without starting anew. What the
 * domain knows wins (request, bodies, the fields of In and Out, the types of the API); what
 * only the collection has stays: its mappings, further In/Out fields, query and headers of
 * an OpenAPI, status and description. Services of its APIs the collection lacks are added,
 * custom workers an older import took over are removed. `null`: the catalog does not know the project.
 */
export function syncWithCatalog(c: ServiceCollectionSpec, model: Model | null): CatalogSync | null {
  const project = catalogProjects(model).find(p => p.project === c.project);
  if (!project) return null;
  const apis = project.apis.filter(a => apisOf(c).some(x => sameApi(x, a)));
  if (!apis.length) return null;
  const fresh = collectionFromCatalog(project, apis, model, c.title);
  const keyOf = (s: CollectionService) => serviceTopic(apiOf(c, s), s);
  const freshByKey = new Map(fresh.services.map(s => [keyOf(s), s]));
  const known = new Set((model?.services ?? []).map(s => s.topic ?? s.id));
  const pathBase = c.pathBase ?? fresh.pathBase;

  // fresh type id → the id it has in the collection (In/Out of a service, a type of the same domain class or name)
  const ids = new Map<string, string>();
  for (const s of c.services) {
    const f = freshByKey.get(keyOf(s));
    if (!f) continue;
    if (f.inTypeId && s.inTypeId) ids.set(f.inTypeId, s.inTypeId);
    if (f.outTypeId && s.outTypeId) ids.set(f.outTypeId, s.outTypeId);
  }
  const own = c.types.filter(t => !t.interactionId);
  for (const t of fresh.types.filter(x => !x.interactionId)) {
    const hit = own.find(x => t.domainId && x.domainId === t.domainId) ?? own.find(x => !x.domainId && x.name === t.name);
    if (hit) ids.set(t.id, hit.id);
  }
  const byDomain = new Map<string, string>();
  for (const t of fresh.types) if (t.domainId) byDomain.set(t.domainId, ids.get(t.id) ?? t.id);
  // a fresh id to the collection's; a reference into the catalog to the type the collection has now
  const mapType = (type: string): string => {
    const dom = type.startsWith('dom:') ? byDomain.get(type.slice(4)) : undefined;
    return ids.get(type) ?? dom ?? type;
  };
  const mapBody = (b: BodyRef | undefined) => (b ? { ...b, type: mapType(b.type) } : b);

  const removed: string[] = [];
  const updated: string[] = [];
  const types = new Map(c.types.map(t => [t.id, fieldTypes(t, mapType)]));
  const services: CollectionService[] = [];
  for (const s of c.services) {
    const f = freshByKey.get(keyOf(s));
    if (!f) {
      // the catalog knows it, but not as a service: a custom worker — otherwise the collection's own one
      if (known.has(keyOf(s)) && !s.operationId) { removed.push(s.name); for (const id of [s.inTypeId, s.outTypeId]) if (id) types.delete(id); continue; }
      services.push(s);
      continue;
    }
    const before = JSON.stringify([s, types.get(s.inTypeId ?? ''), types.get(s.outTypeId ?? '')]);
    // In and Out: the fields of the domain, then those only the collection has
    for (const [mine, theirs] of [[s.inTypeId, f.inTypeId], [s.outTypeId, f.outTypeId]] as const) {
      const cur = mine ? types.get(mine) : undefined;
      const dom = fresh.types.find(t => t.id === theirs);
      if (!cur || !dom) continue;
      const domFields = (dom.fields ?? []).map(df => {
        const old = cur.fields?.find(x => x.name === df.name);
        return { ...df, ...(old ? { id: old.id } : {}), type: mapType(df.type) };
      });
      const extra = (cur.fields ?? []).filter(x => !domFields.some(d => d.name === x.name));
      types.set(cur.id, { ...cur, fields: [...domFields, ...extra] });
    }
    // the request: path parameters from the domain (with the value the collection gave), query and headers stay
    const params = f.path
      ? [
          ...f.params.map(p => {
            const old = s.params.find(x => x.in === p.in && x.name === p.name);
            return { ...p, type: mapType(p.type), ...(old?.expression.trim() ? { expression: old.expression } : {}) };
          }),
          ...s.params.filter(p => p.in !== 'path'),
        ]
      : s.params;
    const next: CollectionService = {
      ...s,
      ...(f.path ? { method: f.method, path: f.path } : {}),
      params,
      ...(f.serviceIn ? { serviceIn: mapBody(f.serviceIn) } : {}),
      ...(f.serviceOut ? { serviceOut: mapBody(f.serviceOut) } : {}),
      ...(!s.description && f.description ? { description: f.description } : {}),
    };
    // still to complete by an OpenAPI — unless one did it already
    if (!f.path || s.operationId || (s.path && !s.fromCatalog)) delete next.fromCatalog;
    else next.fromCatalog = true;
    if (!f.serviceIn && s.fromCatalog) delete next.serviceIn;
    services.push(next);
    if (JSON.stringify([next, types.get(next.inTypeId ?? ''), types.get(next.outTypeId ?? '')]) !== before) updated.push(s.name);
  }
  // new services of the APIs
  const have = new Set(c.services.map(keyOf));
  const added = fresh.services.filter(f => !have.has(keyOf(f)));
  for (const f of added) {
    services.push({ ...f, params: f.params.map(p => ({ ...p, type: mapType(p.type) })), serviceIn: mapBody(f.serviceIn), serviceOut: mapBody(f.serviceOut) });
    for (const id of [f.inTypeId, f.outTypeId]) {
      const t = fresh.types.find(x => x.id === id);
      if (t) types.set(t.id, fieldTypes(t, mapType));
    }
  }
  // the types of the API: the domain's version, under the id the collection gives it
  const addedTypes: string[] = [];
  for (const t of fresh.types.filter(x => !x.interactionId)) {
    const id = ids.get(t.id) ?? t.id;
    const cur = types.get(id);
    if (!cur) addedTypes.push(t.name);
    types.set(id, { ...fieldTypes({ ...t, id }, mapType), ...(cur?.description && !t.description ? { description: cur.description } : {}) });
  }
  // the base the company sets: no parameter of a service
  const spec: ServiceCollectionSpec = { ...c, ...(pathBase ? { pathBase } : {}), services, types: [...types.values()] };
  spec.services = spec.services.map(s => {
    const fromBase = basePathParams(spec, s);
    return fromBase.size ? { ...s, params: s.params.filter(p => !(p.in === 'path' && fromBase.has(p.name))) } : s;
  });
  return { spec, added: added.map(s => s.name), updated, removed, addedTypes };
}
