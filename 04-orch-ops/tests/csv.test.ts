// CSV export: semicolon-separated, header row, cells with special characters quoted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCsv } from '../src/csv';
import type { ErrorEntry } from '../src/types';

const e: ErrorEntry = {
  id: 'acme-a--timeout', process: 'acme-a', title: 'Timeout; beim "Speichern"', details: 'Zeile 1\nZeile 2',
  activity: 'Save', reporter: 'Muster Anna', status: ['OFFEN', 'IN BEARBEITUNG'],
  ticket: '[OPS-123](https://jira.example.com/browse/OPS-123)', workaround: '**Retry**', count: 3,
  createdAt: '', updatedAt: '',
};

test('header row and one line per error', () => {
  const lines = toCsv([e, e]).split('\r\n');
  assert.equal(lines[0], 'Prozess;Kurzbeschrieb;Aktivität;Status;Count;Ticket;Erfasser;Kommentar / Workaround;Details;Letztes Update;Geändert von;Erstellt;ID');
  assert.equal(toCsv([]), lines[0]);
});

test('quoting: semicolon, quotes and newlines', () => {
  const csv = toCsv([e]);
  const row = csv.slice(csv.indexOf('\r\n') + 2);
  assert.ok(row.startsWith('acme-a;"Timeout; beim ""Speichern""";Save;OFFEN, IN BEARBEITUNG;3;OPS-123;Muster Anna;Retry;"Zeile 1\nZeile 2";'));
  assert.ok(row.endsWith(';acme-a--timeout'));
});
