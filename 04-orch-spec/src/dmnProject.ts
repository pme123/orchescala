// Find the DMN table of a DMN decision in the project — like the domain (see
// findDomain in projectImport.ts): in the remembered project folders, its own
// first (its name is the start of the process ID). The tables live next to
// the BPMN: `src/main/resources/camunda`, for Camunda 8 `…/camunda8`.
import type { EngineId, Model, ProjectFolder } from './types';
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
): Promise<DmnHit | null> {
  const folders: ProjectFolder[] = model?.projects ?? [];
  const own = folders.filter(p => processId.startsWith(`${p.name}-`));
  const ordered = [...own, ...folders.filter(p => !own.includes(p))];
  const sub = engine === 'c8' ? 'camunda8' : 'camunda';
  const roots = new Map<string, FileSystemDirectoryHandle | null>();
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
