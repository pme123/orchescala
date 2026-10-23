// Storage backend: local folder (File System Access API) or SharePoint
// folder (Microsoft Graph). The store works only through this interface;
// paths are relative to the chosen folder (`model.json`, `errors/<id>.json`).
//
// «version» is an opaque string for conflict detection: lastModified for the
// local folder, the ETag for Graph.
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

// ── Local folder ─────────────────────────────────────────────────────────────
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

  async read(path: string): Promise<ReadResult | null> {
    try {
      const { dir, file } = await this.dirOf(path, false);
      const fh = await dir.getFileHandle(file);
      const f = await fh.getFile();
      return { text: await f.text(), version: String(f.lastModified) };
    } catch {
      return null;
    }
  }

  async readBlob(path: string): Promise<Blob | null> {
    try {
      const { dir, file } = await this.dirOf(path, false);
      return await (await dir.getFileHandle(file)).getFile();
    } catch {
      return null;
    }
  }

  async write(path: string, text: string | Blob, opts: { ifMatch?: string; createOnly?: boolean } = {}): Promise<WriteResult> {
    try {
      const { dir, file } = await this.dirOf(path, true);
      if (opts.createOnly) {
        let exists = true;
        try { await dir.getFileHandle(file); } catch { exists = false; }
        if (exists) return { ok: false, reason: 'exists', message: 'Datei existiert bereits.' };
      }
      const fh = await dir.getFileHandle(file, { create: true });
      if (opts.ifMatch != null) {
        const cur = await fh.getFile();
        if (cur.lastModified > Number(opts.ifMatch)) {
          return { ok: false, reason: 'conflict', message: 'Datei wurde inzwischen geändert.', currentVersion: String(cur.lastModified) };
        }
      }
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
      const f = await fh.getFile();
      return { ok: true, version: String(f.lastModified) };
    } catch (e) {
      console.error('[orch-ops] LocalBackend.write:', e);
      return { ok: false, reason: 'error', message: 'Schreiben fehlgeschlagen.' };
    }
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

// ── Demo (development only) ──────────────────────────────────────────────────
// Reads `sample-data/` via the dev server and keeps changes in memory —
// so the app can be demonstrated without picking a folder.
export class DemoBackend implements StorageBackend {
  kind = 'local' as const;
  name = 'Demo (sample-data)';
  private overrides = new Map<string, string>();
  private blobs = new Map<string, Blob>();
  private extra = new Map<string, Set<string>>();

  private url(p: string) { return `/sample-data/${p}`; }

  async read(path: string): Promise<ReadResult | null> {
    const own = this.overrides.get(path);
    if (own != null) return { text: own, version: String(own.length) };
    try {
      const res = await fetch(this.url(path), { cache: 'no-store' });
      if (!res.ok) return null;
      const text = await res.text();
      return { text, version: String(text.length) };
    } catch {
      return null;
    }
  }

  async readBlob(path: string): Promise<Blob | null> {
    const own = this.blobs.get(path);
    if (own) return own;
    try {
      const res = await fetch(this.url(path), { cache: 'no-store' });
      return res.ok ? await res.blob() : null;
    } catch {
      return null;
    }
  }

  async write(path: string, body: string | Blob): Promise<WriteResult> {
    const text = typeof body === 'string' ? body : '';
    if (typeof body === 'string') this.overrides.set(path, body);
    else this.blobs.set(path, body);
    const dir = path.split('/').slice(0, -1).join('/');
    const name = path.split('/').pop()!;
    if (!this.extra.has(dir)) this.extra.set(dir, new Set());
    this.extra.get(dir)!.add(name);
    return { ok: true, version: String(typeof body === 'string' ? text.length : body.size) };
  }

  async list(dir: string): Promise<FileInfo[]> {
    const names = new Set<string>(this.extra.get(dir) ?? []);
    try {
      const res = await fetch(this.url(dir), { cache: 'no-store' });
      if (res.ok) for (const n of (await res.json()) as string[]) names.add(n);
    } catch { /* folder is missing */ }
    return [...names].map(name => ({ name, version: '0' }));
  }

  async ensureDir(): Promise<void> { /* nothing to do */ }
}
