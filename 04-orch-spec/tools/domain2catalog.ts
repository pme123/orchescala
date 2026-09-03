// CLI: Orchescala-Domain einlesen → Domain-Katalog in die model.json.
//
//   node tools/domain2catalog.ts <ordner…> [--out sample-data/model.json]
//   node tools/domain2catalog.ts --from sample-data/model.json
//
// Ein Ordner darf ein Projekt sein (`…/valiant-mkk`) oder ein Ordner darüber
// (`…/projects`) — dann kommen alle Projekte darunter, alphabetisch.
//
// `--from` nimmt die **Projektliste aus der model.json** und liest sie in
// genau dieser Reihenfolge — dieselbe Liste, die der Admin-Bereich zeigt und
// sortiert. Jeder Lauf schreibt die Liste samt Pfaden zurück, damit der
// nächste ohne Argumente auskommt.
//
// Liest alle `.scala` unterhalb der angegebenen Pfade (ohne target/, Tests)
// und sammelt `case class` und `enum` — auch die `In`/`Out` innerhalb der
// Service-Objekte. Dieselbe Logik wie in der App (src/domainScan.ts).
//
// **Die Reihenfolge der Ordner ist der Vorrang.** Liegt dasselbe Paket in
// mehreren Projekten (`swisscom.fil.is.domain.client` und
// `valiant.fil.is.domain.client`), gewinnt das zuerst genannte; das spätere
// wird verworfen und am Ende gemeldet.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDomainSource, mergeDomainTypes, scanFiles, type DiscardedPackage } from '../src/domainScan.ts';
import type { DomainType, ProjectFolder } from '../src/types.ts';

const args = process.argv.slice(2);
const pick = (flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const wert = args[i + 1];
  args.splice(i, 2);
  return wert ?? null;
};
const from = pick('--from');
const out = pick('--out') ?? from ?? 'sample-data/model.json';

/** Ein Orchescala-Projekt erkennt man an seinem `01-domain`. */
const istProjekt = (dir: string) => existsSync(join(dir, '01-domain'));

/** Ein Ordner über den Projekten wird zu seinen Projekten, alphabetisch. */
function expand(dir: string): string[] {
  if (istProjekt(dir)) return [dir];
  const unter = readdirSync(dir)
    .filter(e => !e.startsWith('.'))
    .map(e => join(dir, e))
    .filter(p => { try { return statSync(p).isDirectory() && istProjekt(p); } catch { return false; } });
  return unter.length ? unter.sort() : [dir];
}

const vorherige: ProjectFolder[] = from && existsSync(from)
  ? (JSON.parse(readFileSync(from, 'utf8')).projects ?? [])
  : [];
const dirs = args.length
  ? args.flatMap(d => (existsSync(d) ? expand(d) : [d]))
  : vorherige.map(p => p.path ?? p.name);

if (!dirs.length) {
  console.error('Aufruf: node tools/domain2catalog.ts <ordner…> [--out model.json]');
  console.error('        node tools/domain2catalog.ts --from model.json   (Projektliste aus der Datei)');
  process.exit(1);
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (['target', '.bloop', '.scala-build', '.bsp', '.git', 'node_modules'].includes(e)) continue;
      yield* walk(p);
    } else if (isDomainSource(p)) yield p;
  }
}

// Der Pfad im Katalog dient nur der Nachvollziehbarkeit — die absolute
// Lage der Arbeitskopie gehört nicht in eine Datei, die geteilt wird.
const shortPath = (p: string) => {
  const at = p.indexOf('/01-domain/');
  return at < 0 ? p : `${p.slice(0, at).split('/').pop()}${p.slice(at)}`;
};

// Projektweise lesen und zusammenführen — so lässt sich sagen, was jedes
// Projekt beigetragen hat, und die Reihenfolge bleibt der Vorrang.
const model = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { version: 1, services: [] };
const bekannt = new Map<string, ProjectFolder>((model.projects ?? []).map((p: ProjectFolder) => [p.name, p]));
let types: DomainType[] = [];
const discarded: DiscardedPackage[] = [];
const projects: ProjectFolder[] = [];
let alleDateien = 0;
let skipped = 0;

for (const dir of dirs) {
  const name = dir.replace(/\/+$/, '').split('/').pop() ?? dir;
  if (!existsSync(dir)) {
    console.warn(`übersprungen (fehlt): ${dir}`);
    projects.push({ ...(bekannt.get(name) ?? { id: `p-${name}`, name }), path: dir, types: 0 });
    continue;
  }
  const files: Array<{ path: string; text: string }> = [];
  for (const f of walk(dir)) files.push({ path: shortPath(f), text: readFileSync(f, 'utf8') });
  alleDateien += files.length;
  const gelesen = scanFiles(files);
  skipped += gelesen.skipped.length;
  discarded.push(...gelesen.discarded);
  const vorher = types.length;
  const zusammen = mergeDomainTypes(types, gelesen.types);
  types = zusammen.types;
  discarded.push(...zusammen.discarded);
  projects.push({
    ...(bekannt.get(name) ?? { id: `p-${name}`, name }),
    path: dir,
    types: types.length - vorher,
  });
}

const files = { length: alleDateien };
model.domainTypes = types;
model.projects = projects;
// In `domainSources` bleiben nur die Adressen (Doku-Site); die Projekte
// stehen in der Liste, mitsamt ihrer Reihenfolge.
model.domainSources = (model.domainSources ?? []).filter((x: string) => /^https?:/i.test(x));
writeFileSync(out, JSON.stringify(model, null, 2));

const count = (k: string) => types.filter(t => t.kind === k).length;
const inObjects = types.filter(t => t.owner).length;
console.log(`${out}: ${types.length} Typen aus ${files.length} Dateien — `
  + `${count('case')} case class, ${count('enum')} enum, ${count('alias')} type-Alias, ${count('member')} ergänzt; `
  + `${inObjects} davon in Objekten (In/Out)`);
for (const p of projects) console.log(`  ${String(p.types).padStart(5)}  ${p.name}`);
if (skipped) console.log(`ohne package übersprungen: ${skipped}`);
for (const d of discarded) {
  console.log(`verworfen: ${d.pkg} (${d.count} Typen) — Vorrang hat ${d.insteadOf}`);
}
