// Confluence page with the error table → the app's data folder.
//
//   node tools/confluence2errors.ts <seite.html> [zielordner=sample-data] [--count 0|1|2…]
//
// --count: initial count of the imported errors (default 2 — the page documents
// errors from the 2nd occurrence and has no counter of its own).
//
// Writes model.json (status values, how-to) and errors/<id>.json.
// Existing error files stay untouched (same ID = already there).
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from 'linkedom';
import { parseConfluence } from '../src/confluence.ts';
import { DEFAULT_MODEL } from '../src/defaultModel.ts';
import { nowIso } from '../src/util.ts';

const argv = process.argv.slice(2);
const countAt = argv.indexOf('--count');
const initialCount = countAt >= 0 ? Number(argv.splice(countAt, 2)[1]) : undefined;
if (initialCount !== undefined && !(Number.isInteger(initialCount) && initialCount >= 0)) {
  console.error('--count braucht eine ganze Zahl ≥ 0.'); process.exit(1);
}
const [src, out = 'sample-data'] = argv;
if (!src) { console.error('Aufruf: node tools/confluence2errors.ts <seite.html> [zielordner] [--count n]'); process.exit(1); }

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html') as unknown as Document;
const res = parseConfluence(fs.readFileSync(src, 'utf8'), parse, { initialCount });
const now = nowIso();

fs.mkdirSync(path.join(out, 'errors'), { recursive: true });
const modelPath = path.join(out, 'model.json');
const model = fs.existsSync(modelPath) ? JSON.parse(fs.readFileSync(modelPath, 'utf8')) : { ...DEFAULT_MODEL };
// keep the existing order, append new ones
const known = new Set((model.statuses ?? []).map((x: { label: string }) => x.label));
model.statuses = [...(model.statuses ?? []), ...res.statuses.filter(x => !known.has(x.label))];
if (res.howto) model.howto = res.howto;
fs.writeFileSync(modelPath, JSON.stringify(model, null, 2));

let neu = 0;
for (const e of res.errors) {
  const file = path.join(out, 'errors', `${e.id}.json`);
  if (fs.existsSync(file)) continue;
  fs.writeFileSync(file, JSON.stringify({ ...e, createdAt: now, updatedAt: now, createdBy: 'Confluence-Import' }, null, 2));
  neu++;
}
console.log(`Spalten: ${res.columns.join(' | ')}`);
console.log(`${res.errors.length} Fehler gelesen, ${neu} neu geschrieben → ${out}/errors/`);
console.log(`Status: ${res.statuses.map(s => `${s.label} (${s.color})`).join(', ')}`);
console.log(`How-to: ${res.howto.length} Zeichen`);
