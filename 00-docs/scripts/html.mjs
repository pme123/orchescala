// The HTML that prerender.mjs writes: a page from the template, and the redirect page of an old URL.

export const SITE = 'https://pme123.github.io';

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

/** The page of an old Laika URL (/orchescala/specification.html): redirects to the page, keeping the #anchor. */
export function redirectPage(page) {
  const target = escape(page.url);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escape(page.title)}</title>
  <link rel="canonical" href="${SITE}${target}" />
  <meta http-equiv="refresh" content="0; url=${target}" />
  <script>location.replace(${JSON.stringify(page.url)} + location.hash);</script>
</head>
<body><p>This page has moved to <a href="${target}">${target}</a>.</p></body>
</html>
`;
}
