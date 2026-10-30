// Names of a service collection in Orchescala — all derived from project, API
// and version, the same way `deriveObject` (serviceTypes.ts) reads them back:
//
//   project acme-crm · api client · version 1
//     → package     acme.crm.domain.client.v1
//     → super trait ClientV1 (extends CompanyBpmnServiceTaskDsl)
//     → topics      acme-crm-clientV1.GetClient
import { STATUSES, type ProcessSpec, type Status, type TypeDef } from '../types';
import { nowIsoWithTimezone, slugify } from '../util';
import type { CollectionService, ServiceCollectionSpec } from './types';

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

/** The file name in `services/` — from project, API and version, so a second import finds the same one. */
export const collectionSlug = (c: Pick<ServiceCollectionSpec, 'project' | 'api' | 'apiVersion'>): string =>
  slugify(topicPrefix(c));

/** A valid Scala identifier for the API (`client`, `paymentRules`). */
export const API_NAME = /^[a-z][A-Za-z0-9]*$/;
/** `acme-crm` — lower case words joined by `-` */
export const PROJECT_NAME = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$/;

export function newCollection(input: { title: string; project: string; api: string; apiVersion: number; description?: string }): ServiceCollectionSpec {
  const now = nowIsoWithTimezone();
  return {
    kind: 'serviceCollection',
    version: 1,
    slug: collectionSlug(input),
    title: input.title,
    project: input.project,
    api: input.api,
    apiVersion: input.apiVersion,
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
export function processFrame(c: ServiceCollectionSpec): ProcessSpec {
  return {
    version: 1, slug: c.slug, name: collectionTrait(c), title: c.title, project: c.project,
    status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt,
    types: c.types, interactions: [], steps: [],
  };
}

/** The placeholders in the path: `/clients/{clientKey}` → `clientKey` */
export const pathParams = (path: string): string[] => [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);

/** What does not fit in a service — shown at the service and in the list. */
export function serviceIssues(c: ServiceCollectionSpec, s: CollectionService): string[] {
  const out: string[] = [];
  if (!/^[A-Z][A-Za-z0-9]*$/.test(s.name)) out.push(`«${s.name}» ist kein Scala-Objektname (gross, ohne Sonderzeichen).`);
  if (c.services.some(x => x.id !== s.id && x.name === s.name)) out.push(`«${s.name}» gibt es zweimal.`);
  if (!s.path.startsWith('/')) out.push('Der Pfad beginnt mit «/».');
  const declared = new Set(s.params.filter(p => p.in === 'path').map(p => p.name));
  for (const p of pathParams(s.path)) if (!declared.has(p)) out.push(`Pfad-Parameter «${p}» ist nicht beschrieben.`);
  for (const p of s.params) {
    if (p.in === 'path' && !pathParams(s.path).includes(p.name)) out.push(`Pfad-Parameter «${p.name}» kommt im Pfad nicht vor.`);
    if (!p.disabled && !p.expression.trim() && p.required) out.push(`«${p.name}» ist Pflicht, hat aber keinen Wert.`);
  }
  return out;
}
