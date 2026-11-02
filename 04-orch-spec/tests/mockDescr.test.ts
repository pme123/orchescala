// A mock in the InConfig describes itself as in the projects: with an example
// of its type as JSON — `@description(serviceOrProcessMockDescr(GetEventStatus.Out.example))`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderInConfig } from '../src/scala';
import type { ProcessSpec } from '../src/types';

const spec = (mockKind: 'output' | 'service') => ({
  slug: 's', name: 'acme-documents-printV1', project: 'acme-documents', processId: 'acme-documents-printV1', engine: 'c7',
  steps: [{ id: 'GetPrintStatusTask', name: 'Get Print Status', kind: 'service', topic: 'acme-documents-getEventStatus', mockKind }],
} as unknown as ProcessSpec);

test('output mock: the example of the Out', () => {
  const out = renderInConfig(spec('output'), new Set());
  assert.match(out, /@description\(serviceOrProcessMockDescr\(GetEventStatus\.Out\.example\)\)\n\s+\w+Mock: Option\[GetEventStatus\.Out\] = None/, out);
});

test('service mock: the service response of its example - every ServiceTask has it', () => {
  const out = renderInConfig(spec('service'), new Set());
  assert.match(out, /@description\(serviceOrProcessMockDescr\(GetEventStatus\.example\.defaultServiceOutMock\)\)\n\s+\w+Mock: Option\[MockedServiceResponse\[GetEventStatus\.ServiceOut\]\] = None/, out);
});

test('a worker from the catalog over its topic: GetEventStatus, not a guessed EventStatus', async () => {
  const { indexTypes } = await import('../src/scala');
  const model = { services: [], domainTypes: [
    { id: 'acme.graviton.domain.GetEventStatus.Out', name: 'GetEventStatus.Out', pkg: 'acme.graviton.domain', owner: 'GetEventStatus', topicName: 'acme-graviton-eventStatus.get', kind: 'case', fields: [] },
  ] } as unknown as Parameters<typeof indexTypes>[1];
  const s = { ...spec('output'), steps: [{ id: 'GetPrintStatusCallActivity', name: 'Get Archived Status', kind: 'service', topic: 'acme-graviton-eventStatus.get', mockKind: 'output' }] } as unknown as ProcessSpec;
  const imports = new Set<string>();
  const out = renderInConfig(s, imports, indexTypes([], model));
  assert.match(out, /serviceOrProcessMockDescr\(GetEventStatus\.Out\.example\)/, out);
  assert.match(out, /Option\[GetEventStatus\.Out\]/, out);
  assert.deepEqual([...imports], ['import acme.graviton.domain.GetEventStatus']);
});
