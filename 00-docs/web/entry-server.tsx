import {renderToStaticMarkup} from 'react-dom/server';
import App from './App';
import {allDocs, docUrl, findDoc, loadProblems} from './docs';
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
 * Checks all pages before they are written: broken includes, links to pages, files or anchors that
 * do not exist, missing images and navigation entries without a page are errors (the build fails); a page
 * without a description and a code block in a language without highlighting are warnings.
 */
export function check(): {errors: string[]; warnings: string[]} {
  const errors = [...loadProblems];
  const warnings: string[] = [];
  for (const doc of allDocs) {
    const {problems, warnings: pageWarnings, anchorLinks} = renderDoc(doc);
    errors.push(...problems.map(p => `${doc.id}: ${p}`));
    for (const link of anchorLinks) {
      const target = findDoc(link.doc);
      if (target && !renderDoc(target).ids.includes(link.id)) {
        errors.push(`${doc.id}: link ${link.href} - ${link.doc} has no heading or anchor #${link.id}`);
      }
    }
    warnings.push(...pageWarnings.map(w => `${doc.id}: ${w}`));
    if (doc.id !== 'index' && !doc.description) warnings.push(`${doc.id}: no description - add a paragraph of text at the top`);
  }
  return {errors: [...new Set(errors)], warnings: [...new Set(warnings)]};
}
