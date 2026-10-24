// Anonymize a data folder — for demo data and screenshots.
//
//   node tools/anonymize.ts <quelle> <ziel> [konfig=anonymize.local.json]
//
// General rules (without configuration):
//  · People: reporters and @-mentions «Lastname Firstname (ABC)» → fictitious
//    names, everywhere in the text, same person = same replacement
//  · Numbers with 8+ digits (customer, account, phone numbers …) → other digits
//  · UUIDs, Base64 blocks (ETags), JWT fragments, technical users (u1234name)
//  · Host names in URLs → <service>.example.com
//
// Client-specific values (company name, bank number, abbreviations) live in a
// local configuration that does NOT belong in the repo (see .gitignore):
//
//   { "replace": { "firma": "acme", "Firma": "Acme", "1234": "9999" } }
//
// At the end the tool checks whether anything original is left, and
// aborts if so.
import fs from 'node:fs';
import path from 'node:path';
import { slugify } from '../src/util.ts';

const [src, out, cfgPath = 'anonymize.local.json'] = process.argv.slice(2);
if (!src || !out) { console.error('Aufruf: node tools/anonymize.ts <quelle> <ziel> [konfig]'); process.exit(1); }
if (path.resolve(src) === path.resolve(out)) { console.error('Quelle und Ziel müssen verschieden sein.'); process.exit(1); }

const cfg: { replace?: Record<string, string> } = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const replace = Object.entries(cfg.replace ?? {}).sort((a, b) => b[0].length - a[0].length);
if (!replace.length) console.warn(`Hinweis: keine Konfiguration (${cfgPath}) — nur allgemeine Regeln.`);

// ── deterministic replacement values ────────────────────────────────────────
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function digits(s: string): string {
  let h = hash(s), r = '';
  while (r.length < s.length) { h = Math.imul(h ^ (h >>> 13), 2246822519) >>> 0; r += String(h % 10); }
  return (r[0] === '0' && s[0] !== '0' ? '1' : r[0]) + r.slice(1, s.length);
}
function hex(s: string, n: number): string {
  let h = hash(s), r = '';
  while (r.length < n) { h = Math.imul(h ^ (h >>> 15), 2654435761) >>> 0; r += h.toString(16).padStart(8, '0'); }
  return r.slice(0, n);
}

const FAKE_PEOPLE = ['Muster Anna', 'Beispiel Marco', 'Demo Lea', 'Test Jonas', 'Probe Sara', 'Vorlage Nico', 'Platzhalter Mia'];
const people = new Map<string, string>();      // «Lastname Firstname» → fictitious name
const originals = new Set<string>();           // for the final check

function person(name: string): string {
  const n = name.trim();
  if (!n) return n;
  if (!people.has(n)) people.set(n, FAKE_PEOPLE[people.size % FAKE_PEOPLE.length] + (people.size >= FAKE_PEOPLE.length ? ` ${people.size}` : ''));
  originals.add(n);
  return people.get(n)!;
}

// abbreviation in parentheses after names, e.g. «(ABC)» → «(OPS)»; «(EXT)» stays
const unit = (u: string) => (u === 'EXT' ? 'EXT' : 'OPS');

function collectPeople(e: Record<string, unknown>) {
  const reporter = String(e.reporter ?? '');
  reporter.split(/,\s*/).forEach(r => {
    const m = r.match(/^(.+?)\s*\(([A-Z]{2,6})\)$/);
    if (m) person(m[1]); else if (r.trim()) person(r);
  });
  JSON.stringify(e).replace(/@([A-ZÄÖÜ][^@()\n\\"]{2,40}?)\s*\(([A-Z]{2,6})\)/g, (_, n) => { person(n); return ''; });
}

function hostOf(host: string): string {
  originals.add(host.split(':')[0]);
  const first = host.split('.')[0]
    .split('-').filter(p => !/\d/.test(p) && !/^(prd|prod|int|test|rz|svc|apps|ad|ext|external)$/i.test(p)).join('-');
  return `${first || 'service'}.example.com`;
}

function anon(text: string): string {
  let s = text;
  // people (longest first, so that «von X Y» matches before «X Y»)
  [...people.keys()].sort((a, b) => b.length - a.length).forEach(n => {
    s = s.split(n).join(people.get(n)!);
  });
  s = s.replace(/(Muster|Beispiel|Demo|Test|Probe|Vorlage|Platzhalter) (\w+) \(([A-Z]{2,6})\)/g, (_, a, b, u) => `${a} ${b} (${unit(u)})`);
  // URLs: hosts
  s = s.replace(/(https?:\/\/)([A-Za-z0-9.-]+)(:\d+)?/g, (_, p, h, port) => `${p}${hostOf(h)}${port ?? ''}`);
  // JWT fragments, Base64 blocks (ETags), UUIDs
  s = s.replace(/eyJ[A-Za-z0-9_\-.]{6,}(?:\.\.\.[A-Za-z0-9_\-]+)?!?/g, m => { originals.add(m); return 'eyJ…(entfernt)'; });
  // Base64 only if it looks like it (mixed upper/lower case and digits) —
  // URL paths like «/api/v3/banks/…» stay as they are
  s = s.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, m => {
    if (!/[A-Z]/.test(m) || !/[a-z]/.test(m) || !/\d/.test(m) || (m.match(/\//g) ?? []).length > 2) return m;
    originals.add(m);
    return `W/"${hex(m, 16)}"`;
  });
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, m => {
    originals.add(m);
    const x = hex(m, 32);
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
  });
  // technical users with a name part: u1234meier → u0000user
  s = s.replace(/\bu(\d{3,5})([a-z]{3,})\b/g, (m, _n, name) => { originals.add(name); return 'u0000user'; });
  // long numbers (customer, account, phone, ID card numbers)
  s = s.replace(/\d{8,}/g, m => { originals.add(m); return digits(m); });
  // client-specific values from the configuration
  for (const [from, to] of replace) { originals.add(from); s = s.split(from).join(to); }
  return s;
}

function deep<T>(v: T): T {
  if (typeof v === 'string') return anon(v) as T;
  if (Array.isArray(v)) return v.map(deep) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) as T;
  return v;
}

// ── go ──────────────────────────────────────────────────────────────────────
const errDir = path.join(src, 'errors');
const files = fs.readdirSync(errDir).filter(f => f.endsWith('.json')).sort();
const entries = files.map(f => JSON.parse(fs.readFileSync(path.join(errDir, f), 'utf8')) as Record<string, unknown>);
entries.forEach(collectPeople);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'errors'), { recursive: true });

const taken = new Set<string>();
for (const e of entries) {
  const a = deep({ ...e });
  if (Array.isArray(a.occurrences)) a.occurrences = [];
  delete a.updatedBy; delete a.createdBy;
  a.createdBy = 'Confluence-Import';
  const base = `${slugify(String(a.process)) || 'fehler'}--${slugify(String(a.title)).slice(0, 60)}`.replace(/-+$/, '');
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  a.id = id;
  fs.writeFileSync(path.join(out, 'errors', `${id}.json`), JSON.stringify(a, null, 2));
}

const model = JSON.parse(fs.readFileSync(path.join(src, 'model.json'), 'utf8'));
delete model.auth; delete model.logo;
model.company = '';
if (model.howto) model.howto = anon(model.howto);
fs.writeFileSync(path.join(out, 'model.json'), JSON.stringify(model, null, 2));

// ── final check: nothing original left? ─────────────────────────────────────
const all = [path.join(out, 'model.json'), ...fs.readdirSync(path.join(out, 'errors')).map(f => path.join(out, 'errors', f))]
  .map(f => fs.readFileSync(f, 'utf8')).join('\n');
const leaks = [...originals].filter(o => o.length >= 4 && all.includes(o));
// parts of person names (last name alone, first name alone)
for (const n of people.keys()) for (const part of n.split(/\s+/)) if (part.length >= 4 && all.includes(part)) leaks.push(`${part} (aus ${n})`);

console.log(`${entries.length} Fehler anonymisiert → ${out}/ · ${people.size} Personen ersetzt`);
if (leaks.length) {
  console.error(`NICHT sauber — noch enthalten:\n  ${[...new Set(leaks)].join('\n  ')}`);
  process.exit(2);
}
console.log('Prüfung: keine Originalwerte mehr gefunden.');
