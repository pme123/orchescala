import {describe, expect, it} from 'vitest';
import {pageHtml, redirectPage} from './html.mjs';

const template = '<head><!-- seo:start --><title>x</title><!-- seo:end --></head><body><div id="root"></div></body>';
const page = {url: '/orchescala/a/', title: 'A $& "B"', description: "costs $' and $$"};

describe('pageHtml', () => {
  it('puts the markup and the head data in unchanged - also $ patterns', () => {
    const markup = '<code>s"$$x" $& $` $\'</code>';
    const html = pageHtml(template, page, markup);
    expect(html).toContain(`<div id="root">${markup}</div>`);
    expect(html).toContain('<title>A $&amp; &quot;B&quot;</title>');
    expect(html).toContain('<meta name="description" content="costs $\' and $$" />');
    expect(html).toContain('<link rel="canonical" href="https://pme123.github.io/orchescala/a/" />');
  });
});

describe('redirectPage', () => {
  it('redirects to the page and keeps the anchor', () => {
    const html = redirectPage(page);
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/orchescala/a/" />');
    expect(html).toContain('location.replace("/orchescala/a/" + location.hash)');
    expect(html).toContain('<link rel="canonical" href="https://pme123.github.io/orchescala/a/" />');
  });
});
