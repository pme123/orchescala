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
//   parallel       each branch forked, then joined  (as in «Advanced Custom Workers»)
//   exclusive      kind match { case Kind.A => … }  (one variable against values - else if … then …;
//                                                     what a branch produces is an Option afterwards)
//   end            yield Out(…)
// A variable of the Out set from a class of a service (`client = naturalPerson`) becomes the
// type the Out defines - `Client.Person(…)` field by field. The test of the worker runs each branch
// with the services answering their examples.
// What does not translate is a `???` with the reason — the project compiles once it is filled.
import { caseIdent, caseName, exampleValue, fieldType, importsOf, indexTypes, isFinished, packageClause, renderType, scalaKey, scalaName, type ScalaFile, type TypeIndex } from '../scala.ts';
import { domainRef } from '../serviceTypes.ts';
import type { DomainField, DomainType, Field, Mapping, Model, Step, TypeDef } from '../types';
import { collectionPackage, domainDir, typeHome, workerDir } from './collection.ts';
import { schemaPackageOf } from './hierarchy.ts';
import { feelCondition, feelToScala, forTarget, scalaIdent, type ScalaVar } from './feelScala.ts';
import {
  allTypes, conditionOf, elseBranch, flowOf, inVars, orchestrationApi, orchestrationTopic, producedBy, resultName, scriptResultVar, serviceMembers, servicePackages,
  servicesByTopic, type OrchVar, type ServiceRef,
} from './orchestration.ts';
import { caseChain, outCaseFields, outCaseMapping, outCaseOf } from './outCases.ts';
import { adtTodo, descr, indent, workerPackageClause } from './scalaCollection.ts';
import { camelName } from './names.ts';
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
  sources: Map<string, { service: string; field: string; outCase?: string }>;
  /** for the test: per service task the variables of the Out it converts - `client` → `Client.Person` */
  conversions: Map<string, { field: string; optional: boolean; to: string }[]>;
  /** for the test: the exclusive gateways that became a match - per branch what decides it */
  gateways: { variable: string; branches: { label: string; pattern: string; steps: Step[] }[] }[];
  collections: ServiceCollectionSpec[];
  /** the classes of the catalog - a script converts into one (`Client` of another orchestration) */
  domain: DomainType[];
  /** the implementations of the script tasks - each a method of the worker, with a test */
  scripts: ScriptMethod[];
  /** what the script tasks set, with the type the export derived - for the Out at the end */
  scriptVars: Map<string, OrchVar>;
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
}

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
  const field = (f: DomainField): Field => ({ id: `${d.id}.${f.name}`, name: f.name, ...shapeOf(f.type) });
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
  if (!declared) return { line: `// TODO «${where}»: die Implementierung hat keine Ergebnis-Variable`, produced: null };
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
  const used = new Set(ctx.scripts.map(x => x.method));
  const base = camelName((s.name || s.id).replace(/Task$/, ''));
  let method = base;
  for (let i = 2; used.has(method); i++) method = `${base}${i}`;
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
  return [...doc, `  def ${m.method}(${params}): ${fieldType(m.result, idx)} =`, indent(m.body, '    ')].join('\n');
}

/** Per script method a test: with the examples of what it reads - the lists all in it, each in its case. */
function scriptTest(m: ScriptMethod, idx: TypeIndex): string {
  const vals = m.params.map(f => `    val ${scalaIdent(f.name)} = ${exampleValue({ ...f, example: undefined }, idx)}`);
  const call = `Mocked().${m.method}(${m.params.map(f => scalaIdent(f.name)).join(', ')})`;
  const list = (f: Field) => (!f.collection ? (f.optional ? `${scalaIdent(f.name)}.size` : '1') : f.optional ? `${scalaIdent(f.name)}.getOrElse(Seq.empty).size` : `${scalaIdent(f.name)}.size`);
  const got = m.result.optional ? 'result.getOrElse(Seq.empty)' : 'result';
  const checks = m.concat
    ? [
      `    assertEquals(${got}.size, ${m.concat.map(n => list(m.params.find(f => f.name === n)!)).join(' + ')})`,
      ...m.cases.map(c => `    assert(${got}.exists(_.isInstanceOf[${c}]), result)`),
    ]
    : m.cases.length
      ? m.cases.map(c => `    assert(${m.result.optional ? `result.exists(_.isInstanceOf[${c}])` : `result.isInstanceOf[${c}]`}, result)`)
      : [`    // TODO ${m.step}: das erwartete Ergebnis prüfen`, '    assert(result != null)'];
  return [`  test(${JSON.stringify(m.method)}):`, ...vals, `    val result = ${call}`, ...checks].join('\n');
}

/** The imports of the types the methods of the script tasks name - the schema of their collection. */
function scriptImports(ctx: Ctx): string[] {
  const out = new Set<string>();
  for (const m of ctx.scripts) {
    for (const f of [...m.params, m.result]) {
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
export function matchOf(conditions: (string | undefined)[], vars: Map<string, ScalaVar>, types: TypeDef[]): { variable: ScalaVar; name: string; patterns: string[]; exhaustive: boolean } | null {
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

/** The lines of the `for` for a list of steps — and the variables known after them. */
function forLines(steps: Step[], before: OrchVar[], ctx: Ctx): string[] {
  const lines: string[] = [];
  let known = [...before];
  for (const s of steps) {
    const task = ctx.o.tasks[s.id];
    const vars = scalaVars(known);
    if (s.kind === 'service') {
      const ref = task?.service ? ctx.services.get(task.service) : undefined;
      if (!ref) { lines.push(`_ <- ZIO.fail(CustomError(${JSON.stringify(`«${s.name || s.id}»: kein Service`)})) // TODO Service wählen`); continue; }
      ctx.called.set(ref.topic, ref);
      const pre: string[] = [];
      const input = serviceIn(ref, task, vars, ctx, pre);
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
          if (field && outFields.has(field)) ctx.sources.set(m.name.trim(), { service: name, field, ...(outCase ? { outCase } : {}) });
          if (c) {
            const to = c.caseOf ? `${c.to.name}.${caseIdent(c.caseOf)}` : c.to.name;
            ctx.conversions.set(s.id, [...(ctx.conversions.get(s.id) ?? []), { field: c.field.name, optional: !!c.field.optional, to }]);
          }
        }
      }
      if (s.errors?.length) lines.push(`// TODO Fehlerpfad${s.errors.length === 1 ? '' : 'e'} von «${s.name || s.id}»: ${s.errors.map(e => e.label || e.code || 'Fehler').join(', ')} — im Code behandeln (catchSome)`);
    } else if (s.kind === 'script') {
      if (task?.script?.trim()) {
        const c = scriptCall(s, task, known, ctx);
        lines.push(c.line);
        if (c.produced) {
          known = [...known.filter(k => k.name !== c.produced!.name), c.produced];
          ctx.scriptVars.set(c.produced.name, c.produced);
        }
      }
      for (const a of task?.assignments ?? []) {
        if (!a.name.trim()) continue;
        const t = feelToScala(a.expression, scalaVars(known), ctx.types);
        lines.push(`${scalaIdent(a.name.trim())} = ${t.scala}`);
        known = [...known, { name: a.name.trim(), scala: scalaIdent(a.name.trim()), type: 'String', source: 'Script', ...(t.optional ? { optional: true } : {}) }];
      }
      continue;
    } else if (s.kind === 'gateway' && s.gatewayType === 'parallel') {
      // each branch on its own fiber — then joined, its results by name
      const fibers = (s.branches ?? []).map(b => {
        const produced = producedBy(b.steps, ctx.o, ctx.services);
        return { fiber: `fiber${++ctx.n.value}`, produced, body: branchZio(b.steps, known, produced.map(v => v.name), ctx) };
      });
      for (const f of fibers) lines.push(`${f.fiber} <- (`, indent(f.body, '  '), ').fork');
      for (const f of fibers) lines.push(`${pattern(f.produced.map(v => v.name))} <- ${f.fiber}.join`);
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
      if (m) ctx.gateways.push({ variable: m.name, branches: conditional.map((b, i) => ({ label: b.label || m.patterns[i], pattern: m.patterns[i], steps: b.steps })) });
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

function worker(o: ServiceOrchestrationSpec, ctx: Ctx): string {
  const steps = flowOf(o).steps;
  const body = forLines(steps, inVars(o), ctx);
  // a script's result with the type the export derived (producedBy only knows the declared one)
  const known = [...inVars(o), ...producedBy(steps, o, ctx.services)]
    .map(v => (ctx.scriptVars.has(v.name) ? { ...ctx.scriptVars.get(v.name)!, ...(v.optional ? { optional: true } : {}) } : v));
  const pre: string[] = [];
  const out = outValue(o, known, ctx, pre);
  const lines = startWithGenerator([...body, ...pre]);
  const run = lines.length
    ? ['    for', indent(lines.join('\n'), '      '), `    yield ${out.replace(/\n/g, '\n    ')}`]
    : [`    ZIO.succeed(${out.replace(/\n/g, '\n    ')})`];
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
  const scripts = ctx.scripts.map(m => scriptMethod(m, ctx.idx));
  return `${workerPackageClause(api)}

${imports.join('\n')}

class ${o.name}Worker
    extends CompanyCustomWorkerDsl[In, Out]:

  lazy val customTask = example

  override def runWorkZIO(in: In): RunWorkZIOOutput[Out] =
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
  const imports = new Set<string>(['import zio.ZIO', 'import orchescala.worker.WorkerError.CustomError', `import ${pkg}.*`, `import ${pkg}.${o.name}.*`]);
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
    const fromIn = !source && inVars(o).find(v => v.name === g.variable && v.scala === `in.${scalaName(v.name)}`);
    for (const b of g.branches) {
      const expect = flat(b.steps).flatMap(st => ctx.conversions.get(st.id) ?? []);
      const checks = expect.map(e => e.optional ? `out.${scalaName(e.field)}.exists(_.isInstanceOf[${e.to}])` : `out.${scalaName(e.field)}.isInstanceOf[${e.to}]`);
      const decided = ref && source
        ? [`    val worker = new Mocked:`, override(ref, `${answer(ref)}.copy(${scalaName(source.field)} = ${b.pattern})`, '      ')]
        : ['    val worker = Mocked()'];
      const input = fromIn ? `${inEx}.copy(${scalaName(g.variable)} = ${b.pattern})` : inEx;
      tests.push([
        `  test(${JSON.stringify(`runWorkZIO ${b.label}`)}):`,
        ...(ref || fromIn ? [] : [`    // TODO ${g.variable} = ${b.pattern} - where it comes from, set it`]),
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
    ...workerImports(o, ctx, tests.join('\n'), false).filter(i => i !== 'import zio.ZIO'),
  ];
  return `${workerPackageClause(api)}

${imports.join('\n')}

//sbt worker/testOnly *${o.name}WorkerTest
class ${o.name}WorkerTest extends munit.FunSuite:

  /** the services answer with their examples - a test overrides the one that decides */
  class Mocked extends ${o.name}Worker:
${refs.map(r => override(r, answer(r), '    ')).join('\n')}

  private def run(worker: ${o.name}Worker, in: ${o.noIn ? 'NoInput' : 'In'}): Either[CustomError, ${outType}] =
    given EngineRunContext = EngineRunContext(DefaultEngineContext.example, GeneralVariables())
    Unsafe.unsafe(implicit unsafe => Runtime.default.unsafe.run(worker.runWorkZIO(in).either).getOrThrowFiberFailure())

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
  };
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
