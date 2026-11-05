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

/** The parts of a path along the levels of the API — null if the path does not name them all. */
function chainOf(path: string, a: ApiRef): BaseChain | null {
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
  if (segs[at] && VERSION.test(segs[at]) && segs.length > at + 1) at++;
  return { prefix: segs.slice(0, start), levels: out, api: segs.slice(from, at) };
}

const key = (c: BaseChain) => [...c.prefix, ...c.levels.flatMap(l => l.segments), ...c.api].join('/');

/** The chain of an API — the same for all its services, otherwise none. */
export function baseChain(c: ServiceCollectionSpec, a: ApiRef): BaseChain | null {
  const services = c.services.filter(s => s.name.trim() && s.path && sameApi(apiOf(c, s), a));
  if (!services.length) return null;
  const chains = services.map(s => chainOf(workerPath(c, s.path), a));
  const first = chains[0];
  return first && chains.every(x => x && key(x) === key(first)) ? first : null;
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
 * that have a chain; a level shared by several APIs once (the first one says its segments).
 */
export function chainFiles(c: ServiceCollectionSpec, apis: ApiRef[]): ScalaFile[] {
  const stem = [...c.project.split('-').filter(Boolean), 'worker'];
  const dir = (pkgs: string[]) => `03-worker/src/main/scala/${[...stem, ...pkgs].join('/')}`;
  const projectVar = projectBaseVar(c.project);
  const out = new Map<string, ScalaFile>();
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
      const levels = chain.levels.slice(0, i + 1).map(x => x.level);
      const path = `${dir(levels)}/exports.scala`;
      if (out.has(path)) return;
      const parent = i === 0 ? projectVar : levelBaseVar(chain.levels[i - 1].level);
      out.set(path, {
        path,
        content: `${[`package ${stem.join('.')}`, ...levels.map(x => `package ${x}`)].join('\n')}

/** where the APIs of ${levels.join('.')} run — the start of their paths */
def ${levelBaseVar(l.level)}: String =
  s"$${parent}/${l.segments.join('/')}"
`,
      });
    });
  }
  return [...out.values()];
}
