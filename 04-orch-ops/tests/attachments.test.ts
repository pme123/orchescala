// Attachments: only own paths are accepted; Markdown rendering is safe.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageMarkdown, isAttachmentPath, newAttachmentPath } from '../src/attachments';
import { extractLinks, plainText, renderMarkdown } from '../src/markdown';

test('isAttachmentPath: own attachments only', () => {
  assert.ok(isAttachmentPath('attachments/2026-10/20261023120000-ab1cd.png'));
  assert.ok(!isAttachmentPath('../attachments/2026-10/x.png'));
  assert.ok(!isAttachmentPath('attachments/../model.json'));
  assert.ok(!isAttachmentPath('https://evil.example.com/attachments/x.png'));
  assert.ok(!isAttachmentPath('errors/x.json'));
  assert.ok(!isAttachmentPath('/attachments/2026-10/x.png'), 'absolute path');
  assert.ok(!isAttachmentPath('attachments\\..\\model.json'), 'backslashes');
  assert.ok(!isAttachmentPath('attachments/%2e%2e/model.json'), 'encoded dots');
  assert.ok(!isAttachmentPath('attachments/2026-10/x y.png'));
});

test('newAttachmentPath: attachments/<yyyy-mm>/<timestamp>-<random>.<ext>', () => {
  const p = newAttachmentPath('png');
  assert.match(p, /^attachments\/\d{4}-\d{2}\/\d{14}-[a-z0-9]{1,5}\.png$/);
  assert.ok(isAttachmentPath(p));
});

test('imageMarkdown: brackets in the alt text are dropped', () => {
  assert.equal(imageMarkdown('attachments/2026-10/x.png'), '![Screenshot](attachments/2026-10/x.png)');
  assert.equal(imageMarkdown('attachments/2026-10/x.png', 'a [b]'), '![a b](attachments/2026-10/x.png)');
});

test('renderMarkdown: own images as placeholders, foreign images as links, no raw HTML', () => {
  const own = renderMarkdown('![Bild](attachments/2026-10/x.png)');
  assert.match(own, /<img data-att="attachments\/2026-10\/x\.png" alt="Bild"/);
  assert.ok(!own.includes(' src='), 'loaded later through the store');

  const foreign = renderMarkdown('![Bild](https://img.example.com/x.png)');
  assert.ok(!foreign.includes('<img'));
  assert.match(foreign, /<a href="https:\/\/img\.example\.com\/x\.png" target="_blank" rel="noopener noreferrer">Bild<\/a>/);

  const html = renderMarkdown('<script>alert(1)</script>\n\n<b onclick="x()">fett</b>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<b '));

  const js = renderMarkdown('[klick](javascript:alert(1))');
  assert.ok(!js.includes('<a'));
  assert.ok(js.includes('klick'));

  assert.match(renderMarkdown('[OPS-1](https://jira.example.com/browse/OPS-1)'), /<a href="https:\/\/jira\.example\.com\/browse\/OPS-1"[^>]*>OPS-1<\/a>/);
});

test('extractLinks and plainText', () => {
  assert.deepEqual(extractLinks('Siehe [OPS-1](https://jira.example.com/browse/OPS-1) und <https://jira.example.com/browse/OPS-2>'), [
    { text: 'OPS-1', href: 'https://jira.example.com/browse/OPS-1' },
    { text: 'OPS-2', href: 'https://jira.example.com/browse/OPS-2' },
  ]);
  assert.equal(plainText('**Retry** im [Cockpit](https://c.example.com)\n\n```\n503\n```\n![Bild](attachments/x.png)'), 'Retry im Cockpit 503 Bild');
});
