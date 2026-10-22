// CLI: OpenAPI of the Orchescala projects → catalog in the model.json.
//
//   node tools/openapi2catalog.ts <datei|ordner|url …> [--out sample-data/model.json]
//
// One source for both: workers **and** processes, each with their inputs and
// outputs, the topic from the path and the field descriptions from the schemas.
// Folders are searched for `OpenApi.yml` / `.yaml` / `.json`.
//
// In Node there is no CORS — the generated catalog can then be loaded in the
// admin via «Katalog-Datei».
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { catalogFromOpenApi, mergeServices } from '../src/openApi.ts';
import { mergeDomainTypes } from '../src/domainScan.ts';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : 'sample-data/model.json';
const sources = outIdx >= 0 ? [...args.slice(0, outIdx), ...args.slice(outIdx + 2)] : args;
if (!sources.length) {
  console.error('Aufruf: node tools/openapi2catalog.ts <datei|ordner|url …> [--out model.json]');
  process.exit(1);
}

// Exactly the generated `OpenApi.yml` of an Orchescala project:
// - canonically under `03-api/` (ApiCreator writes it there),
// - for old-style projects (globex-helper, globex-fil-papi) in the project root,
//   recognisable by the `helper.scala`/`helper.sc` next to it.
// NOT: foreign specifications that happen to have the same name (e.g.
// `01-domain/coreSearch/openApi.yml`, `04-helper/.../openapi.yaml`), and not
// the `03-worker/src/main/resources/OpenApi.yml` — that is a symlink to the
// 03-api file and would count every project twice.
const isSpecName = (name: string) => /^openapi\.(ya?ml|json)$/i.test(name);
const isSpec = (dir: string, name: string) =>
  isSpecName(name) && (
    /(^|\/)03-api$/.test(dir)
    || existsSync(join(dir, 'helper.scala')) || existsSync(join(dir, 'helper.sc'))
  );

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (['target', '.git', 'node_modules', '.bloop', '.scala-build'].includes(e)) continue;
      yield* walk(p);
    } else if (isSpec(dir, e)) yield p;
  }
}

async function read(src: string): Promise<Array<{ name: string; text: string }>> {
  if (/^https?:/i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    return [{ name: src, text: await res.text() }];
  }
  if (!existsSync(src)) { console.warn(`übersprungen (fehlt): ${src}`); return []; }
  if (statSync(src).isDirectory()) {
    return [...walk(src)].map(p => ({ name: p, text: readFileSync(p, 'utf8') }));
  }
  return [{ name: src, text: readFileSync(src, 'utf8') }];
}

const model = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { version: 1, services: [] };
let services = model.services ?? [];
let types = model.domainTypes ?? [];
let files = 0, addedTotal = 0, procTotal = 0, taskTotal = 0;

for (const src of sources) {
  for (const { name, text } of await read(src)) {
    let doc: unknown;
    try { doc = /\.json$/i.test(name) ? JSON.parse(text) : load(text); }
    catch (e) { console.warn(`${name}: nicht lesbar (${e instanceof Error ? e.message : e})`); continue; }
    const r = catalogFromOpenApi(doc, name);
    if (!r.services.length) { console.warn(`${name}: keine Operationen gefunden`); continue; }
    files++;
    procTotal += r.processes.length;
    taskTotal += r.userTasks.length;
    const m = mergeServices(services, r.services);
    services = m.services;
    addedTotal += m.added;
    types = mergeDomainTypes(types, r.types).types;
    console.log(`${r.project.padEnd(24)} ${String(r.services.length).padStart(3)} Einträge `
      + `(${r.processes.length} Prozesse, ${r.userTasks.length} UserTasks) — ${m.added} neu`);
  }
}

model.services = services;
model.domainTypes = types;
model.domainSources = [...new Set([...(model.domainSources ?? []), ...sources])];
writeFileSync(out, JSON.stringify(model, null, 2));
console.log(`\n${out}: ${files} OpenAPI-Dateien, ${services.length} Einträge im Katalog `
  + `(${addedTotal} neu, ${procTotal} Prozesse, ${taskTotal} UserTasks), ${types.length} Typen`);
