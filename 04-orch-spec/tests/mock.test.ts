// The mock of a step points to a field in the InConfig (`getPoasMock`). If the
// BPMN reads a general variable (`_outputMock`), that field does not exist — the
// InConfig gets the field from the step name, the BPMN then reads that one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockFieldOf, mockRef } from '../src/bpmn';

test('the InConfig field of a mock: what the BPMN reads', () => {
  assert.equal(mockFieldOf({ name: 'Get Poas', mock: "#{execution.getVariable('getPoasMock')}" }), 'getPoasMock');
  assert.equal(mockFieldOf({ name: 'Get Poas', mock: '= getPoasMock' }), 'getPoasMock');
  assert.equal(mockFieldOf({ name: 'Get Poas' }), 'getPoasMock');
});

test('a general variable is no InConfig field - the field comes from the step name', () => {
  const step = { name: 'Update client', mock: "#{execution.getVariable('_outputMock')}" };
  assert.equal(mockRef(step.mock), '_outputMock');
  assert.equal(mockFieldOf(step), 'updateclientMock');
  assert.equal(mockFieldOf({ name: 'Update client', mock: '${_outputServiceMock}' }), 'updateclientMock');
});
