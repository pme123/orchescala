// CLI: spec folder → the export of all its processes and services, without a browser.
//
//   node tools/spec2export.ts <spez-ordner> [--out export.json] [--catalog catalog.generated.json]
//
// Per process exactly what «Process from Spec» gives in the export dialog (BPMN for the engine
// of the process, the Scala classes, the DMN tables) - the same code (src/specExport.ts). As JSON:
//
//   { "v": 1, "entries": [{ "kind": "process", "slug", "processId", "project", "engine",
//                           "bpmn"?, "scala", "dmns": [{ "file", "xml" }] },
//                         { "kind": "serviceCollection" | "serviceOrchestration", "slug", "project", "scala" }],
//     "issues": [...] }
//
// Deterministic: the same folder gives the same bytes. Orchescala's merge runs it on the spec
// before and after a change (checkMerge). Without --out the JSON goes to stdout.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { installNodeDom } from './lib/nodeDom.ts';
import { fsFolder } from './lib/fsFolder.ts';

installNodeDom();
// after the DOM - the BPMN writer reaches for it when it runs
const { exportSpecFolder, specExportJson } = await import('../src/specExport.ts');
const { readCatalogFile } = await import('../src/catalogImport.ts');

const args = process.argv.slice(2);
const pick = (flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const value = args[i + 1];
  args.splice(i, 2);
  return value ?? null;
};
const out = pick('--out');
const catalogFile = pick('--catalog');
const [dir] = args;
if (!dir || !existsSync(dir)) {
  console.error('Aufruf: node tools/spec2export.ts <spez-ordner> [--out export.json] [--catalog catalog.generated.json]');
  process.exit(1);
}

let catalog = undefined;
if (catalogFile) {
  const read = readCatalogFile(readFileSync(catalogFile, 'utf8'));
  if (!read.ok) {
    console.error(`${catalogFile}: ${read.message}`);
    process.exit(2);
  }
  catalog = read.data;
}

const json = specExportJson(exportSpecFolder(fsFolder(dir), catalog !== undefined ? { catalog } : {}));
if (out) writeFileSync(out, json);
else process.stdout.write(json);
