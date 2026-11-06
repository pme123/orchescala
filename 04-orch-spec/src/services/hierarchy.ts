// Nested APIs and their shared classes.
//
// An API may sit in a hierarchy (`clientMaster.multipleNaturalPersons`, see collection.ts).
// What several APIs of a level share lives in the `schema` of that level:
//
//   …/domain/clientMaster/schema/Gender.scala                              shared
//   …/domain/clientMaster/multipleNaturalPersons/v1/schema/NaturalPerson3.scala
//
// · The export puts a type that APIs of the collection with a common level use
//   into the `schema` of the deepest such level — otherwise into the `schema` of
//   its first API, as before.
// · An import (OpenAPI, from the catalog, the Abgleich) takes a class of the same
//   name the project has higher up in the hierarchy as the collection's own: the
//   type of the collection goes, its uses point into the catalog.
import { domainRef } from '../serviceTypes.ts';
import type { DomainType, Model, TypeDef } from '../types.ts';
import { apiOf, apiParents, apisOf, collectionPackage, hierarchySchemaPackages, sameApi, type ApiRef } from './collection.ts';
import type { BodyRef, CollectionService, ServiceCollectionSpec } from './types.ts';

/** The types a type reaches through its fields (itself included). */
export function reach(id: string | undefined, types: TypeDef[], seen = new Set<string>()): Set<string> {
  if (!id || seen.has(id)) return seen;
  const t = types.find(x => x.id === id);
  if (!t) return seen;
  seen.add(id);
  for (const f of [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])]) reach(f.type, types, seen);
  return seen;
}

/** The types a service uses: In, Out, the bodies, the parameters — and what they reach. */
export function typesOf(s: CollectionService, types: TypeDef[]): Set<string> {
  const seen = new Set<string>();
  for (const id of [s.noIn ? undefined : s.inTypeId, s.noOut ? undefined : s.outTypeId, s.serviceIn?.type, s.serviceOut?.type, ...s.params.map(p => p.type)]) reach(id, types, seen);
  return seen;
}

/** Per type of the collection the APIs whose services use it, in the order of the APIs. */
function usersOf(c: ServiceCollectionSpec): Map<string, ApiRef[]> {
  const services = c.services.filter(s => s.name.trim());
  const out = new Map<string, ApiRef[]>();
  for (const a of apisOf({ ...c, services })) {
    for (const s of services.filter(x => sameApi(apiOf(c, x), a))) {
      for (const id of typesOf(s, c.types)) {
        const list = out.get(id) ?? [];
        if (!list.some(x => sameApi(x, a))) out.set(id, [...list, a]);
      }
    }
  }
  return out;
}

/** The levels all the APIs share: `clientMaster.naturalPersons` + `clientMaster.legalPersons` → `['clientMaster']` */
export function commonParents(apis: Pick<ApiRef, 'api'>[]): string[] {
  if (!apis.length) return [];
  const [first, ...rest] = apis.map(a => apiParents(a.api));
  let n = first.length;
  for (const p of rest) {
    let i = 0;
    while (i < n && i < p.length && p[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n);
}

export interface SchemaHome {
  /** `acme.crm.domain.clientMaster.schema` or `acme.crm.domain.client.v1.schema` */
  pkg: string;
  /** the first API that uses it — whose package the type is written from */
  api: ApiRef;
}

/**
 * Where each type of the collection (not In/Out) lives: in the `schema` of the deepest level
 * the APIs that use it share — when more than one API uses it and they share one —
 * otherwise in the `schema` of its first API (or the first API of the collection).
 */
export function schemaHomes(c: ServiceCollectionSpec): Map<string, SchemaHome> {
  const services = c.services.filter(s => s.name.trim());
  const apis = apisOf({ ...c, services });
  const users = usersOf(c);
  const out = new Map<string, SchemaHome>();
  for (const t of c.types.filter(x => !x.interactionId && x.name?.trim())) {
    const by = users.get(t.id) ?? [];
    const api = by[0] ?? apis[0];
    if (!api) continue;
    const shared = by.length > 1 ? commonParents(by) : [];
    const pkg = shared.length
      ? [...api.project.split('-').filter(Boolean), 'domain', ...shared, 'schema'].join('.')
      : `${collectionPackage(api)}.schema`;
    out.set(t.id, { pkg, api });
  }
  return out;
}

/** The `schema` package of a type of the collection — what a user imports. */
export function schemaPackageOf(c: ServiceCollectionSpec, typeId: string): string | undefined {
  return schemaHomes(c).get(typeId)?.pkg;
}

// ── adopting the classes of the hierarchy ──────────────────────────────────

const CLASS_KINDS = new Set<DomainType['kind']>(['case', 'enum', 'alias']);

/** A class of the project higher up in the hierarchy with the name — nearest level first. */
function inHierarchy(name: string, apis: ApiRef[], model: Model | null): DomainType | undefined {
  const domain = model?.domainTypes ?? [];
  const pkgs = [...new Set(apis.flatMap(a => hierarchySchemaPackages(a)))];
  for (const pkg of pkgs) {
    const hit = domain.find(d => d.pkg === pkg && d.name === name && !d.owner && CLASS_KINDS.has(d.kind));
    if (hit) return hit;
  }
  return undefined;
}

export interface Adopted {
  /** the name of the class — `Gender` */
  name: string;
  /** where it lives now — `acme.crm.domain.clientMaster.schema.Gender` */
  from: string;
  /**
   * what only one of the two has — the fields (or cases) by name: `-zip` only the collection's,
   * `+street` only the class of the hierarchy; empty when they match
   */
  differs?: string[];
}

/** The fields (or cases) only one of the two has — compared by name: the types are of two worlds. */
function differences(t: TypeDef, d: DomainType): string[] {
  const names = (xs: { name: string }[] | undefined) => new Set((xs ?? []).map(x => x.name));
  const pairs: [Set<string>, Set<string>][] = [[names(t.fields), names(d.fields)]];
  if (t.kind === 'enum' || d.kind === 'enum') {
    const ours = names(t.values);
    const theirs = new Set([...(d.values ?? []), ...(d.cases ?? []).map(x => x.name)]);
    pairs.push([ours, theirs]);
  }
  return pairs.flatMap(([ours, theirs]) => [
    ...[...ours].filter(n => !theirs.has(n)).map(n => `-${n}`),
    ...[...theirs].filter(n => !ours.has(n)).map(n => `+${n}`),
  ]);
}

/**
 * The types of the collection the project has higher up in the hierarchy (same name, in the
 * `schema` of a level above an API that uses it) are taken from there: the type goes, every
 * use points to the class of the catalog. A type the project has in the API's own package
 * (its `domainId` there) stays — the project says where it lives.
 */
export function adoptHierarchyTypes(c: ServiceCollectionSpec, model: Model | null): { spec: ServiceCollectionSpec; adopted: Adopted[] } {
  if (!model?.domainTypes?.length) return { spec: c, adopted: [] };
  const users = usersOf(c);
  const apis = apisOf(c);
  const replace = new Map<string, string>();
  const adopted: Adopted[] = [];
  for (const t of c.types) {
    if (t.interactionId || !t.name?.trim()) continue;
    const by = users.get(t.id) ?? apis;
    if (!by.some(a => apiParents(a.api).length)) continue;
    // the project has it with its API — not a candidate
    if (t.domainId && by.some(a => t.domainId!.startsWith(`${collectionPackage(a)}.`))) continue;
    const hit = inHierarchy(t.name, by, model);
    if (!hit) continue;
    replace.set(t.id, domainRef(hit.id));
    // the same name, but other fields: taken all the same — the preview shows it to check
    const differs = hit.kind === 'alias' ? [] : differences(t, hit);
    adopted.push({ name: t.name, from: hit.id, ...(differs.length ? { differs } : {}) });
  }
  if (!replace.size) return { spec: c, adopted };
  const map = (type: string) => replace.get(type) ?? type;
  const body = (b: BodyRef | undefined): BodyRef | undefined => (b ? { ...b, type: map(b.type) } : b);
  const types = c.types
    .filter(t => !replace.has(t.id))
    .map(t => ({
      ...t,
      ...(t.fields ? { fields: t.fields.map(f => ({ ...f, type: map(f.type) })) } : {}),
      ...(t.values ? { values: t.values.map(v => (v.fields ? { ...v, fields: v.fields.map(f => ({ ...f, type: map(f.type) })) } : v)) } : {}),
    }));
  const services = c.services.map(s => ({
    ...s,
    params: s.params.map(p => ({ ...p, type: map(p.type) })),
    ...(s.serviceIn ? { serviceIn: body(s.serviceIn) } : {}),
    ...(s.serviceOut ? { serviceOut: body(s.serviceOut) } : {}),
  }));
  return { spec: { ...c, types, services }, adopted };
}
