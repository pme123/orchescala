// A field whose type is a plain Scala name without a type behind it in the model or
// the catalog (`processCallOrigin: ProcessCallOrigin`, catalog not loaded or the type
// not in it) used to be left out of the export. It is taken as named — the import is
// up to the project; Orch Spec only notes it. The ID of a deleted own type (`t-…`)
// has no name and stays out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { checkTypes, isScalaTypeName, scalaFiles } from '../src/scala';
import type { Model, TypeDef } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-startV1';
const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const types: TypeDef[] = [{
  id: 't-in', name: 'In', kind: 'case', root: true, fields: [
    { id: 'f1', name: 'processCallOrigin', type: 'ProcessCallOrigin', description: 'Aus welchem System der Prozess gestartet wurde.', example: 'ProcessCallOrigin.MAP' },
    { id: 'f2', name: 'origins', type: 'ProcessCallOrigin', optional: true, collection: true },
    { id: 'f3', name: 'gone', type: 't-3f9a1c2b7d' },
  ],
}] as TypeDef[];

const exported = (model: Model | null = null) => {
  const spec = importBpmn(bpmn, 'start').spec;
  spec.types = types;
  return scalaFiles(spec, model).map(f => f.content).join('\n');
};

/** a loaded catalog — without ProcessCallOrigin */
const catalog = { services: [], domainTypes: [
  { id: 'acme.demo.Other', name: 'Other', pkg: 'acme.demo', kind: 'enum', importPath: 'acme.demo.Other', values: ['a'] },
] } as unknown as Model;

test('a type name without a type behind it is exported as named', () => {
  const scala = exported();
  assert.match(scala, /processCallOrigin: ProcessCallOrigin\b/);
  assert.match(scala, /origins: Option\[Seq\[ProcessCallOrigin\]\]/);
  assert.match(scala, /processCallOrigin = ProcessCallOrigin\.MAP/);
  // the ID of a deleted own type has no name — it stays out, the class itself is there
  assert.match(scala, /case class In\(/);
  assert.ok(!scala.includes('t-3f9a1c2b7d'), scala);
  assert.ok(!/\bgone:/.test(scala), scala);
});

test('the check notes the name as a hint, the lost ID as an error', () => {
  const issues = checkTypes(types, null);
  const named = issues.find(i => i.field === 'f1')!;
  assert.equal(named.warn, true);
  assert.match(named.message, /wird wie genannt exportiert/);
  const gone = issues.find(i => i.field === 'f3')!;
  assert.ok(!gone.warn);
  assert.match(gone.message, /nicht \(mehr\) vorhanden/);
  assert.match(named.message, /kein Katalog geladen/);
});

test('a loaded catalog without the type: still exported as named, the hint without «no catalog»', () => {
  assert.match(exported(catalog), /processCallOrigin: ProcessCallOrigin\b/);
  const named = checkTypes(types, catalog).find(i => i.field === 'f1')!;
  assert.equal(named.warn, true);
  assert.doesNotMatch(named.message, /kein Katalog geladen/);
});

test('a name the catalog knows is a normal type — no hint', () => {
  const known = { services: [], domainTypes: [
    { id: 'acme.demo.ProcessCallOrigin', name: 'ProcessCallOrigin', pkg: 'acme.demo', kind: 'enum', importPath: 'acme.demo.ProcessCallOrigin', values: ['MAP'] },
  ] } as unknown as Model;
  assert.match(exported(known), /processCallOrigin: ProcessCallOrigin\b/);
  assert.equal(checkTypes(types, known).find(i => i.field === 'f1'), undefined);
});

test('isScalaTypeName: a plain capitalized name only', () => {
  assert.ok(isScalaTypeName('ProcessCallOrigin'));
  assert.ok(!isScalaTypeName('t-3f9a1c2b7d'));
  assert.ok(!isScalaTypeName('processCallOrigin'));
  assert.ok(!isScalaTypeName('GetClient.Out'));
  assert.ok(!isScalaTypeName(''));
  assert.ok(!isScalaTypeName('ProcessCallOrigin '));
  // every ID has a hyphen (`uid` → `t-…`) — never a type name
  assert.ok(!isScalaTypeName('T-3f9a1c2b7d'));
});
