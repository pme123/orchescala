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
  apiKey, apiOf, apisOf, basePathParams, collectionPackage, collectionTrait, domainDir, membersOf, normalPathBase, pathParams, workerPath, sameApi, serviceTopic, workerDir, workerPackage, type ApiRef,
} from './collection.ts';
import { reach, schemaHomes, typesOf } from './hierarchy.ts';
import { asText, feelCondition, feelToScala, forTarget, scalaIdent, type ScalaVar, type Translated } from './feelScala.ts';
import { caseChain, outCaseFields, outCaseMapping, outCaseOf } from './outCases.ts';
import type { BodyRef, CollectionService, ServiceCollectionSpec } from './types';

export const indent = (text: string, by = '  ') => text.split('\n').map(l => (l ? by + l : l)).join('\n');

/** `val descr` — one line as a string, several as `"""…""".stripMargin` */
export function descr(text: string | undefined): string {
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
  return `package ${parts.slice(0, at + 1).join('.')}\npackage ${parts.slice(at + 1).join('.')}`;
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

function worker(c: ServiceCollectionSpec, s: CollectionService, idx: TypeIndex, schemaImports: string[]): string {
  const ref = apiOf(c, s);
  const pkg = collectionPackage(ref);
  const members = membersOf(c, s);
  // `NoInput` / `NoOutput`: their types are not written, nothing reads them
  const inType = s.noIn ? undefined : members.in;
  const outType = s.noOut ? undefined : members.out;
  const types = c.types;
  const vars = inVars(inType);
  const fromBase = basePathParams(c, s);
  const params = s.params.filter(p => !p.disabled && p.name && !(p.in === 'path' && fromBase.has(p.name)));
  const translate = (expr: string, target?: Pick<Field, 'type' | 'optional' | 'collection'>) => feelToScala(expr, vars, types, target);
  // an ADT (`enum Out`) has its content in the cases — as in the domain object
  const hasOut = !!(outType?.fields ?? []).some(f => isFinished(f, idx)) || (outType?.kind === 'enum' && (outType.values ?? []).some(v => v.name));

  // the path: `{clientKey}` → `${in.clientKey}` — without the base the company's serviceBasePath has
  const byName = new Map(params.filter(p => p.in === 'path').map(p => [p.name, p]));
  const uriPath = workerPath(c, s.path).replace(/\{([^}]+)\}/g, (_, name: string) => {
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
        const v = forTarget(translate(m, f), !!f.optional);
        return `${scalaName(f.name)} = ${v.needed ? `${v.scala}.getOrElse(??? /* TODO ${f.name} ist im In optional */)` : v.scala}`;
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
    const mapFields = (fields: Field[], expressionOf: (f: Field) => string) => {
      const steps: string[] = [];
      const args: string[] = [];
      for (const f of fields.filter(x => isFinished(x, idx))) {
        const m = expressionOf(f);
        if (!m.trim()) { args.push(`${scalaName(f.name)} = ${f.optional ? 'None' : `??? /* TODO ${f.name}: kein Mapping — aus body, headers oder dem In */`}`); continue; }
        const v = forTarget(feelToScala(m, outVars, types, f), !!f.optional);
        if (v.needed) {
          steps.push(`${scalaName(f.name)} <- ${v.scala}.toRight(ServiceMappingError(${JSON.stringify(`${s.name}: ${f.name} fehlt in der Antwort`)}))`);
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
          const m = mapFields(c.fields, f => outCaseMapping(oc, f.name));
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
  return `${workerPackageClause(ref)}

${imports.join('\n')}

class ${s.name}Worker
  extends CompanyServiceWorkerDsl[In, Out, ServiceIn, ServiceOut]:

${body.join('\n').replace(/\n+$/, '')}

end ${s.name}Worker
`;
}

/** The own types a type reaches through its fields — itself included. */
/**
 * `serviceBasePath` of an API: the URL of the API and the base of the company —
 * its placeholders are what the company knows (`$bankNumber`), to fill in by hand.
 */
function serviceBasePath(c: ServiceCollectionSpec, a: ApiRef): string {
  // as the project has it (`s"$basePath/…/banks/$bankNumber"`) — the Abgleich takes it over
  const own = c.serviceBasePaths?.[apiKey(a)]?.trim();
  return own || defaultServiceBasePath(c);
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
      content: `${workerPackageClause(a)}\n\n/** where the API runs — per stage from the configuration, if it differs */\ndef serviceBasePath: String =\n  ${serviceBasePath(c, a)}\n`,
    });
    for (const s of own) out.push({ path: `${wDir}/${s.name}Worker.scala`, content: worker(c, s, idx, schemaImports(typesOf(s, c.types))) });
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
  return orderFiles(out, files);
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
