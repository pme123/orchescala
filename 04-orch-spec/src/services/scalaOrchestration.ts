// A service orchestration → Orchescala code: a CustomTask and its CustomWorker, as a
// project writes it by hand when it combines services (`UpdateClient` = GET, then PUT):
//
//   01-domain/…/client/v1/UpdateClient.scala         CustomTask: topic, descr, In, Out, examples
//   01-domain/…/client/v1/schema/<Type>.scala        own types of the orchestration
//   03-worker/…/client/v1/UpdateClientWorker.scala   CustomWorker: runWorkZIO calls the workers
//
// The flow becomes one `for` in `runWorkZIO`:
//   service task   getClient <- runGetClient(GetClient.In(…))   (a `protected def` per service - a test overrides it)
//   script task    total = …                        (FEEL → Scala, see feelScala.ts)
//   parallel       each branch forked, then joined  (as in «Advanced Custom Workers»)
//   exclusive      kind match { case Kind.A => … }  (one variable against values - else if … then …;
//                                                     what a branch produces is an Option afterwards)
//   end            yield Out(…)
// A variable of the Out set from a class of a service (`client = naturalPerson`) becomes the
// type the Out defines - `Client.Person(…)` field by field. The test of the worker runs each branch
// with the services answering their examples.
// What does not translate is a `???` with the reason — the project compiles once it is filled.
import { caseIdent, caseName, importsOf, indexTypes, isFinished, packageClause, renderType, scalaKey, scalaName, type ScalaFile, type TypeIndex } from '../scala.ts';
import { domainRef } from '../serviceTypes.ts';
import type { Field, Mapping, Model, Step, TypeDef } from '../types';
import { collectionPackage, domainDir, typeHome, workerDir } from './collection.ts';
import { schemaPackageOf } from './hierarchy.ts';
import { feelCondition, feelToScala, forTarget, scalaIdent, type ScalaVar } from './feelScala.ts';
import {
  allTypes, conditionOf, elseBranch, flowOf, inVars, orchestrationApi, orchestrationTopic, producedBy, resultName, serviceMembers, servicePackages,
  servicesByTopic, type OrchVar, type ServiceRef,
} from './orchestration.ts';
import { caseChain, outCaseFields, outCaseMapping, outCaseOf } from './outCases.ts';
import { adtTodo, descr, indent, workerPackageClause } from './scalaCollection.ts';
import { isCollection, type ServiceCollectionSpec, type ServiceOrchestrationSpec, type ServiceSpec } from './types.ts';

/** Scala variables for the FEEL translation. */
const scalaVars = (vars: OrchVar[]): Map<string, ScalaVar> =>
  new Map(vars.map(v => [v.name, { scala: v.scala, type: v.type, optional: !!v.optional, collection: !!v.collection, ...(v.byCase ? { byCase: v.byCase } : {}) }]));

const todo = (why: string) => `??? /* TODO ${why.replace(/\*\//g, '* /')} */`;

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
          // a class into the type the Out defines (`Client.Person`)
          const c = conversionOf(ctx.o, m, scope, ctx.types);
          const pre: string[] = [];
          const value = c ? converted(c, ctx, pre) : feelToScala(m.expression, scope, ctx.types).scala;
          lines.push(...pre, `${scalaIdent(m.name.trim())} = ${value}`);
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
  // per field its value — `expressionOf` empty: the variable of the same name, if there is one
  const mapFields = (fields: Field[], expressionOf: (f: Field) => string, steps: string[]) =>
    fields.filter(f => isFinished(f, ctx.idx)).map((f: Field) => {
      const expr = expressionOf(f).trim() || (sv.has(f.name) ? `= ${f.name}` : '');
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
  const known = [...inVars(o), ...producedBy(steps, o, ctx.services)];
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
      `      .mapError(e => CustomError(s"${name}: \${e.errorMsg}"))`,
    ].join('\n');
  });
  return `${workerPackageClause(api)}

${imports.join('\n')}

class ${o.name}Worker
    extends CompanyCustomWorkerDsl[In, Out]:

  lazy val customTask = example

  override def runWorkZIO(in: In): RunWorkZIOOutput[Out] =
${run.join('\n')}
${calls.length ? `\n${calls.join('\n\n')}\n` : ''}
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
    sources: new Map(), conversions: new Map(), gateways: [],
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
