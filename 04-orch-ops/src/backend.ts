// Storage backend: local folder (File System Access API) or SharePoint
// folder (Microsoft Graph). The store works only through this interface;
// paths are relative to the chosen folder (`model.json`, `errors/<id>.json`).
//
// «version» is an opaque string for conflict detection: lastModified for the
// local folder, the ETag for Graph, a counter in memory. A write with
// `ifMatch` succeeds only if the file still has exactly that version.
//
// Images (attachments/…) go through the same `write` as a Blob and come back
// via `readBlob`.

export interface FileInfo { name: string; version: string }
export interface ReadResult { text: string; version: string }
export type WriteResult =
  | { ok: true; version: string }
  | { ok: false; reason: 'conflict' | 'exists' | 'forbidden' | 'error'; message: string; currentVersion?: string };

export interface StorageBackend {
  kind: 'local' | 'sharepoint';
  name: string;
  /** null = file does not exist */
  read(path: string): Promise<ReadResult | null>;
  write(path: string, body: string | Blob, opts?: { ifMatch?: string; createOnly?: boolean }): Promise<WriteResult>;
  /** Read a binary file (image) — null = does not exist */
  readBlob(path: string): Promise<Blob | null>;
  /** files only; empty if the folder is missing */
  list(dir: string): Promise<FileInfo[]>;
  ensureDir(dir: string): Promise<void>;
}

// Check-then-write must not interleave: the Web Locks API serializes it per
// file across all tabs of this origin (two tabs on the same folder). Without
// it (Node, old browsers) the steps simply run in order.
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;
  return locks ? (locks.request(key, fn) as Promise<T>) : fn();
}

// ── Local folder ─────────────────────────────────────────────────────────────
// The version is «modification time + checksum of the content»: a write in the
// same millisecond still gives a new version (unless the content is identical,
// which is harmless). Check and write run under a lock per file for this
// browser (all tabs). Another machine writing into a synced folder (OneDrive,
// Drive) is caught only if its change has arrived before our check — for
// several people at once SharePoint (ETag on the server) is the safe choice.

/** FNV-1a over the text — enough to tell two contents apart, no security purpose */
function checksum(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const localVersion = (lastModified: number, text: string) => `${lastModified}-${checksum(text)}`;

export class LocalBackend implements StorageBackend {
  kind = 'local' as const;
  constructor(private root: FileSystemDirectoryHandle) {}
  get name() { return this.root.name || 'Ordner'; }

  private async dirOf(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; file: string }> {
    const parts = path.split('/').filter(Boolean);
    const file = parts.pop()!;
    let dir = this.root;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
    return { dir, file };
  }

  /** the file handle, or null if it (or its folder) is not there — never creates anything */
  private async existing(path: string): Promise<FileSystemFileHandle | null> {
    try {
      const { dir, file } = await this.dirOf(path, false);
      return await dir.getFileHandle(file);
    } catch {
      return null;
    }
  }

  async read(path: string): Promise<ReadResult | null> {
    const fh = await this.existing(path);
    if (!fh) return null;
    try {
      const f = await fh.getFile();
      const text = await f.text();
      return { text, version: localVersion(f.lastModified, text) };
    } catch {
      return null;
    }
  }

  async readBlob(path: string): Promise<Blob | null> {
    const fh = await this.existing(path);
    try { return fh ? await fh.getFile() : null; } catch { return null; }
  }

  write(path: string, body: string | Blob, opts: { ifMatch?: string; createOnly?: boolean } = {}): Promise<WriteResult> {
    return withLock(`orch-ops:${this.name}/${path}`, async (): Promise<WriteResult> => {
      try {
        let fh = await this.existing(path);
        if (opts.createOnly && fh) return { ok: false, reason: 'exists', message: 'Datei existiert bereits.' };
        if (opts.ifMatch != null) {
          // an update of a file that is gone: a conflict — and nothing (no empty file) is created
          if (!fh) return { ok: false, reason: 'conflict', message: 'Datei gibt es nicht mehr.' };
          // any other version is a conflict — an older one as well as a newer one
          const cur = await fh.getFile();
          const curVersion = localVersion(cur.lastModified, await cur.text());
          if (curVersion !== opts.ifMatch) {
            return { ok: false, reason: 'conflict', message: 'Datei wurde inzwischen geändert.', currentVersion: curVersion };
          }
        }
        if (!fh) {
          const { dir, file } = await this.dirOf(path, true);
          fh = await dir.getFileHandle(file, { create: true });
        }
        const w = await fh.createWritable();
        await w.write(body);
        await w.close();
        const f = await fh.getFile();
        return { ok: true, version: localVersion(f.lastModified, typeof body === 'string' ? body : '') };
      } catch (e) {
        console.error('[orch-ops] LocalBackend.write:', e);
        return { ok: false, reason: 'error', message: 'Schreiben fehlgeschlagen.' };
      }
    });
  }

  async list(dir: string): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    try {
      let d = this.root;
      for (const p of dir.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p);
      for await (const [name, handle] of d.entries()) {
        if (handle.kind !== 'file') continue;
        const f = await (handle as FileSystemFileHandle).getFile();
        out.push({ name, version: String(f.lastModified) });
      }
    } catch {
      // folder is missing
    }
    return out;
  }

  async ensureDir(dir: string): Promise<void> {
    let d = this.root;
    for (const p of dir.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p, { create: true });
  }
}

// ── In memory ────────────────────────────────────────────────────────────────
// The full contract (version check, createOnly) without a folder — the base of
// the demo and of the tests. `beforeWrite` lets a test act as a second writer.
export class MemoryBackend implements StorageBackend {
  kind = 'local' as const;
  name = 'Speicher';
  protected files = new Map<string, { body: string | Blob; version: string }>();
  private seq = 0;
  beforeWrite?: (path: string) => Promise<void> | void;

  /** a file that is there from the start (version `0`) */
  seed(path: string, body: string | Blob) {
    if (!this.files.has(path)) this.files.set(path, { body, version: '0' });
  }

  protected async lookup(path: string) { return this.files.get(path) ?? null; }

  async read(path: string): Promise<ReadResult | null> {
    const f = await this.lookup(path);
    if (!f) return null;
    return { text: typeof f.body === 'string' ? f.body : await f.body.text(), version: f.version };
  }

  async readBlob(path: string): Promise<Blob | null> {
    const f = await this.lookup(path);
    if (!f) return null;
    return typeof f.body === 'string' ? new Blob([f.body]) : f.body;
  }

  async write(path: string, body: string | Blob, opts: { ifMatch?: string; createOnly?: boolean } = {}): Promise<WriteResult> {
    await this.beforeWrite?.(path);
    const cur = await this.lookup(path);
    if (opts.createOnly && cur) return { ok: false, reason: 'exists', message: 'Datei existiert bereits.' };
    if (opts.ifMatch != null && cur && cur.version !== opts.ifMatch) {
      return { ok: false, reason: 'conflict', message: 'Datei wurde inzwischen geändert.', currentVersion: cur.version };
    }
    const version = `m${++this.seq}`;
    this.files.set(path, { body, version });
    return { ok: true, version };
  }

  async list(dir: string): Promise<FileInfo[]> {
    const prefix = dir ? `${dir.replace(/\/$/, '')}/` : '';
    return [...this.files.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map(([p, f]) => ({ name: p.slice(prefix.length), version: f.version }));
  }

  async ensureDir(): Promise<void> { /* folders are implicit */ }
}

// ── Demo (development only) ──────────────────────────────────────────────────
// Reads `sample-data/` via the dev server and keeps changes in memory —
// so the app can be demonstrated without picking a folder. Same version check
// as everywhere: conflicts and «exists» behave like in a real folder.
export class DemoBackend extends MemoryBackend {
  name = 'Demo (sample-data)';
  private url(p: string) { return `/sample-data/${p}`; }

  // a file of the sample data is loaded on first access and then lives in memory
  protected async lookup(path: string) {
    const own = this.files.get(path);
    if (own) return own;
    try {
      const res = await fetch(this.url(path), { cache: 'no-store' });
      if (!res.ok) return null;
      // the dev server answers everything as JSON — the file name decides
      this.seed(path, path.endsWith('.json') ? await res.text() : await res.blob());
      return this.files.get(path) ?? null;
    } catch {
      return null;
    }
  }

  async list(dir: string): Promise<FileInfo[]> {
    try {
      const res = await fetch(this.url(dir), { cache: 'no-store' });
      if (res.ok) for (const n of (await res.json()) as string[]) await this.lookup(`${dir}/${n}`);
    } catch { /* folder is missing */ }
    return super.list(dir);
  }
}
