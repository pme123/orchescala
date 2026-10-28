// Loads the markdown pages from src/docs and builds the navigation from them.
import {navigation, partials} from './nav';

const CONTENT_ROOT = '../src/docs/';

const rawPages = import.meta.glob('../src/docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Everything else in src/docs that a page may show or link: images, example APIs, scripts …
// (served unchanged under its path - see vite.config.ts)
const contentFiles = new Set(__CONTENT_FILES__);

export const version = __ORCH_VERSION__;
export const base = import.meta.env.BASE_URL; // '/orchescala/'

export type Doc = {
  /** path in src/docs without `.md`, e.g. `functionalityDsls/apiDoc` */
  id: string;
  /** folder of the page in src/docs ('' for the top level) */
  dir: string;
  title: string;
  description: string;
  markdown: string;
};

const idOf = (file: string) => file.slice(CONTENT_ROOT.length).replace(/\.md$/, '');
const dirOf = (id: string) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '');

/** Lines outside of fenced code blocks. */
function proseLines(markdown: string): string[] {
  let fence = false;
  return markdown.split('\n').filter(line => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return false;
    }
    return !fence;
  });
}

const plain = (s: string) =>
  s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').replace(/<[^>]+>/g, '').trim();

function titleOf(id: string, markdown: string): string {
  // the first heading - a `# heading` if there is one
  const headings = proseLines(markdown).filter(l => /^#{1,6}\s+/.test(l));
  const heading = headings.find(l => /^#\s+/.test(l)) ?? headings[0];
  return heading ? plain(heading.replace(/^#+\s+/, '')) : id.split('/').pop()!;
}

function descriptionOf(markdown: string): string {
  const para = proseLines(markdown).find(
    l => l.trim() && !/^\s*([#>|!<*-]|\d+\.)/.test(l) && plain(l).length > 30,
  );
  const text = para ? plain(para) : '';
  return text.length > 160 ? text.slice(0, 157) + '…' : text;
}

/** Broken includes found while loading the pages - the build fails on them (see entry-server.tsx). */
export const includeProblems: string[] = [];

/**
 * `<!-- include: other.md -->` is replaced with the content of that page. The included page must be
 * in the same folder: its relative links and images are resolved against the including page.
 */
function withIncludes(markdown: string, id: string, dir: string, depth = 0): string {
  return markdown.replace(/^<!--\s*include:\s*([\w./-]+\.md)\s*-->$/gm, (all, file) => {
    const target = resolvePath(dir, file);
    const included = rawPages[CONTENT_ROOT + target];
    if (included === undefined) includeProblems.push(`${id}: include ${file} - there is no such page`);
    else if (dirOf(target) !== dir) includeProblems.push(`${id}: include ${file} - must be in the same folder`);
    else if (depth >= 3) includeProblems.push(`${id}: include ${file} - nested more than 3 levels`);
    else return withIncludes(included, id, dir, depth + 1);
    return all;
  });
}

/** Resolves a relative path (`../x/y.md`) against a folder in src/docs. */
export function resolvePath(dir: string, relative: string): string {
  const parts = relative.startsWith('/') ? [] : dir.split('/').filter(Boolean);
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

const docsById = new Map<string, Doc>();
for (const [file, raw] of Object.entries(rawPages)) {
  const id = idOf(file);
  if (partials.includes(id)) continue;
  const dir = dirOf(id);
  const markdown = withIncludes(raw, id, dir).replaceAll('@VERSION@', version);
  docsById.set(id, {id, dir, title: titleOf(id, markdown), description: descriptionOf(markdown), markdown});
}

export type Section = {title: string; docs: Doc[]};

/** The navigation: the sections of nav.ts, unlisted pages added to the section of their folder. */
export const sections: Section[] = (() => {
  const listed = new Set<string>();
  const result = navigation.map(section => {
    const ids = section.pages.map(p => (section.dir ? `${section.dir}/${p}` : p));
    const docs = ids.map(id => docsById.get(id)).filter((d): d is Doc => !!d);
    docs.forEach(d => listed.add(d.id));
    return {title: section.title, dir: section.dir, docs};
  });
  const rest = [...docsById.values()].filter(d => !listed.has(d.id)).sort((a, b) => a.id.localeCompare(b.id));
  for (const doc of rest) {
    const section = result.find(s => s.dir === doc.dir);
    if (section) section.docs.push(doc);
    else result.push({title: doc.dir, dir: doc.dir, docs: [doc]});
  }
  return result.filter(s => s.docs.length > 0).map(({title, docs}) => ({title, docs}));
})();

/** All pages in the order of the navigation. */
export const allDocs: Doc[] = sections.flatMap(s => s.docs);

export const findDoc = (id: string) => docsById.get(id);

/** The URL of a page: `/orchescala/functionalityDsls/apiDoc/` (with a trailing slash, as GitHub Pages serves it). */
export const docUrl = (id: string) => (id === 'index' ? base : `${base}${id}/`);

/** The page of a URL path. Old Laika URLs (`/orchescala/specification.html`) still find their page. */
export function docIdOf(pathname: string): string {
  let p = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  p = p.replace(/\/+$/, '').replace(/(\/index)?\.html$/, '').replace(/^index$/, '');
  return p === '' ? 'index' : p;
}

/** The URL of a file in src/docs (image, example API …), if there is one. */
export const assetUrl = (path: string): string | undefined =>
  contentFiles.has(path) ? base + path : undefined;
