// CLI: BPMN → Spezifikations-JSON (dieselbe Logik wie in der App).
//
//   node tools/bpmn2spec.ts <datei.bpmn> [ziel.json]
//
// Existiert die Zieldatei bereits, werden die fachlichen Texte behalten
// (mergeSpec) und ein Änderungsbericht ausgegeben.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DOMParser } from 'linkedom';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const { importBpmn, mergeSpec, statusCounts } = await import('../src/bpmn.ts');

const [src, dest] = process.argv.slice(2);
if (!src) {
  console.error('Aufruf: node tools/bpmn2spec.ts <datei.bpmn> [ziel.json]');
  process.exit(1);
}

const { spec, stepCount, unreachable } = importBpmn(readFileSync(src, 'utf8'), src);
let out = spec;
if (dest && existsSync(dest)) {
  const prev = JSON.parse(readFileSync(dest, 'utf8'));
  const merged = mergeSpec(spec, prev);
  out = merged.spec;
  const r = merged.report;
  console.log(`Abgleich: ${r.kept} behalten · ${r.added.length} neu · ${r.changed.length} geändert · ${r.removed.length} entfallen`);
  for (const n of r.added) console.log(`  + ${n}`);
  for (const n of r.changed) console.log(`  ~ ${n}`);
  for (const n of r.removed) console.log(`  - ${n}`);
}

const target = dest ?? `${out.slug}.json`;
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 2));
console.log(`${target}: ${stepCount} Schritte, Status ${JSON.stringify(statusCounts(out))}`);
if (unreachable.length) console.log(`Nicht erreichbar (${unreachable.length}): ${unreachable.join(', ')}`);
