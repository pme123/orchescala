import {describe, expect, it} from 'vitest';
import {allDocs, docIdOf, docUrl, findDoc, includeProblems, resolvePath} from './docs';

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
    expect(includeProblems).toEqual([]);
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
