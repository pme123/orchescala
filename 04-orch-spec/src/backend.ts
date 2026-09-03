// Speicher-Backend: lokaler Ordner (File System Access API) oder
// SharePoint-Ordner (Microsoft Graph). Der Store arbeitet nur über diese
// Schnittstelle; Pfade sind relativ zum gewählten Ordner
// (`model.json`, `projects/<slug>.json`).
//
// «version» ist ein opaker String für die Konflikterkennung: beim lokalen
// Ordner lastModified, bei Graph das ETag.

export interface FileInfo { name: string; version: string }
export interface ReadResult { text: string; version: string }
export type WriteResult =
  | { ok: true; version: string }
  | { ok: false; reason: 'conflict' | 'exists' | 'forbidden' | 'error'; message: string; currentVersion?: string };

export interface StorageBackend {
  kind: 'local' | 'sharepoint';
  name: string;
  /** null = Datei existiert nicht */
  read(path: string): Promise<ReadResult | null>;
  write(path: string, text: string, opts?: { ifMatch?: string; createOnly?: boolean }): Promise<WriteResult>;
  /** nur Dateien; leer, wenn der Ordner fehlt */
  list(dir: string): Promise<FileInfo[]>;
  ensureDir(dir: string): Promise<void>;
}

// ── Lokaler Ordner ───────────────────────────────────────────────────────────
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

  async write(path: string, text: string, opts: { ifMatch?: string; createOnly?: boolean } = {}): Promise<WriteResult> {
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
      console.error('[arch-review] LocalBackend.write:', e);
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
      // Ordner fehlt
    }
    return out;
  }

  async ensureDir(dir: string): Promise<void> {
    let d = this.root;
    for (const p of dir.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p, { create: true });
  }
}

// ── Demo (nur Entwicklung) ───────────────────────────────────────────────────
// Liest `sample-data/` über den Dev-Server und hält Änderungen im Speicher —
// damit lässt sich der PoC ohne Ordnerauswahl vorführen.
export class DemoBackend implements StorageBackend {
  kind = 'local' as const;
  name = 'Demo (sample-data)';
  private overrides = new Map<string, string>();
  private extra = new Map<string, Set<string>>();

  private url(p: string) { return `/sample-data/${p}`; }

  async read(path: string): Promise<ReadResult | null> {
    const own = this.overrides.get(path);
    if (own != null) return { text: own, version: String(own.length) };
    try {
      const res = await fetch(this.url(path));
      if (!res.ok) return null;
      const text = await res.text();
      return { text, version: String(text.length) };
    } catch {
      return null;
    }
  }

  async write(path: string, text: string): Promise<WriteResult> {
    this.overrides.set(path, text);
    const dir = path.split('/').slice(0, -1).join('/');
    const name = path.split('/').pop()!;
    if (!this.extra.has(dir)) this.extra.set(dir, new Set());
    this.extra.get(dir)!.add(name);
    return { ok: true, version: String(text.length) };
  }

  async list(dir: string): Promise<FileInfo[]> {
    const names = new Set<string>(this.extra.get(dir) ?? []);
    try {
      const res = await fetch(this.url(dir));
      if (res.ok) for (const n of (await res.json()) as string[]) names.add(n);
    } catch { /* Ordner fehlt */ }
    return [...names].map(name => ({ name, version: '0' }));
  }

  async ensureDir(): Promise<void> { /* nichts zu tun */ }
}
