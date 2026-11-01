// CLI: what changed between two spec folders - in business terms (src/specDiff.ts).
//
//   node tools/spec2diff.ts <spez-vorher> <spez-nachher> [--json]
//
// Processes and steps, the data model down to the fields, interactions, diagrams and DMN tables,
// the pages - as text, or with --json the structure the dialog of orch-spec shows. Orchescala's
// `./helper.scala processFromSpec --check` prints it before the merge plan.
import { existsSync } from 'node:fs';
import { fsFolder } from './lib/fsFolder.ts';
import { diffSpecFolders, formatSpecDiff } from '../src/specDiff.ts';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const [before, after] = args.filter(a => a !== '--json');
if (!before || !after) {
  console.error('Aufruf: node tools/spec2diff.ts <spez-vorher> <spez-nachher> [--json]');
  process.exit(1);
}
// a folder that does not exist is an empty spec - the first export has no «before»
const folder = (dir: string) => (existsSync(dir) ? fsFolder(dir) : { read: () => null, list: () => [], dirs: () => [] });
const diff = diffSpecFolders(folder(before), folder(after));
process.stdout.write(asJson ? `${JSON.stringify(diff, null, 2)}\n` : formatSpecDiff(diff));
