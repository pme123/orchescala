// Ein Mock im InConfig beschreibt sich wie in den Projekten: mit einem Beispiel
// seines Typs als JSON — `@description(serviceOrProcessMockDescr(GetEventStatus.Out.example))`.
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

test('service mock: the mock of the ServiceOut', () => {
  const out = renderInConfig(spec('service'), new Set());
  assert.match(out, /@description\(serviceOrProcessMockDescr\(GetEventStatus\.ServiceOut\.mock\)\)\n\s+\w+Mock: Option\[MockedServiceResponse\[GetEventStatus\.ServiceOut\]\] = None/, out);
});
