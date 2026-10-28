import {renderToStaticMarkup} from 'react-dom/server';
import App from './App';
import {allDocs, docUrl} from './docs';

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
