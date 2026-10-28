// The HTML that prerender.mjs writes: a page from the template, and the redirect page of an old URL.

export const SITE = 'https://pme123.github.io';

// for double-quoted attribute values and text - not for single-quoted attributes or inside <script>
export const escape = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function buildHead(page) {
  const url = `${SITE}${page.url}`;
  return [
    `<title>${escape(page.title)}</title>`,
    `<meta name="description" content="${escape(page.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Orchescala" />`,
    `<meta property="og:title" content="${escape(page.title)}" />`,
    `<meta property="og:description" content="${escape(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
  ].join('\n    ');
}

/**
 * The template (dist/index.html) with the head data of the page and its rendered markup.
 * Function replacers: a replacement string would treat `$&`, `$'` or `$$` in the page as patterns.
 */
export function pageHtml(template, page, markup) {
  return template
    .replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, () => `<!-- seo:start -->\n    ${buildHead(page)}\n    <!-- seo:end -->`)
    .replace('<div id="root"></div>', () => `<div id="root">${markup}</div>`);
}

/** The 404 page: the app shows "not found" - not indexed and without the start page's canonical link. */
export function notFoundHtml(template) {
  return template.replace(
    /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,
    () => '<!-- seo:start -->\n    <title>Page not found | Orchescala</title>\n    <meta name="robots" content="noindex" />\n    <!-- seo:end -->',
  );
}

/**
 * The page of an old Laika URL (/orchescala/specification.html): redirects to the page, keeping the
 * #anchor. The meta refresh (without the anchor) is only the fallback without JavaScript.
 */
export function redirectPage(page) {
  const target = escape(page.url);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escape(page.title)}</title>
  <link rel="canonical" href="${SITE}${target}" />
  <script>location.replace(${JSON.stringify(page.url)} + location.hash);</script>
  <noscript><meta http-equiv="refresh" content="0; url=${target}" /></noscript>
</head>
<body><p>This page has moved to <a href="${target}">${target}</a>.</p></body>
</html>
`;
}
