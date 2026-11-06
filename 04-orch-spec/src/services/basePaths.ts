// Where the services of a nested API run: a chain of base paths, one per level.
//
// The paths of an OpenAPI name the levels of the API (`clientMaster.multipleNaturalPersons`):
//
//   /api/ClientMaster/v1/MultipleNaturalPersons/ReadMultipleNaturalPerson2
//    ───  ────────────────  ──────────────────────  ──────────────────────────
//    project   level         the API                 the service (apiUri)
//
// The worker gets each part where it belongs — as the projects write it by hand:
//
//   worker/exports.scala                lazy val crmBasePath = ???  (the gateway of the company — a TODO)
//   worker/clientMaster/exports.scala   def clientMasterBasePath = s"$crmBasePath/ClientMaster/v1"
//   …/multipleNaturalPersons/v1/exports.scala
//                                       def serviceBasePath = s"$clientMasterBasePath/MultipleNaturalPersons"
//   the worker                          uri"$serviceBasePath/ReadMultipleNaturalPerson2"
//
// The project and the level files are created once (the helper leaves them as they are then).
// Without levels in the paths (or an API that is not nested) nothing changes.
import type { ScalaFile } from '../scala.ts';
import { apiLeaf, apiOf, apiParents, sameApi, workerPath, type ApiRef } from './collection.ts';
import type { ServiceCollectionSpec } from './types.ts';

export interface BaseChain {
  /** the segments before the first level — part of the project's base path (`api`) */
  prefix: string[];
  /** per level its segments (`ClientMaster`, `v1`) */
  levels: { level: string; segments: string[] }[];
  /** the segments of the API itself (`MultipleNaturalPersons`) */
  api: string[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const VERSION = /^v\d+$/i;

/** `acme-crm` → `crmBasePath`, `acme-core-neo` → `coreNeoBasePath` — the base of the project */
export function projectBaseVar(project: string): string {
  const parts = project.split('-').filter(Boolean).slice(1);
  const name = (parts.length ? parts : project.split('-')).map((p, i) => (i ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join('');
  return `${name}BasePath`;
}

/** `clientMaster` → `clientMasterBasePath` */
export const levelBaseVar = (level: string): string => `${level}BasePath`;

/**
 * The parts of a path along the levels of the API — null if the path does not name them all.
 * A version after a level belongs to the level (`ClientMaster/v1`). A version after the API
 * (`Persons/v2/Read`) belongs to the API only if `leafVersion` — and then a service follows it.
 */
function chainOf(path: string, a: ApiRef, leafVersion: boolean): BaseChain | null {
  const segs = path.split('/').filter(Boolean);
  const levels = apiParents(a.api);
  if (!levels.length) return null;
  const start = segs.findIndex(s => same(s, levels[0]));
  if (start < 0) return null;
  let at = start;
  const out: BaseChain['levels'] = [];
  for (const level of levels) {
    if (!segs[at] || !same(segs[at], level)) return null;
    const from = at++;
    if (segs[at] && VERSION.test(segs[at])) at++;
    out.push({ level, segments: segs.slice(from, at) });
  }
  if (!segs[at] || !same(segs[at], apiLeaf(a.api))) return null;
  const from = at++;
  if (leafVersion) {
    if (!segs[at] || !VERSION.test(segs[at]) || segs.length <= at + 1) return null;
    at++;
  }
  return { prefix: segs.slice(0, start), levels: out, api: segs.slice(from, at) };
}

const key = (c: BaseChain) => [...c.prefix, ...c.levels.flatMap(l => l.segments), ...c.api].join('/');

const servicesOf = (c: ServiceCollectionSpec, a: ApiRef) =>
  c.services.filter(s => s.name.trim() && s.path && sameApi(apiOf(c, s), a));

/**
 * The chain of an API — the same for all its services, otherwise none. A version after the
 * API is part of it only if every service has it (and something after it).
 */
export function baseChain(c: ServiceCollectionSpec, a: ApiRef): BaseChain | null {
  const paths = servicesOf(c, a).map(s => workerPath(c, s.path));
  if (!paths.length) return null;
  for (const leafVersion of [true, false]) {
    const chains = paths.map(p => chainOf(p, a, leafVersion));
    const first = chains[0];
    if (first && chains.every(x => x && key(x) === key(first))) return first;
  }
  return null;
}

/**
 * Why a nested API has no chain although some of its paths follow its levels — the worker
 * then takes the base without levels; null if there is a chain or no path follows them (a flat API).
 */
export function chainIssue(c: ServiceCollectionSpec, a: ApiRef): string | null {
  if (!apiParents(a.api).length || baseChain(c, a)) return null;
  const services = servicesOf(c, a);
  const fits = services.map(s => chainOf(workerPath(c, s.path), a, false));
  if (!fits.some(Boolean)) return null;
  const off = services.filter((_, i) => !fits[i]).map(s => s.name);
  return off.length
    ? `the paths of ${off.join(', ')} do not follow the levels of ${a.api}`
    : `the services of ${a.api} start their paths differently`;
}

/** `/api/ClientMaster/v1/MultipleNaturalPersons` — what `serviceBasePath` stands for */
export const chainPath = (chain: BaseChain): string => `/${key(chain)}`;

/** `/ClientMaster/v1/MultipleNaturalPersons` — the part after the project's base */
export const chainBelowProject = (chain: BaseChain): string =>
  `/${[...chain.levels.flatMap(l => l.segments), ...chain.api].join('/')}`;

/** `s"$clientMasterBasePath/MultipleNaturalPersons"` — the API's `serviceBasePath` */
export const chainServiceBasePath = (chain: BaseChain): string =>
  `s"$${levelBaseVar(chain.levels[chain.levels.length - 1].level)}/${chain.api.join('/')}"`;

/**
 * The files of the base paths of the project and its levels — for all APIs of the collection
 * that have a chain; a level shared by several APIs once (the first one says its segments,
 * another one with other segments is a TODO in the file).
 */
export function chainFiles(c: ServiceCollectionSpec, apis: ApiRef[]): ScalaFile[] {
  const stem = [...c.project.split('-').filter(Boolean), 'worker'];
  const dir = (pkgs: string[]) => `03-worker/src/main/scala/${[...stem, ...pkgs].join('/')}`;
  const projectVar = projectBaseVar(c.project);
  const out = new Map<string, ScalaFile>();
  const levels = new Map<string, { levels: string[]; parent: string; segments: string; others: string[] }>();
  for (const a of apis) {
    const chain = baseChain(c, a);
    if (!chain) continue;
    const prefix = chain.prefix.length ? `/${chain.prefix.join('/')}` : '';
    const projectPath = `${dir([])}/exports.scala`;
    if (!out.has(projectPath)) {
      out.set(projectPath, {
        path: projectPath,
        content: `package ${stem.join('.')}

/** where the APIs of the project run — per stage, e.g. behind the gateway of the company */
lazy val ${projectVar}: String =
  ??? /* TODO the URL of the project${prefix ? `, with ${prefix} at the end` : ''} — e.g. s"https://…${prefix}" */
`,
      });
    }
    chain.levels.forEach((l, i) => {
      const names = chain.levels.slice(0, i + 1).map(x => x.level);
      const path = `${dir(names)}/exports.scala`;
      const segments = l.segments.join('/');
      const known = levels.get(path);
      if (known) {
        if (known.segments !== segments && !known.others.includes(`${segments} (${a.api} v${a.apiVersion})`))
          known.others.push(`${segments} (${a.api} v${a.apiVersion})`);
        return;
      }
      const parent = i === 0 ? projectVar : levelBaseVar(chain.levels[i - 1].level);
      levels.set(path, { levels: names, parent, segments, others: [] });
    });
  }
  for (const [path, l] of levels) {
    const todo = l.others.length ? `\n  /* TODO other APIs have other segments here: ${l.others.join(', ')} */` : '';
    out.set(path, {
      path,
      content: `${[`package ${stem.join('.')}`, ...l.levels.map(x => `package ${x}`)].join('\n')}

/** where the APIs of ${l.levels.join('.')} run — the start of their paths */
def ${levelBaseVar(l.levels[l.levels.length - 1])}: String =
  s"$${l.parent}/${l.segments}"${todo}
`,
    });
  }
  return [...out.values()];
}
