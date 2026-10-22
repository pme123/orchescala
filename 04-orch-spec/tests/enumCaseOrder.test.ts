// Ein enum mit Fällen (ADT): die Parameter jedes Falls bleiben in der Reihenfolge des Codes —
// gemeinsame Felder (`def x: T`) nicht nach vorn, sonst brechen Aufrufe mit Positionen.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { DEFAULT_MERGE_STATUS, importBpmn } from '../src/bpmn';
import { scanScala } from '../src/domainScan';
import { enrichSpec } from '../src/projectImport';
import { inCodeOrder, scalaFiles } from '../src/scala';
import { mergeDomain } from '../src/domainMerge';
import type { ProcessSpec, TypeDef } from '../src/types';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const PID = 'acme-demo-sendEventV1';
const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${PID}" name="${PID}" isExecutable="true">
    <bpmn:startEvent id="StartEvent"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="EndEvent"><bpmn:incoming>f1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="EndEvent"/>
  </bpmn:process>
</bpmn:definitions>`;

const source = `package acme.demo.domain.sendEvent.v1

object SendEvent extends CompanyBpmnProcessDsl:
  val processName = "${PID}"
  val descr: String = ""

  case class In(clientKey: Long)
  object In:
    lazy val example = In(clientKey = 1L)

  enum Out:
    def subStatusKey: String
    def subStatusNr: Int

    case Graviton(
        subStatusKey: String,
        subStatusScore: Int,
        subStatusNr: Int,
        subStatusActions: String
    )
    case CAM(
        subStatusKey: String,
        subStatusNr: Int,
        subStatusTextDe: Option[String]
    )
  end Out

  lazy val example = process(In.example, Out.Graviton("k", 1, 2, "a"))
end SendEvent
`;

const imported = (): ProcessSpec => {
  const r = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, scanScala(source, 'SendEvent.scala'), null);
  assert.ok(r);
  return r.spec;
};
const exported = (spec: ProcessSpec): string =>
  scalaFiles(spec, { domainTypes: scanScala(source, 'SendEvent.scala') } as never).find(f => f.path.endsWith('/SendEvent.scala'))!.content;
const params = (content: string, kase: string): string[] => {
  const m = new RegExp(`case ${kase}\\(([\\s\\S]*?)\\n\\s*\\)`).exec(content);
  return [...(m?.[1] ?? '').matchAll(/(\w+):/g)].map(x => x[1]);
};

test('import -> export: the parameters of each case in the order of the code', () => {
  const content = exported(imported());
  assert.deepEqual(params(content, 'Graviton'), ['subStatusKey', 'subStatusScore', 'subStatusNr', 'subStatusActions']);
  assert.deepEqual(params(content, 'CAM'), ['subStatusKey', 'subStatusNr', 'subStatusTextDe']);
  // die gemeinsamen bleiben als def im Rumpf
  assert.match(content, /def subStatusKey: String/);
});

test('a field added in Orch Spec goes after those of the code; without order the common ones first', () => {
  const spec = imported();
  const out = spec.types!.find(t => t.name === 'Out')! as TypeDef;
  const graviton = out.values!.find(v => v.name === 'Graviton')!;
  graviton.fields = [...graviton.fields!, { id: 'f-new', name: 'extra', type: 'String' }];
  assert.deepEqual(params(exported(spec), 'Graviton'), ['subStatusKey', 'subStatusScore', 'subStatusNr', 'subStatusActions', 'extra']);
  delete graviton.order;
  assert.deepEqual(params(exported(spec), 'Graviton').slice(0, 2), ['subStatusKey', 'subStatusNr']);
});

test('a field renamed in Orch Spec keeps its place - a new one goes to the end', () => {
  const f = (name: string) => ({ id: name, name, type: 'String' });
  const order = ['subStatusKey', 'subStatusScore', 'subStatusNr', 'subStatusActions'];
  const renamed = [f('subStatusKey'), f('subStatusNr'), f('score'), f('subStatusActions'), f('extra')];
  assert.deepEqual(inCodeOrder(renamed, order).map(x => x.name), ['subStatusKey', 'score', 'subStatusNr', 'subStatusActions', 'extra']);
});

test('re-import: a case only reordered in the code is a change - the new order is taken over', () => {
  const before = imported();
  const reordered = source.replace(
    '        subStatusKey: String,\n        subStatusScore: Int,\n        subStatusNr: Int,',
    '        subStatusKey: String,\n        subStatusNr: Int,\n        subStatusScore: Int,',
  );
  const fresh = enrichSpec({ ...importBpmn(bpmn, 'send-event').spec, project: 'acme-demo' }, scanScala(reordered, 'SendEvent.scala'), null)!.spec;
  const r = mergeDomain(before, fresh, { status: DEFAULT_MERGE_STATUS });
  const out = r.spec.types!.find(t => t.name === 'Out')!;
  assert.deepEqual(out.values!.find(v => v.name === 'Graviton')!.order, ['subStatusKey', 'subStatusNr', 'subStatusScore', 'subStatusActions']);
  assert.ok(r.report.changed.length > 0, JSON.stringify(r.report));
});
