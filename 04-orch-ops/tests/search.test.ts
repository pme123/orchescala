// Search: all terms must match, umlaut-insensitive, across all fields;
// similarity check when creating an error.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlight, matches, similar, snippet, terms } from '../src/search';
import type { ErrorEntry } from '../src/types';

const entry = (id: string, extra: Partial<ErrorEntry> = {}): ErrorEntry => ({
  id, process: 'acme-onboarding', title: '', details: '', activity: '', reporter: '', status: [],
  ticket: '', workaround: '', count: 1, createdAt: '2026-10-01T10:00:00+02:00', updatedAt: '2026-10-01T10:00:00+02:00',
  ...extra,
});

const e = entry('a', {
  title: 'Übermittlung an Zürich-Service schlägt fehl',
  details: '```\n503 Service Unavailable\n```',
  workaround: 'Prozess mit **Retry** im Cockpit neu starten',
  status: ['OFFEN'],
});

test('terms: lower case, without diacritics, split at whitespace', () => {
  assert.deepEqual(terms('  Zürich  RETRY '), ['zurich', 'retry']);
  assert.deepEqual(terms(''), []);
});

test('matches: all terms must occur, in any field', () => {
  assert.ok(matches(e, []));
  assert.ok(matches(e, terms('zurich')));
  assert.ok(matches(e, terms('ÜBERMITTLUNG offen')));
  assert.ok(matches(e, terms('503 retry')), 'details and workaround are searched');
  assert.ok(!matches(e, terms('zürich 404')), 'one term missing → no match');
});

test('snippet: only when the hit is not visible in the list row', () => {
  assert.equal(snippet(e, terms('zurich')), null);
  const s = snippet(e, terms('cockpit'));
  assert.equal(s?.field, 'Workaround');
  assert.ok(s?.text.includes('Cockpit'));
  assert.ok(!s?.text.includes('**'), 'markdown is stripped');
  assert.equal(snippet(e, terms('nirgends')), null);
});

test('highlight: hits are marked, the original spelling is kept', () => {
  assert.deepEqual(highlight('Fehler in Zürich', terms('zurich')), [
    { s: 'Fehler in ', hit: false },
    { s: 'Zürich', hit: true },
  ]);
  assert.deepEqual(highlight('abc', []), [{ s: 'abc', hit: false }]);
});

test('similar: finds a near duplicate, ignores archived and the error itself', () => {
  const dup = entry('dup', { title: 'Übermittlung an Zürich-Service schlägt fehl (Timeout)' });
  const old = entry('old', { title: 'Übermittlung an Zürich-Service schlägt fehl', archived: true });
  const other = entry('other', { process: 'acme-payment', title: 'Zahlung doppelt verbucht' });
  const draft = { process: 'acme-onboarding', title: 'Zürich-Service Übermittlung schlägt fehl', details: '', activity: '' };
  const hits = similar(draft, [e, dup, old, other]);
  assert.deepEqual(hits.map(h => h.e.id).sort(), ['a', 'dup']);
  assert.deepEqual(similar(draft, [e, dup, old, other], 'a').map(h => h.e.id), ['dup']);
  assert.deepEqual(similar({ process: '', title: '', details: '', activity: '' }, [e]), []);
});
