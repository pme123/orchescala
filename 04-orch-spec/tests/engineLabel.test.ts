// c7 is the BPMN of Camunda 7 - Operaton runs it unchanged: one label for both, from one place,
// and the messages for c7 use it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { C7_LABEL, C8_LABEL, conversionNote, engineLabel } from '../src/engineLabels';
import { ENGINES } from '../src/template';
import { regexIssue, scriptWarning } from '../src/findings';
import { juelToFeel } from '../src/juelFeel';
import { convertBpmn } from '../src/engineConvert';
import { exportSpec } from '../src/exporters';
import { applyPattern } from '../src/patterns';
import type { EngineId, PatternDef, ProcessSpec } from '../src/types';

// the converter works on the DOM of the browser
const g = globalThis as unknown as Record<string, unknown>;
g.DOMParser ??= DOMParser;
g.XMLSerializer ??= class { serializeToString(doc: { toString(): string }) { return doc.toString(); } };

test('the engines take their labels from engineLabels', () => {
  assert.equal(engineLabel('c7'), C7_LABEL);
  assert.equal(engineLabel('c8'), C8_LABEL);
  assert.deepEqual(ENGINES.map((e) => e.label), [C7_LABEL, C8_LABEL]);
  assert.equal(engineLabel(undefined), C7_LABEL); // without an engine: the default c7
  assert.equal(engineLabel('c9' as EngineId), 'c9'); // an unknown value stays visible
  // the words themselves - the other checks only compare with the constants
  assert.equal(C7_LABEL, 'Camunda 7 / Operaton');
  assert.equal(C8_LABEL, 'Camunda 8');
});

test('the findings and the JUEL import for c7 name the label', () => {
  assert.ok(scriptWarning('c7').includes(C7_LABEL));
  assert.ok(regexIssue('[0-9]{1,2}', 'c7')?.text.includes(`In ${C7_LABEL} trennt das Komma`));
  assert.ok(!scriptWarning('c8').includes(C7_LABEL));
  const r = juelToFeel('execution.someUnknownProperty');
  assert.ok(!r.ok && r.reason.includes(`gibt es nur in ${C7_LABEL}`), JSON.stringify(r));
});

test('converting to c7 names the label in its notes', () => {
  const c8 = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="d" targetNamespace="x">
  <bpmn:process id="p" isExecutable="true"><bpmn:startEvent id="s" /></bpmn:process>
</bpmn:definitions>`;
  const r = convertBpmn(c8, 'c7');
  assert.ok(r.issues.some((i) => i.text === `${C7_LABEL} verlangt historyTimeToLive — in der Spezifikation setzen.`), JSON.stringify(r.issues));
});

test('the Orchescala export names the engine of the spec', () => {
  const spec = { version: 1, slug: 'acme-shop-bookv1', name: 'bookV1', title: 'Buchen', processId: 'acme-shop-bookV1',
    updatedAt: '2026-10-08T09:00:00Z', steps: [], types: [], interactions: [] } as unknown as ProcessSpec;
  assert.match(exportSpec({ ...spec, engine: 'c7' }, 'orchescala', null), /\| Engine \| Camunda 7 \/ Operaton \|/);
  assert.match(exportSpec({ ...spec, engine: 'c8' }, 'orchescala', null), /\| Engine \| Camunda 8 \|/);
  assert.match(exportSpec(spec, 'orchescala', null), /\| Engine \| Camunda 7 \/ Operaton \|/); // no engine: the default c7
});

test('a pattern without BPMN for the engine says which one', () => {
  const def = { id: 'p1', name: 'Erinnerung', bpmn: {} } as unknown as PatternDef;
  assert.deepEqual(applyPattern('<x/>', def, 'c7', null).issues, ['«Erinnerung» hat kein BPMN für Camunda 7 / Operaton.']);
  assert.deepEqual(applyPattern('<x/>', def, 'c8', null).issues, ['«Erinnerung» hat kein BPMN für Camunda 8.']);
});

test('the audit note of a conversion - written once, it stays', () => {
  assert.equal(conversionNote('c7'), 'In Camunda 7 / Operaton umgewandelt');
  assert.equal(conversionNote('c8'), 'In Camunda 8 umgewandelt');
});

test('no text in src names «Camunda 7» alone - only comments, the labels come from engineLabels', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []));
  // from the test itself (dist-tests/…), not from the cwd
  const src = fileURLToPath(new URL('../src', import.meta.url));
  const sources = files(src);
  assert.ok(sources.length > 50, `src not found at ${src}`); // the scan must not pass for want of files
  const offenders = sources.filter((f) => !f.endsWith('engineLabels.ts')).flatMap((f) =>
    readFileSync(f, 'utf-8').split('\n').map((line, i) => ({ f, i: i + 1, line: line.trim() }))
      .filter(({ line }) => /Camunda 7(?! \/ Operaton)/.test(line) && !/^(\/\/|\*|\/\*|\{\/\*)/.test(line)));
  assert.deepEqual(offenders.map(({ f, i, line }) => `${f}:${i} ${line}`), []);
});
