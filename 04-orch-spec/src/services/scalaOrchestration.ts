// A service orchestration → Orchescala code: a CustomTask and its CustomWorker, as a
// project writes it by hand when it combines services (`UpdateClient` = GET, then PUT):
//
//   01-domain/…/client/v1/UpdateClient.scala         CustomTask: topic, descr, In, Out, examples
//   01-domain/…/client/v1/schema/<Type>.scala        own types of the orchestration
//   03-worker/…/client/v1/UpdateClientWorker.scala   CustomWorker: runWorkZIO calls the workers
//
// The flow becomes one `for` in `runWorkZIO`:
//   service task   getClient <- runGetClient(GetClient.In(…))   (a `protected def` per service - a test overrides it)
//                  an ADT Out is narrowed to the case the step reads (`.collect`) - another case fails
//                  the step with `nicht Out.<Case>`, on purpose: the step was described for that case
//   script task    clients <- ZIO.attempt(mergeClients(…))   (its FEEL as a method of the worker - with a test;
//                                                     `concatenate` of lists, a class into the case it fits)
//                  total = …                        (an assignment: FEEL → Scala, see feelScala.ts)
//   mapping        client <- mapClient(…)           (a method returning IO[CustomError, …]: a `for` that
//                                                     resolves the required values first, then builds)
//   parallel       each branch forked, then joined  (as in «Advanced Custom Workers»)
//   exclusive      kind match { case Kind.A => … }  (one variable against values - else if … then …;
//                                                     what a branch produces is an Option afterwards)
//   end            yield Out(…)
// A variable of the Out set from a class of a service (`client = naturalPerson`) becomes the
// type the Out defines - `Client.Person(…)` field by field. The test of the worker runs each branch
// with the services answering their examples.
// What does not translate is a `???` with the reason — the project compiles once it is filled.
import { feelValueType } from './feelValueType.ts';
import { caseIdent, caseName, exampleValue, fieldType, importsOf, indexTypes, isFinished, packageClause, renderType, scalaKey, scalaName, type ScalaFile, type TypeIndex } from '../scala.ts';
import { domainRef } from '../serviceTypes.ts';
import type { CaseLink, DomainField, DomainType, Field, FieldLink, FieldMapping, Mapping, TypeMapper, Model, Step, TypeDef } from '../types';
import { isAdt, SCALA_TYPES } from '../types.ts';
import { timerVariable } from '../bpmn.ts';
import { isMember, isStandard } from '../standardMappers.ts';
import { resolveType } from '../interactions.ts';
import { collectionPackage, domainDir, typeHome, workerDir } from './collection.ts';
import { schemaPackageOf } from './hierarchy.ts';
import { feelCondition, feelToScala, feelToScalaTyped, forTarget, scalaIdent, type ScalaVar, type Translated } from './feelScala.ts';
import {
  allTypes, conditionOf, elseBranch, flatSteps, flowOf, inVars, orchestrationApi, orchestrationTopic, producedBy, resultName, scriptResultVar, serviceMembers, servicePackages,
  servicesByTopic, type OrchVar, type ServiceRef,
} from './orchestration.ts';
import { caseChain, outCaseFields, outCaseMapping, outCaseOf } from './outCases.ts';
import { adtTodo, descr, indent, workerPackageClause } from './scalaCollection.ts';
import { camelName } from './names.ts';
import { hasInner, linkPaths, mappingOf } from '../fieldMapping.ts';
import { enumCases, findMapper, mapperCode, mapperExtension, mapperHome, mapperImports, modelMappers, type MapperHome } from '../typeMappers.ts';
import { isCollection, type ServiceCollectionSpec, type ServiceOrchestrationSpec, type ServiceSpec } from './types.ts';

/** Scala variables for the FEEL translation. */
const scalaVars = (vars: OrchVar[]): Map<string, ScalaVar> =>
  new Map(vars.map(v => [v.name, { scala: v.scala, type: v.type, optional: !!v.optional, collection: !!v.collection, ...(v.byCase ? { byCase: v.byCase } : {}) }]));

const todo = (why: string) => `??? /* TODO ${why.replace(/\*\//g, '* /')} */`;

/**
 * `CustomError("Merge Clients: " + e.getMessage)` - the text as a literal, the message added: a step
 * name with `$` or `"` stays text (in an `s"…"` it would be interpolated).
 */
const failWith = (prefix: string, message: string) => `CustomError(${JSON.stringify(prefix)} + ${message})`;

interface Ctx {
  o: ServiceOrchestrationSpec;
  services: Map<string, ServiceRef>;
  types: TypeDef[];
  idx: TypeIndex;
  /** the services it calls — for the imports */
  called: Map<string, ServiceRef>;
  /** a counter for helper names (`fiber1`, `value1`) */
  n: { value: number };
  /** the simple enums of the domain, as types of the FEEL translation (`dom:…`) - for their imports */
  domEnums: TypeDef[];
  /** for the test: a variable set from a field of a service's Out - `clientMainType` ← GetPartner….clientMainType */
  sources: Map<string, { service: string; field: string; optional: boolean; outCase?: string }>;
  /** for the test: per service task the variables of the Out it converts - `client` → `Client.Person` */
  conversions: Map<string, { field: string; optional: boolean; to: string }[]>;
  /** for the test: the exclusive gateways that became a match - per branch what decides it */
  gateways: { variable: string; branches: { label: string; pattern: string; value: string; steps: Step[] }[] }[];
  collections: ServiceCollectionSpec[];
  /** the classes of the catalog - a script converts into one (`Client` of another orchestration) */
  domain: DomainType[];
  /** the implementations of the script tasks - each a method of the worker, with a test */
  scripts: ScriptMethod[];
  /** the type mappers of the model - a line between their types converts with them */
  mappers: TypeMapper[];
  /**
   * those a mapping used, by id - each an extension in the `schema` of its level (see
   * mapperHome), the worker imports its object; `explicit`: called on the object
   * (`ClientTypeMappers.toClientType(x)`) - another mapper the worker might use has its name
   */
  usedMappers: Map<string, { mapper: TypeMapper; home: MapperHome; explicit: boolean }>;
  /** the classes a mapping builds by name (`MasterRead(…)`) - for the imports of the worker */
  builtTypes: Set<string>;
  /** what the script tasks set, with the type the export derived - for the Out at the end */
  scriptVars: Map<string, OrchVar>;
  /** the timer variables of its events (`timerWaitForStatus`) with their default - a method of the worker each, a test makes it zero */
  timers: Map<string, { default?: string; step: string }>;
  /** methods of the worker beside runWorkZIO: an In with a TODO is built in one of its own - runWorkZIO has none */
  helpers: { name: string; code: string }[];
  /** what is still to do in the code of the run (an error path) - a TODO above runWorkZIO, not in it */
  notes: string[];
}

/** The implementation of a script task as a method of the worker. */
interface ScriptMethod {
  step: string;
  method: string;
  description?: string;
  params: Field[];
  result: Field;
  body: string;
  /** what the test checks: the lists it concatenates, the cases it converts into */
  concat?: string[];
  cases: string[];
  /** a mapping with several variables in its Out: a tuple of them (`result` is the first) */
  results?: Field[];
  /** a mapping: per mapped field what the test expects (`result.firstName` == `client.firstName`) */
  checks?: { at: string; value: string }[];
  /** a mapping: a ZIO (`IO[CustomError, …]`) - the required values resolved first, a missing one fails */
  io?: boolean;
  /** a mapping onto an enum with cases: a method per case builds it - their tests compare the examples */
  byCase?: boolean;
}

/**
 * The body of a method of a mapping: a `for` that resolves the required values first (`x <-
 * ZIO.fromOption(…).orElseFail(…)`), then builds in `mapped` (see MAPPED) - a value a type mapper
 * cannot convert fails as a CustomError, not as a defect. A body that is only the one binding it
 * yields is that ZIO itself.
 */
function forComprehension(binds: { name: string; io: string }[], value: string, where: string): string {
  if (binds.length === 1 && binds[0].name === value) return binds[0].io;
  const built = `mapped(${JSON.stringify(where)})(${value.includes('\n') ? `\n${indent(value, '  ')}\n` : value})`;
  if (!binds.length) return built;
  let name = 'built';
  for (let i = 2; binds.some(b => b.name === name); i++) name = `built${i}`;
  return ['for', ...binds.map(b => indent(`${b.name} <- ${b.io}`, '  ')), indent(`${name} <- ${built}`, '  '), `yield ${name}`].join('\n');
}

/** In a worker with mappings: what they build - a mapper that throws (an unknown case, `"abc".toBigDecimal`) a CustomError. */
const MAPPED = [
  '  /** what a mapping builds - a value a type mapper cannot convert fails as a CustomError, not as a defect */',
  '  private def mapped[A](where: String)(value: => A): IO[CustomError, A] =',
  '    ZIO.attempt(value).mapError(err => CustomError(s"$where: ${Option(err.getMessage).getOrElse(err.toString)}"))',
].join('\n');

/** The simple enums of the domain as types - a condition or a mapping names their cases. */
function domainEnums(model: Model | null): TypeDef[] {
  return (model?.domainTypes ?? [])
    .filter(d => d.kind === 'enum' && !d.owner && !d.fields?.length && !(d.cases ?? []).some(c => c.fields?.length))
    .map(d => ({
      id: domainRef(d.id), name: d.name, kind: 'enum', status: 'implemented',
      values: (d.values?.length ? d.values : (d.cases ?? []).map(c => c.name)).map(name => ({ name })),
    }) as TypeDef);
}

/** The fields of an ADT's case with the shared ones (`def x` of the enum) - its constructor's. */
const caseFields = (t: TypeDef, name: string): Field[] => {
  const seen = new Set<string>();
  return [...(t.fields ?? []), ...((t.values ?? []).find(v => v.name === name)?.fields ?? [])]
    .filter(f => f.name && !seen.has(f.name) && (seen.add(f.name), true));
};

/** The case of an ADT Out a task reads: its own choice - or the case of the In's name (`ClientKey`). */
export function outCaseOfTask(task: ServiceOrchestrationSpec['tasks'][string] | undefined, out: TypeDef | undefined): string | undefined {
  if (out?.kind !== 'enum') return undefined;
  const has = (n?: string) => !!n && (out.values ?? []).some(v => v.name === n);
  return has(task?.outCase) ? task!.outCase : has(task?.inCase) ? task!.inCase : undefined;
}

/**
 * The case of an ADT a class fits best: of its own fields the largest share the class has; of
 * equal shares the one with more of them (`MultipleNaturalPerson2` has all of `Person` and of
 * `MultiplePersons` - it is the second); then a name in common (`NaturalPerson3` → `Person`).
 */
export function fittingCase(target: TypeDef, source: TypeDef): string | undefined {
  const have = new Set((source.fields ?? []).map(f => f.name));
  const scored = (target.values ?? []).map(v => {
    const own = (v.fields ?? []).filter(f => f.name);
    const matched = own.filter(f => have.has(f.name)).length;
    const named = source.name.toLowerCase().includes(caseName(v.name).toLowerCase()) ? 1 : 0;
    return { name: v.name, score: [own.length ? matched / own.length : 0, matched, named] };
  }).filter(x => x.score[1] > 0);
  scored.sort((a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1] || b.score[2] - a.score[2]);
  return scored[0]?.name;
}

/** The field of the orchestration's Out a variable of the name is for. */
function outFieldOf(o: ServiceOrchestrationSpec, name: string): Field | undefined {
  if (o.noOut) return undefined;
  const out = o.types.find(t => t.id === o.outTypeId);
  return out?.kind === 'enum' ? undefined : (out?.fields ?? []).find(f => f.name === name);
}

/** What a variable of the Out becomes from a class of a service: the type and the case. */
export function conversionOf(o: ServiceOrchestrationSpec, m: Mapping, scope: Map<string, ScalaVar>, types: TypeDef[]): { to: TypeDef; from: TypeDef; caseOf?: string; field: Field; value: ScalaVar } | null {
  const field = outFieldOf(o, m.name.trim());
  const src = /^=\s*([A-Za-z_]\w*)\s*$/.exec(m.expression.trim())?.[1];
  const value = src ? scope.get(src) : undefined;
  if (!field || !value?.type || value.optional || value.collection || field.collection || field.map || value.type === field.type) return null;
  const to = types.find(t => t.id === field.type);
  const from = types.find(t => t.id === value.type);
  if (!to || !from?.fields?.length || (to.kind !== 'enum' && to.kind !== 'case')) return null;
  if (to.kind === 'case') return { to, from, field, value };
  const caseOf = fittingCase(to, from);
  return caseOf ? { to, from, caseOf, field, value } : null;
}

/** `Client.Person(clientKey = naturalPerson.clientKey, …)` - a field the class lacks is None or to do. */
function converted(c: NonNullable<ReturnType<typeof conversionOf>>, ctx: Ctx, pre: string[]): string {
  const sub = new Map<string, ScalaVar>((c.from.fields ?? []).filter(f => f.name).map(f =>
    [f.name, { scala: `${c.value.scala}.${scalaName(f.name)}`, type: f.type, optional: !!f.optional, collection: !!f.collection }]));
  const fields = c.caseOf ? caseFields(c.to, c.caseOf) : (c.to.fields ?? []).filter(f => f.name);
  const args = fields.filter(f => isFinished(f, ctx.idx)).map(f => {
    if (!sub.has(f.name)) return `${scalaName(f.name)} = ${f.optional ? 'None' : todo(`${f.name}: nicht in ${c.from.name}`)}`;
    const v = forTarget(feelToScala(`= ${f.name}`, sub, ctx.types, f), !!f.optional);
    if (!v.needed) return `${scalaName(f.name)} = ${v.scala}`;
    const tmp = `${f.name}${++ctx.n.value}`;
    pre.push(`${tmp} <- ZIO.fromOption(${v.scala}).orElseFail(CustomError(${JSON.stringify(`${ctx.o.name}: ${c.from.name}.${f.name} fehlt`)}))`);
    return `${scalaName(f.name)} = ${tmp}`;
  });
  const name = c.caseOf ? `${c.to.name}.${caseIdent(c.caseOf)}` : c.to.name;
  const value = args.length ? `${name}(\n${indent(args.join(',\n'), '  ')}\n)` : name;
  return c.field.optional ? `Some(${value})` : value;
}

// ── script tasks: their FEEL as a method of the worker ─────────────────────

/** `Option[Seq[Person]]` → type `Person`, optional, collection */
function shapeOf(expr: string): Pick<Field, 'type' | 'optional' | 'collection'> {
  let type = expr.trim();
  const optional = /^Option\[/.test(type);
  if (optional) type = type.slice('Option['.length, -1).trim();
  const collection = /^(Seq|List|Vector|Set)\[/.test(type);
  if (collection) type = type.slice(type.indexOf('[') + 1, -1).trim();
  return { type, ...(optional ? { optional: true } : {}), ...(collection ? { collection: true } : {}) };
}

/** A class of the catalog (`dom:…`) as a type - its fields and cases, enough to convert into it. */
function typeOf(id: string, ctx: Ctx): TypeDef | undefined {
  const own = ctx.types.find(t => t.id === id);
  if (own) return own;
  const d = ctx.domain.find(x => domainRef(x.id) === id);
  if (!d || (d.kind !== 'case' && d.kind !== 'enum')) return undefined;
  // a class of the catalog names its field types by name (`MasterRead`) - as a reference, so a mapping builds into it too
  const field = (f: DomainField): Field => {
    const shape = shapeOf(f.type);
    const ref = (SCALA_TYPES as readonly string[]).includes(shape.type) ? null : resolveType(shape.type, { domainTypes: ctx.domain } as Model, d.pkg);
    return { id: `${d.id}.${f.name}`, name: f.name, ...shape, ...(ref ? { type: domainRef(ref.id) } : {}) };
  };
  return {
    id, name: d.name, kind: d.kind, fields: (d.fields ?? []).map(field),
    ...(d.kind === 'enum' ? { values: (d.cases ?? []).map(c => ({ name: c.name, fields: (c.fields ?? []).map(field) })) } : {}),
  };
}

/** `x` of a class into the type `toId` - the case it fits, field by field (`Client.Company(…)`). */
function convertTo(x: string, fromId: string | undefined, toId: string | undefined, ctx: Ctx, where: string, chosen?: string): { scala: string; to: string; throws: boolean } | null {
  if (!fromId || !toId || fromId === toId) return null;
  const to = typeOf(toId, ctx);
  const from = typeOf(fromId, ctx);
  if (!to || !from?.fields?.length || (to.kind !== 'enum' && to.kind !== 'case')) return null;
  const caseOf = to.kind !== 'enum' ? undefined
    : chosen && (to.values ?? []).some(v => v.name === chosen) ? chosen : fittingCase(to, from);
  if (to.kind === 'enum' && !caseOf) return null;
  const sub = new Map<string, ScalaVar>(from.fields.filter(f => f.name).map(f =>
    [f.name, { scala: `${x}.${scalaName(f.name)}`, type: f.type, optional: !!f.optional, collection: !!f.collection }]));
  const fields = caseOf ? caseFields(to, caseOf) : (to.fields ?? []).filter(f => f.name);
  let throws = false;
  const args = fields.filter(f => isFinished(f, ctx.idx)).map(f => {
    if (!sub.has(f.name)) return `${scalaName(f.name)} = ${f.optional ? 'None' : todo(`${f.name}: nicht in ${from.name}`)}`;
    const v = forTarget(feelToScala(`= ${f.name}`, sub, ctx.types, f), !!f.optional);
    // a required value the class may lack: it fails with its name - the caller runs it in ZIO.attempt
    if (v.needed) throws = true;
    const value = v.needed ? `${v.scala}.getOrElse(throw IllegalArgumentException(${JSON.stringify(`${where}: ${from.name}.${f.name} fehlt`)}))` : v.scala;
    return `${scalaName(f.name)} = ${value}`;
  });
  const name = caseOf ? `${to.name}.${caseIdent(caseOf)}` : to.name;
  return { scala: args.length ? `${name}(\n${indent(args.join(',\n'), '  ')}\n)` : name, to: name, throws };
}

/** The name of an element in a lambda (`x => Client.Person(…)`) - `x`, unless a variable is called so. */
function elementName(scope: Map<string, ScalaVar>): string {
  const taken = new Set([...scope.keys(), ...[...scope.values()].map(v => v.scala)]);
  let n = 'x';
  for (let i = 2; taken.has(n); i++) n = `x${i}`;
  return n;
}

/**
 * An output converted into another type (`mapTo`): the variable it reads, as that type - a list
 * element by element. `throws`: a required value may be missing - the step fails with its name.
 */
function mappedOutput(m: Mapping, scope: Map<string, ScalaVar>, ctx: Ctx, where: string): { scala: string; throws: boolean; to?: string } {
  const src = /^=\s*([A-Za-z_]\w*)\s*$/.exec(m.expression.trim())?.[1];
  const v = src ? scope.get(src) : undefined;
  const target = typeOf(m.mapTo!, ctx)?.name ?? m.mapTo!;
  if (!v) return { scala: todo(`${m.name}: in ${target} umwandeln geht nur von einem Feld des Ergebnisses`), throws: false };
  if (v.type === m.mapTo) return { scala: v.scala, throws: false };
  // one value read directly; the elements of a list (or an Option) under a name nothing else has
  const el = elementName(scope);
  const c = convertTo(v.collection || v.optional ? el : v.scala, v.type, m.mapTo, ctx, where, m.mapToCase);
  if (!c) return { scala: todo(`${m.name}: lässt sich nicht in ${target} umwandeln`), throws: false };
  const lambda = `${el} =>\n${indent(c.scala, '  ')}\n`;
  const scala = v.collection
    ? (v.optional ? `${v.scala}.map(_.map(${lambda}))` : `${v.scala}.map(${lambda})`)
    : v.optional ? `${v.scala}.map(${lambda})` : c.scala;
  return { scala, throws: c.throws, to: c.to };
}

/** The arguments of a FEEL call, split at the commas outside brackets and texts. */
function callArgs(body: string, fn: string): string[] | null {
  const m = new RegExp(`^${fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(([\\s\\S]*)\\)$`).exec(body.trim());
  return m ? splitTop(m[1]) : null;
}

/** The elements of a FEEL list `[a, b]` - null if it is none. */
function listArgs(body: string): string[] | null {
  const t = body.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return null;
  // `[a] ++ [b]` is no one list - the first bracket must close at the end
  let depth = 0, text = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (text && ch === '\\') { i++; continue; }
    if (ch === '"') text = !text;
    if (text) continue;
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch) && --depth === 0 && i < t.length - 1) return null;
  }
  return splitTop(t.slice(1, -1));
}

/** Split at the commas outside brackets and texts - null if the brackets do not close. */
function splitTop(text0: string): string[] | null {
  const args: string[] = [];
  let depth = 0, text = false, cur = '', escaped = false;
  for (const ch of text0) {
    // `\"` in a FEEL text is no end of it
    if (escaped) { escaped = false; cur += ch; continue; }
    if (text && ch === '\\') { escaped = true; cur += ch; continue; }
    if (ch === '"') text = !text;
    if (!text && '([{'.includes(ch)) depth++;
    if (!text && ')]}'.includes(ch)) depth--;
    if (depth < 0) return null;
    if (!text && !depth && ch === ',') { args.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  return depth === 0 && !text ? args : null;
}

/**
 * The lists the field gets one after the other: `concatenate(a, b)`, `flatten([a, b])`. A list of
 * lists (`[a, b]`) stays what it is - the check of the FEEL says it does not fit a list of classes.
 */
function listParts(body: string): string[] | null {
  const flat = callArgs(body, 'flatten');
  if (flat?.length === 1) return listArgs(flat[0]);
  return callArgs(body, 'concatenate');
}

/**
 * The FEEL of a script task in Scala, for the field it fills: `concatenate(a, b)` of lists
 * (each element into the type of the field, the case it fits), one class into that type,
 * otherwise as a mapping (feelScala.ts).
 */
function scriptScala(body: string, scope: Map<string, ScalaVar>, target: Field, ctx: Ctx, where: string): { scala: string; concat?: string[]; cases: string[] } {
  const cases: string[] = [];
  const wrap = (v: string) => (target.optional ? `Some(${v})` : v);
  const args = target.collection ? listParts(body) : null;
  if (args?.length && args.every(a => scope.has(a))) {
    const parts = args.map(a => {
      const v = scope.get(a)!;
      const list = !v.collection ? (v.optional ? `${v.scala}.toSeq` : `Seq(${v.scala})`) : v.optional ? `${v.scala}.getOrElse(Seq.empty)` : v.scala;
      const el = elementName(scope);
      const c = convertTo(el, v.type, target.type, ctx, where);
      if (!c) return list;
      if (!cases.includes(c.to)) cases.push(c.to);
      return `${list}.map(${el} =>\n${indent(c.scala, '  ')}\n)`;
    });
    return { scala: wrap(parts.join(' ++\n')), concat: args, cases };
  }
  const name = /^[A-Za-z_]\w*$/.test(body.trim()) ? scope.get(body.trim()) : undefined;
  if (name && !name.collection && !target.collection) {
    const el = elementName(scope);
    const c = convertTo(name.optional ? el : name.scala, name.type, target.type, ctx, where);
    if (c) {
      cases.push(c.to);
      if (name.optional && target.optional) return { scala: `${name.scala}.map(${el} =>\n${indent(c.scala, '  ')}\n)`, cases };
      if (!name.optional) return { scala: wrap(c.scala), cases };
    }
  }
  const v = forTarget(feelToScala(`= ${body}`, scope, ctx.types, target), !!target.optional);
  return { scala: v.needed ? `${v.scala}.getOrElse(throw IllegalArgumentException(${JSON.stringify(`${where}: ${target.name} fehlt`)}))` : v.scala, cases };
}

/**
 * A mapping as Scala: per variable of the Out its value from the In - a path, the first one set
 * of several (`orElse`), a FEEL expression. An object with lines onto its fields is a copy of
 * what the line onto it gives (`existingClient.copy(…)`, `map` for an Option), otherwise its class
 * field by field (`Client(…)`). `checks`: what the test expects, reached from the result.
 */
/**
 * A case of an enum with cases as a method of its own (see adtValue): the source as that case, the
 * target case built, with what its test checks - the call that replaces the branch.
 */
type CaseMethod = (c: { source: Field; sourceCase: string; target: Field; body: string; checks: { at: string; value: string }[] }) => string;

function mappingValues(m: FieldMapping, scope: Map<string, ScalaVar>, ctx: Ctx, where: string, onCase: CaseMethod) {
  let checks: { at: string; value: string }[] = [];
  /** the bindings of the method being built - a required value resolved before it builds */
  let binds: { name: string; io: string }[] = [];
  /** the names of the method being built - its parameters, its bindings */
  let names = new Set<string>([...scope.keys()].map(scalaIdent));
  const bind = (base: string, io: string): string => {
    const b = scalaIdent(base.replace(/[^A-Za-z0-9_]/g, '') || 'value');
    let name = b;
    for (let i = 2; names.has(name); i++) name = `${b}${i}`;
    names.add(name);
    binds.push({ name, io });
    return name;
  };
  /** a required value from an Option: a binding that fails with its path */
  const required = (path: string, option: string) =>
    bind(path.split('.').pop()!, `ZIO.fromOption(${option}).orElseFail(CustomError(${JSON.stringify(`${where}: ${path} fehlt`)}))`);
  /** `f` built in a method (scope) of its own: its bindings and names apart, its body a ZIO */
  const apart = (own: string[], f: () => string): { value: string; binds: { name: string; io: string }[] } => {
    const outerBinds = binds;
    const outerNames = names;
    binds = [];
    names = new Set([...outerNames, ...own]);
    try {
      const value = f();
      return { value, binds };
    } finally {
      binds = outerBinds;
      names = outerNames;
    }
  };
  const rows = (args: string[]) => `(\n${indent(args.join(',\n'), '  ')}\n)`;
  const lambda = (f: Field) => (scope.has(f.name) ? `${scalaIdent(f.name)}0` : scalaIdent(f.name));

  /** a path into the field: of another type a type mapper converts it (each element of a list, an Option along) */
  const pathValue = (p: string, f: Field, chosen?: string): Translated => {
    const t = feelToScalaTyped(`= ${p}`, scope, ctx.types, f);
    if (t.todo || !t.type || (t.type === f.type && !chosen) || !!t.collection !== !!f.collection) return t;
    // the one the line chooses (one with a name only so), otherwise the one of the types
    const mapper = findMapper(ctx.mappers, t.type, f.type, ctx.idx.nameOf, chosen);
    if (!mapper) return t;
    const { home, explicit } = useMapper(mapper, ctx);
    const name = mapperExtension(mapper, ctx.idx.nameOf);
    // an extension: `x.toClientType`, `.map(_.toClientType)` - on its object where the name is not the only one
    const on = (x: string) => (explicit ? `${home.object}.${name}(${x})` : `${/^[\w.]+$/.test(x) ? x : `(${x})`}.${name}`);
    const each = explicit ? `${home.object}.${name}` : `_.${name}`;
    const scala = t.collection
      ? (t.optional ? `${t.scala}.map(_.map(${each}))` : `${t.scala}.map(${each})`)
      : (t.optional ? `${t.scala}.map(${each})` : on(t.scala));
    return { scala, optional: t.optional };
  };

  /** what a link gives the field: its FEEL expression, or its paths - the first one set */
  const linkValue = (l: FieldLink, f: Field): Translated => {
    const expr = l.expression?.trim();
    if (expr) return feelToScala(expr.startsWith('=') ? expr : `= ${expr}`, scope, ctx.types, f);
    const parts = linkPaths(l).map(p => pathValue(p, f, l.mapper));
    return parts.find(t => t.todo) ?? parts.slice(0, -1).reduceRight<Translated>((rest, t) => (!t.optional ? t
      : { scala: `${t.scala}.${rest.optional ? 'orElse' : 'getOrElse'}(${rest.scala})`, optional: rest.optional }), parts[parts.length - 1]);
  };

  /**
   * The value of the field `f` at `path` - null where a copy of `on` keeps it. `at`: how the
   * test reaches it from the result (null: an Option on the way).
   */
  const value = (f: Field, path: string, on: string | null, at: string | null): string | null => {
    const stored = m.fields.find(x => x.field === path);
    const l = inCase(stored);
    const caseLink = (m.caseLinks ?? []).find(c => c.field === path);
    const sub = (hasInner(m, path) || caseLink) && !f.collection ? typeOf(f.type, ctx) : undefined;
    // an enum with cases built from its fields: the case the source's case decides
    if (sub && isAdt(sub) && (caseLink || !l)) {
      // the match is a ZIO (the methods of the cases fail): bound, before it builds
      const v = caseLink ? bind(f.name, adtValue(sub, caseLink, path)) : todo(`${path}: ein Enum mit Fällen - im Mapping je Fall der Quelle einen Fall wählen`);
      return f.optional ? `Some(${v})` : v;
    }
    if (sub?.kind === 'case') {
      const whole = l ? linkValue(l, f) : null;
      if (whole?.todo) return whole.scala;
      const it = whole ?? (on ? { scala: `${on}.${scalaName(f.name)}`, optional: !!f.optional } : null);
      const inner = `${path}.`;
      const reach = f.optional ? null : at;
      let v: string;
      if (!it) v = build(sub, inner, null, reach);
      else if (!it.optional) v = build(sub, inner, /^[\w.]+$/.test(it.scala) ? it.scala : `(${it.scala})`, reach);
      else if (f.optional) {
        // what it needs resolved inside: each value of the Option in a ZIO of its own
        const x = lambda(f);
        const b = apart([x], () => build(sub, inner, x, null));
        v = !b.binds.length ? `${it.scala}.map(${x} =>\n${indent(b.value, '  ')}\n)`
          : bind(f.name, `ZIO.foreach(${it.scala})(${x} =>\n${indent(forComprehension(b.binds, b.value, where), '  ')}\n)`);
        return v;
      }
      else v = build(sub, inner, required(path, it.scala), at);
      return f.optional && !it?.optional ? `Some(${v})` : v;
    }
    if (!l || (!l.expression?.trim() && !linkPaths(l).length)) {
      if (on) return null;
      if (f.optional) return 'None';
      if (f.collection) return 'Seq.empty';
      // a line from fields this case of the source does not have (`sourceClient.name` only in `Company`)
      return todo(stored && branch ? `${path}: ${linkPaths(stored).join(', ')} gibt es im Fall ${branch.case} von ${branch.name} nicht` : `${path}: nicht zugeordnet`);
    }
    const t = linkValue(l, f);
    const v = forTarget(t, !!f.optional);
    const scala = v.needed ? required(path, v.scala) : v.scala;
    if (at && !t.todo && !v.needed) checks.push({ at, value: scala });
    return scala;
  };

  /** the source of the match being built - a case of it has not every field of another */
  let branch: { name: string; case: string; fields: Set<string> } | null = null;
  /** a link in a branch: without the paths into a field this case of the source does not have */
  const inCase = (l: FieldLink | undefined): FieldLink | undefined => {
    if (!l || !branch) return l;
    const b = branch;
    const from = l.from.filter(p => !p.startsWith(`${b.name}.`) || b.fields.has(p.slice(b.name.length + 1).split('.')[0]));
    return from.length || l.expression?.trim() ? { ...l, from } : undefined;
  };

  /**
   * An enum with cases (`ClientRead`) from the links below `path`: a match on the case of the
   * source (`sourceClient`) - in each branch the source is that case (its own fields readable), the
   * value the case of the target it becomes, field by field. A case of the source without one fails.
   */
  const adtValue = (adt: TypeDef, c: CaseLink, path: string): string => {
    const source = scope.get(c.from);
    const src = source?.type ? typeOf(source.type, ctx) : undefined;
    if (!source || !src || !isAdt(src)) return todo(`${path}: «${c.from}» ist kein Enum mit Fällen im In`);
    const name = c.from;
    const branches: string[] = [];
    for (const sc of src.values ?? []) {
      const to = c.cases.find(x => x.from === sc.name)?.to;
      const tv = to ? (adt.values ?? []).find(v => v.name === to) : undefined;
      if (!tv) continue;
      // the source as this case: the shared fields and its own
      const own = sc.fields ?? [];
      const narrowed: TypeDef = { id: `${source.type ?? src.id}#${sc.name}`, name: `${src.name}.${caseIdent(sc.name)}`, kind: 'case', fields: [...own, ...(src.fields ?? []).filter(x => !own.some(o => o.name === x.name))] };
      // a case takes the shared fields and its own (see EnumValue.order) - by name, so their order does not matter
      const target: TypeDef = { id: `${adt.id}#${tv.name}`, name: `${adt.name}.${caseIdent(tv.name)}`, kind: 'case', fields: [...(adt.fields ?? []).filter(x => !(tv.fields ?? []).some(o => o.name === x.name)), ...(tv.fields ?? [])] };
      ctx.types.push(narrowed);
      scope.set(name, { ...source, type: narrowed.id });
      const outer = branch;
      const outerChecks = checks;
      branch = { name, case: sc.name, fields: new Set((narrowed.fields ?? []).map(x => x.name)) };
      checks = [];
      try {
        // in a method of its own: the test reaches the fields from its result, the target case
        const built = apart([], () => build(target, `${path}.`, null, 'result'));
        const body = forComprehension(built.binds, built.value, where);
        const call = onCase({
          source: { id: `case-${sc.name}`, name, type: source.type!, enumCase: sc.name },
          sourceCase: sc.name,
          target: { id: `case-${tv.name}`, name: path.split('.').pop()!, type: adt.id, enumCase: tv.name },
          body, checks,
        });
        branches.push(`case ${scalaIdent(name)}: ${narrowed.name} => ${call}`);
      } finally {
        scope.set(name, source);
        branch = outer;
        checks = outerChecks;
      }
    }
    const open = (src.values ?? []).filter(sc => !(adt.values ?? []).some(v => v.name === c.cases.find(x => x.from === sc.name)?.to));
    if (open.length) branches.push(`case other => ZIO.fail(CustomError(s"${where}: ${src.name} $other - kein Fall von ${adt.name} gewählt"))`);
    return `${source.scala} match\n${indent(branches.join('\n'), '  ')}`;
  };

  /** The class `t` from the links below `prefix`: a copy of `on`, or field by field. */
  const build = (t: TypeDef, prefix: string, on: string | null, at: string | null): string => {
    const args: string[] = [];
    for (const f of (t.fields ?? []).filter(x => x.name && isFinished(x, ctx.idx))) {
      const v = value(f, `${prefix}${f.name}`, on, at ? `${at}.${scalaName(f.name)}` : null);
      if (v !== null) args.push(`${scalaName(f.name)} = ${v}`);
    }
    if (on) return args.length ? `${on}.copy${rows(args)}` : on;
    // a class built by name: the worker imports it (`MasterRead` of the catalog)
    ctx.builtTypes.add(t.id.replace(/#.*$/, ''));
    return `${t.name}${rows(args)}`;
  };

  return { value, checks, binds: () => binds };
}

const upperFirst = (n: string) => `${n.charAt(0).toUpperCase()}${n.slice(1)}`;

/**
 * The method of a mapping - English, whatever the step is called: `map` and what it builds
 * (`mapFilClient`), its first Out. The code sync finds it by the same name (workerSync.ts).
 */
export function mappingMethodName(m: Pick<FieldMapping, 'out'>): string {
  const first = m.out.find(f => f.name.trim())?.name.trim();
  return `map${upperFirst(camelName(first || 'value'))}`;
}

/** A script task as a mapping: its method - In the parameters, Out the result (a tuple for several) - and its call. */
function mappingCall(s: Step, stored: FieldMapping, known: OrchVar[], ctx: Ctx): { line: string; produced: OrchVar[] } {
  const m = mappingOf(stored);
  const where = s.name || s.id;
  const params = m.in.filter(f => f.name.trim() && f.type);
  const outs = m.out.filter(f => f.name.trim() && f.type);
  if (!outs.length) { ctx.notes.push(`«${where}»: das Mapping hat kein Out`); return { line: '', produced: [] }; }
  // a name twice (see inOutIssues) would be a parameter or a binding twice - no method
  const dups = (fs: Field[]) => fs.map(f => f.name.trim()).filter((n, i, l) => l.indexOf(n) !== i);
  const twice = [...dups(params), ...dups(outs)];
  if (twice.length) { ctx.notes.push(`«${where}»: im Mapping zweimal: ${[...new Set(twice)].join(', ')}`); return { line: '', produced: [] }; }
  const scope = new Map<string, ScalaVar>(params.map(f => [f.name, { scala: scalaIdent(f.name), type: f.type, optional: !!f.optional, collection: !!f.collection }]));
  const one = outs.length === 1;
  // the method of the mapping first - the methods of the cases of an enum follow it
  const method = uniqueMethod(ctx, mappingMethodName(m));
  const entry: ScriptMethod = {
    step: where, method, ...(s.description?.trim() ? { description: s.description.trim() } : {}),
    params, result: outs[0], ...(one ? {} : { results: outs }), body: '', cases: [], io: true,
  };
  ctx.scripts.push(entry);
  const onCase: CaseMethod = c => {
    const name = uniqueMethod(ctx, `${method}${c.sourceCase.charAt(0).toUpperCase()}${c.sourceCase.slice(1).replace(/[^A-Za-z0-9]/g, '')}`);
    const caseParams = params.map(p => (p.name === c.source.name ? { ...p, ...c.source, id: p.id } : p));
    // the result is the enum itself: the comparison per case (a catalog enum has an example per case only)
    if (one && c.target.type === entry.result.type) entry.byCase = true;
    ctx.scripts.push({
      step: `${where}: ${c.sourceCase}`, method: name, params: caseParams, result: c.target, body: c.body, cases: [], io: true,
      ...(c.checks.length ? { checks: c.checks } : {}),
    });
    return `${name}(${params.map(p => scalaIdent(p.name)).join(', ')})`;
  };
  const { value, checks, binds } = mappingValues(m, scope, ctx, where, onCase);
  const values = outs.map((f, i) => value(f, f.name, null, one ? 'result' : `result._${i + 1}`) ?? '');
  // a type mapper is an extension of the domain - the test calls it as the worker does
  entry.body = forComprehension(binds(), one ? values[0] : `(\n${indent(values.join(',\n'), '  ')}\n)`, where);
  if (checks.length) entry.checks = checks;
  const args = params.map(f => known.find(k => k.name === f.name)?.scala ?? todo(`${where}: ${f.name} ist vor dem Schritt nicht bekannt`));
  const names = outs.map(f => scalaIdent(f.name));
  return {
    line: `${one ? names[0] : `(${names.join(', ')})`} <- ${method}(${args.join(', ')})`,
    produced: outs.map(f => ({
      name: f.name, scala: scalaIdent(f.name), type: f.type, source: 'Script',
      ...(f.optional ? { optional: true } : {}), ...(f.collection ? { collection: true } : {}),
    })),
  };
}

/** The variables a FEEL expression reads - of those known, in the order it names them. */
function readVars(body: string, known: OrchVar[]): OrchVar[] {
  const code = body.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const names = [...code.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)].map(m => m[1]);
  const seen = new Set<string>();
  return names.flatMap(n => {
    const v = known.find(k => k.name === n);
    return v && !seen.has(n) && (seen.add(n), true) ? [v] : [];
  });
}

/** The type of a script's value from what it reads: lists of one type concatenated, or one variable. */
function derivedType(body: string, reads: OrchVar[]): Partial<OrchVar> {
  const parts = listParts(body);
  if (parts?.length) {
    const vs = parts.map(p => reads.find(v => v.name === p));
    const types = new Set(vs.map(v => v?.type));
    if (vs.every(Boolean) && types.size === 1) return { type: vs[0]!.type, collection: true, optional: false };
    return {};
  }
  const one = reads.find(v => v.name === body.trim());
  return one ? { type: one.type, collection: !!one.collection, optional: !!one.optional } : {};
}

/** A script task with an implementation: its method - and the line of the `for` that calls it. */
function scriptCall(s: Step, task: ServiceOrchestrationSpec['tasks'][string], known: OrchVar[], ctx: Ctx): { line: string; produced: OrchVar | null } {
  const where = s.name || s.id;
  const declared = scriptResultVar(ctx.o, task);
  if (!declared) { ctx.notes.push(`«${where}»: die Implementierung hat keine Ergebnis-Variable`); return { line: '', produced: null }; }
  const body = (task.script ?? '').trim().replace(/^=\s*/, '');
  const reads = readVars(body, known);
  const { typed, ...produced0 } = declared;
  // without a type: derived where the expression says it - lists of one type, or one variable
  const produced: OrchVar = typed ? produced0 : { ...produced0, ...derivedType(body, reads) };
  const params: Field[] = reads.map(v => ({
    id: `p-${v.name}`, name: v.name, type: v.type, ...(v.optional ? { optional: true } : {}), ...(v.collection ? { collection: true } : {}),
  }));
  const result: Field = {
    id: `r-${produced.name}`, name: produced.name, type: produced.type,
    ...(produced.optional ? { optional: true } : {}), ...(produced.collection ? { collection: true } : {}),
  };
  const scope = new Map<string, ScalaVar>(params.map(f => [f.name, { scala: scalaIdent(f.name), type: f.type, optional: !!f.optional, collection: !!f.collection }]));
  const t = scriptScala(body, scope, result, ctx, where);
  const method = uniqueMethod(ctx, `compute${upperFirst(camelName(produced.name))}`);
  ctx.scripts.push({
    step: where, method, ...(s.description?.trim() ? { description: s.description.trim() } : {}),
    params, result, body: t.scala, ...(t.concat ? { concat: t.concat } : {}), cases: t.cases,
  });
  const call = `${method}(${reads.map(v => v.scala).join(', ')})`;
  return {
    line: `${scalaIdent(produced.name)} <- ZIO.attempt(${call}).mapError(e => ${failWith(`${where}: `, 'e.getMessage')})`,
    produced: { ...produced, scala: scalaIdent(produced.name) },
  };
}

/** The method of a script task in the worker. */
function scriptMethod(m: ScriptMethod, idx: TypeIndex): string {
  const params = m.params.map(f => `${scalaIdent(f.name)}: ${fieldType(f, idx)}`).join(', ');
  const doc = [`  /** ${m.step}${m.description ? ` - ${m.description.split('\n')[0]}` : ''} - a test calls it with examples */`];
  const plain = m.results ? `(${m.results.map(f => fieldType(f, idx)).join(', ')})` : fieldType(m.result, idx);
  const result = m.io ? `IO[CustomError, ${plain}]` : plain;
  return [...doc, `  def ${m.method}(${params}): ${result} =`, indent(m.body, '    ')].join('\n');
}

/** Per script method a test: with the examples of what it reads - the lists all in it, each in its case. */
function scriptTest(m: ScriptMethod, idx: TypeIndex): string {
  const vals = m.params.map(f => `    val ${scalaIdent(f.name)} = ${exampleValue({ ...f, example: undefined }, idx)}`);
  const call0 = `Mocked().${m.method}(${m.params.map(f => scalaIdent(f.name)).join(', ')})`;
  // a ZIO: run - a missing value fails the test with its message
  const call = m.io ? `runIO(${call0})` : call0;
  const list = (f: Field) => (!f.collection ? (f.optional ? `${scalaIdent(f.name)}.size` : '1') : f.optional ? `${scalaIdent(f.name)}.getOrElse(Seq.empty).size` : `${scalaIdent(f.name)}.size`);
  const got = m.result.optional ? 'result.getOrElse(Seq.empty)' : 'result';
  const checks = m.checks?.length
    ? m.checks.map(c => `    assertEquals(${c.at}, ${c.value.replace(/\n\s*/g, ' ')})`)
    : m.concat
    ? [
      `    assertEquals(${got}.size, ${m.concat.map(n => list(m.params.find(f => f.name === n)!)).join(' + ')})`,
      ...m.cases.map(c => `    assert(${got}.exists(_.isInstanceOf[${c}]), result)`),
    ]
    : m.cases.length
      ? m.cases.map(c => `    assert(${m.result.optional ? `result.exists(_.isInstanceOf[${c}])` : `result.isInstanceOf[${c}]`}, result)`)
      : [`    // TODO ${m.step}: das erwartete Ergebnis prüfen`, '    assert(result != null)'];
  const test = [`  test(${JSON.stringify(m.method)}):`, ...vals, `    val result = ${call}`, ...checks].join('\n');
  return [test, ...(m.io && !m.results && !m.byCase ? [exampleTest(m, vals, call, idx)] : [])].join('\n\n');
}

/**
 * A mapping: its examples give the example of the target - so the examples of both sides (their
 * defaults) and the type mappers fit each other. With a TODO: what the source does not have
 * (a field of another case, no line) the code takes out of the expected value - it keeps that.
 */
function exampleTest(m: ScriptMethod, vals: string[], call: string, idx: TypeIndex): string {
  const target = fieldType({ ...m.result, optional: false }, idx);
  return [
    `  test(${JSON.stringify(`${m.method}: the example gives the example of ${target}`)}):`,
    ...vals,
    `    // TODO ${m.step}: was die Quelle nicht hat, aus dem erwarteten Wert nehmen (expected.copy(…))`,
    `    val expected = ${exampleValue({ ...m.result, example: undefined }, idx)}`,
    `    assertEquals(${call}, expected)`,
  ].join('\n');
}

/** `base`, or numbered - a name no method of the worker has yet (its script tasks) */
function uniqueMethod(ctx: Ctx, base: string): string {
  const used = new Set(ctx.scripts.map(x => x.method));
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}${i}`;
  return name;
}

/** The package of the class behind a type - its own schema, a collection's, the catalog's; null for none (`BigDecimal`). */
function typePackage(ref: string, ctx: Ctx): string | null {
  const dom = ctx.idx.domainOf(ref);
  if (dom) return dom.pkg;
  if (ctx.o.types.some(t => t.id === ref && !t.interactionId)) return `${collectionPackage(orchestrationApi(ctx.o))}.schema`;
  for (const c of ctx.collections) {
    const t = c.types.find(x => x.id === ref);
    if (t && !t.interactionId) return schemaPackageOf(c, t.id) ?? `${typeHome(c, t.id)}.schema`;
  }
  return null;
}

/** The import of the class behind a type for code in `pkg` - none in the same package or for none. */
function typeImport(ref: string, ctx: Ctx, pkg: string): string | null {
  const dom = ctx.idx.domainOf(ref);
  if (dom) return dom.pkg === pkg ? null : `import ${dom.importPath}`;
  const at = typePackage(ref, ctx);
  return at && at !== pkg ? `import ${at}.${ctx.idx.nameOf(ref).replace(/^.*\./, '')}` : null;
}

/** Where a mapper lives in the code - one of the code where it is, one of the model see mapperHome. */
function homeOf(m: TypeMapper, ctx: Ctx): MapperHome {
  if (m.code) return { pkg: m.code.pkg, object: m.code.object };
  const api = orchestrationApi(ctx.o);
  const root = `${ctx.o.project.split('-').filter(Boolean).join('.')}.domain`;
  return mapperHome([typePackage(m.from, ctx), typePackage(m.to, ctx)], root, [...api.api.split('.'), `v${api.apiVersion}`]);
}

/**
 * A mapper the worker uses: where it lives, and whether it is called on its object - when a
 * mapper of another object has the same extension name, both imported would be ambiguous.
 */
function useMapper(m: TypeMapper, ctx: Ctx): { home: MapperHome; explicit: boolean } {
  const had = ctx.usedMappers.get(m.id);
  if (had) return had;
  const home = homeOf(m, ctx);
  const name = mapperExtension(m, ctx.idx.nameOf);
  const key = (h: MapperHome) => `${h.pkg}.${h.object}`;
  // a method of the type itself (`x.toString`) is never ambiguous - and has no object to call it on;
  // a standard one with the name of one of the project's is called on its object, the project's stays
  // an extension - otherwise two of the project's with one name, both on their object
  const explicit = !!home.object && ctx.mappers.some(o => o.id !== m.id && o.from && o.to && !isMember(o)
    && !isStandard(o)
    && mapperExtension(o, ctx.idx.nameOf) === name && key(homeOf(o, ctx)) !== key(home));
  const used = { mapper: m, home, explicit };
  ctx.usedMappers.set(m.id, used);
  return used;
}

/** The files of the mappers the worker uses - per object, in the `schema` of its level; the helper merges them into the code. */
function mapperFiles(ctx: Ctx): ScalaFile[] {
  const byObject = new Map<string, { home: MapperHome; mappers: TypeMapper[] }>();
  for (const { mapper, home } of ctx.usedMappers.values()) {
    // one of the code is there already
    if (mapper.code) continue;
    const k = `${home.pkg}.${home.object}`;
    byObject.set(k, { home, mappers: [...(byObject.get(k)?.mappers ?? []), mapper] });
  }
  return [...byObject.values()].map(({ home, mappers }) => {
    const imports = new Set<string>();
    for (const m of mappers) {
      for (const ref of [m.from, m.to]) { const i = typeImport(ref, ctx, home.pkg); if (i) imports.add(i); }
      for (const i of mapperImports(m)) imports.add(i);
    }
    const sorted = [...imports].sort();
    return {
      path: `01-domain/src/main/scala/${home.pkg.replace(/\./g, '/')}/${home.object}.scala`,
      content: [
        packageClause(home.pkg), '', ...(sorted.length ? [...sorted, ''] : []),
        '/** Type mappers - from Orch Spec (Administration → Typ-Mapper): `existing.kind.toClientType` */',
        `object ${home.object}:`, '',
        mappers.map(m => mapperCode(m, ctx.idx.nameOf, enumCases(m.from, ctx.idx), enumCases(m.to, ctx.idx))).join('\n\n'), '',
        `end ${home.object}`, '',
      ].join('\n'),
    };
  });
}

/** The imports of the types the methods of the script tasks name - the schema of their collection. */
function scriptImports(ctx: Ctx): string[] {
  const out = new Set<string>();
  // the classes a mapping builds by name - of the catalog or a collection; the own schema is imported anyway
  for (const id of ctx.builtTypes) {
    const i = typeImport(id, ctx, `${collectionPackage(orchestrationApi(ctx.o))}.schema`);
    if (i) out.add(i);
  }
  // the extensions of the type mappers - their object where one is called on it
  // an object with one called on it: the others by name - all of it would bring that name along too
  const used = [...ctx.usedMappers.values()].filter(u => u.home.object);
  for (const { home, explicit, mapper } of used) {
    const obj = `${home.pkg}.${home.object}`;
    const mixed = used.some(u => u.explicit && `${u.home.pkg}.${u.home.object}` === obj);
    if (explicit) out.add(`import ${obj}`);
    else out.add(mixed ? `import ${obj}.${mapperExtension(mapper, ctx.idx.nameOf)}` : `import ${obj}.*`);
  }
  for (const m of ctx.scripts) {
    for (const f of [...m.params, m.result, ...(m.results ?? [])]) {
      const dom = ctx.idx.domainOf(f.type);
      if (dom) { out.add(`import ${dom.importPath}`); continue; }
      if (ctx.o.types.some(t => t.id === f.type && !t.interactionId)) continue;
      for (const c of ctx.collections) {
        const t = c.types.find(x => x.id === f.type);
        if (t && !t.interactionId) out.add(`import ${schemaPackageOf(c, t.id) ?? `${typeHome(c, t.id)}.schema`}.*`);
      }
    }
  }
  return [...out].sort();
}

/** An exclusive gateway whose conditions each compare one variable with a value - the values. */
export function matchOf(conditions: (string | undefined)[], vars: Map<string, ScalaVar>, types: TypeDef[]): { variable: ScalaVar; name: string; patterns: string[]; values: string[]; exhaustive: boolean } | null {
  const parsed = conditions.map(c => /^=?\s*([A-Za-z_]\w*)\s*=\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)\s*$/.exec((c ?? '').trim()));
  if (!parsed.length || parsed.some(p => !p) || new Set(parsed.map(p => p![1])).size !== 1) return null;
  const name = parsed[0]![1];
  const variable = vars.get(name);
  if (!variable || variable.collection || variable.byCase) return null;
  const en = variable.type ? types.find(t => t.id === variable.type && t.kind === 'enum') : undefined;
  if (en && (en.values ?? []).some(v => v.fields?.length)) return null;
  const literals = parsed.map(p => p![2]);
  // without an enum a pattern only where the literal is of the variable's type: text, Int, Boolean -
  // `case 1 =>` on a Double or BigDecimal does not compile (then the if)
  const fits = (l: string) => (/^"/.test(l) ? variable.type === 'String'
    : /^-?\d+$/.test(l) ? variable.type === 'Int' : /^(true|false)$/.test(l) ? variable.type === 'Boolean' : false);
  if (!en && !literals.every(fits)) return null;
  let patterns: string[];
  if (en) {
    const cases = (en.values ?? []).map(v => v.name);
    const values = literals.map(l => (/^"/.test(l) ? JSON.parse(l) as string : l));
    // a value the enum lacks: no match - the condition says it as a TODO
    if (values.some(v => !cases.includes(v))) return null;
    patterns = values.map(v => `${en.name}.${caseIdent(v)}`);
  } else patterns = literals;
  if (new Set(patterns).size !== patterns.length) return null;
  const all = en ? (en.values ?? []).length === patterns.length : false;
  return {
    variable, name,
    patterns: variable.optional ? patterns.map(p => `Some(${p})`) : patterns,
    // the values themselves - a test sets them in a field that has its own optionality
    values: patterns,
    exhaustive: all && !variable.optional,
  };
}

/** The `In` of a service from the variables known there — field by field, an ADT stays to do. */
function serviceIn(ref: ServiceRef, task: ServiceOrchestrationSpec['tasks'][string] | undefined, vars: Map<string, ScalaVar>, ctx: Ctx, pre: string[]): string {
  const name = ref.service.name;
  if (ref.service.noIn) return 'NoInput()';
  const inType = serviceMembers(ref).in;
  if (!inType) return `${name}.In()`;
  // an ADT: the case the step chose - with the shared fields
  const chosen = inType.kind === 'enum'
    ? (inType.values ?? []).find(v => v.name === task?.inCase) ?? ((inType.values ?? []).length === 1 ? inType.values![0] : undefined)
    : undefined;
  if (inType.kind === 'enum' && !chosen) return todo(`${name}.In ist ein ADT — beim Schritt die Ausprägung wählen`);
  const ctor = chosen ? `${name}.In.${caseIdent(chosen.name)}` : `${name}.In`;
  const fields = chosen ? caseFields(inType, chosen.name) : (inType.fields ?? []);
  const args = fields.filter(f => isFinished(f, ctx.idx)).map(f => {
    const expr = (task?.inputs ?? []).find(m => m.name === f.name)?.expression?.trim() || (vars.has(f.name) ? `= ${f.name}` : '');
    if (!expr) return `${scalaName(f.name)} = ${f.optional ? 'None' : todo(`${f.name}: kein Mapping`)}`;
    const v = forTarget(feelToScala(expr, vars, ctx.types, f), !!f.optional);
    if (!v.needed) return `${scalaName(f.name)} = ${v.scala}`;
    // required, but optional on the way: a step that fails with a message
    const tmp = `${f.name}${++ctx.n.value}`;
    pre.push(`${tmp} <- ZIO.fromOption(${v.scala}).orElseFail(CustomError(${JSON.stringify(`${name}: ${f.name} fehlt`)}))`);
    return `${scalaName(f.name)} = ${tmp}`;
  });
  if (!args.length) return chosen ? ctor : `${name}.In()`;
  return `${ctor}(\n${indent(args.join(',\n'), '  ')}\n)`;
}

/**
 * «Prozess mit Fehler stoppen» on an end of the flow: in a worker the path fails - `ZIO.fail` with
 * its message (text or FEEL). null: not that end.
 */
function stopWithError(s: Step, vars: Map<string, ScalaVar>, ctx: Ctx): string | null {
  const p = (s.patterns ?? []).find(x => x.id === 'stop-with-error');
  if (!p || s.kind !== 'end') return null;
  const message = (p.params?.message ?? '').trim() || 'Der Prozess wurde mit einem Fehler gestoppt.';
  const scala = message.startsWith('=')
    ? feelToScala(message, vars, ctx.types, { id: 'message', name: 'message', type: 'String' } as Field).scala
    : /\$\{/.test(message) ? todo(`«${s.name || s.id}»: die Fehlermeldung als «= …» schreiben`) : JSON.stringify(message);
  return `ZIO.fail(CustomError(${scala}))`;
}

/**
 * The In of a call - with a place still to fill (`???`) in a method of its own, called with what it
 * reads: runWorkZIO stays without TODOs, the method says what is missing.
 */
function inputCall(input: string, ref: ServiceRef, s: Step, vars: Map<string, ScalaVar>, ctx: Ctx): string {
  if (!input.includes('???')) return input;
  const svc = ref.service.name;
  const base = `${svc.charAt(0).toLowerCase()}${svc.slice(1)}In`;
  let name = base;
  for (let i = 2; ctx.helpers.some(h => h.name === name) || ctx.scripts.some(m => m.method === name); i++) name = `${base}${i}`;
  // a mapping In -> <Service>.In: the In of the worker always, the variables of the run it uses besides
  const params = [
    ...(ctx.o.noIn && !/\bin\b/.test(input) ? [] : [{ name: 'in', type: ctx.o.noIn ? 'NoInput' : 'In' }]),
    ...[...vars.entries()]
      .filter(([, v]) => /^[A-Za-z_]\w*$/.test(v.scala) && v.scala !== 'in' && new RegExp(`\\b${v.scala}\\b`).test(input))
      .map(([n, v]) => ({ name: v.scala, type: fieldType({ id: n, name: n, type: v.type ?? 'String', ...(v.optional ? { optional: true } : {}), ...(v.collection ? { collection: true } : {}) } as Field, ctx.idx) })),
  ];
  ctx.helpers.push({
    name,
    code: [
      `  /** maps the In of the worker to the In of «${s.name || s.id}» (${svc}) - still to complete (see the TODO) */`,
      `  private def ${name}(${params.map(p => `${p.name}: ${p.type}`).join(', ')}): ${svc}.In =`,
      indent(input, '    '),
    ].join('\n'),
  });
  return `${name}(${params.map(p => p.name).join(', ')})`;
}

/**
 * Each place still to fill in the code of the run (`??? /* TODO … *\/`) a method of its own - `todo1`,
 * of type `Nothing`, so it fits wherever it stands: the run says what it does, the methods what is missing.
 */
function withoutTodos(code: string, ctx: Ctx): string {
  return code.replace(/\?\?\? \/\* TODO ([\s\S]*?) \*\//g, (_, text: string) => {
    let n = ctx.helpers.filter(h => /^todo\d+$/.test(h.name)).length + 1;
    while (ctx.helpers.some(h => h.name === `todo${n}`)) n++;
    const name = `todo${n}`;
    ctx.helpers.push({ name, code: `  /** TODO ${text.replace(/\*\//g, '* /')} */\n  private def ${name}: Nothing = ???` });
    return name;
  });
}

/** An ISO 8601 duration (`PT1M`) as a ZIO Duration. */
const isoDuration = (scala: string) => `zio.Duration.fromJava(java.time.Duration.parse(${scala}))`;

/**
 * How long a timer event waits: a duration as text (`PT1M`), a variable in scope (`= waitFor`), or a
 * timer variable of the orchestration (`= timerWaitForStatus`) - then a method of the worker with
 * its default, which a test makes zero. A date or a cycle: a TODO (a worker waits a duration).
 */
function timerDuration(s: Step, vars: Map<string, ScalaVar>, ctx: Ctx): string {
  const t = s.timer;
  if (!t || t.kind !== 'duration') return todo(`«${s.name || s.id}»: ein Worker wartet eine Dauer - kein Datum, kein Zyklus`);
  const name = timerVariable(t);
  if (name) {
    const v = vars.get(name);
    if (v) return isoDuration(v.optional ? `${v.scala}.getOrElse(${JSON.stringify(t.default?.trim() || 'PT0S')})` : v.scala);
    ctx.timers.set(name, { ...(t.default?.trim() ? { default: t.default.trim() } : {}), step: s.name || s.id });
    return scalaIdent(name);
  }
  const text = t.expression.trim().replace(/^=\s*/, '').replace(/^"(.*)"$/, '$1');
  return /^P/.test(text) ? isoDuration(JSON.stringify(text)) : todo(`«${s.name || s.id}»: Dauer ${t.expression}`);
}

/** The lines of the `for` for a list of steps — and the variables known after them. */
function forLines(steps: Step[], before: OrchVar[], ctx: Ctx): string[] {
  const lines: string[] = [];
  let known = [...before];
  for (const s of steps) {
    const task = ctx.o.tasks[s.id];
    const vars = scalaVars(known);
    if (s.kind === 'service') {
      const ref = task?.service ? ctx.services.get(task.service) : undefined;
      if (!ref) { lines.push(`_ <- ZIO.fail(CustomError(${JSON.stringify(`«${s.name || s.id}»: kein Service - im Schritt den Service wählen`)}))`); continue; }
      ctx.called.set(ref.topic, ref);
      const pre: string[] = [];
      const input = inputCall(serviceIn(ref, task, vars, ctx, pre), ref, s, vars, ctx);
      lines.push(...pre);
      const outputs = (task?.outputs ?? []).filter(m => !m.disabled && m.name.trim());
      const target = ref.service.noOut || (task?.outputs && !outputs.length) ? '_' : resultName(task, ref);
      const name = ref.service.name;
      const call = input.includes('\n') ? [`${target} <- run${name}(`, indent(input, '  '), ')'] : [`${target} <- run${name}(${input})`];
      // an ADT Out: the case it reads - another one is an error with its name
      const outType = serviceMembers(ref).out;
      const outCase = target === '_' ? undefined : outCaseOfTask(task, outType);
      if (outCase) {
        const last = call.pop()!;
        call.push(`${last}.collect(CustomError(${JSON.stringify(`${name}: nicht Out.${caseName(outCase)}`)})) { case out: ${name}.Out.${caseIdent(outCase)} => out }`);
      }
      lines.push(...call);
      // as a process describes it: the variables from the fields of the Out — the result itself is not kept
      if (task?.outputs && target !== '_') {
        const fields = outCase && outType ? caseFields(outType, outCase) : (outType?.fields ?? []);
        const outFields = new Map<string, ScalaVar>(fields.filter(f => f.name).map(f =>
          [f.name, { scala: `${target}.${scalaName(f.name)}`, type: f.type, optional: !!f.optional, collection: !!f.collection }]));
        const scope = new Map([...vars, ...outFields]);
        for (const m of outputs) {
          // converted into the type the row names (`mapTo`) - or a class into the type the Out defines (`Client.Person`)
          const mapped = m.mapTo ? mappedOutput(m, scope, ctx, name) : null;
          const c = mapped ? null : conversionOf(ctx.o, m, scope, ctx.types);
          const pre: string[] = [];
          const value = mapped?.scala ?? (c ? converted(c, ctx, pre) : feelToScala(m.expression, scope, ctx.types).scala);
          const ident = scalaIdent(m.name.trim());
          if (mapped?.throws) lines.push(`${ident} <- ZIO.attempt(${value}).mapError(e => ${failWith(`${name}: `, 'e.getMessage')})`);
          else lines.push(...pre, `${ident} = ${value}`);
          const out = outFieldOf(ctx.o, m.name.trim());
          if (mapped?.to && out && !out.collection) {
            ctx.conversions.set(s.id, [...(ctx.conversions.get(s.id) ?? []), { field: out.name, optional: !!out.optional, to: mapped.to }]);
          }
          // what the test sets and checks
          const field = /^=\s*([A-Za-z_]\w*)\s*$/.exec(m.expression.trim())?.[1];
          if (field && outFields.has(field)) ctx.sources.set(m.name.trim(), { service: name, field, optional: !!outFields.get(field)!.optional, ...(outCase ? { outCase } : {}) });
          if (c) {
            const to = c.caseOf ? `${c.to.name}.${caseIdent(c.caseOf)}` : c.to.name;
            ctx.conversions.set(s.id, [...(ctx.conversions.get(s.id) ?? []), { field: c.field.name, optional: !!c.field.optional, to }]);
          }
        }
      }
      // not in runWorkZIO: a note above it
      if (s.errors?.length) ctx.notes.push(`Fehlerpfad${s.errors.length === 1 ? '' : 'e'} von «${s.name || s.id}»: ${s.errors.map(e => e.label || e.code || 'Fehler').join(', ')} — im Code behandeln (catchSome)`);
    } else if (s.kind === 'script') {
      if (task?.mapping || task?.script?.trim()) {
        const c = task.mapping ? mappingCall(s, task.mapping, known, ctx) : scriptCall(s, task, known, ctx);
        if (c.line) lines.push(c.line);
        for (const v of Array.isArray(c.produced) ? c.produced : c.produced ? [c.produced] : []) {
          known = [...known.filter(k => k.name !== v.name), v];
          ctx.scriptVars.set(v.name, v);
        }
      }
      for (const a of task?.assignments ?? []) {
        if (!a.name.trim()) continue;
        const t = feelToScala(a.expression, scalaVars(known), ctx.types);
        lines.push(`${scalaIdent(a.name.trim())} = ${t.scala}`);
        known = [...known, { name: a.name.trim(), scala: scalaIdent(a.name.trim()), type: feelValueType(a.expression, known) ?? 'String', source: 'Script', ...(t.optional ? { optional: true } : {}) }];
      }
      continue;
    } else if (s.kind === 'end' && stopWithError(s, vars, ctx)) {
      // the path ends with an error - the worker fails with its message
      lines.push(`_ <- ${stopWithError(s, vars, ctx)}`);
      continue;
    } else if (s.kind === 'event' && s.eventKind === 'timer') {
      // a timer in a worker: it waits - ZIO.sleep
      lines.push(`_ <- ZIO.sleep(${timerDuration(s, vars, ctx)})`);
      continue;
    } else if (s.kind === 'gateway' && s.gatewayType === 'parallel') {
      // each branch on its own fiber — then joined, its results by name
      const fibers = (s.branches ?? []).map(b => {
        const produced = producedBy(b.steps, ctx.o, ctx.services);
        return { fiber: `fiber${++ctx.n.value}`, produced, body: branchZio(b.steps, known, produced.map(v => v.name), ctx) };
      });
      for (const f of fibers) lines.push(`${f.fiber} <- (`, indent(f.body, '  '), ').fork');
      for (const f of fibers) lines.push(`${pattern(f.produced.map(v => v.name))} <- ${f.fiber}.join`);
    } else if (s.kind === 'gateway' && !(s.branches ?? []).length) {
      // a gateway without branches only joins (the start of a loop) - nothing to run
      continue;
    } else if (s.kind === 'gateway' && s.gatewayType === 'exclusive') {
      // one branch runs: what the branches produce is an Option afterwards
      const produced = producedBy([s], ctx.o, ctx.services).map(v => v.name);
      const branches = s.branches ?? [];
      const fallback = elseBranch(ctx.o, s);
      const conditional = branches.filter(b => b !== fallback);
      const some = (b: (typeof branches)[number]) => {
        const own = new Set(producedBy(b.steps, ctx.o, ctx.services).map(v => v.name));
        return branchZio(b.steps, known, produced.map(n => (own.has(n) ? `Some(${n})` : 'None')), ctx);
      };
      const none = `ZIO.succeed(${tuple(produced.map(() => 'None'))})`;
      const cases = conditional.map(b => {
        const cond = conditionOf(ctx.o, b);
        const t = cond ? feelCondition(cond, scalaVars(known), ctx.types) : null;
        const scalaCond = !t ? todo(`Bedingung für «${b.label || b.id}»`) : t.todo ? todo(`Bedingung: ${cond}`) : t.scala;
        return { cond: scalaCond, body: some(b) };
      });
      const els = fallback ? some(fallback) : none;
      // one variable against values: a match - its cases as the type has them
      const m = conditional.length ? matchOf(conditional.map(b => conditionOf(ctx.o, b)), scalaVars(known), ctx.types) : null;
      if (m) ctx.gateways.push({ variable: m.name, branches: conditional.map((b, i) => ({ label: b.label || m.patterns[i], pattern: m.patterns[i], value: m.values[i], steps: b.steps })) });
      const expr = m
        ? [`${m.variable.scala} match`,
          ...cases.map((c, i) => `  case ${m.patterns[i]} =>\n${indent(c.body, '    ')}`),
          ...(m.exhaustive && !fallback ? [] : [`  case _ =>\n${indent(els, '    ')}`])].join('\n')
        : cases.length
          ? cases.map((c, i) => `${i ? 'else if' : 'if'} ${c.cond} then\n${indent(c.body, '  ')}`).join('\n') + `\nelse\n${indent(els, '  ')}`
          : els;
      lines.push(`${pattern(produced)} <-`, indent(expr, '  '));
    }
    known = [...known, ...producedBy([s], ctx.o, ctx.services).filter(v => !known.some(k => k.name === v.name))];
    if (s.kind === 'gateway' && s.gatewayType === 'exclusive') {
      const produced = new Set(producedBy([s], ctx.o, ctx.services).map(v => v.name));
      known = known.map(k => (produced.has(k.name) ? { ...k, optional: true } : k));
    }
  }
  return lines;
}

/** `a` · `(a, b)` · `_` */
const pattern = (names: string[]) => (names.length === 0 ? '_' : names.length === 1 ? names[0] : `(${names.join(', ')})`);
/** `a` · `(a, b)` · `()` */
const tuple = (values: string[]) => (values.length === 0 ? '()' : values.length === 1 ? values[0] : `(${values.join(', ')})`);

/** A branch as one ZIO that yields the given values. */
function branchZio(steps: Step[], known: OrchVar[], yields: string[], ctx: Ctx): string {
  const body = forLines(steps, known, ctx);
  if (!body.length) return `ZIO.succeed(${tuple(yields)})`;
  // with braces: nested in `if` or `( ).fork`, the indentation does not matter
  return `(for {\n${indent(startWithGenerator(body).join('\n'), '  ')}\n} yield ${tuple(yields)})`;
}

/** A `for` begins with a generator — an assignment first gets one before it. */
const startWithGenerator = (lines: string[]): string[] =>
  lines.length && !/^\S+ <-|^\(.*\) <-/.test(lines[0]) ? ['_ <- ZIO.unit', ...lines] : lines;

/** The Out at the end: per field its mapping, a required one from an optional value fails with a message. */
function outValue(o: ServiceOrchestrationSpec, vars: OrchVar[], ctx: Ctx, pre: string[]): string {
  if (o.noOut) return 'NoOutput()';
  const out = o.types.find(t => t.id === o.outTypeId);
  const sv = scalaVars(vars);
  // per field its value — `expressionOf` empty: the variable of the same name, if there is one,
  // otherwise the one variable of its type - of several the one a script sets (`clients` ← `allClients: Seq[Client]`)
  const mapFields = (fields: Field[], expressionOf: (f: Field) => string, steps: string[]) =>
    fields.filter(f => isFinished(f, ctx.idx)).map((f: Field) => {
      const all = vars.filter(v => v.type === f.type && !!v.collection === !!f.collection);
      const byType = all.length > 1 ? all.filter(v => v.source === 'Script') : all;
      const expr = expressionOf(f).trim() || (sv.has(f.name) ? `= ${f.name}` : byType.length === 1 ? `= ${byType[0].name}` : '');
      if (!expr) return `${scalaName(f.name)} = ${f.optional ? 'None' : todo(`${f.name}: kein Mapping`)}`;
      const v = forTarget(feelToScala(expr, sv, ctx.types, f), !!f.optional);
      if (!v.needed) return `${scalaName(f.name)} = ${v.scala}`;
      const tmp = `${f.name}${++ctx.n.value}`;
      steps.push(`${tmp} <- ZIO.fromOption(${v.scala}).orElseFail(CustomError(${JSON.stringify(`${o.name}: ${f.name} fehlt`)}))`);
      return `${scalaName(f.name)} = ${tmp}`;
    });
  if (out?.kind === 'enum') {
    const cases = outCaseFields(out);
    if (!cases.length) return adtTodo(out);
    // the first case whose condition holds - as one step: what a case needs fails only in that case
    const chain = caseChain(
      cases.map((c, i) => {
        const oc = outCaseOf(o.outCases, c.name);
        const steps: string[] = [];
        const args = mapFields(c.fields, f => outCaseMapping(oc, f.name), steps);
        const name = `Out.${caseIdent(c.name)}`;
        const value = args.length ? `${name}(\n${indent(args.join(',\n'), '  ')}\n)` : name;
        const cond = oc.condition?.trim() ? feelCondition(oc.condition, sv, ctx.types).scala
          : i === cases.length - 1 ? undefined : todo(`${c.name}: keine Bedingung — wann ist es dieser Fall?`);
        return {
          cond,
          value: steps.length ? `(for {\n${indent(steps.join('\n'), '  ')}\n} yield ${value})` : `ZIO.succeed(${value})`,
        };
      }),
      `ZIO.fail(CustomError(${JSON.stringify(`${o.name}: kein Fall des Out passt`)}))`,
    );
    const tmp = `out${++ctx.n.value}`;
    pre.push(`${tmp} <- (\n${indent(chain, '  ')}\n)`);
    return tmp;
  }
  const fields = (out?.fields ?? []).filter(f => isFinished(f, ctx.idx));
  if (!fields.length) return 'NoOutput()';
  const args = mapFields(fields, f => (o.outMappings ?? []).find(m => m.name === f.name)?.expression ?? '', pre);
  return `Out(\n${indent(args.join(',\n'), '  ')}\n)`;
}

/** A loop of the flow: a step a jump back (`goto`) leads to - from it on the steps are a method of the worker. */
interface Loop {
  /** the method: `wiederholungAbHier` */
  method: string;
  /** what it is called with: `loopCounter`, the In, the variables known before it */
  params: { name: string; type: string; arg: (known: Map<string, ScalaVar>) => string }[];
}

/**
 * The steps to the end of the flow, each path a ZIO of the Out: the steps before the gateway that
 * decides as lines of a `for`, a branch the same again - a jump back calls the loop once more
 * (`loopCounter + 1`), the end of a path gives the Out with what is known there.
 */
function terminalZio(steps: Step[], known: OrchVar[], ctx: Ctx, loop: Loop): string {
  const deciding = (st: Step) => st.kind === 'goto'
    || (st.kind === 'gateway' && st.gatewayType === 'exclusive' && flatSteps((st.branches ?? []).flatMap(b => b.steps)).some(x => x.kind === 'goto' || x.kind === 'end'));
  const at = steps.findIndex(deciding);
  const before = (at < 0 ? steps : steps.slice(0, at)).filter(st => st.kind !== 'end');
  const lines = forLines(before, known, ctx);
  const produced = producedBy(before, ctx.o, ctx.services);
  // what a step sets here is the value from now on - also of a variable the loop carries
  const after = [...known.filter(k => !produced.some(v => v.name === k.name)), ...produced]
    .map(v => (ctx.scriptVars.has(v.name) ? { ...ctx.scriptVars.get(v.name)!, ...(v.optional ? { optional: true } : {}) } : v));
  const vars = scalaVars(after);
  let tail: string;
  const step = at < 0 ? undefined : steps[at];
  const stop = !step ? steps.map(st => stopWithError(st, vars, ctx)).find(Boolean) : null;
  if (stop) {
    // the path ends with «Prozess mit Fehler stoppen»: it fails
    tail = stop;
  } else if (!step) {
    const pre: string[] = [];
    const out = outValue(ctx.o, after, ctx, pre);
    lines.push(...pre);
    tail = `ZIO.succeed(${out})`;
  } else if (step.kind === 'goto') {
    tail = `${loop.method}(${loop.params.map(p => p.arg(vars)).join(', ')})`;
  } else {
    const branches = step.branches ?? [];
    const fallback = elseBranch(ctx.o, step);
    const cases = branches.filter(b => b !== fallback).map(b => {
      const cond = conditionOf(ctx.o, b);
      const t = cond ? feelCondition(cond, vars, ctx.types) : null;
      const scalaCond = !t ? todo(`Bedingung für «${b.label || b.id}»`) : t.todo ? todo(`Bedingung: ${cond}`) : t.scala;
      return `if ${scalaCond} then\n${indent(terminalZio(b.steps, after, ctx, loop), '  ')}`;
    });
    const els = fallback ? terminalZio(fallback.steps, after, ctx, loop) : `ZIO.fail(CustomError(${JSON.stringify(`«${step.name || step.id}»: kein Zweig passt`)}))`;
    tail = cases.length ? `${cases.join('\nelse ')}\nelse\n${indent(els, '  ')}` : els;
  }
  if (!lines.length) return tail;
  return `(for {\n${indent([...startWithGenerator(lines), `out <- ${tail.includes('\n') ? `(\n${indent(tail, '  ')}\n)` : tail}`].join('\n'), '  ')}\n} yield out)`;
}

/**
 * The names a loop carries from one round to the next: set in it and read before - in the same round
 * not yet (`checkStatusCount = checkStatusCount + 1`).
 */
function carriedVars(steps: Step[], o: ServiceOrchestrationSpec, services: Map<string, ServiceRef>): OrchVar[] {
  const all = producedBy(steps, o, services);
  const names = new Set(all.map(v => v.name));
  const set = new Set<string>();
  const carried = new Set<string>();
  const reads = (text: string | undefined) => { for (const m of (text ?? '').matchAll(/[A-Za-z_]\w*/g)) if (names.has(m[0]) && !set.has(m[0])) carried.add(m[0]); };
  const walk = (list: Step[]) => {
    for (const st of list) {
      const task = o.tasks[st.id];
      // an output of a service reads its Out (`isDone = isDone`) - only one it computes reads variables
      for (const m of [...(task?.inputs ?? []), ...(task?.outputs ?? []).filter(m => !m.fromService), ...(task?.assignments ?? [])]) reads(m.expression);
      reads(task?.script);
      for (const b of st.branches ?? []) reads(conditionOf(o, b));
      for (const v of producedBy([st], o, services)) set.add(v.name);
      for (const b of st.branches ?? []) walk(b.steps);
    }
  };
  walk(steps);
  return all.filter(v => carried.has(v.name));
}

function worker(o: ServiceOrchestrationSpec, ctx: Ctx): string {
  const steps = flowOf(o).steps;
  // a jump back to a step of the flow: from it on a method that calls itself again
  const back = flatSteps(steps).find(st => st.kind === 'goto' && st.back && st.gotoId && steps.some(x => x.id === st.gotoId));
  const loopAt = back ? steps.findIndex(x => x.id === back.gotoId) : -1;
  const before = loopAt < 0 ? steps : steps.slice(0, loopAt);
  const body = forLines(before, inVars(o), ctx);
  // a script's result with the type the export derived (producedBy only knows the declared one)
  const known = [...inVars(o), ...producedBy(before, o, ctx.services)]
    .map(v => (ctx.scriptVars.has(v.name) ? { ...ctx.scriptVars.get(v.name)!, ...(v.optional ? { optional: true } : {}) } : v));
  const pre: string[] = [];
  let out: string;
  let loopMethod = '';
  if (loopAt >= 0) {
    const segment = steps.slice(loopAt);
    const target = steps[loopAt];
    // English, whatever the step is called - its name is in the doc of the method
    const name = uniqueMethod(ctx, 'repeat');
    const typeOfVar = (v: OrchVar, optional = !!v.optional) => fieldType({ id: v.name, name: v.name, type: v.type, ...(optional ? { optional: true } : {}), ...(v.collection ? { collection: true } : {}) } as Field, ctx.idx);
    const carried = carriedVars(segment, o, ctx.services);
    const plain = known.filter(v => !carried.some(c => c.name === v.name) && /^[A-Za-z_]\w*$/.test(v.scala));
    const usesIn = known.some(v => v.scala.startsWith('in.'));
    const loop: Loop = {
      method: name,
      params: [
        { name: 'loopCounter', type: 'Int', arg: () => 'loopCounter + 1' },
        ...(usesIn ? [{ name: 'in', type: o.noIn ? 'NoInput' : 'In', arg: () => 'in' }] : []),
        ...plain.map(v => ({ name: scalaIdent(v.name), type: typeOfVar(v), arg: () => scalaIdent(v.name) })),
        // carried: the value of the round before - None in the first
        ...carried.map(v => ({
          name: `${v.name}Before`, type: typeOfVar(v, true),
          arg: (vars: Map<string, ScalaVar>) => {
            const now = vars.get(v.name);
            if (!now || now.scala === `${v.name}Before`) return `${v.name}Before`;
            return now.optional ? now.scala : `Some(${now.scala})`;
          },
        })),
      ],
    };
    const inLoop: OrchVar[] = [
      ...known.filter(v => !carried.some(c => c.name === v.name)),
      { name: 'loopCounter', scala: 'loopCounter', type: 'Int', source: 'Script' },
      ...carried.map(v => ({ ...v, scala: `${v.name}Before`, optional: true })),
    ];
    const zio = withoutTodos(terminalZio(segment, inLoop, ctx, loop), ctx);
    loopMethod = [
      `  /** «${target.name || target.id}»: the steps from here on - a jump back to it: once more, loopCounter + 1 */`,
      `  private def ${name}(${loop.params.map(p => `${p.name}: ${p.type}`).join(', ')}): RunWorkZIOOutput[${o.noOut ? 'NoOutput' : 'Out'}] =`,
      indent(zio, '    '),
    ].join('\n');
    const first = loop.params.map(p => (p.name === 'loopCounter' ? '1' : p.name.endsWith('Before') && carried.some(c => `${c.name}Before` === p.name) ? 'None' : p.name)).join(', ');
    pre.push(`out <- ${name}(${first})`);
    out = 'out';
  } else {
    out = outValue(o, known, ctx, pre);
  }
  const lines = startWithGenerator([...body, ...pre]).map(l => withoutTodos(l, ctx));
  const yielded = withoutTodos(out, ctx);
  const run = lines.length
    ? ['    for', indent(lines.join('\n'), '      '), `    yield ${yielded.replace(/\n/g, '\n    ')}`]
    : [`    ZIO.succeed(${yielded.replace(/\n/g, '\n    ')})`];
  const api = orchestrationApi(o);
  const imports = workerImports(o, ctx, run.join('\n'), true);
  // per service it calls: one method - a test overrides it with what the service answers
  const calls = [...ctx.called.values()].map(ref => {
    const name = ref.service.name;
    return [
      `  /** calls ${name} - a test overrides it with the answer of the service */`,
      `  protected def run${name}(in: ${name}.In): RunWorkZIOOutput[${name}.Out] =`,
      `    ${name}Worker()`,
      '      .runWorkFromWorkerUnsafe(in)',
      `      .mapError(e => ${failWith(`${name}: `, 'e.errorMsg')})`,
    ].join('\n');
  });
  const timers = [...ctx.timers].map(([name, t]) => [
    `  /** «${t.step}»: how long it waits - a test makes it zero */`,
    `  protected def ${scalaIdent(name)}: zio.Duration = ${t.default ? isoDuration(JSON.stringify(t.default)) : todo(`${name}: wie lange? (ISO 8601, z. B. PT1M)`)}`,
  ].join('\n'));
  const scripts = [
    ...(loopMethod ? [loopMethod] : []),
    ...ctx.helpers.map(h => h.code),
    ...timers,
    ...ctx.scripts.map(m => scriptMethod(m, ctx.idx)),
    ...(ctx.scripts.some(m => m.io) ? [MAPPED] : []),
  ];
  return `${workerPackageClause(api)}

${imports.join('\n')}

class ${o.name}Worker
    extends CompanyCustomWorkerDsl[In, Out]:

  lazy val customTask = example

${ctx.notes.map(n => `  // TODO ${n}\n`).join('')}  override def runWorkZIO(in: In): RunWorkZIOOutput[Out] =
${run.join('\n')}
${scripts.length ? `\n${scripts.join('\n\n')}\n` : ''}${calls.length ? `\n${calls.join('\n\n')}\n` : ''}
end ${o.name}Worker
`;
}

/**
 * The imports of the worker (and its test): the objects and workers of the services it calls —
 * those of another API —, its own schema, the enums of the domain the code names.
 */
function workerImports(o: ServiceOrchestrationSpec, ctx: Ctx, code: string, workers: boolean): string[] {
  const pkg = collectionPackage(orchestrationApi(o));
  const imports = new Set<string>([ctx.scripts.some(m => m.io) ? 'import zio.{IO, ZIO}' : 'import zio.ZIO', 'import orchescala.worker.WorkerError.CustomError', `import ${pkg}.*`, `import ${pkg}.${o.name}.*`]);
  if (o.types.some(t => !t.interactionId && t.name?.trim())) imports.add(`import ${pkg}.schema.*`);
  for (const ref of ctx.called.values()) {
    const p = servicePackages(ref);
    if (p.domain !== pkg) imports.add(`import ${p.domain}.${ref.service.name}`);
    if (workers && p.domain !== pkg) imports.add(`import ${p.worker}.${ref.service.name}Worker`);
  }
  const own = new Set(o.types.map(t => t.name));
  for (const e of ctx.domEnums) {
    if (!own.has(e.name) && new RegExp(`\\b${e.name}\\.`).test(code)) imports.add(`import ${e.id.replace(/^dom:/, '')}`);
  }
  for (const i of scriptImports(ctx)) imports.add(i);
  return [...imports];
}

/**
 * The test of the worker: the services answer with their examples (the case it reads of an ADT
 * Out). Per branch of an exclusive gateway that became a match one test - the service whose field
 * decides answers with the value of the branch, the Out has the type the branch converts to.
 * Without such a gateway one test that the worker runs through.
 */
function workerTest(o: ServiceOrchestrationSpec, ctx: Ctx): string {
  const api = orchestrationApi(o);
  const refs = [...ctx.called.values()];
  const inEx = o.noIn ? 'NoInput()' : 'In.example';
  const outType = o.noOut ? 'NoOutput' : 'Out';
  const caseOfService = new Map([...ctx.sources.values()].filter(x => x.outCase).map(x => [x.service, x.outCase!]));
  // what a service answers: its Out example - of an ADT the case it reads
  const answer = (ref: ServiceRef) => {
    const n = ref.service.name;
    const out = serviceMembers(ref).out;
    if (ref.service.noOut || !out) return 'NoOutput()';
    if (out.kind !== 'enum') return `${n}.Out.example`;
    const tasks = Object.values(o.tasks).filter(t => t.service === ref.topic);
    const c = tasks.map(t => outCaseOfTask(t, out)).find(Boolean) ?? caseOfService.get(n) ?? out.values?.[0]?.name;
    if (!c) return `${n}.Out.example`;
    return caseFields(out, c).length ? `${n}.Out.${caseIdent(c)}.example` : `${n}.Out.${caseIdent(c)}`;
  };
  const override = (ref: ServiceRef, value: string, pad: string) => [
    `${pad}override protected def run${ref.service.name}(in: ${ref.service.name}.In): RunWorkZIOOutput[${ref.service.name}.Out] =`,
    `${pad}  ZIO.succeed(${value})`,
  ].join('\n');
  const flat = (steps: Step[]): Step[] => steps.flatMap(st => [st, ...(st.branches ?? []).flatMap(b => flat(b.steps))]);
  const tests: string[] = [];
  for (const g of ctx.gateways) {
    const source = ctx.sources.get(g.variable);
    const ref = source ? refs.find(r => r.service.name === source.service) : undefined;
    const fromIn = source ? undefined : inVars(o).find(v => v.name === g.variable && v.scala === `in.${scalaName(v.name)}`);
    // the value of the branch as the field that decides it has it - `Some(…)` only for an optional one
    const valueFor = (b: (typeof g.branches)[number], optional: boolean) => (optional ? `Some(${b.value})` : b.value);
    for (const b of g.branches) {
      const expect = flat(b.steps).flatMap(st => ctx.conversions.get(st.id) ?? []);
      const checks = expect.map(e => e.optional ? `out.${scalaName(e.field)}.exists(_.isInstanceOf[${e.to}])` : `out.${scalaName(e.field)}.isInstanceOf[${e.to}]`);
      const decided = ref && source
        ? [`    val worker = new Mocked:`, override(ref, `${answer(ref)}.copy(${scalaName(source.field)} = ${valueFor(b, source.optional)})`, '      ')]
        : ['    val worker = Mocked()'];
      const input = fromIn ? `${inEx}.copy(${scalaName(g.variable)} = ${valueFor(b, !!fromIn.optional)})` : inEx;
      // where the value comes from is unknown: the test is ignored until it is set - it must not pass by chance
      const undecided = !ref && !fromIn;
      tests.push([
        `  test(${JSON.stringify(`runWorkZIO ${b.label}`)}${undecided ? '.ignore' : ''}):`,
        ...(undecided ? [`    // TODO ${g.variable} = ${b.pattern} - set it where it comes from, then remove .ignore`] : []),
        ...decided,
        `    val result = run(worker, ${input})`,
        checks.length ? `    assert(result.exists(out => ${checks.join(' && ')}), result)` : '    assert(result.isRight, result)',
      ].join('\n'));
    }
  }
  if (!ctx.gateways.length) tests.push(['  test("runWorkZIO"):', `    val result = run(Mocked(), ${inEx})`, '    assert(result.isRight, result)'].join('\n'));
  for (const m of ctx.scripts) tests.push(scriptTest(m, ctx.idx));
  const imports = [
    'import zio.*', 'import orchescala.domain.*', 'import orchescala.worker.*',
    ...workerImports(o, ctx, tests.join('\n'), false).filter(i => !i.startsWith('import zio.')),
  ];
  return `${workerPackageClause(api)}

${imports.join('\n')}

//sbt worker/testOnly *${o.name}WorkerTest
class ${o.name}WorkerTest extends munit.FunSuite:

  /** the services answer with their examples - a test overrides the one that decides */
  class Mocked extends ${o.name}Worker:
${refs.map(r => override(r, answer(r), '    ')).join('\n')}${[...ctx.timers.keys()].map(n => `\n    override protected def ${scalaIdent(n)}: zio.Duration = zio.Duration.Zero`).join('')}

  private def run(worker: ${o.name}Worker, in: ${o.noIn ? 'NoInput' : 'In'}): Either[CustomError, ${outType}] =
    given EngineRunContext = EngineRunContext(DefaultEngineContext.example, GeneralVariables())
    Unsafe.unsafe(implicit unsafe => Runtime.default.unsafe.run(worker.runWorkZIO(in).either).getOrThrowFiberFailure())
${ctx.scripts.some(m => m.io) ? `
  private def runIO[A](io: IO[CustomError, A]): A =
    Unsafe.unsafe(implicit unsafe => Runtime.default.unsafe.run(io).getOrThrowFiberFailure())
` : ''}
${tests.join('\n\n')}

end ${o.name}WorkerTest
`;
}

/** The imports of the schema types of the collections the In and Out use. */
function collectionImports(o: ServiceOrchestrationSpec, collections: ServiceCollectionSpec[]): string[] {
  const used = new Set<string>();
  const visit = (id: string | undefined) => {
    // a type of its own (also one copied from a collection, same id): in its own schema
    if (o.types.some(t => t.id === id && !t.interactionId)) return;
    for (const c of collections) {
      const t = c.types.find(x => x.id === id);
      if (t && !t.interactionId) used.add(`import ${schemaPackageOf(c, t.id) ?? `${typeHome(c, t.id)}.schema`}.*`);
    }
  };
  for (const t of o.types) for (const f of [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])]) visit(f.type);
  return [...used].sort();
}

function domainObject(o: ServiceOrchestrationSpec, idx: TypeIndex, collections: ServiceCollectionSpec[]): string {
  const api = orchestrationApi(o);
  const imports = new Set<string>(collectionImports(o, collections));
  if (o.types.some(t => !t.interactionId && t.name?.trim())) imports.add(`import ${collectionPackage(api)}.schema.*`);
  const lines = [`object ${o.name}`, '    extends CompanyBpmnCustomTaskDsl:', '', `  final val topicName = ${scalaKey(orchestrationTopic(o))}`, descr(o.description), ''];
  const member = (id: string | undefined, name: 'In' | 'Out', nothing: boolean): boolean => {
    const t = o.types.find(x => x.id === id);
    const fields = (t?.fields ?? []).filter(f => isFinished(f, idx));
    if (!t || nothing || (!fields.length && !(t.values ?? []).length)) {
      lines.push(`  type ${name} = ${name === 'In' ? 'NoInput' : 'NoOutput'}`, '');
      return false;
    }
    for (const l of importsOf(t, idx)) imports.add(l);
    lines.push(indent(renderType({ ...t, name }, idx)), '');
    return true;
  };
  const hasIn = member(o.inTypeId, 'In', !!o.noIn);
  const hasOut = member(o.outTypeId, 'Out', !!o.noOut);
  const ex = (has: boolean, name: string, minimal = false) => (has ? `${name}.example${minimal ? 'Minimal' : ''}` : `${name === 'In' ? 'NoInput' : 'NoOutput'}()`);
  lines.push(
    '  lazy val example =',
    '    customTask(',
    `      in = ${ex(hasIn, 'In')},`,
    `      out = ${ex(hasOut, 'Out')}`,
    '    )',
    '',
    '  lazy val exampleMinimal =',
    '    customTask(',
    `      in = ${ex(hasIn, 'In', true)},`,
    `      out = ${ex(hasOut, 'Out', true)}`,
    '    )',
    `end ${o.name}`,
  );
  const head = [packageClause(collectionPackage(api)), '', ...[...imports].sort(), ...(imports.size ? [''] : [])];
  return `${head.join('\n')}\n${lines.join('\n')}\n`;
}

/** The files of the orchestration — the helper writes them like those of a collection. */
export function orchestrationFiles(o: ServiceOrchestrationSpec, all: ServiceSpec[], model: Model | null = null): ScalaFile[] {
  const collections = all.filter(isCollection);
  const api = orchestrationApi(o);
  const pkg = collectionPackage(api);
  const types = allTypes(o, collections);
  const idx = indexTypes(types, model, o.project.split('-').join('.'), pkg);
  // its own types are written to its schema - never one of the same name elsewhere (another project's `Client`)
  for (const t of o.types) idx.referenced.delete(t.id);
  const domEnums = domainEnums(model);
  const ctx: Ctx = {
    o, services: servicesByTopic(collections), types: [...types, ...domEnums], idx, called: new Map(), n: { value: 0 }, domEnums,
    sources: new Map(), conversions: new Map(), gateways: [], collections, domain: model?.domainTypes ?? [], scripts: [], scriptVars: new Map(),
    mappers: modelMappers(model), usedMappers: new Map(), builtTypes: new Set(), timers: new Map(), helpers: [], notes: [],
  };
  // the classes of the catalog as types too - a path into one (`client.clientKey`) resolves like one into an own class
  for (const d of ctx.domain) {
    if (d.owner || (d.kind !== 'case' && d.kind !== 'enum')) continue;
    const ref = domainRef(d.id);
    if (ctx.types.some(t => t.id === ref)) continue;
    const t = typeOf(ref, ctx);
    if (t) ctx.types.push(t);
  }
  const out: ScalaFile[] = [{ path: `${domainDir(api)}/${o.name}.scala`, content: domainObject(o, idx, collections) }];
  for (const t of o.types.filter(x => !x.interactionId && x.name?.trim())) {
    const imports = importsOf(t, idx);
    out.push({
      path: `${domainDir(api)}/schema/${t.name}.scala`,
      content: `${packageClause(`${pkg}.schema`)}\n${imports.length ? `\n${imports.join('\n')}\n` : ''}\n${renderType(t, idx)}\n`,
    });
  }
  out.push({ path: `${workerDir(api)}/${o.name}Worker.scala`, content: worker(o, ctx) });
  out.push({ path: `${workerDir(api).replace('/src/main/', '/src/test/')}/${o.name}WorkerTest.scala`, content: workerTest(o, ctx) });
  out.push(...mapperFiles(ctx));
  return out;
}

/** The files as one text — the frame the helper splits. */
export function orchestrationBundle(o: ServiceOrchestrationSpec, all: ServiceSpec[], model: Model | null = null): string {
  return orchestrationFiles(o, all, model).map(f => `// ${'─'.repeat(72)}\n// ${f.path}\n// ${'─'.repeat(72)}\n\n${f.content}`).join('\n\n');
}

/** The files with a place to fill by hand (`???`). */
export function orchestrationTodos(o: ServiceOrchestrationSpec, all: ServiceSpec[], model: Model | null = null): { file: string; count: number }[] {
  return orchestrationFiles(o, all, model)
    .map(f => ({ file: f.path.split('/').pop()!, count: (f.content.match(/\?\?\?/g) ?? []).length }))
    .filter(x => x.count > 0);
}
