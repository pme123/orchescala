// Katalog von der Orchescala-Doku-Site.
//
// Die Site führt je Firma eine `catalog.html` mit allen Einträgen der
// Projekte. Jeder Eintrag steckt vollständig im Link:
//
//   .../site/valiant/valiant-mkk/OpenApi.html#operation/Bpmn:%20openMkkV1
//        │      │      │                                 │      └ Name
//        │      │      └ Projekt                         └ Art
//        │      └ Firma
//        └ Basis
//
// Daraus entstehen die **Prozesse** — also das, was sich als Subprozess
// (Call Activity) rufen lässt — mit ihren `In` und `Out`.
//
// Bewusst nur Prozesse: deren Paket lässt sich aus Projekt und Name sicher
// ableiten (`valiant-mkk` + `openMkkV1` → `valiant.mkk.domain.openMkk.v1`),
// weil der Name die Version trägt. Bei Workern fehlt in der Site die
// API-Ebene (`personV1` in `valiant-graviton-personV1.GetCustomer`) — dort
// wäre der Import geraten. Worker kommen deshalb weiter aus den
// element-templates, wo auch das Mapping steht.

import type { DomainType } from './types';

export type SiteEntryKind = 'process' | 'worker' | 'message' | 'userTask';

export interface SiteEntry {
  kind: SiteEntryKind;
  /** Name laut Katalog, z. B. `openMkkV1` */
  name: string;
  /** Projekt, z. B. `valiant-mkk` */
  project: string;
  /** Firma, z. B. `valiant` */
  company: string;
  url: string;
}

const KIND: Record<string, SiteEntryKind> = {
  Bpmn: 'process', Worker: 'worker', Message: 'message',
};

// Die Links stehen als absolute oder relative Adresse — in der gerenderten Seite als
// `href="…"`, in der Quelle `catalog.md` (Orchescala `00-docs/src/docs`) als `](…)`;
// beide tragen dieselben Bestandteile.
const LINK = /(?:href="|\]\()([^")]*?\/([^/")]+)\/([^/")]+)\/OpenApi\.html#operation\/([A-Za-z]+)[^")]*?(?:%20|:\s|:%20)([^")]+))(?:"|\))/g;

/** Katalog-Einträge aus `catalog.html` (gerendert) oder `catalog.md` (Quelle). */
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

/** Die `catalog.html` je Firma aus der Startseite der Site. */
export function catalogUrls(indexHtml: string, baseUrl: string): string[] {
  const base = baseUrl.replace(/\/?$/, '/');
  const urls = new Set<string>();
  for (const m of indexHtml.matchAll(/href="([^"]*catalog\.html)"/g)) {
    urls.add(new URL(m[1], base).toString());
  }
  return [...urls];
}

/** Die `In`/`Out` eines Prozesses — das, was ein Subprozess-Aufruf braucht. */
const MEMBERS = ['In', 'Out'] as const;

const camel = (s: string) => s.split(/[-_.]/).filter(Boolean)
  .map((p, i) => (i === 0 ? p : p.replace(/^(.)/, c => c.toUpperCase()))).join('');
const upper = (s: string) => s.replace(/^(.)/, c => c.toUpperCase());

/**
 * Paket und Objekt eines Prozesses aus Projekt und Prozessnamen:
 *
 *   valiant-mkk     + openMkkV1     → valiant.mkk.domain.openMkk.v1 · OpenMkkV1
 *   valiant-product + openAccountV2 → valiant.product.domain.openAccount.v2
 *
 * Sicher ist das nur, wenn der Name die Version trägt und keine Bindestriche
 * enthält. Sonst ist der Katalogname die BPMN-Prozess-ID und nicht der
 * Scala-Name (`valiant-addresschange` heisst dort `AddressChangeV1`) — solche
 * Einträge sind als «Import prüfen» markiert.
 */
export function processTarget(project: string, name: string): { object: string; pkg: string; uncertain: boolean } {
  const segments = project.split('-').filter(Boolean);
  const m = /^([A-Za-z][A-Za-z0-9]*?)V(\d+)$/.exec(name);
  const uncertain = !m;
  const proc = camel(m ? m[1] : name);
  const version = m ? `v${m[2]}` : 'v1';
  return {
    object: upper(camel(name)),
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
  /** Adressen, die gelesen wurden */
  read: string[];
}

/**
 * Die Site einlesen. `url` darf die Startseite (`.../site/`) oder direkt eine
 * `catalog.html` sein. Das Holen übernimmt der Aufrufer — im Browser `fetch`,
 * im Werkzeug die Datei bzw. `fetch` in Node.
 */
export async function readSite(
  url: string,
  get: (url: string) => Promise<string>,
): Promise<SiteResult> {
  const first = await get(url);
  const pages = /catalog\.(html|md)$/i.test(url) ? [url] : catalogUrls(first, url);
  if (!pages.length) {
    // Vielleicht ist die Startseite schon der Katalog
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

/** Zählung für die Rückmeldung. */
export function countByKind(entries: SiteEntry[]): Record<SiteEntryKind, number> {
  const counts: Record<SiteEntryKind, number> = { process: 0, worker: 0, message: 0, userTask: 0 };
  for (const e of entries) counts[e.kind]++;
  return counts;
}

/**
 * Was der Katalog schon **exakt** kennt (aus den Quellen eingelesen), bleibt.
 * Die Site liefert nur abgeleitete Pakete — sie soll Lücken füllen, nicht
 * gleichnamige Einträge daneben stellen.
 */
export function fillGapsOnly(incoming: DomainType[], existing: DomainType[]): DomainType[] {
  const known = new Set(existing.map(t => t.name));
  return incoming.filter(t => !known.has(t.name));
}
