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

test('the start carries the classes of the process; a new step status applies to its data model', async () => {
  const { dataBelow, statusParts, withDataStatus } = await import('../src/status');
  const spec = {
    steps: [step('Start', 'accepted', { kind: 'start' }), step('task', 'accepted')],
    types: [
      { id: 't-in', name: 'In', kind: 'case', status: 'changed', root: true },
      { id: 't-init', name: 'InitIn', kind: 'case', status: 'accepted', initIn: true },
      { id: 't-ia-in', name: 'Merge.In', kind: 'case', status: 'accepted', interactionId: 'ia' },
      { id: 't-ia-out', name: 'Merge.Out', kind: 'case', status: 'changed', interactionId: 'ia' },
    ],
    interactions: [{ id: 'ia', name: 'Merge', kind: 'customTask', stepId: 'task', inTypeId: 't-ia-in', outTypeId: 't-ia-out', status: 'changed' }],
  } as unknown as ProcessSpec;
  // der Start zeigt die Klasse des Prozesses, die tiefer steht
  assert.deepEqual(dataBelow(spec.steps[0], spec), { status: 'changed', typeId: 't-in', label: 'In' });
  assert.deepEqual(dataBelow(spec.steps[1], spec), { status: 'changed', typeId: 't-ia-in', label: 'Merge' });
  assert.deepEqual(statusParts(spec).changed, { steps: 2, model: [] });
  // «Abgenommen» am Schritt: Interaktion, In und Out ziehen mit — am Start die Klassen des Prozesses
  const next = withDataStatus(spec, new Set(['task', 'Start']), 'accepted');
  assert.equal(overallStatus(next), 'accepted');
  assert.equal(dataBelow(next.steps[1], next), null);
});

test('at the start: In, InitIn, InConfig always - other classes only when lower', async () => {
  const { startClasses } = await import('../src/status');
  const spec = {
    steps: [step('Start', 'accepted', { kind: 'start' })],
    types: [
      { id: 'a', name: 'Address', kind: 'case', status: 'review' },
      { id: 'c', name: 'InConfig', kind: 'case', status: 'accepted', inConfig: true },
      { id: 'i', name: 'In', kind: 'case', status: 'changed', root: true },
      { id: 'n', name: 'InitIn', kind: 'case', status: 'accepted', initIn: true },
      { id: 'o', name: 'Out', kind: 'case', status: 'accepted', processOut: true },
    ],
    interactions: [],
  } as unknown as ProcessSpec;
  assert.deepEqual(startClasses(spec.steps[0], spec).map(k => `${k.name}${k.below ? ` [${k.status}]` : ''}`),
    ['In [changed]', 'InitIn', 'InConfig', 'Address [review]']);
});
