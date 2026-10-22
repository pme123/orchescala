// Find the DMN table of a DMN decision in the project — like the domain (see
// findDomain in projectImport.ts): in the remembered project folders, its own
// first (its name is the start of the process ID). The tables live next to
// the BPMN: `src/main/resources/camunda`, for Camunda 8 `…/camunda8`.
import type { EngineId, Model, ProcessSpec, ProjectFolder } from './types';
import { handleFor } from './projects';
import { findDecision } from './dmn';

export interface DmnHit {
  xml: string;
  /** file name in the project */
  file: string;
  /** in which project folder */
  project: string;
}

const RESOURCES = ['src', 'main', 'resources'];

async function dirAt(root: FileSystemDirectoryHandle, path: string[]): Promise<FileSystemDirectoryHandle | null> {
  let dir = root;
  for (const p of path) {
    try { dir = await dir.getDirectoryHandle(p); } catch { return null; }
  }
  return dir;
}

/** In a folder, the DMN file with this decision */
async function inFolder(dir: FileSystemDirectoryHandle, decisionId: string): Promise<{ xml: string; file: string } | null> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.dmn')) continue;
    const xml = await (handle as FileSystemFileHandle).getFile().then(f => f.text());
    if (findDecision(xml, decisionId)) return { xml, file: name };
  }
  return null;
}

/**
 * The table with the decision `decisionId` — `null` if no remembered
 * project folder has it. If the browser asks for read permission, this happens
 * once per folder (the call must come from a click).
 */
export async function findDmnInProject(
  decisionId: string, processId: string, model: Model | null, engine: EngineId | undefined,
  onProgress?: (text: string) => void,
  /**
   * `ownOnly`: only the own project folder; `roots`: share the roots across several calls;
   * `noAccess`: collects the folders that are not readable (no access in this browser)
   */
  opts: { ownOnly?: boolean; roots?: Map<string, FileSystemDirectoryHandle | null>; noAccess?: string[] } = {},
): Promise<DmnHit | null> {
  const folders: ProjectFolder[] = model?.projects ?? [];
  const own = folders.filter(p => processId.startsWith(`${p.name}-`));
  const ordered = opts.ownOnly ? own : [...own, ...folders.filter(p => !own.includes(p))];
  const sub = engine === 'c8' ? 'camunda8' : 'camunda';
  const roots = opts.roots ?? new Map<string, FileSystemDirectoryHandle | null>();
  for (const p of ordered) {
    onProgress?.(`${p.name} wird durchsucht …`);
    const handle = await handleFor(p, roots);
    if (!handle) { opts.noAccess?.push(p.name); continue; }
    const dir = await dirAt(handle, [...RESOURCES, sub]);
    if (!dir) continue;
    const hit = await inFolder(dir, decisionId);
    if (hit) return { ...hit, project: p.name };
  }
  return null;
}

/** A table of a matched decision, found in the own project folder — not saved yet. */
export interface FoundDmn {
  iaId: string;
  /** the interaction, e.g. `MapActionsFromSubStatusDmn` */
  name: string;
  decisionId: string;
  /** file name in the project */
  file: string;
  xml: string;
}

export type SaveDmn = (slug: string, decisionId: string, xml: string, opts?: { createOnly?: boolean })
  => Promise<{ ok: true } | { ok: false; message: string; exists?: boolean }>;

/**
 * On create and on sync: the tables of the matched decisions that the spec
 * does not hold yet, from the own project folder. Only reads — saving is
 * `saveProjectDmns`, once the spec is written. Not found (or no access) is
 * no failure — the step offers to fetch it; a folder that cannot be read is.
 */
export async function findProjectDmns(
  spec: ProcessSpec, model: Model | null, onProgress?: (text: string) => void,
): Promise<{ found: FoundDmn[]; failed: string[] }> {
  const open = (spec.interactions ?? []).filter(i => i.kind === 'decision' && !i.dmnFile && i.key);
  const roots = new Map<string, FileSystemDirectoryHandle | null>();
  const found: FoundDmn[] = [];
  const failed: string[] = [];
  for (const ia of open) {
    try {
      const hit = await findDmnInProject(ia.key, spec.processId ?? '', model, spec.engine, onProgress, { ownOnly: true, roots });
      if (hit) found.push({ iaId: ia.id, name: ia.name, decisionId: ia.key, file: hit.file, xml: hit.xml });
    } catch (e) {
      failed.push(`${ia.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { found, failed };
}

export interface SavedDmns {
  /** saved from the project */
  saved: FoundDmn[];
  /** `createOnly`: a table was already stored beside the spec — kept and linked, not overwritten */
  kept: FoundDmn[];
  /** not saved, with the reason (`MapActionsDmn: …`) */
  failed: string[];
}

/**
 * Save the found tables beside the spec. `createOnly` (on sync) never
 * overwrites a stored table — it is linked as it is.
 */
export async function saveProjectDmns(slug: string, found: FoundDmn[], saveDmn: SaveDmn, opts: { createOnly?: boolean } = {}): Promise<SavedDmns> {
  const out: SavedDmns = { saved: [], kept: [], failed: [] };
  for (const f of found) {
    try {
      const w = await saveDmn(slug, f.decisionId, f.xml, opts.createOnly ? { createOnly: true } : undefined);
      if (w.ok) out.saved.push(f);
      else if (w.exists) out.kept.push(f);
      else out.failed.push(`${f.name}: ${w.message}`);
    } catch (e) {
      out.failed.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

/**
 * The spec referencing the given tables (`dmnFile`) — only where it has none
 * yet; an interaction that is gone meanwhile is skipped.
 */
export function withDmnFiles(spec: ProcessSpec, tables: FoundDmn[]): ProcessSpec {
  const files = new Map(tables.map(t => [t.iaId, t.file]));
  if (!(spec.interactions ?? []).some(i => files.has(i.id) && !i.dmnFile)) return spec;
  return { ...spec, interactions: (spec.interactions ?? []).map(i => (files.has(i.id) && !i.dmnFile ? { ...i, dmnFile: files.get(i.id) } : i)) };
}

/**
 * Why the table was not found — no remembered folders, no access to the own
 * one (access is remembered per browser and address), or really not there.
 */
export function notFoundMessage(decisionId: string, processId: string, model: Model | null, engine: EngineId | undefined, noAccess: string[]): string {
  const folders = model?.projects ?? [];
  const sub = engine === 'c8' ? 'camunda8' : 'camunda';
  if (!folders.length) return 'Keine Projekt-Ordner gemerkt — unter Admin → Katalog die Projekte verbinden, oder Datei wählen.';
  const own = folders.filter(p => processId.startsWith(`${p.name}-`)).map(p => p.name);
  const blocked = own.filter(n => noAccess.includes(n));
  if (blocked.length) {
    return `Kein Zugriff auf den Projekt-Ordner «${blocked.join('», «')}» in diesem Browser — unter Admin → Katalog verbinden (der Zugriff gilt je Adresse, auch je Port), oder Datei wählen.`;
  }
  const others = noAccess.length ? ` Ohne Zugriff, nicht durchsucht: ${noAccess.join(', ')}.` : '';
  return `In den gemerkten Projekt-Ordnern (Admin → Katalog) liegt unter src/main/resources/${sub} keine Tabelle «${decisionId}» — Datei wählen oder neu anlegen.${others}`;
}
