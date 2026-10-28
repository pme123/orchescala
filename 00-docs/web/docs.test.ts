import {describe, expect, it} from 'vitest';
import {allDocs, descriptionOf, docIdOf, docUrl, findDoc, loadProblems, resolvePath} from './docs';

describe('resolvePath', () => {
  it('resolves against the folder', () => {
    expect(resolvePath('functionalityDsls', 'worker.md')).toBe('functionalityDsls/worker.md');
    expect(resolvePath('functionalityDsls', './images/x.png')).toBe('functionalityDsls/images/x.png');
  });
  it('goes up with ..', () => {
    expect(resolvePath('functionalityDsls', '../specification.md')).toBe('specification.md');
    expect(resolvePath('', '../x.md')).toBe('x.md');
  });
  it('starts at the top for an absolute path', () => {
    expect(resolvePath('functionalityDsls', '/images/x.png')).toBe('images/x.png');
  });
});

describe('docIdOf', () => {
  it('finds the index page', () => {
    expect(docIdOf('/orchescala/')).toBe('index');
    expect(docIdOf('/orchescala')).toBe('index');
    expect(docIdOf('/orchescala/index.html')).toBe('index');
  });
  it('finds a page with or without a trailing slash', () => {
    expect(docIdOf('/orchescala/functionalityDsls/apiDoc/')).toBe('functionalityDsls/apiDoc');
    expect(docIdOf('/orchescala/functionalityDsls/apiDoc')).toBe('functionalityDsls/apiDoc');
  });
  it('finds a page by its old Laika URL', () => {
    expect(docIdOf('/orchescala/specification.html')).toBe('specification');
    expect(docIdOf('/orchescala/functionalityDsls/index.html')).toBe('functionalityDsls');
  });
  it('is the inverse of docUrl', () => {
    for (const doc of allDocs) expect(docIdOf(docUrl(doc.id))).toBe(doc.id);
  });
});

describe('pages', () => {
  it('inlines includes', () => {
    const worker = findDoc('functionalityDsls/worker')!;
    expect(worker.markdown).not.toContain('<!-- include:');
    expect(worker.markdown).toContain('## Advanced Custom Workers');
  });
  it('loads without broken includes or navigation entries', () => {
    expect(loadProblems).toEqual([]);
  });
  it('lists no partial as a page', () => {
    expect(findDoc('functionalityDsls/workers_advanced')).toBeUndefined();
  });
  it('replaces @VERSION@', () => {
    for (const doc of allDocs) expect(doc.markdown).not.toContain('@VERSION@');
  });
  it('gives every page a title and a description', () => {
    for (const doc of allDocs) {
      expect(doc.title, doc.id).not.toBe('');
      if (doc.id !== 'index') expect(doc.description, doc.id).not.toBe('');
    }
  });
});

describe('descriptionOf', () => {
  it('takes the whole first paragraph of text', () => {
    expect(descriptionOf('# Title\n\n> [!NOTE]\n> a note that is long enough to count\n\nThe first paragraph of the page,\nwith a second line.\n\nMore.'))
      .toBe('The first paragraph of the page, with a second line.');
  });
  it('cuts a long paragraph at a word', () => {
    const text = descriptionOf(`${'word '.repeat(40)}end`);
    expect(text.endsWith('word …')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(160);
  });
  it('removes emphasis but keeps _ and * in words and patterns', () => {
    expect(descriptionOf('Set **my_var** in `*.md` files - _not_ in __other__ ones, **_nested_** too.'))
      .toBe('Set my_var in *.md files - not in other ones, nested too.');
  });
  it('cuts a long paragraph without a space', () => {
    expect(descriptionOf('x'.repeat(200))).toBe(`${'x'.repeat(157)} …`);
  });
});
