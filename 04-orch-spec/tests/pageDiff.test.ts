// The cases of PageDiffSuite (02-orch-spec-core, Scala) before pageDiff came back to TypeScript - the
// expected JSON is what the Scala build answered, compared as text: the same fields in the same order,
// a field that is not there stays out (orch-spec reads it as undefined).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedKeys, flatten, pageDiff, type Component, type Page, type PageChange } from '../src/core';

const diff = (before: string, after: string) => JSON.stringify(pageDiff(JSON.parse(before) as Page, JSON.parse(after) as Page));

const book =
  '{"path":"shop/book","title":"Termin buchen","access":"public","state":{"contact":{}},"body":[{"type":"heading","text":"Termin buchen"},{"type":"section","label":"Kontakt","body":[{"type":"fields","fields":[{"bind":"contact.name","label":"Name","required":true}]}]},{"type":"button","label":"Buchen","actions":[]}]}';

test('the same page - no differences', () => {
  assert.equal(diff(book, book), '[]');
});

test('new field, changed block, moved, added, page title', () => {
  const edited =
    '{"path":"shop/book","title":"Beratung buchen","access":"public","state":{"contact":{}},"body":[{"type":"button","label":"Buchen","actions":[]},{"type":"heading","text":"Termin buchen"},{"type":"text","text":"Hinweis","id":"b-d812b1f182"},{"type":"section","label":"Kontakt","body":[{"type":"fields","fields":[{"bind":"contact.name","label":"Name","required":true},{"bind":"contact.branch","label":"Filiale"}]}]}]}';
  assert.equal(
    diff(book, edited),
    '[{"kind":"page","label":"Titel","detail":"«Termin buchen» → «Beratung buchen»"},{"kind":"moved","key":"0","label":"Button «Buchen»","detail":"von 2"},{"kind":"added","key":"2","label":"Text «Hinweis»"},{"kind":"changed","key":"3.0","label":"Eingabefelder","detail":"«Filiale» neu"}]',
  );
});

test('removed block', () => {
  const removed =
    '{"path":"shop/book","title":"Termin buchen","access":"public","state":{"contact":{}},"body":[{"type":"heading","text":"Termin buchen"},{"type":"section","label":"Kontakt","body":[{"type":"fields","fields":[{"bind":"contact.name","label":"Name","required":true}]}]}]}';
  assert.equal(diff(book, removed), '[{"kind":"removed","key":"2","label":"Button «Buchen»"}]');
});

test('a new label after an insert before it: the only button changed - not one new and one removed', () => {
  const relabeled =
    '{"path":"shop/book","title":"Termin buchen","access":"public","state":{"contact":{}},"body":[{"type":"heading","text":"Termin buchen"},{"type":"section","label":"Kontakt","body":[{"type":"fields","fields":[{"bind":"contact.name","label":"Name","required":true}]}]},{"type":"text","text":"Datenschutz","id":"b-80b60e8f1d"},{"type":"button","label":"Verbindlich anfragen","actions":[]}]}';
  assert.equal(
    diff(book, relabeled),
    '[{"kind":"added","key":"2","label":"Text «Datenschutz»"},{"kind":"changed","key":"3","label":"Button «Verbindlich anfragen»"}]',
  );
});

test('changed keys - new, changed and moved blocks of the draft', () => {
  const changes: PageChange[] = [
    { kind: 'page', label: 'Titel' },
    { kind: 'moved', key: '0', label: 'Button «Buchen»', detail: 'von 2' },
    { kind: 'changed', key: '3.0', label: 'Eingabefelder' },
    { kind: 'removed', key: '2', label: 'Text' },
  ];
  assert.deepEqual([...changedKeys(changes)], ['0', '3.0']);
});

test('a hand-edited page: no body, a body that is no list, a block that is no object', () => {
  assert.equal(diff('{"title":"x","body":"kaputt"}', '{"title":"x","body":[42,{"type":"text","text":"Hallo"}]}'),
    '[{"kind":"added","key":"1","label":"Text «Hallo»"}]');
  assert.equal(diff('{"title":"x"}', '{"title":"x","body":[{"type":"text","text":"Hallo"}]}'),
    '[{"kind":"added","key":"0","label":"Text «Hallo»"}]');
});

test('a hand-edited block: an unknown type, a text that is no string, entries without a label', () => {
  assert.equal(diff(book.replace('"Buchen"', '42'), book.replace('{"type":"button","label":"Buchen","actions":[]}', '{"type":"map","label":"Karte"}')),
    '[{"kind":"added","key":"2","label":"map «Karte»"},{"kind":"removed","key":"2","label":"Button"}]');
  assert.equal(diff('{"body":[{"type":"choice","label":"C","options":[{"label":"A"}]}]}', '{"body":[{"type":"choice","label":"C","options":[{"label":"A"},{"value":"b"}]}]}'),
    '[{"kind":"changed","key":"0","label":"Auswahl «C»","detail":"«» neu"}]');
});

test('a property that is no text next to one that is: the JSON of it', () => {
  assert.equal(diff('{"title":"x","path":"p"}', '{"title":{"de":"x"},"path":"p"}'), '[{"kind":"page","label":"Titel","detail":"«x» → «{\\"de\\":\\"x\\"}»"}]');
});

test('something else than an object counts as an empty page', () => {
  assert.equal(JSON.stringify(pageDiff(null as unknown as Page, JSON.parse('{"body":[{"type":"text","text":"A"}]}') as Page)),
    '[{"kind":"added","key":"0","label":"Text «A»"}]');
});

// edge cases - the expected JSON is what the TypeScript pageDiff of orch-spec answered before it moved
// to Scala, and the Scala build after it
const page = (body: string) => `{"path":"p","title":"T","access":"public","body":[${body}]}`;
const a = '{"type":"text","text":"A"}';
const b = '{"type":"text","text":"B"}';
const go = '{"type":"button","label":"Go","actions":[]}';

const edgeCases: [string, string, string, string][] = [
  ['empty pages', page(''), page(''), '[]'],
  ['all new', page(''), page(`${a},${go}`),
    '[{"kind":"added","key":"0","label":"Text «A»"},{"kind":"added","key":"1","label":"Button «Go»"}]'],
  ['all removed', page(`${a},${go}`), page(''),
    '[{"kind":"removed","key":"0","label":"Text «A»"},{"kind":"removed","key":"1","label":"Button «Go»"}]'],
  ['all moved - the order reversed', page(`${a},${b},${go}`), page(`${go},${b},${a}`),
    '[{"kind":"moved","key":"1","label":"Text «B»","detail":"von 1"},{"kind":"moved","key":"2","label":"Text «A»","detail":"von 0"}]'],
  ['the same block twice', page(`${a},${a},${go}`), page(`${go},${a},${a}`),
    '[{"kind":"moved","key":"0","label":"Button «Go»","detail":"von 2"}]'],
  ['one of two same blocks changed', page(`${a},${a}`), page(`${a},{"type":"text","text":"A","tone":"muted"}`),
    '[{"kind":"changed","key":"1","label":"Text «A»"}]'],
  ['two of a type left - not paired: one new, two removed', page(`{"type":"heading","text":"H"},${a},${b}`), page(`{"type":"text","text":"C"},{"type":"heading","text":"H"}`),
    '[{"kind":"added","key":"0","label":"Text «C»"},{"kind":"removed","key":"1","label":"Text «A»"},{"kind":"removed","key":"2","label":"Text «B»"}]'],
  ['a new block in a section - the section itself unchanged',
    page(`{"type":"section","label":"S","body":[${a}]}`), page(`{"type":"section","label":"S","body":[${a},${b}]}`),
    '[{"kind":"added","key":"0.1","label":"Text «B»"}]'],
];

for (const [name, before, after, expected] of edgeCases) {
  test(`edge case: ${name}`, () => assert.equal(diff(before, after), expected));
}

test('keys in another order: the block changed, the state a change of the page', () => {
  assert.equal(
    diff(
      '{"path":"p","title":"T","access":"public","state":{"a":1,"b":2},"body":[{"type":"text","text":"A"},{"type":"button","label":"Go","actions":[]}]}',
      '{"path":"p","title":"T","access":"public","state":{"b":2,"a":1},"body":[{"text":"A","type":"text"},{"type":"button","label":"Go","actions":[]}]}',
    ),
    '[{"kind":"page","label":"Anfangszustand"},{"kind":"changed","key":"0","label":"Text «A»"}]',
  );
});

test('a value that is no object keeps its index - also before a section and inside one', () => {
  const body = JSON.parse('[{"type":"text","text":"A"},42,{"type":"section","body":["x",{"type":"text","text":"B"}]}]') as Component[];
  assert.deepEqual(flatten(body).map((x) => [x.key, x.depth]), [['0', 0], ['2', 0], ['2.1', 1]]);
});
