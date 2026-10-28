// Postbuild step: renders every page on the server (react-dom/server) and writes it as its own
// static HTML file to dist/ - with the title and description of the page. So each page has a
// real URL on GitHub Pages and is readable without JavaScript.
//
// Runs AFTER the SSR build (vite build --ssr web/entry-server.tsx --outDir dist-ssr), so that the
// image URLs in the markup are the hashed production assets.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const SITE = 'https://pme123.github.io';

const escape = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

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

function redirectPage(page) {
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

async function main() {
  const distDir = path.resolve('dist');
  const ssrDir = path.resolve('dist-ssr');
  const templatePath = path.join(distDir, 'index.html');
  if (!fs.existsSync(templatePath)) throw new Error('dist/index.html is missing - run "vite build" first.');
  const ssrEntryPath = path.join(ssrDir, 'entry-server.js');
  if (!fs.existsSync(ssrEntryPath)) {
    throw new Error('dist-ssr/entry-server.js is missing - run "vite build --ssr web/entry-server.tsx --outDir dist-ssr" first.');
  }
  const template = fs.readFileSync(templatePath, 'utf-8');
  const {render, pages, check} = await import(pathToFileURL(ssrEntryPath).href);

  const {errors, warnings} = check();
  warnings.forEach(w => console.warn(`warning: ${w}`));
  if (errors.length > 0) {
    throw new Error(`${errors.length} broken page(s), link(s), image(s) or navigation entries:\n  ${errors.join('\n  ')}`);
  }

  // unknown URLs - the app shows its "not found" page (or still finds an old URL it knows)
  fs.writeFileSync(path.join(distDir, '404.html'), template);

  for (const page of pages()) {
    let html = template.replace(
      /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,
      `<!-- seo:start -->\n    ${buildHead(page)}\n    <!-- seo:end -->`,
    );
    html = html.replace('<div id="root"></div>', `<div id="root">${render(page.url)}</div>`);
    const outPath = path.join(distDir, page.outFile);
    fs.mkdirSync(path.dirname(outPath), {recursive: true});
    fs.writeFileSync(outPath, html);
    console.log(`prerendered ${page.url} -> dist/${page.outFile}`);

    // the old Laika URL (/orchescala/specification.html) - a real page (not a 404) that redirects,
    // so links and search results to it keep working
    const legacyFile = page.outFile.replace(/\/index\.html$/, '.html');
    const legacyPath = path.join(distDir, legacyFile);
    if (legacyFile !== page.outFile && !fs.existsSync(legacyPath)) {
      fs.writeFileSync(legacyPath, redirectPage(page));
    }
  }

  // the markdown sources come along with the content folder (publicDir) - the pages replace them
  for (const file of fs.readdirSync(distDir, {recursive: true})) {
    if (file.endsWith('.md')) fs.rmSync(path.join(distDir, file));
  }
  fs.rmSync(ssrDir, {recursive: true, force: true});
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
