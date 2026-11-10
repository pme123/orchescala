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
//   name the project has in a `schema` of its hierarchy as the collection's own: the
//   type of the collection goes, its uses point into the catalog. A class of another
//   name counts as well when it has exactly the same structure — the same values of a
//   simple enum, the same fields with the same types — and is the only one of its level.
//   Every `schema` of the project is searched, the nearest first (`searchGroups`): the
//   levels above the API up to `acme.crm.domain.schema`, then the other levels, then the
//   packages of the other APIs.
import { domainRef, parseDomainRef } from '../serviceTypes.ts';
import type { DomainType, Field, Model, TypeDef } from '../types.ts';
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

// an API's own package: `acme.crm.domain.clientMaster.persons.v1.schema` — no level shared by APIs
const VERSIONED = /\.v\d+\.schema$/;

/**
 * Where the classes of the hierarchy are searched — every `schema` package of the project, in
 * groups, the nearest first: the levels above the APIs that use a type (each a group, up to
 * `domain.schema`), then the other levels of the project (`clientMaster.schema`), the shallow ones
 * first, and last the `schema` of the other APIs. The packages of the collection's own APIs are none:
 * what is there is the collection's.
 */
export function searchGroups(by: ApiRef[], apis: ApiRef[], model: Model | null): string[][] {
  const above = [...new Set(by.flatMap(a => hierarchySchemaPackages(a)))];
  const stems = [...new Set(by.map(a => [...a.project.split('-').filter(Boolean), 'domain'].join('.')))];
  const own = apis.map(a => `${collectionPackage(a)}.`);
  const others = [...new Set((model?.domainTypes ?? []).filter(d => !d.owner).map(d => d.pkg))]
    .filter(p => p.endsWith('.schema') && !above.includes(p) && stems.some(x => p.startsWith(`${x}.`)) && !own.some(o => p.startsWith(o)))
    .sort();
  const depth = (p: string) => p.split('.').length;
  const levels = others.filter(p => !VERSIONED.test(p));
  const byDepth = [...new Set(levels.map(depth))].sort((a, b) => a - b).map(n => levels.filter(p => depth(p) === n));
  const ofApis = others.filter(p => VERSIONED.test(p));
  return [...above.map(p => [p]), ...byDepth, ...(ofApis.length ? [ofApis] : [])];
}

/**
 * A class of the project with the name — in the nearest group that has one; of several there the
 * one with the same fields, otherwise none.
 */
function inHierarchy(t: TypeDef, groups: string[][], model: Model | null): DomainType | undefined {
  const domain = model?.domainTypes ?? [];
  for (const group of groups) {
    const hits = domain.filter(d => group.includes(d.pkg) && d.name === t.name && !d.owner && CLASS_KINDS.has(d.kind));
    if (!hits.length) continue;
    if (hits.length === 1) return hits[0];
    const same = hits.filter(d => d.kind !== 'alias' && !differences(t, d).length);
    return same.length === 1 ? same[0] : undefined;
  }
  return undefined;
}

export interface Adopted {
  /** the id of the collection's type that goes — what a choice keeps */
  id: string;
  /** the name of the class of the collection — `Gender` (`NaturalPersonGender1` when renamed) */
  name: string;
  /** the class of the hierarchy has another name, but the same structure — `Gender1` */
  renamed?: string;
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

// ── the same structure under another name ──────────────────────────────────

// `acme.crm.domain.schema.Gender1` → `Gender1`, without blanks — the types are compared by their names
const bare = (type: string) => type.replace(/\s+/g, '').replace(/\b[a-z]\w*\./g, '');

/** The structure of a class of the domain: the values of a simple enum, the fields of a case class. */
function domainShape(d: DomainType): string | undefined {
  if (d.kind === 'enum') {
    const values = d.values?.length ? d.values : (d.cases ?? []).map(x => x.name);
    if ((d.cases ?? []).some(x => x.fields?.length) || d.fields?.length || values.length < 2) return undefined;
    return `enum ${[...values].sort().join(',')}`;
  }
  if (d.kind === 'case' && d.fields?.length) return `case ${d.fields.map(f => `${f.name}:${bare(f.type)}`).sort().join(',')}`;
  return undefined;
}

/** The same for a type of the collection — the types of its fields by the names they will have. */
function typeShape(t: TypeDef, nameOf: (type: string) => string): string | undefined {
  if (t.kind === 'enum') {
    const values = (t.values ?? []).filter(v => v.name);
    if (values.some(v => v.fields?.length) || t.fields?.length || values.length < 2) return undefined;
    return `enum ${values.map(v => v.name).sort().join(',')}`;
  }
  if (!t.fields?.length) return undefined;
  const expr = (f: Field) => {
    let x = nameOf(f.type) + (f.enumCase ? `.${f.enumCase}` : '') + (f.constraint ? `:|${f.constraint}` : '');
    if (f.map) x = `Map[String,${x}]`;
    if (f.collection) x = `Seq[${x}]`;
    if (f.optional) x = `Option[${x}]`;
    return bare(x);
  };
  return `case ${t.fields.map(f => `${f.name}:${expr(f)}`).sort().join(',')}`;
}

// the descriptions of the fields — what tells two classes of the same structure apart
// (`TypeDateWrapper` and `TypeBigDecimalWrapper`: both `value: Option[String]`)
const said = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const described = (d: DomainType) => (d.fields ?? []).map(f => `${f.name}:${said(f.description)}`).sort().join('|');
const describedType = (t: TypeDef) => (t.fields ?? []).map(f => `${f.name}:${said(f.description)}`).sort().join('|');

/**
 * The types of the collection the hierarchy has under another name with exactly the same
 * structure: taken from there like one of the same name. Only one such class in the nearest group
 * of `searchGroups` with one counts — of two of the same structure there the one whose fields have the same
 * descriptions; otherwise the type stays. A type whose fields
 * point to a type taken over is compared with the name it gets: the simple enums first, then the
 * classes that use them.
 */
function sameStructure(
  c: ServiceCollectionSpec, model: Model, users: Map<string, ApiRef[]>, apis: ApiRef[],
  replace: Map<string, string>, adopted: Adopted[], keep: ReadonlySet<string>,
): void {
  const domain = (model.domainTypes ?? []).filter(d => !d.owner && (d.kind === 'case' || d.kind === 'enum'));
  // per package of the hierarchy: the classes by their structure
  const shapes = new Map<string, Map<string, DomainType[]>>();
  const byShape = (pkg: string) => {
    let m = shapes.get(pkg);
    if (!m) {
      m = new Map();
      for (const d of domain.filter(x => x.pkg === pkg)) {
        const s = domainShape(d);
        if (s) m.set(s, [...(m.get(s) ?? []), d]);
      }
      shapes.set(pkg, m);
    }
    return m;
  };
  const nameOf = (type: string): string => {
    const ref = parseDomainRef(type);
    if (ref) return ref.split('.').pop() ?? ref;
    const adoptedRef = replace.get(type);
    if (adoptedRef) return (parseDomainRef(adoptedRef) ?? adoptedRef).split('.').pop() ?? type;
    return c.types.find(t => t.id === type)?.name ?? type;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const t of c.types) {
      if (replace.has(t.id) || keep.has(t.id) || t.interactionId || !t.name?.trim()) continue;
      const by = users.get(t.id) ?? apis;
      if (t.domainId && by.some(a => t.domainId!.startsWith(`${collectionPackage(a)}.`))) continue;
      const shape = typeShape(t, nameOf);
      if (!shape) continue;
      for (const group of searchGroups(by, apis, model)) {
        const all  = group.flatMap(pkg => byShape(pkg).get(shape) ?? []);
        if (!all.length) continue;
        // several of the same structure: the one whose fields say the same
        const hits = all.length === 1 ? all : all.filter(d => described(d) === describedType(t));
        if (hits.length === 1) {
          replace.set(t.id, domainRef(hits[0].id));
          adopted.push({ id: t.id, name: t.name, renamed: hits[0].name, from: hits[0].id });
          changed = true;
        }
        break;
      }
    }
  }
}

/**
 * The types of the collection the project has in its hierarchy (same name, in a `schema` of the
 * project — the nearest first, see `searchGroups`) are taken from there: the type goes, every
 * use points to the class of the catalog. A type the project has in the API's own package
 * (its `domainId` there) stays — the project says where it lives.
 * @param keep the ids of the types the user keeps as the collection's own — not taken over; a
 *             type that would match only through one of them stays too
 */
export function adoptHierarchyTypes(c: ServiceCollectionSpec, model: Model | null, keep: ReadonlySet<string> = new Set()): { spec: ServiceCollectionSpec; adopted: Adopted[] } {
  if (!model?.domainTypes?.length) return { spec: c, adopted: [] };
  const users = usersOf(c);
  const apis = apisOf(c);
  const replace = new Map<string, string>();
  const adopted: Adopted[] = [];
  for (const t of c.types) {
    if (t.interactionId || !t.name?.trim() || keep.has(t.id)) continue;
    const by = users.get(t.id) ?? apis;
    // the project has it with its API — not a candidate
    if (t.domainId && by.some(a => t.domainId!.startsWith(`${collectionPackage(a)}.`))) continue;
    const hit = inHierarchy(t, searchGroups(by, apis, model), model);
    if (!hit) continue;
    replace.set(t.id, domainRef(hit.id));
    // the same name, but other fields: taken all the same — the preview shows it to check
    const differs = hit.kind === 'alias' ? [] : differences(t, hit);
    adopted.push({ id: t.id, name: t.name, from: hit.id, ...(differs.length ? { differs } : {}) });
  }
  sameStructure(c, model, users, apis, replace, adopted, keep);
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
