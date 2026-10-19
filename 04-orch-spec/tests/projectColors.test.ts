// Projektfarben aus dem generierten Katalog: `white` bzw. `#fff` heisst in
// Orchescala «keine Farbe» — das kommt nicht als Farbe herein.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCatalogFile } from '../src/catalogImport';

test('project colors: white and #fff are no color', () => {
  const read = readCatalogFile(JSON.stringify({
    services: [],
    projectColors: { 'acme-cards': '#c8feda', 'acme-helper': 'white', 'acme-admin': '#FFF', 'acme-kube': ' #ffffff ' },
  }));
  assert.ok(read.ok);
  assert.deepEqual(read.ok && read.data.projectColors, { 'acme-cards': '#c8feda' });
});

test('project colors only: still a catalog', () => {
  const read = readCatalogFile(JSON.stringify({ projectColors: { 'acme-cards': '#c8feda' } }));
  assert.ok(read.ok);
});
