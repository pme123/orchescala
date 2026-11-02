// The dependencies of an Orchescala project — from its `PROJECT.conf`:
//
//   dependencies: [
//     mycompany-commons
//   ]
//   workerDependencies: [ "mycompany-services" ]
//
// The helper puts both lists into every module with project dependencies,
// the domain included (`VersionHelper.allDependencies`) — so generated code
// sees the domain of these projects, and of what they depend on (sbt resolves
// them transitively). Nothing else: an example value (`default…`) of a project
// outside of them would not compile.
import type { Model } from './types.ts';

/** HOCON comments (`// …`, `# …`) — outside of a quoted string */
const withoutComments = (text: string): string =>
  text.split('\n').map(line => {
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') quoted = !quoted;
      else if (!quoted && (c === '#' || (c === '/' && line[i + 1] === '/'))) return line.slice(0, i);
    }
    return line;
  }).join('\n');

const listOf = (text: string, key: string): string[] => {
  const m = new RegExp(`(?:^|\\n)\\s*${key}\\s*[:=]\\s*\\[([^\\]]*)\\]`).exec(text);
  if (!m) return [];
  return m[1].split(/[,\n]/).map(s => s.trim().replace(/^"(.*)"$/, '$1').trim()).filter(Boolean);
};

/** the projects a project depends on — `dependencies` and `workerDependencies`, each once */
export function dependenciesOfConf(text: string): string[] {
  const clean = withoutComments(text);
  return [...new Set([...listOf(clean, 'dependencies'), ...listOf(clean, 'workerDependencies')])];
}

/** the package root of a project: `acme-core-banking` → `acme.core.banking` (as `DependencyConfig.projectPackage`) */
export const projectPackage = (project: string): string => project.split('-').filter(Boolean).join('.');

/**
 * The dependencies per project, by its package root — from the catalog
 * (`projectDependencies`) and the own scan (`projects`); the own scan wins.
 * `undefined`: not known (a project without `PROJECT.conf` or from an older scan).
 */
function dependencyMap(model: Model | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [p, deps] of Object.entries(model?.projectDependencies ?? {})) out.set(projectPackage(p), deps);
  for (const p of model?.projects ?? []) if (Array.isArray(p.dependencies)) out.set(projectPackage(p.name), p.dependencies);
  return out;
}

/**
 * The package roots generated code of a project sees: its own and those of
 * its dependencies, transitively. `home`: the package root of the project
 * (`acme.product`, see `homeOf`).
 */
export function visibleRoots(model: Model | null, home: string): Set<string> {
  const deps = dependencyMap(model);
  const seen = new Set<string>();
  const todo = [home];
  while (todo.length) {
    const root = todo.pop()!;
    if (!root || seen.has(root)) continue;
    seen.add(root);
    for (const d of deps.get(root) ?? []) todo.push(projectPackage(d));
  }
  return seen;
}

/** the project of each package, from the source path of its types (`acme-crm/01-domain/…`) */
const projectsByPackage = new WeakMap<object, Map<string, string>>();
function projectOfPackage(model: Model | null, pkg: string): string | undefined {
  const types = model?.domainTypes;
  if (!types) return undefined;
  let byPkg = projectsByPackage.get(types);
  if (!byPkg) {
    byPkg = new Map();
    for (const t of types) {
      const at = t.source?.indexOf('/') ?? -1;
      if (t.pkg && at > 0 && !byPkg.has(t.pkg)) byPkg.set(t.pkg, t.source!.slice(0, at));
    }
    projectsByPackage.set(types, byPkg);
  }
  return byPkg.get(pkg);
}

/**
 * Does generated code of a project see this package? Its project — from the
 * source of the catalog's types, else from the package itself — must be one
 * of `roots` (see `visibleRoots`).
 */
export function seesPackage(model: Model | null, roots: Set<string>, pkg: string): boolean {
  const project = projectOfPackage(model, pkg);
  if (project) return roots.has(projectPackage(project));
  for (const r of roots) if (pkg === r || pkg.startsWith(`${r}.`)) return true;
  return false;
}
