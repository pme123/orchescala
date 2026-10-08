// «Einmalige Ausführung»: ein Ereignis-Subprozess fängt die Start-Nachricht des
// Prozesses selbst (messageName = Prozess-ID) — ihr In ist das In des Prozesses,
// kein eigenes Objekt. Ältere Importe bereiteten dafür eine Interaktion vor.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingInteractions, wiringSteps, withoutWiringInteractions } from '../src/interactions';
import type { ProcessSpec } from '../src/types';

const spec = {
  processId: 'acme-product-lilaSetV2', name: 'acme-product-lilaSetV2',
  steps: [
    { id: 'Start', kind: 'start', name: 'start', status: 'accepted' },
    { id: 'Sub', kind: 'subprocess', name: 'Sub', status: 'accepted', eventSubprocess: true, pattern: 'unique-execution', children: [
      { id: 'Compensate', kind: 'start', name: 'compensate if process', status: 'accepted', eventKind: 'message', messageName: 'acme-product-lilaSetV2' },
    ] },
    { id: 'Other', kind: 'event', name: 'other message', status: 'accepted', eventKind: 'message', messageName: 'acme-other' },
  ],
  types: [{ id: 't-in', name: 'In', kind: 'case', status: 'draft', interactionId: 'ia' }],
  interactions: [{ id: 'ia', name: 'CompensateIfProcessME', kind: 'message', stepId: 'Compensate', inTypeId: 't-in', status: 'draft' }],
} as unknown as ProcessSpec;

test('a step in a pattern block and the own start message are wiring', () => {
  assert.deepEqual([...wiringSteps(spec)].sort(), ['Compensate', 'Sub']);
  assert.ok(!missingInteractions({ ...spec, interactions: [] }).some(s => s.step.id === 'Compensate'));
});

test('a prepared interaction there goes, with its classes', () => {
  const healed = withoutWiringInteractions(spec);
  assert.deepEqual(healed.interactions, []);
  assert.deepEqual(healed.types, []);
  // eine schon gepflegte (nicht Entwurf) bleibt
  const kept = withoutWiringInteractions({ ...spec, interactions: [{ ...spec.interactions![0], status: 'implemented' }] });
  assert.equal(kept.interactions?.length, 1);
});
