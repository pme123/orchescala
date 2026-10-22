// Die DMN-Tabelle einer DMN Decision im Projekt finden — wie die Domain (siehe
// findDomain in projectImport.ts): in den gemerkten Projekt-Ordnern, der eigene
// zuerst (sein Name ist der Anfang der Prozess-ID). Die Tabellen liegen neben
// den BPMN: `src/main/resources/camunda`, für Camunda 8 `…/camunda8`.
import type { EngineId, Model, ProcessSpec, ProjectFolder } from './types';
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
  /** `ownOnly`: nur der eigene Projekt-Ordner; `roots`: die Wurzeln über mehrere Aufrufe teilen */
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
 * Beim Anlegen und beim Abgleich: die Tabellen der zugeordneten Decisions,
 * die die Spezifikation noch nicht führt, aus dem eigenen Projekt-Ordner
 * holen — dann lässt sich die Tabelle am Schritt gleich bearbeiten. In und
 * Out bleiben, wie sie aus der Domain kamen. Was sich nicht findet oder nicht
 * speichern lässt, bleibt ohne Tabelle (am Schritt nachzuholen).
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
    } catch { /* kein Zugriff — die Tabelle wird am Schritt geholt */ }
  }
  if (!files.size) return { spec, loaded: [] };
  return {
    spec: { ...spec, interactions: (spec.interactions ?? []).map(i => (files.has(i.id) ? { ...i, dmnFile: files.get(i.id) } : i)) },
    loaded: open.filter(i => files.has(i.id)).map(i => i.name),
  };
}
