// CLI: BPMN and DMN as the Camunda Modeler writes them (modelerXml in src/modelerXml.ts - its own
// serializer, bpmn-moddle / dmn-moddle) - so a merge compares content, not the form, and writes
// what the Modeler would. Anything else in one form (formatXml).
//
//   node tools/xmlformat.ts <datei.bpmn|.dmn>      the file formatted on stdout
//   node tools/xmlformat.ts --json                 { "<key>": "<xml>", … } on stdin → the same keys formatted
//
// Orchescala's merge from Orch Spec (`processFromSpec --merge`) formats base, new and code with it.
import { readFileSync } from 'node:fs';
import { modelerXml } from '../src/modelerXml.ts';

const args = process.argv.slice(2);
if (args[0] === '--json') {
  const input = JSON.parse(readFileSync(0, 'utf8')) as Record<string, string>;
  const output: Record<string, string> = {};
  for (const [key, xml] of Object.entries(input)) output[key] = await modelerXml(xml);
  process.stdout.write(JSON.stringify(output));
} else if (args.length === 1) {
  process.stdout.write(await modelerXml(readFileSync(args[0], 'utf8')));
} else {
  console.error('Aufruf: node tools/xmlformat.ts <datei.bpmn|.dmn>  |  node tools/xmlformat.ts --json < texte.json');
  process.exit(1);
}
