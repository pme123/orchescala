// Projekt-Ordner des Domain-Katalogs.
//
// Der Katalog entsteht aus mehreren Orchescala-Projekten. Liegt dasselbe
// Paket in zweien (`swisscom.fil.is.domain.client` und
// `valiant.fil.is.domain.client`), muss entschieden sein, welches gilt — und
// diese Entscheidung gehört nicht in die Reihenfolge zufälliger Klicks,
// sondern in eine Liste, die man sieht und umsortieren kann.
//
// **Oben steht, was gewinnt.** Der Aufbau liest die Projekte in dieser
// Reihenfolge; `mergeDomainTypes` behält das zuerst Gelesene und meldet, was
// es dabei verworfen hat.

import { isDomainSource, mergeDomainTypes, scanFiles, type DiscardedPackage } from './domainScan.ts';
import { delHandle, ensureRead, getHandle, putHandle } from './handles.ts';
import type { DomainType, ProjectFolder } from './types.ts';
import { uid } from './util.ts';

const IGNORE = ['target', '.bloop', '.scala-build', '.bsp', '.git', 'node_modules', '.idea'];

/** Schlüssel des gemerkten Ordner-Zugriffs. */
export const handleKey = (p: ProjectFolder) => `project:${p.id}`;

/**
 * Sieht dieser Ordner nach einem Orchescala-Projekt aus? Kennzeichen ist ein
 * `01-domain` daneben; hilfsweise ein `src` mit Scala darin.
 */
async function istProjekt(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'directory') continue;
    if (name === '01-domain') return true;
  }
  return false;
}

/**
 * Was der Nutzer gewählt hat, in Projekte übersetzen: entweder **ein**
 * Projekt oder ein Ordner darüber (`~/dev-valiant/projects`), dessen
 * Unterordner die Projekte sind. Der zweite Fall ist der übliche.
 */
export async function projectsInFolder(
  dir: FileSystemDirectoryHandle,
): Promise<Array<{ project: ProjectFolder; handle: FileSystemDirectoryHandle }>> {
  if (await istProjekt(dir)) {
    return [{ project: { id: uid('p'), name: dir.name }, handle: dir }];
  }
  const gefunden: Array<{ project: ProjectFolder; handle: FileSystemDirectoryHandle }> = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'directory' || IGNORE.includes(name) || name.startsWith('.')) continue;
    const unter = handle as FileSystemDirectoryHandle;
    if (await istProjekt(unter)) gefunden.push({ project: { id: uid('p'), name }, handle: unter });
  }
  gefunden.sort((a, b) => a.project.name.localeCompare(b.project.name));
  return gefunden;
}

/** Rekursiv alle Scala-Quellen eines Ordners lesen. */
export async function readSources(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Array<{ path: string; text: string }>,
  onProgress: (n: number) => void,
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (IGNORE.includes(name)) continue;
      await readSources(handle as FileSystemDirectoryHandle, path, out, onProgress);
      continue;
    }
    if (!isDomainSource(path)) continue;
    out.push({ path, text: await (handle as FileSystemFileHandle).getFile().then(f => f.text()) });
    if (out.length % 50 === 0) onProgress(out.length);
  }
}

export interface RebuildResult {
  types: DomainType[];
  /** je Projekt die Zahl der beigesteuerten Typen */
  projects: ProjectFolder[];
  discarded: DiscardedPackage[];
  /** Projekte, deren Ordner nicht (mehr) lesbar ist */
  missing: ProjectFolder[];
  files: number;
  skipped: number;
}

/**
 * Den Katalog aus den Projekten **neu** aufbauen — nicht ergänzen. Nur so
 * wirkt sich ein Umsortieren aus: beim Ergänzen bliebe das früher Gelesene
 * ja stehen, egal wie die Liste inzwischen aussieht.
 */
export async function rebuild(
  projects: ProjectFolder[],
  onProgress: (text: string) => void,
): Promise<RebuildResult> {
  let types: DomainType[] = [];
  const discarded: DiscardedPackage[] = [];
  const missing: ProjectFolder[] = [];
  const gezaehlt: ProjectFolder[] = [];
  let files = 0;
  let skipped = 0;

  for (const p of projects) {
    const handle = await getHandle(handleKey(p));
    if (!handle || !(await ensureRead(handle))) {
      missing.push(p);
      gezaehlt.push({ ...p, types: 0 });
      continue;
    }
    onProgress(`${p.name}: Dateien lesen …`);
    const quellen: Array<{ path: string; text: string }> = [];
    await readSources(handle, p.name, quellen, n => onProgress(`${p.name}: ${n} Dateien gelesen …`));
    files += quellen.length;
    const gelesen = scanFiles(quellen);
    skipped += gelesen.skipped.length;
    discarded.push(...gelesen.discarded);
    const vorher = types.length;
    const zusammen = mergeDomainTypes(types, gelesen.types);
    types = zusammen.types;
    discarded.push(...zusammen.discarded);
    gezaehlt.push({ ...p, types: types.length - vorher });
  }
  return { types, projects: gezaehlt, discarded, missing, files, skipped };
}

/** Einen Projekt-Ordner merken, damit der Aufbau ihn ohne Wählen wiederfindet. */
export const rememberProject = (p: ProjectFolder, h: FileSystemDirectoryHandle) => putHandle(handleKey(p), h);
export const forgetProject = (p: ProjectFolder) => delHandle(handleKey(p));

/** Ein Element in der Liste verschieben — `dir` ist −1 (hoch) oder +1 (runter). */
export function move<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const ziel = index + dir;
  if (ziel < 0 || ziel >= list.length) return list;
  const next = [...list];
  [next[index], next[ziel]] = [next[ziel], next[index]];
  return next;
}
