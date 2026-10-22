// CLI: read an Orchescala domain → domain catalog into the model.json.
//
//   node tools/domain2catalog.ts <ordner…> [--out sample-data/model.json]
//   node tools/domain2catalog.ts --from sample-data/model.json
//
// A folder may be a project (`…/globex-savings`) or a folder above it
// (`…/projects`) — then all projects below it come, alphabetically.
//
// `--from` takes the **project list from the model.json** and reads it in
// exactly this order — the same list the admin area shows and
// sorts. Every run writes the list including paths back, so that the
// next one gets by without arguments.
//
// Reads all `.scala` below the given paths (without target/, tests)
// and collects `case class` and `enum` — also the `In`/`Out` inside the
// service objects. The same logic as in the app (src/domainScan.ts).
//
// **The order of the folders is the precedence.** If the same package is in
// several projects (`initech.core.banking.domain.client` and
// `globex.core.banking.domain.client`), the one named first wins; the later one
// is discarded and reported at the end.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDomainSource, isSkippedDir, mergeDefaults, mergeDomainTypes, scanFiles, type DiscardedPackage } from '../src/domainScan.ts';
import type { DomainDefault, DomainType, ProjectFolder } from '../src/types.ts';

const args = process.argv.slice(2);
const pick = (flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const wert = args[i + 1];
  args.splice(i, 2);
  return wert ?? null;
};
const from = pick('--from');
const out = pick('--out') ?? from ?? 'sample-data/model.json';

/** An Orchescala project is recognized by its `01-domain`. */
const istProjekt = (dir: string) => existsSync(join(dir, '01-domain'));

/** A folder above the projects becomes its projects, alphabetically. */
function expand(dir: string): string[] {
  if (istProjekt(dir)) return [dir];
  const unter = readdirSync(dir)
    .filter(e => !e.startsWith('.'))
    .map(e => join(dir, e))
    .filter(p => { try { return statSync(p).isDirectory() && istProjekt(p); } catch { return false; } });
  return unter.length ? unter.sort() : [dir];
}

const vorherige: ProjectFolder[] = from && existsSync(from)
  ? (JSON.parse(readFileSync(from, 'utf8')).projects ?? [])
  : [];
const dirs = args.length
  ? args.flatMap(d => (existsSync(d) ? expand(d) : [d]))
  : vorherige.map(p => p.path ?? p.name);

if (!dirs.length) {
  console.error('Aufruf: node tools/domain2catalog.ts <ordner…> [--out model.json]');
  console.error('        node tools/domain2catalog.ts --from model.json   (Projektliste aus der Datei)');
  process.exit(1);
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (isSkippedDir(e)) continue;
      yield* walk(p);
    } else if (isDomainSource(p)) yield p;
  }
}

// The path in the catalog only serves traceability — the absolute
// location of the working copy does not belong in a file that is shared.
const shortPath = (p: string) => {
  const at = p.indexOf('/01-domain/');
  return at < 0 ? p : `${p.slice(0, at).split('/').pop()}${p.slice(at)}`;
};

// Read and merge project by project — so it can be said what each
// project contributed, and the order stays the precedence.
const model = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { version: 1, services: [] };
const bekannt = new Map<string, ProjectFolder>((model.projects ?? []).map((p: ProjectFolder) => [p.name, p]));
let types: DomainType[] = [];
let defaults: DomainDefault[] = [];
const discarded: DiscardedPackage[] = [];
const projects: ProjectFolder[] = [];
let alleDateien = 0;
let skipped = 0;

for (const dir of dirs) {
  const name = dir.replace(/\/+$/, '').split('/').pop() ?? dir;
  if (!existsSync(dir)) {
    console.warn(`übersprungen (fehlt): ${dir}`);
    projects.push({ ...(bekannt.get(name) ?? { id: `p-${name}`, name }), path: dir, types: 0 });
    continue;
  }
  const files: Array<{ path: string; text: string }> = [];
  for (const f of walk(dir)) files.push({ path: shortPath(f), text: readFileSync(f, 'utf8') });
  alleDateien += files.length;
  const gelesen = scanFiles(files);
  defaults = mergeDefaults(defaults, gelesen.defaults);
  skipped += gelesen.skipped.length;
  discarded.push(...gelesen.discarded);
  const vorher = types.length;
  const zusammen = mergeDomainTypes(types, gelesen.types);
  types = zusammen.types;
  discarded.push(...zusammen.discarded);
  projects.push({
    ...(bekannt.get(name) ?? { id: `p-${name}`, name }),
    path: dir,
    types: types.length - vorher,
  });
}

const files = { length: alleDateien };
model.domainTypes = types;
model.domainDefaults = defaults;
model.projects = projects;
// Only the addresses (docs site) stay in `domainSources`; the projects
// are in the list, including their order.
model.domainSources = (model.domainSources ?? []).filter((x: string) => /^https?:/i.test(x));
writeFileSync(out, JSON.stringify(model, null, 2));

const count = (k: string) => types.filter(t => t.kind === k).length;
const inObjects = types.filter(t => t.owner).length;
console.log(`${out}: ${types.length} Typen aus ${files.length} Dateien — `
  + `${count('case')} case class, ${count('enum')} enum, ${count('alias')} type-Alias, ${count('member')} ergänzt; `
  + `${inObjects} davon in Objekten (In/Out); ${defaults.length} Beispielwerte (default…)`);
for (const p of projects) console.log(`  ${String(p.types).padStart(5)}  ${p.name}`);
if (skipped) console.log(`ohne package übersprungen: ${skipped}`);
for (const d of discarded) {
  console.log(`verworfen: ${d.pkg} (${d.count} Typen) — Vorrang hat ${d.insteadOf}`);
}
