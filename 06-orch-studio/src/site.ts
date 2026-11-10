// The documentation site under `/site/` - the same layout as the gateway of Orchescala serves:
//   - `index.html`, `assets/`   orch-doc, the documentation app
//   - `spec/`, `ops/`           orch-spec and orch-ops
//   - `index.json`, `<company>/…`, `spec/catalog.generated.json`   the company's documentation
// A file is taken from the first source that has it - see siteOf for the order.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Where files of the site come from. `rel` is relative to the site root (`spec/index.html`), already
  * checked by resolve: no `..`, no empty segments. */
export type SiteSource = { read(rel: string): Buffer | undefined };

export type Resolved = { kind: 'file'; rel: string; bytes: Buffer } | { kind: 'redirect'; location: string } | { kind: 'notFound' };

const inside = (root: string, path: string) => {
  const r = relative(root, path);
  // `..` as a segment leaves the root - a name that starts with dots (`..foo`) does not
  return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r);
};

/** A folder, e.g. the company's assembled site `00-docs/site`. A symbolic link that leads out of the
  * folder is not served - the real paths count, not the names. */
export function folderSource(root: string): SiteSource {
  const realRoot = (() => { try { return realpathSync(root); } catch { return undefined; } })();
  return {
    read(rel) {
      if (realRoot === undefined) return undefined;
      const file = join(root, ...rel.split('/'));
      try {
        const real = realpathSync(file);
        return inside(realRoot, real) && statSync(real).isFile() ? readFileSync(real) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/** Files given in memory - e.g. `spec/folder.json`, the company folder orch-spec names on its start. */
export const memorySource = (files: Record<string, Buffer>): SiteSource => ({
  read: (rel) => (Object.hasOwn(files, rel) ? files[rel] : undefined),
});

/** Data of the company, not of the apps - never from the apps, even if a build put one there (a local
  * build of Orchescala copies orch-spec's `public/catalog.generated.json`, the catalog of whatever the
  * developer worked on last). Comes from the company's documentation or not at all. */
export const isCompanyData = (rel: string) => rel.endsWith('.generated.json') || rel.endsWith('/folder.json');

/** orch-doc, orch-spec and orch-ops as Orchescala builds them (`04-orch-doc/bundle/orch-doc-site`) -
  * with its index `files.txt` only the files listed there. None without the folder. */
export function appsSource(dir: string): SiteSource | undefined {
  if (!existsSync(join(dir, 'index.html'))) return undefined;
  const index = join(dir, 'files.txt');
  const listed = existsSync(index)
    ? new Set(readFileSync(index, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean))
    : undefined;
  const folder = folderSource(dir);
  return {
    read: (rel) => (isCompanyData(rel) || rel === 'files.txt' || (listed && !listed.has(rel)) ? undefined : folder.read(rel)),
  };
}

/** The company folders for orch-spec and orch-ops (`spec/folder.json`, `ops/folder.json`) - the apps
  * show them on their start screen. Only existing folders. */
export function folderHints(folders: { app: string; dir: string | undefined }[]): SiteSource {
  const isDir = (d: string) => { try { return statSync(d).isDirectory(); } catch { return false; } };
  return memorySource(Object.fromEntries(folders.flatMap(({ app, dir }) =>
    dir !== undefined && isDir(dir) ? [[`${app}/folder.json`, Buffer.from(JSON.stringify({ path: dir }))]] : [])));
}

/** The decoded segments - undefined if one could leave the site (`..`) or is not a plain name. */
export function segments(path: string): string[] | undefined {
  const decoded = path.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return undefined; }
  });
  const plain = (s: string | undefined): s is string =>
    s !== undefined && s !== '' && s !== '.' && s !== '..' && !/[/\\\p{Cc}]/u.test(s);
  return decoded.every(plain) ? decoded : undefined;
}

const encode = (segment: string) => encodeURIComponent(segment);

/** The site of the studio. The order decides who wins:
  *   1. `extras` - files in memory, e.g. the company folders of orch-spec and orch-ops
  *   2. the apps - the version the studio is built with, also when the company's site still has an
  *      older copy
  *   3. the company's documentation */
export function siteOf(sources: (SiteSource | undefined)[]) {
  const all = sources.filter((s): s is SiteSource => s !== undefined);
  const read = (rel: string) => all.map((s) => s.read(rel)).find((b) => b !== undefined);
  const file = (rel: string): Resolved => {
    const bytes = read(rel);
    return bytes ? { kind: 'file', rel, bytes } : { kind: 'notFound' };
  };

  /** What a request for `/site<path>` gets. `path` is the raw (URL encoded) rest after `/site`. */
  function resolve(path: string): Resolved {
    const segs = segments(path);
    if (!segs) return { kind: 'notFound' };
    const trailingSlash = path === '' || path.endsWith('/');
    const looksLikeFile = segs.length > 0 && segs[segs.length - 1].includes('.');
    if (segs.length === 0) return path === '' ? { kind: 'redirect', location: '/site/' } : file('index.html');
    // `/site/<company>` -> its page in the documentation app (one page for all companies; the
    // company folder only holds its data and the classic sites of older releases)
    const [company] = segs;
    if (segs.length === 1 && !looksLikeFile && read(`${company}/docs.json`)) return { kind: 'redirect', location: `/site/#/${encode(company)}` };
    if (segs.length === 2 && segs[1] === 'index.html' && read(`${company}/docs.json`)) return { kind: 'redirect', location: `/site/#/${encode(company)}` };
    if (trailingSlash) return file(`${segs.join('/')}/index.html`);
    // a folder without the slash (`/site/spec`) - relative links need it
    if (!looksLikeFile) return read(`${segs.join('/')}/index.html`) ? { kind: 'redirect', location: `/site/${segs.map(encode).join('/')}/` } : { kind: 'notFound' };
    return file(segs.join('/'));
  }

  return { resolve };
}
export type Site = ReturnType<typeof siteOf>;

/** The apps' `assets/` carry a hash in the name - kept for good; everything else asked again, so a new
  * release of the apps or the documentation is there on the next reload. */
export const cacheControl = (rel: string) =>
  rel.split('/').slice(0, -1).includes('assets') ? 'public, max-age=31536000, immutable' : 'no-cache';

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', map: 'application/json', yml: 'text/yaml; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  xml: 'application/xml', bpmn: 'application/xml', dmn: 'application/xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon', webp: 'image/webp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', eot: 'application/vnd.ms-fontobject', pdf: 'application/pdf',
};

export const contentType = (rel: string) => CONTENT_TYPES[rel.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
