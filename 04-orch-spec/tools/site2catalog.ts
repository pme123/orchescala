// CLI: processes from the Orchescala docs site into the domain catalog.
//
//   node tools/site2catalog.ts <url-oder-datei> [--out sample-data/model.json]
//
// Takes the start page of the site (`.../site/`) or a `catalog.html` directly.
// In Node no CORS applies — where the browser fails, you can always get
// to the catalog here and then export it as a file.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mergeDomainTypes } from '../src/domainScan.ts';
import { countByKind, fillGapsOnly, readSite } from '../src/siteCatalog.ts';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : 'sample-data/model.json';
const source = args[0];
if (!source || source.startsWith('--')) {
  console.error('Aufruf: node tools/site2catalog.ts <url-oder-datei> [--out model.json]');
  process.exit(1);
}

const get = async (url: string): Promise<string> => {
  if (/^https?:/i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
  }
  return readFileSync(url, 'utf8');
};

const { entries, types, read } = await readSite(source, get);
const counts = countByKind(entries);
console.log(`gelesen: ${read.length} Katalogseite(n)`);
console.log(`gefunden: ${counts.process} Prozesse, ${counts.worker} Worker, ${counts.userTask} UserTasks, ${counts.message} Messages`);

const model = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { version: 1, services: [] };
const before = model.domainTypes ?? [];
// What comes from the sources is exact — the site only fills gaps
const neu = fillGapsOnly(types, before);
const { types: next, discarded } = mergeDomainTypes(before, neu);
model.domainTypes = next;
model.domainSources = [...new Set([...(model.domainSources ?? []), source])];
writeFileSync(out, JSON.stringify(model, null, 2));
console.log(`${out}: ${neu.length} von ${types.length} Prozess-Typen ergänzt `
  + `(${types.length - neu.length} kannte der Katalog schon exakt) — ${next.length} im Katalog`);
for (const d of discarded) console.log(`verworfen: ${d.pkg} (${d.count}) — Vorrang hat ${d.insteadOf}`);
