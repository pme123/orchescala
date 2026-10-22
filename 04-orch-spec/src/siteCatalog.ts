// Catalog from the Orchescala docs site.
//
// The site has a `catalog.html` per company with all entries of the
// projects. Each entry is fully contained in the link:
//
//   .../site/globex/globex-savings/OpenApi.html#operation/Bpmn:%20openSavingsV1
//        │      │      │                                 │      └ name
//        │      │      └ project                         └ kind
//        │      └ company
//        └ base
//
// From this come the **processes** — i.e. what can be called as a subprocess
// (call activity) — with their `In` and `Out`.
//
// Deliberately only processes: their package can be reliably derived from project and name
// (`globex-savings` + `openSavingsV1` → `globex.savings.domain.openSavings.v1`),
// because the name carries the version. For workers the site lacks the
// API level (`personV1` in `globex-crm-personV1.GetCustomer`) — there
// the import would be guesswork. Workers therefore still come from the
// element templates, where the mapping is as well.

import type { DomainType } from './types';

export type SiteEntryKind = 'process' | 'worker' | 'message' | 'userTask';

export interface SiteEntry {
  kind: SiteEntryKind;
  /** name according to the catalog, e.g. `openSavingsV1` */
  name: string;
  /** project, e.g. `globex-savings` */
  project: string;
  /** company, e.g. `globex` */
  company: string;
  url: string;
}

const KIND: Record<string, SiteEntryKind> = {
  Bpmn: 'process', Worker: 'worker', Message: 'message',
};

// The links are absolute or relative addresses — in the rendered page as
// `href="…"`, in the source `catalog.md` (Orchescala `00-docs/src/docs`) as `](…)`;
// both carry the same parts.
const LINK = /(?:href="|\]\()([^")]*?\/([^/")]+)\/([^/")]+)\/OpenApi\.html#operation\/([A-Za-z]+)[^")]*?(?:%20|:\s|:%20)([^")]+))(?:"|\))/g;

/** Catalog entries from `catalog.html` (rendered) or `catalog.md` (source). */
export function parseCatalogHtml(html: string): SiteEntry[] {
  const out: SiteEntry[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(LINK)) {
    const [, url, company, project, rawKind, rawName] = m;
    const kind = KIND[rawKind] ?? (rawKind.startsWith('UserTask') ? 'userTask' : null);
    if (!kind) continue;
    const name = decodeURIComponent(rawName).trim();
    const key = `${project}|${kind}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, name, project, company, url });
  }
  return out;
}

/** The `catalog.html` per company from the start page of the site. */
export function catalogUrls(indexHtml: string, baseUrl: string): string[] {
  const base = baseUrl.replace(/\/?$/, '/');
  const urls = new Set<string>();
  for (const m of indexHtml.matchAll(/href="([^"]*catalog\.html)"/g)) {
    urls.add(new URL(m[1], base).toString());
  }
  return [...urls];
}

/** The `In`/`Out` of a process — what a subprocess call needs. */
const MEMBERS = ['In', 'Out'] as const;

const camel = (s: string) => s.split(/[-_.]/).filter(Boolean)
  .map((p, i) => (i === 0 ? p : p.replace(/^(.)/, c => c.toUpperCase()))).join('');
const upper = (s: string) => s.replace(/^(.)/, c => c.toUpperCase());

/**
 * Package and object of a process from project and process name:
 *
 *   globex-savings     + openSavingsV1     → globex.savings.domain.openSavings.v1 · OpenSavings
 *   globex-product + openAccountV2 → globex.product.domain.openAccount.v2 · OpenAccount
 *
 * The version is in the package, not in the object name.
 *
 * This is only reliable if the name carries the version and contains no hyphens.
 * Otherwise the catalog name is the BPMN process ID and not the
 * Scala name (`globex-ordercard` is called `OrderCardV1` there) — such
 * entries are marked as «Import prüfen».
 */
export function processTarget(project: string, name: string): { object: string; pkg: string; uncertain: boolean } {
  const segments = project.split('-').filter(Boolean);
  const m = /^([A-Za-z][A-Za-z0-9]*?)V(\d+)$/.exec(name);
  const uncertain = !m;
  const proc = camel(m ? m[1] : name);
  const version = m ? `v${m[2]}` : 'v1';
  return {
    object: upper(proc),
    pkg: [...segments, 'domain', proc, version].join('.'),
    uncertain,
  };
}

export function typesFromSite(entries: SiteEntry[], source: string): DomainType[] {
  const out: DomainType[] = [];
  for (const e of entries) {
    if (e.kind !== 'process') continue;
    const { object, pkg, uncertain } = processTarget(e.project, e.name);
    for (const member of MEMBERS) {
      out.push({
        id: `${pkg}.${object}.${member}`,
        name: `${object}.${member}`,
        pkg,
        kind: 'member',
        owner: object,
        importPath: `${pkg}.${object}`,
        descr: `Prozess «${e.name}» aus ${e.project}${uncertain ? ' — Import prüfen' : ''}`,
        source,
      });
    }
  }
  return out;
}

export interface SiteResult {
  entries: SiteEntry[];
  types: DomainType[];
  /** addresses that were read */
  read: string[];
}

/**
 * Read the site. `url` may be the start page (`.../site/`) or directly a
 * `catalog.html`. The caller does the fetching — in the browser `fetch`,
 * in the tool the file or `fetch` in Node.
 */
export async function readSite(
  url: string,
  get: (url: string) => Promise<string>,
): Promise<SiteResult> {
  const first = await get(url);
  const pages = /catalog\.(html|md)$/i.test(url) ? [url] : catalogUrls(first, url);
  if (!pages.length) {
    // Maybe the start page already is the catalog
    const direct = parseCatalogHtml(first);
    if (direct.length) return { entries: direct, types: typesFromSite(direct, url), read: [url] };
    throw new Error('Auf dieser Seite steht kein Katalog (keine catalog.html verlinkt).');
  }
  const entries: SiteEntry[] = [];
  const read: string[] = [];
  for (const page of pages) {
    const html = page === url ? first : await get(page);
    entries.push(...parseCatalogHtml(html));
    read.push(page);
  }
  return { entries, types: typesFromSite(entries, url), read };
}

/** Count for the feedback. */
export function countByKind(entries: SiteEntry[]): Record<SiteEntryKind, number> {
  const counts: Record<SiteEntryKind, number> = { process: 0, worker: 0, message: 0, userTask: 0 };
  for (const e of entries) counts[e.kind]++;
  return counts;
}

/**
 * What the catalog already knows **exactly** (read from the sources) stays.
 * The site only provides derived packages — it should fill gaps, not
 * put same-named entries next to them.
 */
export function fillGapsOnly(incoming: DomainType[], existing: DomainType[]): DomainType[] {
  const known = new Set(existing.map(t => t.name));
  return incoming.filter(t => !known.has(t.name));
}
