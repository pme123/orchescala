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
  /** `ownOnly`: only the own project folder; `roots`: share the roots across several calls */
  opts: { ownOnly?: boolean; roots?: Map<string, FileSystemDirectoryHandle | null> } = {},
): Promise<DmnHit | null> {
  const folders: ProjectFolder[] = model?.projects ?? [];
  const own = folders.filter(p => processId.startsWith(`${p.name}-`));
  const ordered = opts.ownOnly ? own : [...own, ...folders.filter(p => !own.includes(p))];
  const sub = engine === 'c8' ? 'camunda8' : 'camunda';
  const roots = opts.roots ?? new Map<string, FileSystemDirectoryHandle | null>();
  for (const p of ordered) {
    onProgress?.(`${p.name} wird durchsucht …`);
    const handle = await handleFor(p, roots);
    if (!handle) continue;
    const dir = await dirAt(handle, [...RESOURCES, sub]);
    if (!dir) continue;
    const hit = await inFolder(dir, decisionId);
    if (hit) return { ...hit, project: p.name };
  }
  return null;
}

/**
 * On create and on sync: fetch the tables of the matched decisions that the
 * spec does not hold yet from the own project folder — then the table can be
 * edited at the step right away. In and Out stay as they came from the
 * domain. What is not found or cannot be saved stays without a table (to be
 * fetched at the step).
 */
export async function withProjectDmns(
  spec: ProcessSpec, model: Model | null,
  saveDmn: (slug: string, decisionId: string, xml: string) => Promise<{ ok: true } | { ok: false; message: string }>,
  onProgress?: (text: string) => void,
): Promise<{ spec: ProcessSpec; loaded: string[] }> {
  const open = (spec.interactions ?? []).filter(i => i.kind === 'decision' && !i.dmnFile && i.key);
  if (!open.length) return { spec, loaded: [] };
  const roots = new Map<string, FileSystemDirectoryHandle | null>();
  const files = new Map<string, string>();
  for (const ia of open) {
    try {
      const hit = await findDmnInProject(ia.key, spec.processId ?? '', model, spec.engine, onProgress, { ownOnly: true, roots });
      if (hit && (await saveDmn(spec.slug, ia.key, hit.xml)).ok) files.set(ia.id, hit.file);
    } catch { /* no access — the table is fetched at the step */ }
  }
  if (!files.size) return { spec, loaded: [] };
  return {
    spec: { ...spec, interactions: (spec.interactions ?? []).map(i => (files.has(i.id) ? { ...i, dmnFile: files.get(i.id) } : i)) },
    loaded: open.filter(i => files.has(i.id)).map(i => i.name),
  };
}
