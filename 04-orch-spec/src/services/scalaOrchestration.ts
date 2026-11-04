// A service orchestration → Orchescala code: a CustomTask and its CustomWorker, as a
// project writes it by hand when it combines services (`UpdateClient` = GET, then PUT):
//
//   01-domain/…/client/v1/UpdateClient.scala         CustomTask: topic, descr, In, Out, examples
//   01-domain/…/client/v1/schema/<Type>.scala        own types of the orchestration
//   03-worker/…/client/v1/UpdateClientWorker.scala   CustomWorker: runWorkZIO calls the workers
//
// The flow becomes one `for` in `runWorkZIO`:
//   service task   getClient <- GetClientWorker().runWorkFromWorkerUnsafe(GetClient.In(…)).mapError(…)
//   script task    total = …                        (FEEL → Scala, see feelScala.ts)
//   parallel       each branch forked, then joined  (as in «Advanced Custom Workers»)
//   exclusive      if … then … else …               (what a branch produces is an Option afterwards)
//   end            yield Out(…)
// What does not translate is a `???` with the reason — the project compiles once it is filled.
import { caseIdent, importsOf, indexTypes, isFinished, packageClause, renderType, scalaKey, scalaName, type ScalaFile, type TypeIndex } from '../scala.ts';
import type { Field, Model, Step, TypeDef } from '../types';
import { collectionPackage, domainDir, typeHome, workerDir } from './collection.ts';
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
}

/** The `In` of a service from the variables known there — field by field, an ADT stays to do. */
function serviceIn(ref: ServiceRef, task: ServiceOrchestrationSpec['tasks'][string] | undefined, vars: Map<string, ScalaVar>, ctx: Ctx, pre: string[]): string {
  const name = ref.service.name;
  if (ref.service.noIn) return 'NoInput()';
  const inType = serviceMembers(ref).in;
  if (!inType) return `${name}.In()`;
  if (inType.kind === 'enum') return todo(`${name}.In ist ein ADT — den Fall wählen und füllen`);
  const args = (inType.fields ?? []).filter(f => isFinished(f, ctx.idx)).map(f => {
    const expr = (task?.inputs ?? []).find(m => m.name === f.name)?.expression?.trim() || (vars.has(f.name) ? `= ${f.name}` : '');
    if (!expr) return `${scalaName(f.name)} = ${f.optional ? 'None' : todo(`${f.name}: kein Mapping`)}`;
    const v = forTarget(feelToScala(expr, vars, ctx.types, f), !!f.optional);
    if (!v.needed) return `${scalaName(f.name)} = ${v.scala}`;
    // required, but optional on the way: a step that fails with a message
    const tmp = `${f.name}${++ctx.n.value}`;
    pre.push(`${tmp} <- ZIO.fromOption(${v.scala}).orElseFail(CustomError(${JSON.stringify(`${name}: ${f.name} fehlt`)}))`);
    return `${scalaName(f.name)} = ${tmp}`;
  });
  return args.length ? `${name}.In(\n${indent(args.join(',\n'), '  ')}\n)` : `${name}.In()`;
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
      lines.push(
        `${target} <- ${ref.service.name}Worker()`,
        `  .runWorkFromWorkerUnsafe(${input.includes('\n') ? `\n${indent(input, '    ')}\n  ` : input})`,
        `  .mapError(e => CustomError(s"${ref.service.name}: \${e.errorMsg}"))`,
      );
      // as a process describes it: the variables from the fields of the Out — the result itself is not kept
      if (task?.outputs && target !== '_') {
        const outFields = new Map<string, ScalaVar>((serviceMembers(ref).out?.fields ?? []).filter(f => f.name).map(f =>
          [f.name, { scala: `${target}.${scalaName(f.name)}`, type: f.type, optional: !!f.optional, collection: !!f.collection }]));
        const scope = new Map([...vars, ...outFields]);
        for (const m of outputs) lines.push(`${scalaIdent(m.name.trim())} = ${feelToScala(m.expression, scope, ctx.types).scala}`);
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
      const expr = cases.length
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
  const pkg = collectionPackage(api);
  // the services it calls: their objects and workers — those of another API by import
  const imports = new Set<string>(['import zio.ZIO', 'import orchescala.worker.WorkerError.CustomError', `import ${pkg}.*`, `import ${pkg}.${o.name}.*`]);
  for (const ref of ctx.called.values()) {
    const p = servicePackages(ref);
    if (p.domain !== pkg) imports.add(`import ${p.domain}.${ref.service.name}`);
    if (p.domain !== pkg) imports.add(`import ${p.worker}.${ref.service.name}Worker`);
  }
  return `${workerPackageClause(api)}

${[...imports].join('\n')}

class ${o.name}Worker
    extends CompanyCustomWorkerDsl[In, Out]:

  lazy val customTask = example

  override def runWorkZIO(in: In): RunWorkZIOOutput[Out] =
${run.join('\n')}

end ${o.name}Worker
`;
}

/** The imports of the schema types of the collections the In and Out use. */
function collectionImports(o: ServiceOrchestrationSpec, collections: ServiceCollectionSpec[]): string[] {
  const used = new Set<string>();
  const visit = (id: string | undefined) => {
    for (const c of collections) {
      const t = c.types.find(x => x.id === id);
      if (t && !t.interactionId) used.add(`import ${typeHome(c, t.id)}.schema.*`);
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
  const ctx: Ctx = { o, services: servicesByTopic(collections), types, idx, called: new Map(), n: { value: 0 } };
  const out: ScalaFile[] = [{ path: `${domainDir(api)}/${o.name}.scala`, content: domainObject(o, idx, collections) }];
  for (const t of o.types.filter(x => !x.interactionId && x.name?.trim())) {
    const imports = importsOf(t, idx);
    out.push({
      path: `${domainDir(api)}/schema/${t.name}.scala`,
      content: `${packageClause(`${pkg}.schema`)}\n${imports.length ? `\n${imports.join('\n')}\n` : ''}\n${renderType(t, idx)}\n`,
    });
  }
  out.push({ path: `${workerDir(api)}/${o.name}Worker.scala`, content: worker(o, ctx) });
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
