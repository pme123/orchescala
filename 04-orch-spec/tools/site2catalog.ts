// CLI: Prozesse von der Orchescala-Doku-Site in den Domain-Katalog.
//
//   node tools/site2catalog.ts <url-oder-datei> [--out sample-data/model.json]
//
// Nimmt die Startseite der Site (`.../site/`) oder direkt eine `catalog.html`.
// In Node greift kein CORS — wo der Browser scheitert, kommt man hier immer
// an den Katalog und exportiert ihn anschliessend als Datei.
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
// Was aus den Quellen kommt, ist exakt — die Site füllt nur Lücken
const neu = fillGapsOnly(types, before);
const { types: next, discarded } = mergeDomainTypes(before, neu);
model.domainTypes = next;
model.domainSources = [...new Set([...(model.domainSources ?? []), source])];
writeFileSync(out, JSON.stringify(model, null, 2));
console.log(`${out}: ${neu.length} von ${types.length} Prozess-Typen ergänzt `
  + `(${types.length - neu.length} kannte der Katalog schon exakt) — ${next.length} im Katalog`);
for (const d of discarded) console.log(`verworfen: ${d.pkg} (${d.count}) — Vorrang hat ${d.insteadOf}`);
