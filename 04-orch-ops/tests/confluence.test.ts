// Confluence import: the rendered page («Save page as») and the view-source
// variant give the same errors, statuses and how-to — cells become Markdown.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from 'linkedom';
import { IMPORT_COUNT, parseConfluence } from '../src/confluence';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html') as unknown as Document;

const code = (line: string) =>
  `<div data-testid="renderer-code-block"><code><span data-ds--code--row=""><span class="linenumber" data-ds--line-number="1"></span><span>${line}</span></span></code></div>`;

const page = `<!DOCTYPE html>
<html>
<head><title>Betrieb</title></head>
<body>
<div class="ak-renderer-document">
<h2>Wiki mit How-to Infos</h2>
<ul><li><p>Incident neu starten: <a href="https://wiki.example.com/howto">Anleitung</a></p></li><li><p>Logs prüfen</p></li></ul>
<h2>Dokumentation wiederkehrender Fehler</h2>
<div class="table-wrapper"><table><tbody>
<tr><th><p>Prozess</p></th><th><p>Kurzbeschrieb und/oder Incident</p></th><th><p>Aktivität</p></th><th><p>Erfasser</p></th><th><p>Status</p></th><th><p>Ticket</p></th><th><p>Kommentar / Workaround</p></th></tr>
<tr><td><p>acme-onboarding</p></td><td><p>Adresse kann nicht gespeichert werden</p>${code('400: error')}</td><td><p>SaveAddress</p></td><td><p><span data-mention-id="x">@Muster Anna (OPS)</span></p></td><td><p><span data-node-type="status" data-color="green">GELÖST</span></p></td><td><p><a href="https://jira.example.com/browse/OPS-1">[OPS-1]</a></p></td><td><style>.x { color: red; }</style><ol><li><p>Incident wiederholen</p></li><li><p>Ergebnis prüfen</p></li></ol></td></tr>
<tr><td><p>acme-payment</p></td><td>${code('500: Internal Server Error')}</td><td><p>Pay</p></td><td><p>Beispiel Marco</p></td><td><p><span data-node-type="status" data-color="yellow">Finanzierung notwendig</span> ?</p></td><td></td><td><p>Siehe <code>retry</code></p></td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
</tbody></table></div>
</div>
</body>
</html>`;

// Chrome's «View source» → save: every line of the original wrapped into a table cell, HTML-escaped
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const viewSource = `<html><body><table><tbody>${page.split('\n').map((l, i) =>
  `<tr><td class="line-number" value="${i + 1}"></td><td class="line-content">${esc(l)}</td></tr>`).join('')}</tbody></table></body></html>`;

function check(html: string) {
  const res = parseConfluence(html, parse);
  assert.deepEqual(res.columns, ['Prozess', 'Kurzbeschrieb und/oder Incident', 'Aktivität', 'Erfasser', 'Status', 'Ticket', 'Kommentar / Workaround']);
  assert.equal(res.errors.length, 2, 'the empty row is skipped');

  const [a, b] = res.errors;
  assert.equal(a.id, 'acme-onboarding--adresse-kann-nicht-gespeichert-werden');
  assert.equal(a.process, 'acme-onboarding');
  assert.equal(a.title, 'Adresse kann nicht gespeichert werden');
  assert.equal(a.details, '```\n400: error\n```');
  assert.equal(a.activity, 'SaveAddress');
  assert.equal(a.reporter, 'Muster Anna (OPS)');
  assert.deepEqual(a.status, ['GELÖST']);
  assert.equal(a.ticket, '[OPS-1](https://jira.example.com/browse/OPS-1)');
  assert.equal(a.workaround, '1. Incident wiederholen\n2. Ergebnis prüfen');
  assert.equal(a.count, IMPORT_COUNT);
  assert.equal(a.seq, 0);
  assert.equal(a.lastAction, 'imported');

  // only a code block: its first line becomes the title
  assert.equal(b.title, '500: Internal Server Error');
  assert.equal(b.details, '```\n500: Internal Server Error\n```');
  assert.equal(b.reporter, 'Beispiel Marco');
  assert.deepEqual(b.status, ['FINANZIERUNG NOTWENDIG']);
  assert.equal(b.ticket, '');
  // the text next to the lozenge is kept as a note
  assert.equal(b.workaround, 'Siehe `retry`\n\n*Status-Notiz aus Confluence:* ?');
  assert.equal(b.count, IMPORT_COUNT);

  assert.deepEqual(res.statuses, [
    { label: 'GELÖST', color: 'green', done: true },
    { label: 'FINANZIERUNG NOTWENDIG', color: 'yellow' },
  ]);
  assert.equal(res.howto, '- Incident neu starten: [Anleitung](https://wiki.example.com/howto)\n- Logs prüfen');

  // the inline <style> in a cell must not leak into any text
  assert.ok(!JSON.stringify(res.errors).includes('color: red'));
}

test('the rendered page («Save page as»)', () => check(page));

test('the view-source variant gives the same result', () => check(viewSource));

test('without the error table: a clear error', () => {
  assert.throws(() => parseConfluence('<html><body><table><tr><td>x</td></tr></table></body></html>', parse), /Keine Fehler-Tabelle/);
});

test('a count column overrides the initial count', () => {
  const html = `<table><tr><th>Prozess</th><th>Kurzbeschrieb</th><th>Status</th><th>Anzahl</th></tr>
    <tr><td>acme-a</td><td>Timeout</td><td><span data-node-type="status" data-color="purple">OFFEN</span></td><td>7</td></tr></table>`;
  const res = parseConfluence(html, parse);
  assert.equal(res.errors[0].count, 7);
  assert.deepEqual(res.statuses, [{ label: 'OFFEN', color: 'purple' }]);
  assert.equal(res.howto, '');
});

test('the initial count is selectable (0, 1, 2 …) — a count column still wins', () => {
  const table = (count: string) => `<table><tr><th>Prozess</th><th>Kurzbeschrieb</th><th>Status</th>${count ? '<th>Count</th>' : ''}</tr>
    <tr><td>acme-a</td><td>Timeout</td><td><span data-node-type="status" data-color="neutral">OFFEN</span></td>${count ? `<td>${count}</td>` : ''}</tr></table>`;
  assert.equal(parseConfluence(table(''), parse).errors[0].count, IMPORT_COUNT);
  assert.equal(parseConfluence(table(''), parse, { initialCount: 0 }).errors[0].count, 0);
  assert.equal(parseConfluence(table(''), parse, { initialCount: 1 }).errors[0].count, 1);
  // nonsense falls back to the default
  assert.equal(parseConfluence(table(''), parse, { initialCount: -3 }).errors[0].count, IMPORT_COUNT);
  assert.equal(parseConfluence(table('5'), parse, { initialCount: 0 }).errors[0].count, 5);
  assert.equal(parseConfluence(table('0'), parse).errors[0].count, 0);
});
