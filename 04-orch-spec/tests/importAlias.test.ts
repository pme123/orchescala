// A renamed import (`import a.b.C as E`, Scala 2: `import a.b.{C => E}`): a field of type `E`
// resolves to `a.b.C` - in the project or in the catalog - and is not reported as unknown.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { importsOfFile, scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { importedPath, importName, importsForExpression } from '../src/scalaTypes';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-admissionV1';
const PKG = 'acme.demo.domain.admission.v1';
const FOREIGN = 'acme.filis.domain.vsb.v2.schema';

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const foreign = `package ${FOREIGN}

enum AdmissionTypeCode:
  case A, B

enum OtherCode:
  case X, Y
`;

const source = (imports: string) => `package ${PKG}

${imports}

object Admission extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""

  case class In(
      admissionType: FilIsAdmissionTypeCode,
      other: Option[Other]
  )
  object In:
    lazy val example = In(admissionType = FilIsAdmissionTypeCode.A, other = None)
  end In

  enum AdmissionTypeCode:
    case LOCAL

  lazy val example = process(In.example, NoOutput())
end Admission
`;

test('importsOfFile: renames are kept as `path as Name`, exclusions are dropped', () => {
  assert.deepEqual(importsOfFile([
    `import ${FOREIGN}.AdmissionTypeCode as FilIsAdmissionTypeCode`,
    `import ${FOREIGN}.{OtherCode => Other, Gone => _, Kept}`,
    `import ${FOREIGN}.{AdmissionTypeCode as Adm, Hidden as _}`,
    `import ${FOREIGN}.*`,
  ]), [
    `${FOREIGN}.AdmissionTypeCode as FilIsAdmissionTypeCode`,
    `${FOREIGN}.OtherCode as Other`,
    `${FOREIGN}.Kept`,
    `${FOREIGN}.AdmissionTypeCode as Adm`,
    `${FOREIGN}.*`,
  ]);
  assert.equal(importName(`${FOREIGN}.OtherCode as Other`), 'Other');
  assert.equal(importName(`${FOREIGN}.Kept`), 'Kept');
  assert.equal(importedPath(`${FOREIGN}.OtherCode as Other`), `${FOREIGN}.OtherCode`);
  // an expression that uses the new name needs the rename, verbatim
  assert.deepEqual(importsForExpression('s"${Other.X}"', [`${FOREIGN}.OtherCode as Other`, `${FOREIGN}.Kept`]),
    [`${FOREIGN}.OtherCode as Other`]);
});

for (const [label, imports] of [
  ['Scala 3 `as`', `import ${FOREIGN}.AdmissionTypeCode as FilIsAdmissionTypeCode\nimport ${FOREIGN}.OtherCode as Other`],
  ['Scala 2 `=>`', `import ${FOREIGN}.{AdmissionTypeCode => FilIsAdmissionTypeCode, OtherCode => Other}`],
] as const) {
  test(`enrichSpec: a field typed with a renamed import resolves to the catalog type (${label})`, () => {
    const catalog = scanScala(foreign, 'Vsb.scala');
    const domain = scanScala(source(imports), 'Admission.scala');
    const model = { domainTypes: catalog } as never;
    const r = enrichSpec({ ...importBpmn(bpmn, 'admission').spec, project: 'acme-demo' }, domain, model)!;
    assert.deepEqual(r.unresolved, []);
    const inType = r.spec.types!.find(t => t.name === 'In' || t.name.endsWith('.In'))!;
    const field = (n: string) => inType.fields!.find(f => f.name === n)!;
    // the foreign class, not the own `Admission.AdmissionTypeCode` of the same name
    assert.match(field('admissionType').type, new RegExp(`${FOREIGN.replace(/\./g, '\\.')}\\.AdmissionTypeCode$`));
    assert.match(field('other').type, new RegExp(`${FOREIGN.replace(/\./g, '\\.')}\\.OtherCode$`));
  });
}

test('importsOfFile: a rename next to `given` in braces - `given` itself is no name', () => {
  assert.deepEqual(importsOfFile([`import ${FOREIGN}.{given, AdmissionTypeCode as Adm}`, `import ${FOREIGN}.{given Codec[X], OtherCode => Other}`]),
    [`${FOREIGN}.AdmissionTypeCode as Adm`, `${FOREIGN}.OtherCode as Other`]);
});
