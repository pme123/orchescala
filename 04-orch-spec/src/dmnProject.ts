// Die DMN-Tabelle einer DMN Decision im Projekt finden — wie die Domain (siehe
// findDomain in projectImport.ts): in den gemerkten Projekt-Ordnern, der eigene
// zuerst (sein Name ist der Anfang der Prozess-ID). Die Tabellen liegen neben
// den BPMN: `src/main/resources/camunda`, für Camunda 8 `…/camunda8`.
import type { EngineId, Model, ProjectFolder } from './types';
import { handleFor } from './projects';
import { findDecision } from './dmn';

export interface DmnHit {
  xml: string;
  /** Dateiname im Projekt */
  file: string;
  /** in welchem Projekt-Ordner */
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

/** In einem Ordner die DMN-Datei mit dieser Entscheidung */
async function inFolder(dir: FileSystemDirectoryHandle, decisionId: string): Promise<{ xml: string; file: string } | null> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.dmn')) continue;
    const xml = await (handle as FileSystemFileHandle).getFile().then(f => f.text());
    if (findDecision(xml, decisionId)) return { xml, file: name };
  }
  return null;
}

/**
 * Die Tabelle mit der Entscheidung `decisionId` — `null`, wenn kein gemerkter
 * Projekt-Ordner sie hat. Fragt der Browser nach dem Leserecht, geschieht das
 * je Ordner einmal (der Aufruf muss aus einem Klick kommen).
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
