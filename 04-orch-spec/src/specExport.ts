// The export of a whole spec folder - what «Process from Spec» gives per process, for all
// processes at once and without a browser. Orchescala's merge (`checkMerge`) runs it on the spec
// before and after a change (tools/spec2export.ts); the same code as the export dialog
// (`helperPayload`, `helperDmnRefs`).
//
// The output is deterministic: the same spec folder gives the same bytes - the entries sorted by
// file name, no time stamps, no generated ids.
import type { EngineId, Model, ProcessSpec } from './types.ts';
import { helperDmnRefs, helperPayload, type HelperDmn } from './exporters.ts';
import { normalizeModel, withoutRetiredFields } from './specLoad.ts';
import { mergeGeneratedCatalog } from './catalogMerge.ts';
import { readCatalogFile, type CatalogFile } from './catalogImport.ts';
import { dmnPath } from './dmn.ts';

/** Read access to a spec folder - paths relative to it (`processes/a.json`). */
export interface SpecFolder {
  /** null: the file is not there */
  read(path: string): string | null;
  /** the names of the files in the folder (not the subfolders) - empty if it is missing */
  list(dir: string): string[];
}

/** One process - the payload of «Process from Spec» (v1) and where it comes from. */
export interface ProcessExport {
  kind: 'process';
  /** the file in the spec folder: `processes/<slug>.json` */
  slug: string;
  processId: string;
  project: string;
  engine: EngineId;
  bpmn?: string;
  scala: string;
  dmns: HelperDmn[];
}

/**
 * An entry of the export. Extension point: the service collections (`services/*.json`, payload v2
 * `kind: 'serviceCollection'`, branch feature/orch-spec-services) come in as a second kind - an
 * own exporter in `EXPORTERS` and a member of this union. A reader skips a kind it does not know.
 */
export type SpecExportEntry = ProcessExport;

export interface SpecExportIssue { file: string; text: string }

export interface SpecExport {
  /** the format of this file - Orchescala rejects one it does not know */
  v: 1;
  entries: SpecExportEntry[];
  /** what could not be exported - the file and why */
  issues: SpecExportIssue[];
}

const PROCESSES = 'processes';
/** the model.json - in config/, older folders have it in the main folder */
const MODEL_PATHS = ['config/model.json', 'model.json'];
/** the bundled catalog next to the app (see catalogMerge.ts) - optional in a spec folder */
export const CATALOG_PATH = 'catalog.generated.json';

/** The model as the app sees it: model.json with the defaults and the generated catalog. */
export function loadModel(folder: SpecFolder, catalog: CatalogFile | null, issues: SpecExportIssue[] = []): Model {
  const path = MODEL_PATHS.find(p => folder.read(p) != null);
  let raw: unknown = {};
  if (path) {
    try { raw = JSON.parse(folder.read(path)!); }
    catch (e) { issues.push({ file: path, text: `kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}` }); }
  }
  return mergeGeneratedCatalog(normalizeModel(raw), catalog);
}

/** The catalog of the folder (`catalog.generated.json`), if it has one. */
export function loadCatalog(folder: SpecFolder, issues: SpecExportIssue[] = []): CatalogFile | null {
  const text = folder.read(CATALOG_PATH);
  if (text == null) return null;
  const read = readCatalogFile(text);
  if (read.ok) return read.data;
  issues.push({ file: CATALOG_PATH, text: read.message });
  return null;
}

/** The process specifications of the folder, by file name - unreadable ones as issues. */
export function loadSpecs(folder: SpecFolder, issues: SpecExportIssue[] = []): Array<{ slug: string; spec: ProcessSpec }> {
  const out: Array<{ slug: string; spec: ProcessSpec }> = [];
  for (const name of [...folder.list(PROCESSES)].filter(n => n.endsWith('.json')).sort()) {
    const file = `${PROCESSES}/${name}`;
    let raw: unknown;
    try { raw = JSON.parse(folder.read(file) ?? ''); }
    catch (e) { issues.push({ file, text: `kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}` }); continue; }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { issues.push({ file, text: 'keine Spezifikation' }); continue; }
    out.push({ slug: name.replace(/\.json$/, ''), spec: withoutRetiredFields(raw as ProcessSpec) });
  }
  return out;
}

type Exporter = (folder: SpecFolder, model: Model, issues: SpecExportIssue[]) => SpecExportEntry[];

/** «Process from Spec» for each process - with its BPMN (`<slug>.bpmn`) and DMN tables. */
const processExports: Exporter = (folder, model, issues) =>
  loadSpecs(folder, issues).map(({ slug, spec }) => {
    const bpmn = folder.read(`${PROCESSES}/${slug}.bpmn`) ?? '';
    const dmns: HelperDmn[] = [];
    for (const ref of helperDmnRefs(spec)) {
      const xml = folder.read(dmnPath(PROCESSES, slug, ref.key));
      if (xml) dmns.push({ file: ref.file, xml });
      else issues.push({ file: dmnPath(PROCESSES, slug, ref.key), text: `Tabelle der Entscheidung ${ref.key} fehlt` });
    }
    const engine: EngineId = spec.engine ?? 'c7';
    const payload = helperPayload(spec, model, bpmn, engine, dmns);
    return {
      kind: 'process' as const,
      slug,
      processId: spec.processId ?? '',
      project: spec.project ?? '',
      engine,
      ...(payload.bpmn != null ? { bpmn: payload.bpmn } : {}),
      scala: payload.scala,
      dmns,
    };
  });

/** One exporter per kind of entry - service collections plug in here (see `SpecExportEntry`). */
const EXPORTERS: Exporter[] = [processExports];

/** The export of the spec folder - `catalog` overrides the one in the folder. */
export function exportSpecFolder(folder: SpecFolder, opts: { catalog?: CatalogFile | null } = {}): SpecExport {
  const issues: SpecExportIssue[] = [];
  const catalog = opts.catalog !== undefined ? opts.catalog : loadCatalog(folder, issues);
  const model = loadModel(folder, catalog, issues);
  const entries = EXPORTERS.flatMap(e => e(folder, model, issues));
  return { v: 1, entries, issues };
}

/** The export as text - two-space JSON with a final newline, the same bytes for the same folder. */
export const specExportJson = (e: SpecExport): string => `${JSON.stringify(e, null, 2)}\n`;
