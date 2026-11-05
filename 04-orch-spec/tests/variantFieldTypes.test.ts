// A name several cases of an `In` have, each with its own type
// (`fileAction: FileAction` here, `fileAction: String` there), is not a
// shared field: it is shown only with a variant, and its type is the one of
// that variant.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanScala } from '../src/domainScan';
import { collectFindings } from '../src/findings';
import { ALL_VARIANTS, chosenVariant, variantAllows, variantsOf } from '../src/variants';
import type { Mapping, Model, ProcessSpec, Step } from '../src/types';

const source = `package acme.file.domain
package file.v1

object ProcessFiles extends CompanyBpmnServiceTaskDsl:
  val topicName = "acme-file-process"

  enum FileAction:
    case mergeDocuments, splitDocuments

  enum In:
    case Advanced(fileId: String, fileAction: FileAction, target: String)
    case Simple(fileId: String, fileAction: String)
  end In
end ProcessFiles
`;

const model = { domainTypes: scanScala(source, 'ProcessFiles.scala') } as unknown as Model;
const step = (inputs: Mapping[], inVariant?: string): Step =>
  ({ id: 'ProcessFilesTask', name: 'Process Files', kind: 'service', topic: 'acme-file-process', inputs, ...(inVariant ? { inVariant } : {}) } as Step);
const spec = (s: Step): ProcessSpec => ({ processId: 'acme-demoV1', name: 'acme-demoV1', steps: [s], engine: 'c8' } as unknown as ProcessSpec);
const rows = (): Mapping[] => [{ name: 'fileId', expression: '= "f-1"' }, { name: 'fileAction', expression: '= "mergeDocuments"' }];
const messages = (s: Step) => [...collectFindings(spec(s), model, [s]).values()].flatMap(f => [...f.errors, ...f.warnings]);
const typeErrors = (s: Step) => messages(s).filter(m => m.startsWith('«fileAction»'));

test('same name, different type: not a shared field', () => {
  const s = step(rows());
  const v = variantsOf(s, spec(s), model, 'inputs', null)!;
  assert.ok(v.common.has('fileId'), 'same name and type stays shared');
  assert.ok(v.specific.has('fileAction'));
  assert.ok(v.typeVaries.has('fileAction'));
  // without a choice the field is hidden like any field of a variant
  assert.equal(variantAllows(v, chosenVariant(s, 'inputs', v), 'fileAction'), false);
});

test('the type of the chosen variant is the yardstick', () => {
  const simple = step(rows(), 'Simple');
  assert.deepEqual(typeErrors(simple), [], messages(simple).join(' / '));
  const advanced = step(rows(), 'Advanced');
  // a text for an enum without cases is fine as long as it is one of its values
  assert.deepEqual(typeErrors(advanced), [], messages(advanced).join(' / '));
  const wrong = step([{ name: 'fileId', expression: '= "f-1"' }, { name: 'fileAction', expression: '= 42' }], 'Simple');
  assert.ok(typeErrors(wrong).some(m => m.includes('String')), messages(wrong).join(' / '));
});

test('«alle Ausprägungen»: no single type - no type check for the field', () => {
  const s = step([{ name: 'fileId', expression: '= "f-1"' }, { name: 'fileAction', expression: '= 42' }], ALL_VARIANTS);
  assert.deepEqual(typeErrors(s), [], messages(s).join(' / '));
});
