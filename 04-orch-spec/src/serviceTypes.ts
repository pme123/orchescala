// Service objects as field types.
//
// A catalog entry (element template) carries its Orchescala origin in its
// name. From it, object and package can be derived:
//
//   globex-crm-accountV1.GetAccount
//     → object  GetAccount
//     → package globex.crm.domain.account.v1
//     → types   GetAccount.In · GetAccount.Out
//
//   globex-product-openAccountV2            (subprocess)
//     → object  OpenAccount   (the version is in the package, not in the name)
//     → package globex.product.domain.openAccount.v2
//
// In the data model such a field type is written as `svc:<serviceId>:<In|Out>`.
// If the domain catalog knows the object — a process via `processName`,
// a service object via its name —, the catalog wins (`catalogObject`).
// Otherwise the derivation is a good guess, not a proof — for unusually
// built names `uncertain` marks that the import must be checked.

import type { DomainType, Model, ServiceDef } from './types.ts';
import { ORCHESCALA_TYPES, catalogIndex } from './orchescalaTypes.ts';

export type ServiceMember = 'In' | 'Out';

export interface ServiceType {
  /** Field value in the data model */
  value: string;
  serviceId: string;
  member: ServiceMember;
  /** Scala type, e.g. `GetAccount.Out` */
  name: string;
  /** Package of the object, e.g. `globex.crm.domain.account.v1` */
  pkg: string;
  /** complete import line */
  importPath: string;
  /** Display name of the service */
  label: string;
  group: string;
  /** Derivation uncertain — check the import in the project */
  uncertain?: boolean;
}

export const SERVICE_PREFIX = 'svc:';

const capitalize = (s: string) => s.replace(/^(.)/, c => c.toUpperCase());

/** Split `svc:<serviceId>:<member>`; null = not a service type. */
export function parseServiceRef(ref: string): { serviceId: string; member: ServiceMember } | null {
  if (!ref.startsWith(SERVICE_PREFIX)) return null;
  const rest = ref.slice(SERVICE_PREFIX.length);
  const at = rest.lastIndexOf(':');
  if (at < 0) return null;
  const member = rest.slice(at + 1);
  if (member !== 'In' && member !== 'Out') return null;
  return { serviceId: rest.slice(0, at), member };
}

export const serviceRef = (serviceId: string, member: ServiceMember) =>
  `${SERVICE_PREFIX}${serviceId}:${member}`;

interface Derived { object: string; pkg: string; uncertain: boolean }

/** Derive object and package from the template ID. */
export function deriveObject(serviceId: string): Derived {
  const dotted = serviceId.split('.');
  const prefix = dotted[0];
  const last = dotted[dotted.length - 1];

  const segments = prefix.split('-').filter(Boolean);
  const tail = segments[segments.length - 1] ?? prefix;
  const m = /^(.*?)V(\d+)$/.exec(tail);
  const name = m ? m[1] : tail;
  const version = m ? `v${m[2]}` : 'v1';

  // The usual form is <company>-<project>-<api><Version>. If the version suffix or
  // the project level is missing, the split is no longer unambiguous — then the
  // import is a guess (e.g. `globex-documents-print-document`).
  const uncertain = segments.length < 3 || !m;
  const head = uncertain ? segments : segments.slice(0, -1);
  const pkg = [...head, 'domain', name, version].join('.');

  // If an object name (capital letter) follows the last dot, that wins;
  // otherwise the entry is a process and is named like its last segment —
  // without the version, which is in the package (`loadPoasV1` → `LoadPoas`)
  const object = dotted.length > 1 && /^[A-Z]/.test(last) ? last : capitalize(name);
  return { object, pkg, uncertain };
}

/**
 * Object and package from the domain catalog: a process via its
 * `processName` (`valiant-vollmacht-loadPoasV1` → `LoadPoas` in
 * `valiant.vollmacht.domain.loadPoas.v1`), a worker via its `topicName`
 * (`valiant-graviton-eventStatus.get` → `GetEventStatus`), a service object via its
 * name (`valiant-services-tadv2.GetProfileCompletionCustomerId` → in
 * `valiant.services.domain.tad.v2`) — if the name exists several times, the one in the
 * derived package, otherwise none. Null if the catalog does not know it.
 */
export function catalogObject(ref: string, model: Model | null): Derived | null {
  const idx = catalogIndex(model?.domainTypes);
  const asObject = (t: DomainType): Derived => ({ object: t.owner!, pkg: t.pkg, uncertain: false });
  const process = idx.byProcess.get(ref)?.[0];
  if (process) return asObject(process);
  // a worker via its topic (`valiant-graviton-eventStatus.get` → `GetEventStatus`) —
  // the name cannot be derived from it
  const worker = idx.byTopic.get(ref) ?? [];
  if (worker.length && new Set(worker.map(t => `${t.pkg}.${t.owner}`)).size === 1) return asObject(worker[0]);
  const derived = deriveObject(ref);
  if (!ref.includes('.') || !/^[A-Z]/.test(derived.object)) return null;
  const owners = idx.byOwner.get(derived.object) ?? [];
  const pkgs = [...new Set(owners.map(t => t.pkg))];
  if (pkgs.length === 1) return asObject(owners[0]);
  const same = owners.find(t => t.pkg === derived.pkg);
  return same ? asObject(same) : null;
}

/** Object and package — from the catalog, otherwise derived. */
export const objectOf = (ref: string, model: Model | null): Derived =>
  catalogObject(ref, model) ?? deriveObject(ref);

function typeOf(svc: ServiceDef, member: ServiceMember, model: Model | null): ServiceType {
  const { object, pkg, uncertain } = objectOf(svc.id, model);
  return {
    value: serviceRef(svc.id, member),
    serviceId: svc.id,
    member,
    name: `${object}.${member}`,
    pkg,
    importPath: `${pkg}.${object}`,
    label: svc.name || svc.id,
    group: svc.group ?? '—',
    ...(uncertain ? { uncertain: true } : {}),
  };
}

/** All selectable service objects of the catalog. */
export function serviceTypes(model: Model | null): ServiceType[] {
  const out: ServiceType[] = [];
  for (const svc of model?.services ?? []) {
    out.push(typeOf(svc, 'In', model), typeOf(svc, 'Out', model));
  }
  return out;
}

/** A single service type — even if the catalog does not know it (yet). */
export function serviceTypeOf(ref: string, model: Model | null): ServiceType | null {
  const parsed = parseServiceRef(ref);
  if (!parsed) return null;
  const svc = model?.services.find(s => s.id === parsed.serviceId)
    ?? { id: parsed.serviceId, name: parsed.serviceId } as ServiceDef;
  return typeOf(svc, parsed.member, model);
}

// ── Types from the domain catalog ────────────────────────────────────────────
// These are read from the sources, hence exact — in contrast to those above
// derived from the service name. In the data model such a field type is written
// as `dom:<fully qualified name>`.

export const DOMAIN_PREFIX = 'dom:';

export const domainRef = (id: string) => `${DOMAIN_PREFIX}${id}`;

export function parseDomainRef(ref: string): string | null {
  return ref.startsWith(DOMAIN_PREFIX) ? ref.slice(DOMAIN_PREFIX.length) : null;
}

/**
 * The catalog type for a field type. A reference (`domain:<id>`) is found via
 * the id. A bare name (`ProcessCallOrigin`) is left over from the import
 * if the catalog did not know the type back then — if it knows it
 * now, that counts: the name resolves as soon as it is unambiguous.
 */
export function domainTypeOf(ref: string, model: Model | null): DomainType | null {
  const id = parseDomainRef(ref);
  // the types from `orchescala.domain` exist even without a loaded catalog
  if (id) return catalogIndex(model?.domainTypes).byId.get(id) ?? null;
  if (!/^[A-Z][\w.]*$/.test(ref)) return null;
  // exactly one catalog type with this name — the built-in ones only count if the
  // project does not name one that way (`IdentityCorrelation` from orchescala.domain)
  const all = catalogIndex(model?.domainTypes).byName.get(ref) ?? [];
  const own = all.filter(t => !ORCHESCALA_TYPES.includes(t));
  if (own.length) return own.length === 1 ? own[0] : null;
  const builtIn = all.filter(t => ORCHESCALA_TYPES.includes(t));
  return builtIn.length === 1 ? builtIn[0] : null;
}

/** If the catalog is gone, at least the name stays readable. */
export function domainNameOf(ref: string): string {
  const id = parseDomainRef(ref) ?? '';
  const parts = id.split('.');
  // `pkg.Owner.In` → `Owner.In`, `pkg.schema.InAddress` → `InAddress`
  const upper = parts.findIndex(p => /^[A-Z]/.test(p));
  return upper < 0 ? id : parts.slice(upper).join('.');
}
