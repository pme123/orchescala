// The SharePoint URL of a folder is shown readable; a malformed one stays as it is.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayUrl } from '../src/util';

test('decodes spaces and umlauts', () => {
  assert.equal(displayUrl('https://x.sharepoint.com/sites/Team/Freigegebene%20Dokumente/Pr%C3%BCfung'),
    'https://x.sharepoint.com/sites/Team/Freigegebene Dokumente/Prüfung');
});

test('a malformed URL stays as it is', () => {
  assert.equal(displayUrl('https://x/%E0%A4%A'), 'https://x/%E0%A4%A');
});
