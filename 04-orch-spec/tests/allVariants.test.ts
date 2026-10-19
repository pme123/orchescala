// Ein Worker kann mehrere Fälle eines `In` unterstützen und beim Unmarshalling
// selbst entscheiden, welcher es ist — «alle Ausprägungen» (`*`) auch bei den
// Eingaben: die Felder aller Fälle sind erlaubt, Pflicht sind nur die gemeinsamen.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { collectFindings, missingRequiredInputs, withServiceRows } from '../src/findings';
import { ALL_VARIANTS, chosenVariant, rowsForVariant, variantAllows, variantsOf } from '../src/variants';
import type { Mapping, Model, ProcessSpec, Step } from '../src/types';

const source = `package acme.file.domain
package file.v1

object MoveFile extends CompanyBpmnServiceTaskDsl:
  val topicName = "acme-file-move"

  enum In:
    def fileId: String
    case ToFolder(fileId: String, folder: String)
    case ToArchive(fileId: String, archiveKey: String)
  end In
end MoveFile
`;

const model = { domainTypes: scanScala(source, 'MoveFile.scala') } as unknown as Model;
const step = (inputs: Mapping[], inVariant?: string): Step =>
  ({ id: 'MoveFileTask', name: 'Move File', kind: 'service', topic: 'acme-file-move', inputs, ...(inVariant ? { inVariant } : {}) } as Step);
const spec = (s: Step): ProcessSpec => ({ processId: 'acme-demoV1', name: 'acme-demoV1', steps: [s] } as unknown as ProcessSpec);
const row = (name: string, disabled = false): Mapping => ({ name, expression: `= ${name}`, ...(disabled ? { disabled: true } : {}) });
const messages = (s: Step) => [...collectFindings(spec(s), model, [s]).values()].flatMap(f => [...f.errors, ...f.warnings]);

test('inputs: «alle Ausprägungen» can be chosen - all case fields allowed, none of them required', () => {
  const s = step([row('fileId'), row('folder'), row('archiveKey', true)], ALL_VARIANTS);
  const v = variantsOf(s, spec(s), model, 'inputs', null);
  const chosen = chosenVariant(s, 'inputs', v);
  assert.equal(chosen.name, ALL_VARIANTS);
  assert.equal(chosen.inferred, false);
  assert.ok(variantAllows(v, chosen, 'archiveKey'));
  assert.deepEqual(missingRequiredInputs(s, spec(s), model), []);
  assert.deepEqual(messages(s).filter(m => /Pflicht|Ausprägung/.test(m)), []);
});

test('inputs: choosing «alle Ausprägungen» keeps the checked state of the rows', () => {
  const rows = [row('fileId'), row('folder'), row('archiveKey', true)];
  const s = step(rows);
  const v = variantsOf(s, spec(s), model, 'inputs', null)!;
  assert.deepEqual(rowsForVariant(rows, v, ALL_VARIANTS, 'inputs'), rows);
  // die Ausgaben lesen weiterhin alles
  assert.ok(rowsForVariant(rows, v, ALL_VARIANTS, 'outputs').every(m => !m.disabled));
});

test('without a choice: fields of several cases are mixed', () => {
  const s = step([row('fileId'), row('folder'), row('archiveKey')]);
  assert.deepEqual(chosenVariant(s, 'inputs', variantsOf(s, spec(s), model, 'inputs', null)).mixed, ['ToFolder', 'ToArchive']);
  assert.ok(messages(s).some(m => m.includes('«alle Ausprägungen»')), messages(s).join(' / '));
});

test('import: inputs of several cases from the BPMN - the worker decides, «alle Ausprägungen»', () => {
  const s = step([row('fileId'), row('folder'), row('archiveKey')]);
  const r = withServiceRows(spec(s), model);
  assert.ok(r.changed);
  const imported = r.spec.steps[0];
  assert.equal(imported.inVariant, ALL_VARIANTS);
  assert.deepEqual(messages(imported).filter(m => /Pflicht|Ausprägung/.test(m)), []);
});

test('import: inputs of one case keep their inferred case', () => {
  const s = step([row('fileId'), row('folder')]);
  const imported = withServiceRows(spec(s), model).spec.steps[0];
  assert.equal(imported.inVariant, undefined);
  assert.equal(chosenVariant(imported, 'inputs', variantsOf(imported, spec(imported), model, 'inputs', null)).name, 'ToFolder');
});
