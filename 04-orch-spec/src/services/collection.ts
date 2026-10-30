// Names of the services in Orchescala — all derived from project, API and
// version, the same way `deriveObject` (serviceTypes.ts) reads them back:
//
//   project acme-crm · api client · version 1
//     → package     acme.crm.domain.client.v1
//     → super trait ClientV1 (extends CompanyBpmnServiceTaskDsl)
//     → topics      acme-crm-clientV1.GetClient
//
// A collection has one project, its services may belong to several APIs
// (`client.v1`, `crm.v2`) — each service carries its own.
import { STATUSES, type Field, type Mapping, type ProcessSpec, type Status, type TypeDef } from '../types';
import { nowIsoWithTimezone, slugify } from '../util';
import type { CollectionService, ServiceCollectionSpec } from './types';

/** One API of a project — what package, trait and topics are derived from. */
export interface ApiRef { project: string; api: string; apiVersion: number }

/** The API of a service — its own, otherwise the default of the collection (older files). */
export const apiOf = (c: Pick<ServiceCollectionSpec, 'project' | 'api' | 'apiVersion'>, s: Partial<Pick<CollectionService, 'api' | 'apiVersion'>>): ApiRef =>
  ({ project: c.project, api: s.api || c.api, apiVersion: s.apiVersion || c.apiVersion });

/** The APIs of a collection, in the order of their first service — `client.v1`, `crm.v2`. */
export function apisOf(c: ServiceCollectionSpec): ApiRef[] {
  const out: ApiRef[] = [];
  for (const s of c.services) {
    const a = apiOf(c, s);
    if (!out.some(x => sameApi(x, a))) out.push(a);
  }
  return out;
}

export const sameApi = (a: Pick<ApiRef, 'api' | 'apiVersion'>, b: Pick<ApiRef, 'api' | 'apiVersion'>): boolean =>
  a.api === b.api && a.apiVersion === b.apiVersion;

/** `client v1, crm v2` */
export const apiList = (c: ServiceCollectionSpec): string => apisOf(c).map(a => `${a.api} v${a.apiVersion}`).join(', ');

/** Older files have the API only on the collection — every service gets it. */
export function withServiceApis(c: ServiceCollectionSpec): ServiceCollectionSpec {
  if (c.services.every(s => s.api && s.apiVersion)) return c;
  return { ...c, services: c.services.map(s => ({ ...s, api: s.api || c.api, apiVersion: s.apiVersion || c.apiVersion })) };
}

const capitalize = (s: string) => s.replace(/^(.)/, c => c.toUpperCase());

/** `acme.crm.domain.client.v1` */
export const collectionPackage = (c: Pick<ServiceCollectionSpec, 'project' | 'api' | 'apiVersion'>): string =>
  [...c.project.split('-').filter(Boolean), 'domain', c.api, `v${c.apiVersion}`].join('.');

/** `ClientV1` — the super trait of all services of the API */
export const collectionTrait = (c: Pick<ServiceCollectionSpec, 'api' | 'apiVersion'>): string =>
  `${capitalize(c.api)}V${c.apiVersion}`;

/** `acme-crm-clientV1` — the topics of the services start with it */
export const topicPrefix = (c: Pick<ServiceCollectionSpec, 'project' | 'api' | 'apiVersion'>): string =>
  `${c.project}-${c.api}V${c.apiVersion}`;

/** `acme-crm-clientV1.GetClient` — also the id in the service catalog */
export const serviceTopic = (c: Pick<ServiceCollectionSpec, 'project' | 'api' | 'apiVersion'>, s: Pick<CollectionService, 'name'>): string =>
  `${topicPrefix(c)}.${s.name}`;

/** Directory of the domain in the project: `01-domain/src/main/scala/acme/crm/domain/client/v1` */
export const domainDir = (c: Pick<ServiceCollectionSpec, 'project' | 'api' | 'apiVersion'>): string =>
  `01-domain/src/main/scala/${collectionPackage(c).replace(/\./g, '/')}`;

/** `acme.crm.worker.client.v1` — the workers live next to the domain, in 03-worker */
export const workerPackage = (c: Pick<ServiceCollectionSpec, 'project' | 'api' | 'apiVersion'>): string =>
  [...c.project.split('-').filter(Boolean), 'worker', c.api, `v${c.apiVersion}`].join('.');

export const workerDir = (c: Pick<ServiceCollectionSpec, 'project' | 'api' | 'apiVersion'>): string =>
  `03-worker/src/main/scala/${workerPackage(c).replace(/\./g, '/')}`;

/**
 * The file name in `services/` — the project, and the title if it says more
 * (`acme-crm`, `acme-crm-kunden`).
 */
export function collectionSlug(c: Pick<ServiceCollectionSpec, 'project' | 'title'>): string {
  const project = slugify(c.project);
  const title = slugify(c.title ?? '');
  return !title || title === project || title.startsWith(`${project}-`) ? title || project : `${project}-${title}`;
}

/** A valid Scala identifier for the API (`client`, `paymentRules`). */
export const API_NAME = /^[a-z][A-Za-z0-9]*$/;
/** `acme-crm` — lower case words joined by `-` */
export const PROJECT_NAME = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$/;

export function newCollection(input: { title: string; project: string; api: string; apiVersion: number; pathPrefix?: string; description?: string }): ServiceCollectionSpec {
  const now = nowIsoWithTimezone();
  return {
    kind: 'serviceCollection',
    version: 1,
    slug: collectionSlug(input),
    title: input.title,
    project: input.project,
    api: input.api,
    apiVersion: input.apiVersion,
    ...(input.pathPrefix?.trim() ? { pathPrefix: input.pathPrefix.trim() } : {}),
    status: 'draft',
    ...(input.description ? { description: input.description } : {}),
    createdAt: now,
    updatedAt: now,
    types: [],
    services: [],
  };
}

/** The lowest status of the services — like a process and its steps; without services the own one. */
export function collectionStatus(c: ServiceCollectionSpec): Status {
  if (!c.services.length) return c.status;
  return c.services.reduce<Status>((low, s) => (STATUSES.indexOf(s.status) < STATUSES.indexOf(low) ? s.status : low), 'accepted');
}

/** In and Out of a service. */
export function membersOf(c: ServiceCollectionSpec, s: CollectionService): { in?: TypeDef; out?: TypeDef } {
  return {
    in: c.types.find(t => t.id === s.inTypeId),
    out: c.types.find(t => t.id === s.outTypeId),
  };
}

/** Headers of the response an `Out` field of the same name takes over — as the projects do (`headers.etag`). */
const OUT_HEADERS = ['etag', 'location'];

const sameShape = (f: Pick<Field, 'type' | 'collection'>, g: Pick<Field, 'type' | 'collection'>) => f.type === g.type && !!f.collection === !!g.collection;

/**
 * The obvious mappings of the `outputMapper` — for the `Out` fields without one: `etag` from
 * the headers, the whole body where the field has its type, a body field of the same name,
 * otherwise an `In` field of the same name. With the headers the response needs for it.
 */
export function suggestOutMappings(c: Pick<ServiceCollectionSpec, 'types'>, s: CollectionService): { mappings: Mapping[]; headers: string[] } {
  const { in: inType, out } = membersOf(c as ServiceCollectionSpec, s);
  if (s.noOut) return { mappings: [], headers: [] };
  const have = new Set((s.outMappings ?? []).map(m => m.name));
  const body = s.serviceOut;
  // a class, or an ADT with the fields all its cases share (`ClientRead.master`)
  const bodyCase = body && !body.collection ? c.types.find(t => t.id === body.type) : undefined;
  const mappings: Mapping[] = [];
  const headers: string[] = [];
  for (const f of out?.fields ?? []) {
    if (!f.name || have.has(f.name)) continue;
    const bodyField = bodyCase?.fields?.find(b => b.name === f.name);
    const inField = inType?.fields?.find(i => i.name === f.name);
    const expression = OUT_HEADERS.includes(f.name) ? `= headers.${f.name}`
      : body && sameShape(f, body) ? '= body'
        : bodyField ? `= body.${f.name}`
          : inField && sameShape(f, inField) ? `= ${f.name}` : '';
    if (!expression) continue;
    mappings.push({ name: f.name, expression });
    if (OUT_HEADERS.includes(f.name) && !(s.responseHeaders ?? []).includes(f.name)) headers.push(f.name);
  }
  return { mappings, headers };
}

/** The service with the suggested mappings added (and the response headers they read). */
export function withSuggestedOutMappings(c: Pick<ServiceCollectionSpec, 'types'>, s: CollectionService): CollectionService {
  const { mappings, headers } = suggestOutMappings(c, s);
  if (!mappings.length) return s;
  return {
    ...s,
    outMappings: [...(s.outMappings ?? []), ...mappings],
    ...(headers.length ? { responseHeaders: [...(s.responseHeaders ?? []), ...headers] } : {}),
  };
}

/** Remove a service — with its In and Out. */
export function withoutService(c: ServiceCollectionSpec, id: string): ServiceCollectionSpec {
  return {
    ...c,
    services: c.services.filter(s => s.id !== id),
    types: c.types.filter(t => t.interactionId !== id),
  };
}

/**
 * The collection as the frame the class builder and the Scala generator know
 * (a `ProcessSpec` without flow): its types and its project.
 */
export function processFrame(c: ServiceCollectionSpec, ownPackage?: string): ProcessSpec {
  return {
    version: 1, slug: c.slug, name: c.slug, title: c.title, project: c.project,
    status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt,
    types: c.types, interactions: [], steps: [],
    // the package the types live in — that of their API, as a process has its own
    ownPackage: ownPackage ?? typeHome(c),
  };
}

/**
 * The package of the API a type of the collection belongs to: where the domain has it
 * (`…crm.v2.schema.ProductType` → `…crm.v2`), otherwise the first API of the collection.
 */
export function typeHome(c: ServiceCollectionSpec, typeId?: string): string {
  const t = typeId ? c.types.find(x => x.id === typeId) : undefined;
  const apis = apisOf(c).map(collectionPackage);
  const fromDomain = t?.domainId ? apis.find(pkg => t.domainId === `${pkg}.${t.name}` || t.domainId === `${pkg}.schema.${t.name}`) : undefined;
  return fromDomain ?? apis[0] ?? collectionPackage(c);
}

/** The placeholders in the path: `/clients/{clientKey}` → `clientKey` */
export const pathParams = (path: string): string[] => [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);

const segmentsOf = (path: string): string[] => path.split('/').filter(Boolean);

/** `/banks/{bankNumber}/` → `/banks/{bankNumber}` — empty: none. */
export const normalPathBase = (base: string | undefined): string => {
  const parts = segmentsOf(base ?? '');
  return parts.length ? `/${parts.join('/')}` : '';
};

/** Does the path start with the base of the company (whole segments)? */
export function inPathBase(c: Pick<ServiceCollectionSpec, 'pathBase'>, path: string): boolean {
  const base = segmentsOf(normalPathBase(c.pathBase));
  const parts = segmentsOf(path);
  return base.length > 0 && base.length <= parts.length && base.every((b, i) => b === parts[i]);
}

/** The part of the path the worker adds to `serviceBasePath` — without the base of the company. */
export function workerPath(c: Pick<ServiceCollectionSpec, 'pathBase'>, path: string): string {
  if (!inPathBase(c, path)) return path;
  const rest = segmentsOf(path).slice(segmentsOf(normalPathBase(c.pathBase)).length);
  return rest.length ? `/${rest.join('/')}` : '';
}

/** The placeholders the base of the company fills — no parameters of the service. */
export function basePathParams(c: Pick<ServiceCollectionSpec, 'pathBase'>, s: Pick<CollectionService, 'path'>): Set<string> {
  return new Set(inPathBase(c, s.path) ? pathParams(normalPathBase(c.pathBase)) : []);
}

/**
 * A base the company sets, read from the services: the segments all paths share, up to
 * the last placeholder no service has in its `In` (`/banks/{bankNumber}` — the bank comes
 * from the configuration, the client from the process). Empty if there is none.
 */
export function suggestPathBase(c: ServiceCollectionSpec): string {
  const paths = c.services.map(s => s.path).filter(Boolean).map(segmentsOf);
  if (!paths.length) return '';
  const common: string[] = [];
  for (let i = 0; paths.every(p => i < p.length - 1 && p[i] === paths[0][i]); i++) common.push(paths[0][i]);
  const inFields = new Set(c.services.flatMap(s => membersOf(c, s).in?.fields ?? []).map(f => f.name));
  let end = -1;
  common.forEach((seg, i) => {
    const m = /^\{([^}]+)\}$/.exec(seg);
    if (m && !inFields.has(m[1])) end = i;
  });
  return end < 0 ? '' : `/${common.slice(0, end + 1).join('/')}`;
}

/** What does not fit in a service — shown at the service and in the list. */
export function serviceIssues(c: ServiceCollectionSpec, s: CollectionService): string[] {
  const out: string[] = [];
  if (!/^[A-Z][A-Za-z0-9]*$/.test(s.name)) out.push(`«${s.name}» ist kein Scala-Objektname (gross, ohne Sonderzeichen).`);
  if (!API_NAME.test(apiOf(c, s).api)) out.push(`API «${apiOf(c, s).api}» ist kein Paketname (klein, camelCase).`);
  if (c.services.some(x => x.id !== s.id && x.name === s.name)) out.push(`«${s.name}» gibt es zweimal.`);
  if (!s.path) out.push('Pfad fehlt — der Katalog kennt ihn nicht (Katalog neu aufbauen: er liest jetzt `val path`), aus der OpenAPI ergänzen (gleicher Name) oder von Hand.');
  else if (!s.path.startsWith('/')) out.push('Der Pfad beginnt mit «/».');
  // the placeholders of the company's base are filled by `serviceBasePath`
  const fromBase = basePathParams(c, s);
  const declared = new Set(s.params.filter(p => p.in === 'path').map(p => p.name));
  for (const p of pathParams(s.path)) if (!declared.has(p) && !fromBase.has(p)) out.push(`Pfad-Parameter «${p}» ist nicht beschrieben.`);
  for (const p of s.params) {
    if (p.in === 'path' && fromBase.has(p.name)) continue;
    if (p.in === 'path' && !pathParams(s.path).includes(p.name)) out.push(`Pfad-Parameter «${p.name}» kommt im Pfad nicht vor.`);
    if (!p.disabled && !p.expression.trim() && p.required)
      out.push(`«${p.name}» ist Pflicht, hat aber keinen Wert.${p.in === 'path' ? ' Setzt ihn die Firma (im serviceBasePath), gehört er in den Basispfad (Übersicht der Collection).' : ''}`);
  }
  return out;
}
