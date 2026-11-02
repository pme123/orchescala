// A field with a constraint (`String :| MinLength[1]`): the export writes no Iron imports -
// the project's `-Yimports` brings `io.github.iltotore.iron` and its constraints along.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { scalaFiles } from '../src/scala';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-ironV1';
const PKG = 'acme.demo.domain.iron.v1';

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const source = `package ${PKG}

object Iron extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""
  case class In(id: String :| MinLength[1], count: Int :| Positive)
  object In:
    lazy val example = In(id = "1", count = 1)
  lazy val example = process(In.example, NoOutput())
end Iron
`;

test('export: a field with a constraint gets no Iron imports', () => {
  const domain = scanScala(source, 'Iron.scala');
  const r = enrichSpec({ ...importBpmn(bpmn, 'iron').spec, project: 'acme-demo' }, domain, null)!;
  const files = scalaFiles(r.spec, { domainTypes: domain } as never);
  const all = files.map(f => f.content).join('\n');
  assert.match(all, /String :\| MinLength\[1\]/);
  assert.doesNotMatch(all, /import io\.github\.iltotore/);
});
