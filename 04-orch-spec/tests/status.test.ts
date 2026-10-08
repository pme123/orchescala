// Der Status der Spezifikation ist der kleinste ihrer Teile — Reihenfolge
// Entwurf → In Prüfung → Final → Angepasst → Umgesetzt → Abgenommen.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overallStatus } from '../src/status';
import { STATUSES, type ProcessSpec, type Status } from '../src/types';

const step = (id: string, status: Status, extra: object = {}) => ({ id, name: id, kind: 'service', status, ...extra });

test('the order: changed comes after final', () => {
  assert.deepEqual([...STATUSES], ['draft', 'review', 'final', 'changed', 'implemented', 'accepted']);
});

test('the smallest status of steps (also nested) and data model', () => {
  const spec = {
    status: 'accepted',
    steps: [step('a', 'accepted'), step('g', 'implemented', { kind: 'gateway', branches: [{ id: 'b', label: 'ja', steps: [step('c', 'changed')] }] })],
    types: [{ id: 't', name: 'In', kind: 'case', status: 'implemented' }],
    interactions: [],
  } as unknown as ProcessSpec;
  assert.equal(overallStatus(spec), 'changed');
  assert.equal(overallStatus({ ...spec, types: [{ id: 't', name: 'X', kind: 'case', status: 'final' }] } as unknown as ProcessSpec), 'final');
});

test('without parts with status: what was stored, else draft', () => {
  assert.equal(overallStatus({ steps: [], status: 'review' } as unknown as ProcessSpec), 'review');
  assert.equal(overallStatus({ steps: [] } as unknown as ProcessSpec), 'draft');
});

test('a step carries the status of its interaction and its classes - the overall status finds its filter', async () => {
  const { statusParts, stepStatuses } = await import('../src/status');
  const spec = {
    steps: [step('a', 'accepted'), step('msg', 'accepted', { kind: 'event' })],
    types: [
      { id: 't-in', name: 'In', kind: 'case', status: 'draft', interactionId: 'ia' },
      { id: 't-schema', name: 'Address', kind: 'case', status: 'review' },
    ],
    interactions: [{ id: 'ia', name: 'CompensateME', kind: 'message', stepId: 'msg', inTypeId: 't-in', status: 'draft' }],
  } as unknown as ProcessSpec;
  assert.equal(overallStatus(spec), 'draft');
  assert.deepEqual(stepStatuses(spec.steps[1], spec).sort(), ['accepted', 'draft']);
  const parts = statusParts(spec);
  assert.deepEqual(parts.draft, { steps: 1, model: [] });
  assert.deepEqual(parts.accepted, { steps: 2, model: [] });
  // eine Klasse ohne Schritt zählt fürs Datenmodell
  assert.deepEqual(parts.review, { steps: 0, model: ['Address'] });
});
