// The expressions of the page specs (pages/*.json) - paths, templates, conditions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionInput, conditionProblem, errorText, evaluate, format, getPath, groupBy, interpolate, resolve, resolveValue, sameValue, setPath } from '../src/pages/runtime/expr';

const state = {
  step: 'choose',
  topic: 'mortgage',
  accepted: false,
  slots: { slots: [{ start: '2026-10-20T09:00', end: '2026-10-20T10:30', advisorName: 'Anna Berater' }] },
  contact: { firstName: 'Peter', lastName: 'Muster', email: 'peter@example.ch', phone: '', customerNo: undefined },
  query: { token: 'abc' },
};
const labels = { topic: { mortgage: 'Hypothek' } };

test('conditionProblem - no escape in texts', () => {
  assert.match(conditionProblem("name == 'it\\'s'") ?? '', /kein \\/);
  assert.equal(conditionProblem(`name == "it's"`), null);
  assert.match(conditionProblem("a == 'x || b") ?? '', /nicht geschlossen/);
});

test('getPath / setPath', () => {
  assert.equal(getPath(state, 'contact.firstName'), 'Peter');
  assert.equal(getPath(state, 'slots.slots.0.advisorName'), 'Anna Berater');
  assert.equal(getPath(state, 'nothing.here'), undefined);
  const next = setPath(state, 'contact.email', 'neu@example.ch');
  assert.equal(getPath(next, 'contact.email'), 'neu@example.ch');
  assert.equal(getPath(next, 'contact.firstName'), 'Peter');
  assert.equal(state.contact.email, 'peter@example.ch'); // unverändert
  assert.deepEqual(setPath({}, 'a.b', 1), { a: { b: 1 } });
});

test('format and interpolate', () => {
  assert.equal(format('2026-10-20T09:00', 'date'), 'Di 20.10.2026');
  assert.equal(format('2026-10-20T09:00', 'time'), '09:00');
  assert.equal(format('2026-10-20', 'time'), ''); // only a day - no 00:00
  assert.equal(format('2026-10-20', 'datetime'), format('2026-10-20', 'date'));
  assert.equal(format('2026-10-20T09:00', 'datetime'), 'Di 20.10.2026, 09:00');
  assert.equal(format('mortgage', 'label:topic', labels), 'Hypothek');
  assert.equal(format('pension', 'label:topic', labels), 'pension');
  assert.equal(
    interpolate('{{slots.slots.0.start|time}}–{{slots.slots.0.end|time}} bei {{slots.slots.0.advisorName}}', state),
    '09:00–10:30 bei Anna Berater',
  );
  assert.equal(interpolate('{{topic|label:topic}}', state, labels), 'Hypothek');
  assert.equal(interpolate('fehlt: {{nothing}}', state), 'fehlt: ');
});

test('resolve - a single expression is the value itself, empty fields fall away', () => {
  assert.deepEqual(resolve({ contact: '{{contact}}', token: '{{query.token}}', days: 14 }, state), {
    contact: { firstName: 'Peter', lastName: 'Muster', email: 'peter@example.ch' },
    token: 'abc',
    days: 14,
  });
  assert.deepEqual(resolve({ remark: '{{remark}}', text: 'Thema {{topic}}' }, state), { text: 'Thema mortgage' });
});

test('evaluate', () => {
  assert.equal(evaluate(undefined, state), true);
  assert.equal(evaluate("step == 'choose'", state), true);
  assert.equal(evaluate("step != 'choose'", state), false);
  assert.equal(evaluate('accepted == false', state), true);
  assert.equal(evaluate('slots.slots', state), true);
  assert.equal(evaluate('!appointment', state), true);
  assert.equal(evaluate('appointment == null', state), true);
  assert.equal(evaluate('contact.phone', state), false);
  assert.equal(evaluate("step == 'choose' && accepted == false", state), true);
  assert.equal(evaluate("step == 'sent' && accepted == false", state), false);
  assert.equal(evaluate("step == 'sent' || topic == 'mortgage'", state), true);
  assert.equal(evaluate("step == 'sent' || topic == 'x' && accepted == false", state), false);
});

test('evaluate - operators in quotes, numbers and their text', () => {
  const st = { x: 'a||b', y: 'c&&d', n: 1, flag: true, z: 'x != y' };
  assert.equal(evaluate("z == 'x != y'", st), true);
  assert.equal(evaluate("z != 'x == y'", st), true);
  assert.equal(evaluate("x == 'a||b'", st), true);
  assert.equal(evaluate("y == 'c&&d' && n == 1", st), true);
  assert.equal(evaluate("n == '1'", st), true);
  assert.equal(evaluate("flag == 'true'", st), true);
  assert.equal(evaluate("n != '2'", st), true);
});

test('resolve - in lists every entry keeps its place, only empty fields of objects fall away', () => {
  const st = { list: ['a', '', null, { v: '', w: 1 }], x: '' };
  assert.deepEqual(resolve('{{list}}', st), ['a', '', null, { w: 1 }]);
  assert.deepEqual(resolve(['{{x}}', 'b', '{{nothing}}'], st), ['', 'b', null]);
  assert.deepEqual(resolve([{ a: '{{x}}', b: 1 }], st), [{ b: 1 }]);
});

test('resolveValue - a text stays a text, also empty (to clear a field)', () => {
  const st = { x: '', slot: { start: '2026-10-09T09:00' } };
  assert.equal(resolveValue('', st), '');
  assert.equal(resolveValue('{{x}}', st), '');
  assert.equal(resolveValue('Termin {{slot.start|time}}', st), 'Termin 09:00');
  assert.deepEqual(resolveValue('{{slot}}', st), st.slot);
  assert.deepEqual(resolveValue({ a: '{{x}}', b: 2 }, st), { b: 2 });
});

test('sameValue - deep, the order of the fields does not matter', () => {
  assert.ok(sameValue({ start: 'a', advisor: { id: 1, name: 'M' } }, { advisor: { name: 'M', id: 1 }, start: 'a' }));
  assert.ok(sameValue(['a', { x: 1 }], ['a', { x: 1 }]));
  assert.ok(sameValue('mortgage', 'mortgage'));
  assert.ok(!sameValue({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!sameValue(['a', 'b'], ['b', 'a']));
  assert.ok(!sameValue({ a: undefined }, { b: undefined }));
  assert.ok(!sameValue(null, {}));
  assert.ok(!sameValue([], {}));
});

test('format - a point in time with a zone in the time of the browser, a local one as it is', () => {
  const instant = '2026-10-20T07:00:00Z';
  const local = new Date(instant);
  assert.equal(format(instant, 'time'), `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`);
  assert.equal(format('2026-10-20T09:00', 'time'), '09:00');
  assert.equal(format('2026-10-20T09:00:00+02:00', 'date'), format(new Date('2026-10-20T07:00:00Z').toISOString(), 'date'));
});

test('setPath on a list - at most one entry after the last, no huge sparse list', () => {
  assert.deepEqual(setPath({ items: ['a'] }, 'items.1', 'b'), { items: ['a', 'b'] });
  assert.deepEqual(setPath({ items: ['a'] }, 'items.4294967294', 'x'), { items: ['a'] });
});

test('getPath reads own fields only - setPath keeps lists lists', () => {
  assert.equal(getPath({ a: {} }, 'a.constructor'), undefined);
  assert.equal(getPath({}, '__proto__'), undefined);
  const next = setPath({ items: [{ name: 'a' }, { name: 'b' }] }, 'items.1.name', 'c') as { items: { name: string }[] };
  assert.ok(Array.isArray(next.items));
  assert.deepEqual(next.items, [{ name: 'a' }, { name: 'c' }]);
  // no index on a list - nothing changes
  const same = setPath({ items: [1, 2] }, 'items.name', 3) as { items: unknown[] };
  assert.deepEqual(same.items, [1, 2]);
});

test('conditionProblem - what does not parse', () => {
  for (const ok of [undefined, '', "step == 'sent'", '!task', 'task.taskId && accepted == false', "a != 'x||y'", 'n == 1', 'flag == true'])
    assert.equal(conditionProblem(ok), null, String(ok));
  assert.match(conditionProblem('step == sent')!, /Anführungszeichen/);
  assert.match(conditionProblem("!a == 'x'")!, /kein Pfad/);
  assert.match(conditionProblem('a && ')!, /leerer Teil/);
  assert.match(conditionProblem('a b')!, /weder/);
});

test('actionInput - the honeypot only for public calls; empty fields fall away, the rest stays as it is', () => {
  const st = { name: ' Peter ', empty: '  ' };
  assert.deepEqual(actionInput({ name: '{{name}}', e: '{{empty}}' }, st, {}, true, ''), { name: ' Peter ', _hp: '' });
  assert.deepEqual(actionInput({ name: '{{name}}' }, st, {}, false, 'bot'), { name: ' Peter ' });
  assert.deepEqual(actionInput(undefined, st, {}, true, 'bot'), { _hp: 'bot' });
});

test('format - an impossible date stays the text it is', () => {
  assert.equal(format('2026-13-45T09:00', 'date'), '2026-13-45T09:00');
  assert.equal(format('2026-02-30', 'date'), '2026-02-30');
});

test('groupBy keeps the order', () => {
  const groups = groupBy([1, 2, 3, 5, 6], (n) => (n < 4 ? 'klein' : 'gross'));
  assert.deepEqual(groups, [
    { key: 'klein', items: [1, 2, 3] },
    { key: 'gross', items: [5, 6] },
  ]);
});

test('errorText - the text of the action, else a general one', () => {
  assert.equal(errorText(409, { '409': 'vergeben' }), 'vergeben');
  assert.equal(errorText(400, { default: 'ungültig' }), 'ungültig');
  assert.match(errorText(503, undefined), /im Moment/);
  assert.match(errorText(429, undefined), /Zu viele/);
  assert.match(errorText(401, undefined), /anmelden/);
});
