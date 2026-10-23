// Project folders of the domain catalog.
//
// The catalog is built from several Orchescala projects. If the same
// package is in two of them (`initech.core.banking.domain.client` and
// `globex.core.banking.domain.client`), it must be decided which one wins — and
// this decision does not belong to the order of random clicks,
// but in a list that you can see and reorder.
//
// **What is on top wins.** The build reads the projects in this
// order; `mergeDomainTypes` keeps what was read first and reports what
// it discarded in doing so.

import { isDomainSource, isSkippedDir, mergeDefaults, mergeDomainTypes, scanFiles, type DiscardedPackage } from './domainScan.ts';
import { delHandle, ensureRead, getHandle, putHandle } from './handles.ts';
import type { DomainDefault, DomainType, ProjectFolder } from './types.ts';
import { uid } from './util.ts';

/** Key of the remembered folder access. */
export const handleKey = (p: ProjectFolder) => `project:${p.id}`;
/** Key of the folder above the projects. */
export const rootKey = (root: string) => `root:${root}`;

/**
 * Does this folder look like an Orchescala project? The indicator is a
 * `01-domain` next to it; alternatively a `src` with Scala in it.
 */
async function istProjekt(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'directory') continue;
    if (name === '01-domain') return true;
  }
  return false;
}

/**
 * Translate what the user chose into projects: either **one**
 * project or a folder above (`~/dev-mycompany/projects`) whose
 * subfolders are the projects. The second case is the usual one.
 */
export async function projectsInFolder(
  dir: FileSystemDirectoryHandle,
): Promise<Array<{ project: ProjectFolder; handle: FileSystemDirectoryHandle }>> {
  if (await istProjekt(dir)) {
    return [{ project: { id: uid('p'), name: dir.name }, handle: dir }];
  }
  // The folder above is remembered as `root`: one access for all
  // projects below — the browser then asks once, not per project.
  // Two folders with the same name (`~/dev-a/projects`, `~/dev-b/projects`)
  // each get a key of their own: «projects», «projects (2)» …
  const root = await rootLabelFor(dir);
  await putHandle(rootKey(root), dir);
  const gefunden: Array<{ project: ProjectFolder; handle: FileSystemDirectoryHandle }> = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'directory' || isSkippedDir(name)) continue;
    const unter = handle as FileSystemDirectoryHandle;
    if (await istProjekt(unter)) gefunden.push({ project: { id: uid('p'), name, root }, handle: unter });
  }
  gefunden.sort((a, b) => a.project.name.localeCompare(b.project.name));
  return gefunden;
}

/**
 * The name under which a folder above the projects is remembered: its
 * own — unless a **different** folder with the same name is already remembered;
 * then «Name (2)», «Name (3)» … The same folder keeps its name.
 */
async function rootLabelFor(dir: FileSystemDirectoryHandle): Promise<string> {
  for (let n = 1; ; n++) {
    const label = n === 1 ? dir.name : `${dir.name} (${n})`;
    const known = await getHandle(rootKey(label));
    if (!known) return label;
    try { if (await known.isSameEntry(dir)) return label; } catch { /* not comparable — continue */ }
  }
}

/** Recursively read all Scala sources of a folder. */
export async function readSources(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Array<{ path: string; text: string }>,
  onProgress: (n: number) => void,
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (isSkippedDir(name)) continue;
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
  /** Example values `default…` — in the order of the projects */
  defaults: DomainDefault[];
  /** per project the number of contributed types */
  projects: ProjectFolder[];
  discarded: DiscardedPackage[];
  /** Projects whose folder is not readable (anymore) */
  missing: ProjectFolder[];
  /**
   * Folders above the projects (`root`) that access is missing for. A
   * missing project whose root is readable is not in it (e.g. a
   * second folder with the same name) — it needs its own access.
   */
  rootsWithoutAccess: string[];
  files: number;
  skipped: number;
}

/**
 * The readable folder of a project. If it came from a folder above, its
 * access is used (confirmed once, applies to all below); otherwise
 * its own. `roots` remembers per root whether access is granted — so that a
 * build over 17 projects does not trigger 17 dialogs.
 */
export async function handleFor(
  p: ProjectFolder,
  roots: Map<string, FileSystemDirectoryHandle | null> = new Map(),
): Promise<FileSystemDirectoryHandle | null> {
  if (p.root) {
    if (!roots.has(p.root)) {
      const root = await getHandle(rootKey(p.root));
      roots.set(p.root, root && (await ensureRead(root)) ? root : null);
    }
    const root = roots.get(p.root);
    if (root) {
      try { return await root.getDirectoryHandle(p.name); } catch { /* renamed or gone — own access */ }
    }
  }
  const own = await getHandle(handleKey(p));
  if (!own || !(await ensureRead(own))) return null;
  return intoProject(own, p.name);
}

/**
 * A remembered folder that is not the project but the folder above it
 * (`…/projects` instead of `…/projects/democompany-services`): the project
 * inside it — otherwise the build reads all projects below through this one,
 * and the others add nothing (same packages).
 *
 * A folder with the project's name, or one that is a project itself (renamed
 * on disk, other case), stays. Without a subfolder of the project's name,
 * the folder stays too (as before). Any other error
 * (e.g. access to the subfolder denied) gives `null`: the project counts as
 * missing instead of reading the projects next to it.
 */
export async function intoProject(dir: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  if (dir.name === name || (await istProjekt(dir))) return dir;
  try {
    return await dir.getDirectoryHandle(name);
  } catch (e) {
    const notThere = e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
    return notThere ? dir : null;
  }
}

/**
 * Build the catalog from the projects **anew** — not extend it. Only this way
 * does reordering take effect: when extending, what was read earlier would
 * stay, no matter what the list looks like by now.
 */
export async function rebuild(
  projects: ProjectFolder[],
  onProgress: (text: string) => void,
): Promise<RebuildResult> {
  let types: DomainType[] = [];
  let defaults: DomainDefault[] = [];
  const discarded: DiscardedPackage[] = [];
  const missing: ProjectFolder[] = [];
  const gezaehlt: ProjectFolder[] = [];
  let files = 0;
  let skipped = 0;
  // one time for the whole build — only projects that were read get it
  const scannedAt = new Date().toISOString();
  // access per root first — while the click still counts as a user action
  const roots = new Map<string, FileSystemDirectoryHandle | null>();
  for (const p of projects) if (p.root && !roots.has(p.root)) await handleFor(p, roots);

  for (const p of projects) {
    const handle = await handleFor(p, roots);
    if (!handle) {
      missing.push(p);
      // not read: no types, and no scan time of its own either
      const { scannedAt: _s, ...unread } = p;
      gezaehlt.push({ ...unread, types: 0 });
      continue;
    }
    onProgress(`${p.name}: Dateien lesen …`);
    const quellen: Array<{ path: string; text: string }> = [];
    await readSources(handle, p.name, quellen, n => onProgress(`${p.name}: ${n} Dateien gelesen …`));
    files += quellen.length;
    const gelesen = scanFiles(quellen);
    defaults = mergeDefaults(defaults, gelesen.defaults);
    skipped += gelesen.skipped.length;
    discarded.push(...gelesen.discarded);
    const vorher = types.length;
    const zusammen = mergeDomainTypes(types, gelesen.types);
    types = zusammen.types;
    discarded.push(...zusammen.discarded);
    gezaehlt.push({ ...p, types: types.length - vorher, scannedAt });
  }
  const rootsWithoutAccess = [...roots].filter(([, h]) => !h).map(([r]) => r);
  return { types, defaults, projects: gezaehlt, discarded, missing, rootsWithoutAccess, files, skipped };
}

/**
 * Grant access **now** — from within a click, otherwise the browser does
 * not ask. If an access is remembered, you confirm it; if there is none (different
 * browser, different address of the app — remembered per address), you choose the
 * folder right here. `target` is the folder above the projects (`root`)
 * or an individually remembered project.
 */
export async function grantAccess(target: { root: string } | { project: ProjectFolder }): Promise<boolean> {
  const key = 'root' in target ? rootKey(target.root) : handleKey(target.project);
  const known = await getHandle(key);
  if (known && (await ensureRead(known))) return true;
  const pick = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!pick) return false;
  const dir = await pick({ mode: 'read' }).catch(() => null);
  if (!dir) return false;
  // for a project, the folder above it chosen by mistake: remember the project inside
  // (no access to it: no grant — like the build, never the folder above instead)
  const keep = 'project' in target ? await intoProject(dir, target.project.name) : dir;
  if (!keep) return false;
  await putHandle(key, keep);
  return true;
}

/** Remember a project folder, so that the build finds it again without choosing. */
export const rememberProject = (p: ProjectFolder, h: FileSystemDirectoryHandle) => putHandle(handleKey(p), h);
export const forgetProject = (p: ProjectFolder) => delHandle(handleKey(p));

/** Move an element in the list — `dir` is −1 (up) or +1 (down). */
export function move<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const ziel = index + dir;
  if (ziel < 0 || ziel >= list.length) return list;
  const next = [...list];
  [next[index], next[ziel]] = [next[ziel], next[index]];
  return next;
}

/**
 * Colour for a called worker or subprocess — like `colorForId` in
 * Orchescala: the project whose name the identifier starts with, except the
 * own one. The colour on the project folder (admin) takes precedence over the one from the
 * generated catalog (`prepareDocs`). Without a match no colour.
 */
export function projectColor(ref: string | undefined, ownProject: string | undefined, projects: ProjectFolder[] | undefined, generated?: Record<string, string>): string | undefined {
  if (!ref) return undefined;
  const own = ownProject?.trim();
  const colors = new Map<string, string>(Object.entries(generated ?? {}));
  for (const p of projects ?? []) if (p.color && p.name) colors.set(p.name, p.color);
  const hit = [...colors]
    .filter(([name]) => name && ref.startsWith(name) && !(own && ref.startsWith(own)))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit?.[1];
}
