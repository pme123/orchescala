import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import type {Doc} from './docs';
import {renderDoc} from './markdown';

let n = 0;
const render = (markdown: string, dir = '') => {
  const doc: Doc = {id: `test/page${n++}`, dir, title: '', description: '', markdown};
  const {content, toc, problems, warnings, ids, anchorLinks} = renderDoc(doc);
  return {html: renderToStaticMarkup(<>{content}</>), toc, problems, warnings, ids, anchorLinks, id: doc.id};
};

describe('alerts', () => {
  it('turns a [!NOTE] with the text on the next line into a callout', () => {
    const {html} = render('> [!NOTE]\n> Some info.');
    expect(html).toContain('<div class="callout callout-note"><p class="callout-title">Note</p>');
    expect(html).toContain('<p>Some info.</p>');
    expect(html).not.toContain('[!NOTE]');
  });
  it('turns a [!WARNING] with the text on the same line into a callout', () => {
    const {html} = render('> [!WARNING] Be careful.');
    expect(html).toContain('callout-warning');
    expect(html).toContain('<p>Be careful.</p>');
  });
  it('turns a bare [!NOTE] without text into a callout with just its title', () => {
    const {html} = render('> [!NOTE]');
    expect(html).toContain('<p class="callout-title">Note</p>');
    expect(html).not.toContain('[!NOTE]');
  });
  it('leaves a plain quote and an unknown kind alone', () => {
    expect(render('> Just a quote.').html).toContain('<blockquote>');
    expect(render('> [!FOO] x').html).toContain('<blockquote>');
  });
});

describe('links and images', () => {
  it('links a page by its URL', () => {
    const {html, problems} = render('[spec](../specification.md#intro)', 'functionalityDsls');
    expect(html).toContain('href="/orchescala/specification/#intro"');
    expect(problems).toEqual([]);
  });
  it('opens external links in a new tab', () => {
    expect(render('[gh](https://github.com)').html).toContain('target="_blank" rel="noopener noreferrer"');
  });
  it('reports links and images that point nowhere', () => {
    const {problems} = render('[x](nope.md) [y](nope.yml) ![z](images/nope.png)');
    expect(problems).toEqual([
      'link nope.md - there is no such page',
      'link nope.yml - there is no such file',
      'image images/nope.png - there is no such file',
    ]);
  });
});

describe('anchors', () => {
  it('collects the ids of the page and its links to anchors', () => {
    const {ids, anchorLinks, id} = render('## My Heading\n<a id="raw"></a>\n[a](#raw) [b](../specification.md#intro)', 'functionalityDsls');
    expect(ids).toEqual(expect.arrayContaining(['my-heading', 'raw']));
    expect(anchorLinks).toEqual([
      {href: '#raw', doc: id, id: 'raw'},
      {href: '../specification.md#intro', doc: 'specification', id: 'intro'},
    ]);
  });
});

describe('code and headings', () => {
  it('warns about a language without highlighting', () => {
    expect(render('```kotlin\nval x = 1\n```').warnings).toEqual([
      'code block in kotlin - no highlighting (register it in markdown.tsx)',
    ]);
  });
  it('shows mdoc fences as Scala without their modifiers, and hides mdoc:invisible', () => {
    const {html, warnings} = render('```scala mdoc:invisible\nval setup = 1\n```\n\n```scala mdoc:reset\nval x = 1\n```');
    expect(html).toContain('<code class="language-scala hljs"><span class="hljs-keyword">val</span> x');
    expect(html).not.toContain('setup');
    expect(html).not.toContain('mdoc');
    expect(warnings).toEqual([]);
  });
  it('highlights Scala', () => {
    expect(render('```scala\nval x = 1\n```').html).toContain('<span class="hljs-keyword">val</span>');
  });
  it('builds the table of contents from h2 and h3', () => {
    const {toc, html} = render('# Title\n## One\n### Two\n#### Three');
    expect(toc).toEqual([
      {id: 'one', text: 'One', level: 2},
      {id: 'two', text: 'Two', level: 3},
    ]);
    expect(html).toContain('<a href="#one" class="heading-anchor" aria-hidden="true">#</a>');
  });
});
