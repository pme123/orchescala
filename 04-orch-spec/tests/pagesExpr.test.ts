// The expressions of the page specs (pages/*.json) - paths, templates, conditions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorText, evaluate, format, getPath, groupBy, interpolate, resolve, setPath } from '../src/pages/runtime/expr';

const state = {
  step: 'choose',
  topic: 'mortgage',
  accepted: false,
  slots: { slots: [{ start: '2026-10-20T09:00', end: '2026-10-20T10:30', advisorName: 'Anna Berater' }] },
  contact: { firstName: 'Peter', lastName: 'Muster', email: 'peter@example.ch', phone: '', customerNo: undefined },
  query: { token: 'abc' },
};
const labels = { topic: { mortgage: 'Hypothek' } };

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
  const st = { x: 'a||b', y: 'c&&d', n: 1, flag: true };
  assert.equal(evaluate("x == 'a||b'", st), true);
  assert.equal(evaluate("y == 'c&&d' && n == 1", st), true);
  assert.equal(evaluate("n == '1'", st), true);
  assert.equal(evaluate("flag == 'true'", st), true);
  assert.equal(evaluate("n != '2'", st), true);
});

test('resolve - empty values fall away in lists as well (also of a single expression)', () => {
  const st = { list: ['a', '', null, { v: '', w: 1 }], x: '' };
  assert.deepEqual(resolve('{{list}}', st), ['a', { w: 1 }]);
  assert.deepEqual(resolve(['{{x}}', 'b'], st), ['b']);
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
