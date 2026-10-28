import {renderToStaticMarkup} from 'react-dom/server';
import App from './App';
import {allDocs, docUrl, includeProblems} from './docs';
import {renderDoc} from './markdown';

const SITE_DESCRIPTION =
  'Orchescala - use your Domain as much as possible in your Process Automation (Camunda 7 and 8, Scala 3).';

// Renders one page to static HTML for the prerender build (see scripts/prerender.mjs).
// No hydration - the client renders again with createRoot; this markup is for crawlers
// and the first paint.
export function render(url: string): string {
  return renderToStaticMarkup(<App ssrPath={url} />);
}

/** All pages to prerender: their URL (with base), output file and head data. */
export function pages() {
  return allDocs.map(doc => ({
    url: docUrl(doc.id),
    outFile: doc.id === 'index' ? 'index.html' : `${doc.id}/index.html`,
    title: doc.id === 'index' ? 'Orchescala' : `${doc.title} | Orchescala`,
    description: doc.id === 'index' ? SITE_DESCRIPTION : doc.description || SITE_DESCRIPTION,
  }));
}

/**
 * Checks all pages before they are written: broken includes, links to pages or files that do not
 * exist and missing images are errors (the build fails); a page without a description a warning.
 */
export function check(): {errors: string[]; warnings: string[]} {
  const errors = [...includeProblems];
  const warnings: string[] = [];
  for (const doc of allDocs) {
    errors.push(...renderDoc(doc).problems.map(p => `${doc.id}: ${p}`));
    if (doc.id !== 'index' && !doc.description) warnings.push(`${doc.id}: no description - add a paragraph of text at the top`);
  }
  return {errors, warnings};
}
