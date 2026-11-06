// A service collection → Orchescala code, in the house style of
// `./helper.scala serviceTask` and of the OpenAPI generator of the helper:
//
//   01-domain/…/client/v1/ClientV1.scala          super trait (serviceLabel, serviceVersion)
//   01-domain/…/client/v1/GetClient.scala         ServiceTask: topic, path, In/Out, ServiceIn/Out, mock
//   01-domain/…/client/v1/schema/Client.scala     the types of the API
//   03-worker/…/client/v1/exports.scala           serviceBasePath
//   03-worker/…/client/v1/GetClientWorker.scala   ServiceWorker: method, apiUri, query, headers, mappers
//
// The mappings come from FEEL (feelScala.ts); what does not translate is a
// `???` with the FEEL in a comment — the project compiles once it is filled.
import { caseIdent, exampleValue, fieldAccess, fieldType, importsOf, indexTypes, isFinished, packageClause, renderType, scalaKey, scalaName, type ScalaFile, type TypeIndex } from '../scala.ts';
import type { Field, Model, TypeDef } from '../types';
import {
  apiKey, apiOf, apiParents, apisOf, basePathParams, collectionPackage, collectionTrait, domainDir, membersOf, normalPathBase, pathParams, workerPath, sameApi, serviceTopic, workerDir, workerPackage, type ApiRef,
} from './collection.ts';
import { reach, schemaHomes, typesOf } from './hierarchy.ts';
import { baseChain, chainBelowProject, chainFiles, chainIssue, chainPath, chainServiceBasePath, projectBaseVar } from './basePaths.ts';
import { asText, feelCondition, feelToScala, forTarget, scalaIdent, type ScalaVar, type Translated } from './feelScala.ts';
import { caseChain, outCaseFields, outCaseMapping, outCaseOf } from './outCases.ts';
import type { BodyRef, CollectionService, ServiceCollectionSpec } from './types';

export const indent = (text: string, by = '  ') => text.split('\n').map(l => (l ? by + l : l)).join('\n');

/** `val descr` — one line as a string, several as `"""…""".stripMargin` */
export function descr(text: string | undefined): string {
  const t = (text ?? '').trim().replace(/"""/g, '\\"\\"\\"');
  // no blanks at the end of a line — a blank line of the description stays a bare `|`
  const lines = t.split('\n').map(l => l.trimEnd());
  if (lines.length === 1) return `  val descr: String = ${scalaKey(t)}`;
  const [first, ...rest] = lines;
  return [`  val descr: String =`, `    """${first}`, ...rest.map(l => `      |${l}`), '      |""".stripMargin'].join('\n');
}

/** A body as a field — for its Scala type and its example. */
const bodyField = (b: BodyRef): Field => ({ id: 'body', name: 'body', type: b.type, collection: b.collection, optional: b.optional });

/** `Client.example` → `Client.exampleMinimal` (also in `Seq(…)` / `Some(…)`) — a scalar stays */
const minimalOf = (example: string): string => example.replace(/\b([A-Z]\w*)\.example\b/, '$1.exampleMinimal');

function serviceTypeLines(name: 'ServiceIn' | 'ServiceOut', b: BodyRef | undefined, status: number | undefined, headers: string[], idx: TypeIndex): { type: string; object: string[] } {
  if (!b) {
    const none = name === 'ServiceIn' ? 'NoInput' : 'NoOutput';
    const obj = [`  object ${name}:`, `    lazy val example        = ${none}()`, '    lazy val exampleMinimal = example'];
    if (name === 'ServiceOut') obj.push('    lazy val mock: MockedServiceResponse[ServiceOut] =', '      MockedServiceResponse.success204', '    lazy val mockMinimal = mock');
    return { type: none, object: [...obj, `  end ${name}`] };
  }
  const f = bodyField(b);
  const example = exampleValue(f, idx);
  const minimal = b.optional ? 'None' : minimalOf(example);
  const obj = [`  object ${name}:`, `    lazy val example: ${name} = ${example}`, `    lazy val exampleMinimal: ${name} = ${minimal}`];
  if (name === 'ServiceOut') {
    const code = status && status >= 200 && status < 300 && status !== 204 ? status : 200;
    const mockHeaders = headers.includes('etag') ? ', Map("etag" -> "\\"etag-example\\"")' : '';
    obj.push(
      '    lazy val mock: MockedServiceResponse[ServiceOut] =',
      `      MockedServiceResponse.success(${code}, example${mockHeaders})`,
      '    lazy val mockMinimal: MockedServiceResponse[ServiceOut] =',
      `      MockedServiceResponse.success(${code}, exampleMinimal${mockHeaders})`,
    );
  }
  return { type: fieldType(f, idx), object: [...obj, `  end ${name}`] };
}

function domainObject(c: ServiceCollectionSpec, s: CollectionService, idx: TypeIndex, schemaImports: string[]): string {
  const ref = apiOf(c, s);
  const pkg = collectionPackage(ref);
  const { in: inType, out: outType } = membersOf(c, s);
  const imports = new Set<string>();
  const lines: string[] = [];
  lines.push(`object ${s.name} extends ${collectionTrait(ref)}:`, '');
  lines.push(`  final val topicName = ${scalaKey(serviceTopic(ref, s))}`);
  lines.push(descr(s.description));
  lines.push(`  val path = ${scalaKey(`${s.method}: ${s.path}`)}`, '');

  const sIn = serviceTypeLines('ServiceIn', s.serviceIn, undefined, [], idx);
  const sOut = serviceTypeLines('ServiceOut', s.serviceOut, s.responseStatus, s.responseHeaders ?? [], idx);
  lines.push(`  type ServiceIn = ${sIn.type}`, `  type ServiceOut = ${sOut.type}`, '');

  const member = (t: TypeDef | undefined, name: 'In' | 'Out'): boolean => {
    const fields = (t?.fields ?? []).filter(f => isFinished(f, idx));
    // an ADT (`enum In`) has its content in the cases
    const cases = t?.kind === 'enum' ? (t.values ?? []).filter(v => v.name) : [];
    if (!t || (!fields.length && !cases.length) || (name === 'In' ? s.noIn : s.noOut)) {
      lines.push(`  type ${name} = ${name === 'In' ? 'NoInput' : 'NoOutput'}`, '');
      return false;
    }
    for (const l of importsOf(t, idx)) imports.add(l);
    lines.push(indent(renderType({ ...t, name, description: t.description }, idx)), '');
    return true;
  };
  const hasIn = member(inType, 'In');
  const hasOut = member(outType, 'Out');
  lines.push(...sIn.object, '', ...sOut.object, '');
  const ex = (has: boolean, name: string, minimal = false) => (has ? `${name}.example${minimal ? 'Minimal' : ''}` : `${name === 'In' ? 'NoInput' : 'NoOutput'}()`);
  lines.push(
    '  lazy val example =',
    '    serviceTask(',
    `      in = ${ex(hasIn, 'In')},`,
    `      out = ${ex(hasOut, 'Out')},`,
    '      ServiceOut.mock,',
    '      ServiceIn.example',
    '    )',
    '',
    '  lazy val exampleMinimal =',
    '    serviceTask(',
    `      in = ${ex(hasIn, 'In', true)},`,
    `      out = ${ex(hasOut, 'Out', true)},`,
    '      ServiceOut.mockMinimal,',
    '      ServiceIn.exampleMinimal',
    '    )',
    `end ${s.name}`,
  );
  for (const i of schemaImports) imports.add(i);
  for (const l of bodyImports(s, idx)) imports.add(l);
  const head = [packageClause(pkg), '', ...[...imports].sort(), ...(imports.size ? [''] : [])];
  return `${head.join('\n')}\n${lines.join('\n')}\n`;
}

/** A body of another domain (`dom:…`, from the catalog) brings its import. */
function bodyImports(s: CollectionService, idx: TypeIndex): string[] {
  const fields = [s.serviceIn, s.serviceOut].filter((b): b is BodyRef => !!b).map(bodyField);
  return fields.length ? importsOf({ id: 'bodies', name: 'Bodies', kind: 'case', fields }, idx) : [];
}

function superTrait(c: ServiceCollectionSpec, ref: ApiRef, single: boolean): string {
  const name = collectionTrait(ref);
  // the version of the OpenAPI is the one of its API only if there is one
  const version = (single && c.source?.version?.trim()) || `${ref.apiVersion}.0`;
  const label = c.serviceLabel?.trim() || c.source?.title?.trim() || c.title;
  return `${packageClause(collectionPackage(ref))}

object ${name}:

  final val serviceVersion = ${scalaKey(version)}
  final val serviceLabel = ${scalaKey(label)}

${descr(c.description).replace('  val descr: String', '  val description: String')}
  val externalDoc = ""
  val externalUrl = ${scalaKey(c.source?.basePath ?? '')}

trait ${name}
  extends CompanyBpmnServiceTaskDsl:
  final val serviceLabel = ${name}.serviceLabel
  val serviceVersion = ${name}.serviceVersion
end ${name}
`;
}

// ── the worker ───────────────────────────────────────────────────────────────

export const workerPackageClause = (ref: ApiRef): string => {
  const parts = workerPackage(ref).split('.');
  const at = parts.indexOf('worker');
  // a nested API: one line per level — what a level has (its base path) is visible without an import
  const levels = apiParents(ref.api);
  return [`package ${parts.slice(0, at + 1).join('.')}`, ...levels.map(l => `package ${l}`), `package ${parts.slice(at + 1 + levels.length).join('.')}`].join('\n');
};

/** What a mapping of the request can read: the fields of the In — of an ADT also those of its cases. */
function inVars(inType: TypeDef | undefined): Map<string, ScalaVar> {
  return new Map(fieldAccess(inType).map(({ field: f, scala, optional, byCase }) => [f.name, {
    scala, type: f.type, optional, collection: !!f.collection, ...(byCase ? { byCase } : {}),
  }]));
}

/** an ADT `Out` the code cannot build by itself: a TODO that names its cases */
export function adtTodo(t: TypeDef): string {
  const cases = (t.values ?? []).filter(v => v.name).map(v => `Out.${v.name}${(v.fields ?? []).length ? '(…)' : ''}`);
  return `??? /* TODO Out ist eine Auswahl (enum) — den Fall wählen: ${cases.join(', ') || 'noch keine Fälle'} */`;
}

/** a sure value for a place that needs one (path, required header) — an optional one is a TODO */
function sure(t: Translated, what: string): string {
  if (t.todo || !t.optional) return t.scala;
  return `${t.scala}.getOrElse(??? /* TODO ${what} ist optional */)`;
}

/** The path after `serviceBasePath`: a nested API has the start of it in its chain of base paths (see basePaths.ts). */
function pathBelowBase(c: ServiceCollectionSpec, s: CollectionService): string {
  const path = workerPath(c, s.path);
  const chain = baseChain(c, apiOf(c, s));
  const base = chain ? chainPath(chain) : '';
  return base && (path === base || path.startsWith(`${base}/`)) ? path.slice(base.length) : path;
}

/** `Seq.empty` / `Map.empty` — what a required list or map is when the value is missing; null: no such default */
const emptyOf = (f: Pick<Field, 'collection' | 'map'>): string | null => (f.map ? 'Map.empty' : f.collection ? 'Seq.empty' : null);

/**
 * `= clientKeys` with `clientKeys` a field of only some cases of an ADT In: case by case — a case
 * without it gets a TODO instead of a silent `None` (its value would be lost). Null: no such mapping.
 */
function caseByCase(mapping: string, target: Field, vars: Map<string, ScalaVar>): string | null {
  const plain = /^=\s*(?:in\.)?([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(mapping.trim());
  const v = plain ? vars.get(plain[1]) : undefined;
  if (!plain || !v?.byCase || Object.keys(v.byCase.own).length === v.byCase.cases.length) return null;
  const name = plain[1];
  const arms = v.byCase.cases.map(c => {
    const own = v.byCase!.own[c];
    if (!own) return `case _: ${c} => ??? /* TODO ${target.name}: ${c} hat kein Feld ${name} */`;
    const value = target.optional ? (own.optional ? own.scala : `Some(${own.scala})`)
      : own.optional ? `${own.scala}.getOrElse(${emptyOf(target) ?? `??? /* TODO ${target.name} ist im In optional */`})` : own.scala;
    return `case v: ${c} => ${value}`;
  });
  return `(${v.byCase.at} match { ${arms.join('; ')} })`;
}

/** The parameters the worker sends — without those of the company's base (`/banks/{bankNumber}`). */
function requestParams(c: ServiceCollectionSpec, s: CollectionService) {
  const fromBase = basePathParams(c, s);
  return s.params.filter(p => !p.disabled && p.name && !(p.in === 'path' && fromBase.has(p.name)));
}

/** Has the In / Out content — fields, or cases of an ADT (`enum Out`)? */
const hasMember = (t: TypeDef | undefined, idx: TypeIndex): boolean =>
  !!(t?.fields ?? []).some(f => isFinished(f, idx)) || (t?.kind === 'enum' && (t.values ?? []).some(v => v.name));

/** The path: `{clientKey}` → `${in.clientKey}` — without the base the company's serviceBasePath has. */
function apiPath(c: ServiceCollectionSpec, s: CollectionService, inType: TypeDef | undefined): string {
  const vars = inVars(inType);
  const byName = new Map(requestParams(c, s).filter(p => p.in === 'path').map(p => [p.name, p]));
  return pathBelowBase(c, s).replace(/\{([^}]+)\}/g, (_, name: string) => {
    const p = byName.get(name);
    return p ? `\${${sure(feelToScala(p.expression, vars, c.types, { type: p.type }), `Pfad-Parameter ${name}`)}}` : `\${??? /* TODO Pfad-Parameter ${name} */}`;
  });
}

/**
 * The test of the worker — as `./helper.scala` writes it (`//sbt worker/testOnly *GetClientWorkerTest`),
 * with what Orch Spec knows: the method, the URI of the example, the mappers with the examples.
 * A skeleton for the developer: created once, then merged like the worker.
 */
/** Each `${…}` of an interpolated string through `f` — braces inside it (a `match`) counted. */
function interpolations(text: string, f: (expr: string) => string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      for (; j < text.length && depth; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0;
      out += `\${${f(text.slice(i + 2, j - 1))}}`;
      i = j - 1;
    } else out += text[i];
  }
  return out;
}

function workerTest(c: ServiceCollectionSpec, s: CollectionService, idx: TypeIndex, schemaImports: string[], missing: MissingStep[] = []): string {
  const ref = apiOf(c, s);
  const pkg = collectionPackage(ref);
  const members = membersOf(c, s);
  const inType = s.noIn ? undefined : members.in;
  const hasIn = hasMember(inType, idx);
  const hasOut = !s.noOut && hasMember(members.out, idx);
  const ex = (has: boolean, name: 'In' | 'Out', minimal = false) => (has ? `${name}.example${minimal ? 'Minimal' : ''}` : `${name === 'In' ? 'NoInput' : 'NoOutput'}()`);
  const tests: string[] = [`  test("method"):\n    assertEquals(worker.method, Method.${s.method})`];
  // the URI of the example: the path with the values of `In.example` — a TODO stays one
  const uriPath = apiPath(c, s, inType);
  if (!uriPath.includes('???')) {
    // a nested API: from the base of the project — the test checks the whole chain
    const chain = baseChain(c, ref);
    const full = chain ? `$${projectBaseVar(c.project)}${chainBelowProject(chain)}${uriPath}` : `$serviceBasePath${uriPath}`;
    // only in the interpolations: `${in.clientKey}` → `${In.example.clientKey}`
    const expected = interpolations(full, e => (hasIn ? e.replace(/\bin\./g, 'In.example.') : e));
    const unresolved = { found: false };
    interpolations(expected, e => { if (/\bin\b/.test(e)) unresolved.found = true; return e; });
    if (!unresolved.found) {
      tests.push([
        '  test("apiUri"):',
        '    assertEquals(',
        `      worker.apiUri(${ex(hasIn, 'In')}).toString,`,
        `      s"${expected}"`,
        '    )',
      ].join('\n'));
    }
  }
  if (s.serviceIn) {
    for (const minimal of [false, true]) {
      tests.push([
        `  test("inputMapper${minimal ? ' minimal' : ''}"):`,
        '    assertEquals(',
        `      worker.inputMapper(${ex(hasIn, 'In', minimal)}),`,
        `      Some(ServiceIn.example${minimal ? 'Minimal' : ''})`,
        '    )',
      ].join('\n'));
    }
  }
  if (hasOut || s.serviceOut) {
    for (const minimal of [false, true]) {
      tests.push([
        `  test("outputMapper${minimal ? ' minimal' : ''}"):`,
        '    assertEquals(',
        '      worker.outputMapper(',
        `        ServiceOut.mock${minimal ? 'Minimal' : ''}.toServiceResponse,`,
        `        ${ex(hasIn, 'In', minimal)}`,
        '      ),',
        `      Right(${ex(hasOut, 'Out', minimal)})`,
        '    )',
      ].join('\n'));
    }
  }
  // an In with cases: the output mapper with each further case — the Out case of the same name, if there is one
  const inCases = hasIn && inType?.kind === 'enum' ? (inType.values ?? []).filter(v => v.name) : [];
  const outType = s.noOut ? undefined : members.out;
  const outCases = hasOut && outType?.kind === 'enum' ? (outType.values ?? []).filter(v => v.name).map(v => v.name) : [];
  const inExample = (name: string, minimal = false) => {
    const v = inCases.find(x => x.name === name)!;
    return (v.fields ?? []).length ? `In.${caseIdent(name)}.example${minimal ? 'Minimal' : ''}` : `In.${caseIdent(name)}`;
  };
  if (hasOut || s.serviceOut) {
    for (const v of inCases.slice(1)) {
      const out = outCases.includes(v.name) ? (outType!.values!.find(x => x.name === v.name)!.fields?.length ? `Out.${caseIdent(v.name)}.example` : `Out.${caseIdent(v.name)}`) : ex(hasOut, 'Out');
      tests.push([
        `  test("outputMapper ${v.name}"):`,
        '    assertEquals(',
        '      worker.outputMapper(',
        '        ServiceOut.mock.toServiceResponse,',
        `        ${inExample(v.name)}`,
        '      ),',
        `      Right(${out})`,
        '    )',
      ].join('\n'));
    }
  }
  // a value the response may lack: with `mockMinimal` the output mapper fails with its message —
  // the first step of the Out (or of an Out case that has an In case of the same name)
  const failing: { name: string; in: string; step: MissingStep }[] = [];
  const firstOf = (outCase?: string) => missing.find(m => m.outCase === outCase);
  if (!outCases.length) {
    const first = firstOf();
    if (first?.fromBody) failing.push({ name: `outputMapper without ${first.field}`, in: ex(hasIn, 'In', true), step: first });
  } else {
    for (const oc of outCases) {
      const first = firstOf(oc);
      if (first?.fromBody && inCases.some(v => v.name === oc)) failing.push({ name: `outputMapper ${oc} without ${first.field}`, in: inExample(oc, true), step: first });
    }
  }
  for (const f of failing) {
    tests.push([
      `  test(${JSON.stringify(f.name)}):`,
      '    assertEquals(',
      '      worker.outputMapper(',
      '        ServiceOut.mockMinimal.toServiceResponse,',
      `        ${f.in}`,
      '      ),',
      `      Left(ServiceMappingError(${JSON.stringify(f.step.message)}))`,
      '    )',
    ].join('\n'));
  }
  const imports = [...(failing.length ? ['import WorkerError.*', ''] : []), ...schemaImports, ...bodyImports(s, idx), `import ${pkg}.${s.name}.*`];
  return `${workerPackageClause(ref)}

${imports.join('\n')}

//sbt worker/testOnly *${s.name}WorkerTest
class ${s.name}WorkerTest extends munit.FunSuite:

  lazy val worker = ${s.name}Worker()

${tests.join('\n\n')}

end ${s.name}WorkerTest
`;
}

/** `03-worker/src/test/scala/…/client/v1` — the tests next to the workers, in the test sources */
const workerTestDir = (a: ApiRef): string => workerDir(a).replace('/src/main/', '/src/test/');

/** A step of the output mapper that fails with a message when the value is missing — for its test. */
interface MissingStep {
  /** the case of an ADT Out it belongs to — none: the Out is a class */
  outCase?: string;
  field: string;
  message: string;
  /** read from the body of the response (not from headers or the In) — `mockMinimal` lacks it */
  fromBody: boolean;
}

/** The worker — and the steps of its output mapper that fail when a value is missing (for its test). */
function worker(c: ServiceCollectionSpec, s: CollectionService, idx: TypeIndex, schemaImports: string[]): { content: string; missing: MissingStep[] } {
  const missing: MissingStep[] = [];
  const ref = apiOf(c, s);
  const pkg = collectionPackage(ref);
  const members = membersOf(c, s);
  // `NoInput` / `NoOutput`: their types are not written, nothing reads them
  const inType = s.noIn ? undefined : members.in;
  const outType = s.noOut ? undefined : members.out;
  const types = c.types;
  const vars = inVars(inType);
  const params = requestParams(c, s);
  const translate = (expr: string, target?: Pick<Field, 'type' | 'optional' | 'collection'>) => feelToScala(expr, vars, types, target);
  // an ADT (`enum Out`) has its content in the cases — as in the domain object
  const hasOut = hasMember(outType, idx);
  const uriPath = apiPath(c, s, inType);

  const body: string[] = [];
  body.push('  lazy val serviceTask = example', '');
  body.push(`  override lazy val method = Method.${s.method}`, '');
  body.push('  def apiUri(in: In) =', `    uri"$serviceBasePath${uriPath}"`, '');

  // query: a parameter that is the In field of the same name → `queryKeys` (an empty one is left out)
  const query = params.filter(p => p.in === 'query');
  if (query.length) {
    const parts: string[] = [];
    const keys: string[] = [];
    for (const p of query) {
      const t = translate(p.expression, { type: p.type, optional: !p.required, collection: p.collection });
      const same = vars.get(p.name);
      if (!t.todo && same && t.scala === same.scala && !p.collection) { keys.push(JSON.stringify(p.name)); continue; }
      const value = (v: string) => `${JSON.stringify(p.name)} -> ${v}`;
      if (p.collection) parts.push(`${t.optional ? `${t.scala}.toSeq.flatten` : t.scala}.flatMap(v => queryKeyValues(${value('v')}))`);
      else if (t.optional) parts.push(`${t.scala}.toSeq.flatMap(v => queryKeyValues(${value('v')}))`);
      else parts.push(`queryKeyValues(${value(t.scala)})`);
    }
    if (keys.length) parts.unshift(`queryKeys(${keys.join(', ')})`);
    body.push('  override def querySegments(in: In) =', `    ${parts.join(' ++\n      ')}`, '');
  }

  // headers: required ones in the map, optional ones only when they have a value
  const headers = params.filter(p => p.in === 'header');
  if (headers.length) {
    const sureOnes: string[] = [];
    const optional: string[] = [];
    for (const p of headers) {
      const t = translate(p.expression, { type: p.type });
      if (t.optional && !p.required) optional.push(`${t.scala}.map(v => ${JSON.stringify(p.name)} -> ${asText('v', p.type)})`);
      else sureOnes.push(`${JSON.stringify(p.name)} -> ${asText(sure(t, `Header ${p.name}`), p.type)}`);
    }
    const parts = sureOnes.length ? [`Map(${sureOnes.join(', ')})`, ...optional] : [`${optional[0]}.toMap`, ...optional.slice(1)];
    body.push('  override def inputHeaders(in: In) =', `    ${parts.join(' ++\n      ')}`, '');
  }

  // the body of the request
  if (s.serviceIn) {
    // `type ServiceIn = In` — the request sends the In as it is
    const isIn = !s.serviceIn.collection && !!s.inTypeId && s.serviceIn.type === s.inTypeId;
    const bodyType = !s.serviceIn.collection && !isIn ? types.find(t => t.id === s.serviceIn!.type && t.kind === 'case') : undefined;
    let value: string;
    if (isIn) value = 'in';
    else if (bodyType) {
      const args = (bodyType.fields ?? []).filter(f => isFinished(f, idx)).map(f => {
        const m = (s.bodyMappings ?? []).find(x => x.name === f.name)?.expression
          ?? (vars.has(f.name) ? `= ${f.name}` : '');
        if (!m) return `${scalaName(f.name)} = ${f.optional ? 'None' : `??? /* TODO ${f.name}: kein Mapping — kein Feld gleichen Namens im In */`}`;
        const byCase = caseByCase(m, f, vars);
        if (byCase) return `${scalaName(f.name)} = ${byCase}`;
        const v = forTarget(translate(m, f), !!f.optional);
        return `${scalaName(f.name)} = ${v.needed ? `${v.scala}.getOrElse(${emptyOf(f) ?? `??? /* TODO ${f.name} ist im In optional */`})` : v.scala}`;
      });
      value = `${bodyType.name}(\n${indent(args.join(',\n'), '        ')}\n      )`;
    } else {
      const own = (s.bodyMappings ?? []).find(x => x.name === 'body')?.expression;
      if (own?.trim()) value = forTarget(translate(own, bodyField(s.serviceIn)), !!s.serviceIn.optional).scala;
      else {
        // a list or an ADT: how it comes from the In is no field-by-field mapping
        const what = s.serviceIn.collection ? 'eine Liste' : types.find(t => t.id === s.serviceIn!.type)?.kind === 'enum' ? 'ein ADT' : 'kein Typ der API';
        value = `??? /* TODO ServiceIn aus dem In bauen — ${what} */`;
      }
    }
    body.push('  override def inputMapper(in: In): Option[ServiceIn] =', `    Some(\n      ${value}\n    )`, '');
  }

  // the Out from the response
  if (hasOut || s.serviceOut) {
    const outVars = new Map(vars);
    if (s.serviceOut) outVars.set('body', { scala: 'body', type: s.serviceOut.type, optional: !!s.serviceOut.optional, collection: !!s.serviceOut.collection });
    outVars.set('headers', { scala: 'headers', headers: s.responseHeaders ?? [] });
    // per field its value — a required one from an optional value is a step that fails with a message
    const mapFields = (fields: Field[], expressionOf: (f: Field) => string, outCase?: string) => {
      const steps: string[] = [];
      const args: string[] = [];
      for (const f of fields.filter(x => isFinished(x, idx))) {
        const m = expressionOf(f);
        if (!m.trim()) { args.push(`${scalaName(f.name)} = ${f.optional ? 'None' : `??? /* TODO ${f.name}: kein Mapping — aus body, headers oder dem In */`}`); continue; }
        const v = forTarget(feelToScala(m, outVars, types, f), !!f.optional);
        // a list (or map) that is missing is empty — no reason to fail
        const empty = v.needed ? emptyOf(f) : null;
        if (empty) { args.push(`${scalaName(f.name)} = ${v.scala}.getOrElse(${empty})`); continue; }
        if (v.needed) {
          const message = `${s.name}: ${f.name} fehlt in der Antwort`;
          missing.push({ ...(outCase ? { outCase } : {}), field: f.name, message, fromBody: /^body\b/.test(v.scala) });
          steps.push(`${scalaName(f.name)} <- ${v.scala}.toRight(ServiceMappingError(${JSON.stringify(message)}))`);
          args.push(`${scalaName(f.name)} = ${scalaName(f.name)}`);
        } else args.push(`${scalaName(f.name)} = ${v.scala}`);
      }
      return { steps, args };
    };
    const { steps, args } = mapFields(outType?.kind === 'enum' ? [] : outType?.fields ?? [],
      f => (s.outMappings ?? []).find(x => x.name === f.name)?.expression ?? '');
    // `type ServiceOut = Out` — the response is the Out as it is
    const isOut = !!s.serviceOut && !s.serviceOut.collection && !!s.outTypeId && s.serviceOut.type === s.outTypeId && !s.noOut;
    // an Out with cases: the first case whose condition holds, per case its fields (see outCases.ts)
    const cases = hasOut && outType?.kind === 'enum' ? outCaseFields(outType) : [];
    const chain = cases.length
      ? caseChain(
        cases.map((c, i) => {
          const oc = outCaseOf(s.outCases, c.name);
          const m = mapFields(c.fields, f => outCaseMapping(oc, f.name), c.name);
          const name = `Out.${caseIdent(c.name)}`;
          const value = m.args.length ? `${name}(\n${indent(m.args.join(',\n'), '  ')}\n)` : name;
          return {
            cond: oc.condition?.trim() ? feelCondition(oc.condition, outVars, types).scala
              : i === cases.length - 1 ? undefined : `??? /* TODO ${c.name}: keine Bedingung — wann ist es dieser Fall? */`,
            value: m.steps.length ? ['for', ...m.steps.map(st => `  ${st}`), `yield ${value}`].join('\n') : `Right(${value})`,
          };
        }),
        `Left(ServiceMappingError(${JSON.stringify(`${s.name}: kein Fall des Out passt zur Antwort`)}))`,
      )
      : null;
    const out = !hasOut ? 'NoOutput()'
      : outType?.kind === 'enum' ? adtTodo(outType)
        : `Out(\n${indent(args.join(',\n'), '        ')}\n      )`;
    const lines = ['  override def outputMapper(', '      out: ServiceResponse[ServiceOut],', '      in: In', '  ): Either[ServiceMappingError, Out] ='];
    if (isOut) {
      lines.push('    Right(out.outputBody)', '  end outputMapper', '');
      body.push(...lines);
    } else {
    // the Scala that reads `name` — not in a text (the messages name the service) or a comment
    const code = (scala: string) => scala.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\*[\s\S]*?\*\//g, '');
    const uses = (name: string) => new RegExp(`\\b${name}\\b`).test(code(chain ?? [...args.map(a => a.split(' = ').slice(1).join(' = ')), ...steps].join('\n')));
    if (uses('body')) lines.push('    val body = out.outputBody');
    if (uses('headers')) lines.push('    val headers = out.headers');
    if (chain) lines.push(indent(chain, '    '));
    else if (steps.length) lines.push('    for', ...steps.map(st => `      ${st}`), `    yield ${out.replace(/\n {6}/g, '\n    ')}`);
    else lines.push(`    Right(\n      ${out}\n    )`);
    lines.push('  end outputMapper', '');
    body.push(...lines);
    }
  }

  const imports = [
    'import WorkerError.*',
    '',
    `import ${pkg}.*`,
    ...schemaImports,
    ...bodyImports(s, idx),
    `import ${pkg}.${s.name}.*`,
  ];
  const content = `${workerPackageClause(ref)}

${imports.join('\n')}

class ${s.name}Worker
  extends CompanyServiceWorkerDsl[In, Out, ServiceIn, ServiceOut]:

${body.join('\n').replace(/\n+$/, '')}

end ${s.name}Worker
`;
  return { content, missing };
}

/** The own types a type reaches through its fields — itself included. */
/**
 * `serviceBasePath` of an API: the URL of the API and the base of the company —
 * its placeholders are what the company knows (`$bankNumber`), to fill in by hand.
 */
/** A nested API without its chain although some paths follow its levels — a TODO (none with an own expression). */
function baseIssue(c: ServiceCollectionSpec, a: ApiRef): string {
  const issue = c.serviceBasePaths?.[apiKey(a)]?.trim() ? null : chainIssue(c, a);
  return issue ? `  /* TODO not from the base of the levels: ${issue} */\n` : '';
}

function serviceBasePath(c: ServiceCollectionSpec, a: ApiRef): string {
  // as the project has it (`s"$basePath/…/banks/$bankNumber"`) — the Abgleich takes it over
  const own = c.serviceBasePaths?.[apiKey(a)]?.trim();
  const chain = baseChain(c, a);
  return own || (chain ? chainServiceBasePath(chain) : defaultServiceBasePath(c));
}

/** `serviceBasePath` without an own expression: from the URL of the API and the base of the company */
export function defaultServiceBasePath(c: ServiceCollectionSpec): string {
  const url = (c.source?.basePath || 'TODO: https://…').replace(/\/+$/, '');
  const base = normalPathBase(c.pathBase);
  if (!base) return scalaKey(url);
  const text = `${url}${base}`.replace(/[\\"]/g, m => `\\${m}`).replace(/\$/g, '$$$$');
  return `s"${text.replace(/\{([^}]+)\}/g, (_, name: string) => `\${??? /* TODO ${name} — wie die Firma ihn setzt */}`)}"`;
}

/** The own types a service uses — In, Out, bodies and parameters. */
/**
 * All files of the collection — what the helper writes into the project. Per API
 * its package: the super trait, the ServiceTasks, the ServiceWorkers. A type of the
 * API lives in the `schema/` of the first API that uses it; the others import it.
 */
export function collectionFiles(c: ServiceCollectionSpec, model: Model | null = null): ScalaFile[] {
  const home = c.project.split('-').join('.');
  const services = c.services.filter(s => s.name.trim());
  const apis = apisOf({ ...c, services });
  const schema = c.types.filter(t => !t.interactionId && t.name?.trim());
  // where each schema type lives: the schema of its first API — or of the level its APIs share
  const homes = schemaHomes(c);
  const schemaImports = (ids: Set<string>): string[] =>
    [...new Set([...ids].map(id => homes.get(id)?.pkg).filter((p): p is string => !!p).map(p => `import ${p}.*`))].sort();
  const indexes = new Map<string, TypeIndex>();
  const indexOf = (a: ApiRef): TypeIndex => {
    const pkg = collectionPackage(a);
    if (!indexes.has(pkg)) indexes.set(pkg, indexTypes(c.types, model, home, pkg));
    return indexes.get(pkg)!;
  };

  const out: ScalaFile[] = [];
  for (const a of apis) {
    const idx = indexOf(a);
    const own = services.filter(s => sameApi(apiOf(c, s), a));
    const dDir = domainDir(a);
    const wDir = workerDir(a);
    out.push({ path: `${dDir}/${collectionTrait(a)}.scala`, content: superTrait(c, a, apis.length === 1) });
    for (const s of own) out.push({ path: `${dDir}/${s.name}.scala`, content: domainObject(c, s, idx, schemaImports(typesOf(s, c.types))) });
    out.push({
      path: `${wDir}/exports.scala`,
      content: `${workerPackageClause(a)}\n\n/** where the API runs — per stage from the configuration, if it differs */\ndef serviceBasePath: String =\n  ${serviceBasePath(c, a)}\n${baseIssue(c, a)}`,
    });
    const workers = own.map(s => ({ s, ...worker(c, s, idx, schemaImports(typesOf(s, c.types))) }));
    for (const w of workers) out.push({ path: `${wDir}/${w.s.name}Worker.scala`, content: w.content });
    for (const w of workers) out.push({ path: `${workerTestDir(a)}/${w.s.name}WorkerTest.scala`, content: workerTest(c, w.s, idx, schemaImports(typesOf(w.s, c.types)), w.missing) });
  }
  // the types: in the schema of their API, or of the level the APIs share
  const files = new Map<string, ScalaFile[]>();
  for (const t of schema) {
    const h = homes.get(t.id);
    if (!h) continue;
    const idx = indexOf(h.api);
    if (idx.referenced.has(t.id)) continue;
    // a type of another schema it points to: imported from there
    const others = schemaImports(reach(t.id, c.types)).filter(i => i !== `import ${h.pkg}.*`);
    const imports = [...others, ...importsOf(t, idx)];
    const list = files.get(h.pkg) ?? [];
    list.push({
      path: `01-domain/src/main/scala/${h.pkg.replace(/\./g, '/')}/${t.name}.scala`,
      content: `${packageClause(h.pkg)}\n${imports.length ? `\n${imports.join('\n')}\n` : ''}\n${renderType(t, idx)}\n`,
    });
    files.set(h.pkg, list);
  }
  // the base paths of the project and the levels of nested APIs — created once
  return [...orderFiles(out, files), ...chainFiles(c, apis)];
}

/** The schema files right after the domain files of their API (before its worker) — shared ones at the end. */
function orderFiles(out: ScalaFile[], schemaFiles: Map<string, ScalaFile[]>): ScalaFile[] {
  const result: ScalaFile[] = [];
  const done = new Set<string>();
  for (let i = 0; i < out.length; i++) {
    result.push(out[i]);
    const next = out[i + 1];
    // the last domain file of an API: its schema follows
    if (out[i].path.startsWith('01-domain/') && (!next || !next.path.startsWith('01-domain/') || dirOf(next.path) !== dirOf(out[i].path))) {
      const pkg = `${dirOf(out[i].path).replace('01-domain/src/main/scala/', '').replace(/\//g, '.')}.schema`;
      for (const f of schemaFiles.get(pkg) ?? []) result.push(f);
      done.add(pkg);
    }
  }
  for (const [pkg, list] of schemaFiles) if (!done.has(pkg)) result.push(...list);
  return result;
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'));

/** The files as one text — the same frame as the process export, the helper splits it again. */
export function collectionBundle(c: ServiceCollectionSpec, model: Model | null = null): string {
  const files = collectionFiles(c, model);
  return files.map(f => `// ${'─'.repeat(72)}\n// ${f.path}\n// ${'─'.repeat(72)}\n\n${f.content}`).join('\n\n');
}

/** The services whose code has a place to fill by hand (`???`). */
export function openTodos(c: ServiceCollectionSpec, model: Model | null = null): { file: string; count: number }[] {
  return collectionFiles(c, model)
    .map(f => ({ file: f.path.split('/').pop()!, count: (f.content.match(/\?\?\?/g) ?? []).length }))
    .filter(x => x.count > 0);
}

export { pathParams };
