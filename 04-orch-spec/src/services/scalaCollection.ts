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
import { exampleValue, fieldType, importsOf, indexTypes, isFinished, packageClause, renderType, scalaKey, scalaName, type ScalaFile, type TypeIndex } from '../scala';
import type { Field, Model, TypeDef } from '../types';
import {
  apiOf, apisOf, collectionPackage, collectionTrait, domainDir, membersOf, pathParams, sameApi, serviceTopic, workerDir, workerPackage, type ApiRef,
} from './collection';
import { asText, feelToScala, forTarget, scalaIdent, type ScalaVar, type Translated } from './feelScala';
import type { BodyRef, CollectionService, ServiceCollectionSpec } from './types';

const indent = (text: string, by = '  ') => text.split('\n').map(l => (l ? by + l : l)).join('\n');

/** `val descr` — one line as a string, several as `"""…""".stripMargin` */
function descr(text: string | undefined): string {
  const t = (text ?? '').trim().replace(/"""/g, '\\"\\"\\"');
  if (!t.includes('\n')) return `  val descr: String = ${scalaKey(t)}`;
  const [first, ...rest] = t.split('\n');
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
    if (!t || !fields.length) {
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
  const head = [packageClause(pkg), '', ...[...imports].sort(), ...(imports.size ? [''] : [])];
  return `${head.join('\n')}\n${lines.join('\n')}\n`;
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

const workerPackageClause = (ref: ApiRef): string => {
  const parts = workerPackage(ref).split('.');
  const at = parts.indexOf('worker');
  return `package ${parts.slice(0, at + 1).join('.')}\npackage ${parts.slice(at + 1).join('.')}`;
};

/** What a mapping of the request can read: the fields of the In. */
function inVars(inType: TypeDef | undefined): Map<string, ScalaVar> {
  return new Map((inType?.fields ?? []).filter(f => f.name).map(f => [f.name, {
    scala: `in.${scalaIdent(f.name)}`, type: f.type, optional: !!f.optional, collection: !!f.collection,
  }]));
}

/** a sure value for a place that needs one (path, required header) — an optional one is a TODO */
function sure(t: Translated, what: string): string {
  if (t.todo || !t.optional) return t.scala;
  return `${t.scala}.getOrElse(??? /* TODO ${what} ist optional */)`;
}

function worker(c: ServiceCollectionSpec, s: CollectionService, idx: TypeIndex, schemaImports: string[]): string {
  const ref = apiOf(c, s);
  const pkg = collectionPackage(ref);
  const { in: inType, out: outType } = membersOf(c, s);
  const types = c.types;
  const vars = inVars(inType);
  const params = s.params.filter(p => !p.disabled && p.name);
  const translate = (expr: string, target?: Pick<Field, 'type' | 'optional' | 'collection'>) => feelToScala(expr, vars, types, target);
  const hasOut = !!(outType?.fields ?? []).some(f => isFinished(f, idx));

  // the path: `{clientKey}` → `${in.clientKey}`
  const byName = new Map(params.filter(p => p.in === 'path').map(p => [p.name, p]));
  const uriPath = s.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const p = byName.get(name);
    return p ? `\${${sure(translate(p.expression, { type: p.type }), `Pfad-Parameter ${name}`)}}` : `\${??? /* TODO Pfad-Parameter ${name} */}`;
  });

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
    const bodyType = !s.serviceIn.collection ? types.find(t => t.id === s.serviceIn!.type && t.kind === 'case') : undefined;
    let value: string;
    if (bodyType) {
      const args = (bodyType.fields ?? []).filter(f => isFinished(f, idx)).map(f => {
        const m = (s.bodyMappings ?? []).find(x => x.name === f.name)?.expression
          ?? (vars.has(f.name) ? `= ${f.name}` : '');
        if (!m) return `${scalaName(f.name)} = ${f.optional ? 'None' : `??? /* TODO ${f.name}: kein Mapping */`}`;
        const v = forTarget(translate(m, f), !!f.optional);
        return `${scalaName(f.name)} = ${v.needed ? `${v.scala}.getOrElse(??? /* TODO ${f.name} ist im In optional */)` : v.scala}`;
      });
      value = `${bodyType.name}(\n${indent(args.join(',\n'), '        ')}\n      )`;
    } else {
      const t = translate((s.bodyMappings ?? []).find(x => x.name === 'body')?.expression ?? '= body', bodyField(s.serviceIn));
      value = forTarget(t, !!s.serviceIn.optional).scala;
    }
    body.push('  override def inputMapper(in: In): Option[ServiceIn] =', `    Some(\n      ${value}\n    )`, '');
  }

  // the Out from the response
  if (hasOut || s.serviceOut) {
    const outVars = new Map(vars);
    if (s.serviceOut) outVars.set('body', { scala: 'body', type: s.serviceOut.type, optional: !!s.serviceOut.optional, collection: !!s.serviceOut.collection });
    outVars.set('headers', { scala: 'headers', headers: true });
    const steps: string[] = [];
    const args: string[] = [];
    for (const f of (outType?.fields ?? []).filter(x => isFinished(x, idx))) {
      const m = (s.outMappings ?? []).find(x => x.name === f.name)?.expression ?? '';
      if (!m.trim()) { args.push(`${scalaName(f.name)} = ${f.optional ? 'None' : `??? /* TODO ${f.name}: kein Mapping */`}`); continue; }
      const v = forTarget(feelToScala(m, outVars, types, f), !!f.optional);
      if (v.needed) {
        steps.push(`${scalaName(f.name)} <- ${v.scala}.toRight(ServiceMappingError(${JSON.stringify(`${s.name}: ${f.name} fehlt in der Antwort`)}))`);
        args.push(`${scalaName(f.name)} = ${scalaName(f.name)}`);
      } else args.push(`${scalaName(f.name)} = ${v.scala}`);
    }
    const out = hasOut ? `Out(\n${indent(args.join(',\n'), '        ')}\n      )` : 'NoOutput()';
    const lines = ['  override def outputMapper(', '      out: ServiceResponse[ServiceOut],', '      in: In', '  ): Either[ServiceMappingError, Out] ='];
    const uses = (name: string) => args.some(a => new RegExp(`\\b${name}\\b`).test(a.split(' = ').slice(1).join(' = '))) || steps.some(st => new RegExp(`\\b${name}\\b`).test(st));
    if (uses('body')) lines.push('    val body = out.outputBody');
    if (uses('headers')) lines.push('    val headers = out.headers');
    if (steps.length) lines.push('    for', ...steps.map(st => `      ${st}`), `    yield ${out.replace(/\n {6}/g, '\n    ')}`);
    else lines.push(`    Right(\n      ${out}\n    )`);
    lines.push('  end outputMapper', '');
    body.push(...lines);
  }

  const imports = [
    'import WorkerError.*',
    '',
    `import ${pkg}.*`,
    ...schemaImports,
    `import ${pkg}.${s.name}.*`,
  ];
  return `${workerPackageClause(ref)}

${imports.join('\n')}

class ${s.name}Worker
  extends CompanyServiceWorkerDsl[In, Out, ServiceIn, ServiceOut]:

${body.join('\n').replace(/\n+$/, '')}

end ${s.name}Worker
`;
}

/** The own types a type reaches through its fields — itself included. */
function reach(id: string | undefined, types: TypeDef[], seen = new Set<string>()): Set<string> {
  if (!id || seen.has(id)) return seen;
  const t = types.find(x => x.id === id);
  if (!t) return seen;
  seen.add(id);
  for (const f of [...(t.fields ?? []), ...(t.values ?? []).flatMap(v => v.fields ?? [])]) reach(f.type, types, seen);
  return seen;
}

/** The own types a service uses — In, Out, bodies and parameters. */
function typesOf(s: CollectionService, types: TypeDef[]): Set<string> {
  const seen = new Set<string>();
  for (const id of [s.inTypeId, s.outTypeId, s.serviceIn?.type, s.serviceOut?.type, ...s.params.map(p => p.type)]) reach(id, types, seen);
  return seen;
}

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
  // the owner API of each schema type: the first one whose services use it — or the first API
  const owner = new Map<string, ApiRef>();
  for (const a of apis) {
    for (const s of services.filter(x => sameApi(apiOf(c, x), a))) {
      for (const id of typesOf(s, c.types)) if (!owner.has(id) && schema.some(t => t.id === id)) owner.set(id, a);
    }
  }
  if (apis[0]) for (const t of schema) if (!owner.has(t.id)) owner.set(t.id, apis[0]);
  const schemaImports = (ids: Set<string>): string[] =>
    [...new Set([...ids].map(id => owner.get(id)).filter((a): a is ApiRef => !!a).map(a => `import ${collectionPackage(a)}.schema.*`))].sort();

  const out: ScalaFile[] = [];
  for (const a of apis) {
    const pkg = collectionPackage(a);
    const idx = indexTypes(c.types, model, home, pkg);
    const own = services.filter(s => sameApi(apiOf(c, s), a));
    const dDir = domainDir(a);
    const wDir = workerDir(a);
    out.push({ path: `${dDir}/${collectionTrait(a)}.scala`, content: superTrait(c, a, apis.length === 1) });
    for (const s of own) out.push({ path: `${dDir}/${s.name}.scala`, content: domainObject(c, s, idx, schemaImports(typesOf(s, c.types))) });
    for (const t of schema.filter(x => owner.get(x.id) === a && !idx.referenced.has(x.id))) {
      // a type of another API it points to: imported from there
      const others = schemaImports(reach(t.id, c.types)).filter(i => i !== `import ${pkg}.schema.*`);
      const imports = [...others, ...importsOf(t, idx)];
      out.push({
        path: `${dDir}/schema/${t.name}.scala`,
        content: `${packageClause(`${pkg}.schema`)}\n${imports.length ? `\n${imports.join('\n')}\n` : ''}\n${renderType(t, idx)}\n`,
      });
    }
    out.push({
      path: `${wDir}/exports.scala`,
      content: `${workerPackageClause(a)}\n\n/** where the API runs — per stage from the configuration, if it differs */\ndef serviceBasePath: String =\n  ${scalaKey(c.source?.basePath || 'TODO: https://…')}\n`,
    });
    for (const s of own) out.push({ path: `${wDir}/${s.name}Worker.scala`, content: worker(c, s, idx, schemaImports(typesOf(s, c.types))) });
  }
  return out;
}

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
