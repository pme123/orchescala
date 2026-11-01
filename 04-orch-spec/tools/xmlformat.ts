// CLI: BPMN and DMN in one form (formatXml in src/xmlFormat.ts) - so a merge compares content,
// not indentation or the order of attributes.
//
//   node tools/xmlformat.ts <datei.bpmn|.dmn>      the file formatted on stdout
//   node tools/xmlformat.ts --json                 { "<key>": "<xml>", … } on stdin → the same keys formatted
//
// Orchescala's merge from Orch Spec (`processFromSpec --merge`) formats base, new and code with it.
import { readFileSync } from 'node:fs';
import { formatXml } from '../src/xmlFormat.ts';

const args = process.argv.slice(2);
if (args[0] === '--json') {
  const input = JSON.parse(readFileSync(0, 'utf8')) as Record<string, string>;
  const output = Object.fromEntries(Object.entries(input).map(([k, xml]) => [k, formatXml(xml)]));
  process.stdout.write(JSON.stringify(output));
} else if (args.length === 1) {
  process.stdout.write(formatXml(readFileSync(args[0], 'utf8')));
} else {
  console.error('Aufruf: node tools/xmlformat.ts <datei.bpmn|.dmn>  |  node tools/xmlformat.ts --json < texte.json');
  process.exit(1);
}
