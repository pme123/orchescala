// Standalone entry: renders ONLY the API view of the project it is deployed
// next to — `api.html` + `assets/` beside an `OpenApi.yml` (+ `diagrams/`),
// no company docs.json needed. This is the modern replacement for the Redoc
// shell that each project uploads as OpenApi.html.
//
// Deep links: `#op=<operationId>` — and Redoc-style `#operation/<id>` anchors
// from existing catalog/site links keep working.
import { Moon, Sun } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
// imported (not `public/`) so the single-file build inlines it — the page ships without assets
import favicon from './assets/favicon.png';
import ApiDoc from './components/ApiDoc';
import './index.css';
import type { CompanyDocs } from './types';
import { cls } from './ui';

// The page's own file name decides the yml: `OpenApi.html` -> `OpenApi.yml`,
// `PostmanOpenApi.html` -> `PostmanOpenApi.yml` (the same html is written as both by
// `./helper.scala update`). Anything else (dev server `api.html`) falls back to OpenApi.yml.
const htmlName = window.location.pathname.split('/').pop() ?? '';
const apiDocUrl = /^[\w-]+\.html$/.test(htmlName) && htmlName !== 'api.html' ? htmlName : 'OpenApi.html';

// minimal synthetic docs — everything the API view needs to resolve the yml next to the page
const docs: CompanyDocs = {
  company: '.', title: 'API Documentation',
  release: { tag: '', released: true, createdDay: '', notes: '', olderReleases: [] },
  groups: [],
  projects: [{ name: 'project', group: '', color: 'white', apiDocUrl, hasDependencies: false }],
  graph: [], dependencies: [], releaseTables: [], releaseNotes: [], catalog: [], devStats: [], pages: [],
};

const opFromHash = () => {
  const h = window.location.hash;
  if (h.startsWith('#operation/')) return decodeURIComponent(h.slice('#operation/'.length));
  return new URLSearchParams(h.replace(/^#\??/, '')).get('op') ?? undefined;
};

function StandaloneApp() {
  const [isDark, setIsDark] = useState(() => localStorage.getItem('orch-doc:theme') === 'dark'
    || (!localStorage.getItem('orch-doc:theme') && window.matchMedia('(prefers-color-scheme: dark)').matches));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('orch-doc:theme', isDark ? 'dark' : 'light');
  }, [isDark]);
  // the tab icon from the inlined image - no favicon.png next to the page in the single-file case
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(document.createElement('link'));
    link.rel = 'icon'; link.type = 'image/png'; link.href = favicon;
  }, []);
  const [op, setOp] = useState(opFromHash);
  useEffect(() => {
    const on = () => setOp(opFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const c = cls(isDark);
  return (
    <div className={`min-h-screen flex flex-col ${c.bg} ${c.text}`}>
      <div className={`flex items-center gap-3 px-4 py-2 border-b ${c.border} ${c.top} sticky top-0 z-20`}>
        <img src={favicon} alt="" className="w-6 h-6 opacity-80" />
        <span className={`text-xs font-bold tracking-widest ${isDark ? 'text-white/70' : 'text-black/70'}`}>API Documentation</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setIsDark(d => !d)} title="Toggle theme"
            className={`p-1.5 rounded transition-colors ${isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'}`}>
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
          </button>
          <a href="https://z9nai.ch" target="_blank" rel="noopener noreferrer" title="z9nai GmbH"
            className={`flex items-center gap-2 text-[10px] whitespace-nowrap opacity-70 hover:opacity-100 transition-opacity ${c.muted2}`}>
            <span className="hidden lg:inline">by z9nai GmbH</span>
          </a>
        </div>
      </div>
      <main className="flex-1 min-w-0 px-4 sm:px-8 py-6 max-w-[1200px] xl:max-w-[1500px] 2xl:max-w-[1800px]">
        <ApiDoc docs={docs} isDark={isDark} project="project" op={op} standalone
          onSelectOp={id => { window.location.hash = `#op=${encodeURIComponent(id)}`; }} />
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><StandaloneApp /></React.StrictMode>
);
