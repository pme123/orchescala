import React from 'react';
import {ChevronLeft, ChevronRight, Menu, Moon, Pencil, Sun, X} from 'lucide-react';
import {allDocs, assetUrl, base, type Doc, docIdOf, docUrl, findDoc, sections, version} from './docs';
import {renderDoc, type TocEntry} from './markdown';
import z9naiLogo from './z9nai-logo.png';

const GITHUB_URL = 'https://github.com/pme123/orchescala';
const logo = assetUrl('images/orchescala_icon.png');

// Footer: when this version of the site was built (= published)
// Swiss time - the same in the prerendered page (built on CI in UTC) and in every browser
const BUILD_LABEL = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
  .format(new Date(__BUILD_TIME__))
  .replace(',', '');

// ── Theme ──────────────────────────────────────────────────────────────────
const ThemeContext = React.createContext<{isDark: boolean; toggle: () => void}>({
  isDark: true,
  toggle: () => {},
});
const useTheme = () => React.useContext(ThemeContext);

const ThemeToggle = () => {
  const {isDark, toggle} = useTheme();
  return (
    <button
      onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="inline-flex items-center gap-1.5 focus:outline-none group cursor-pointer"
    >
      <Sun
        className={`w-3.5 h-3.5 transition-colors duration-300 ${
          isDark ? 'text-white/25 group-hover:text-white/60' : 'text-amber-500 group-hover:text-amber-600'
        }`}
      />
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-300 ${
          isDark ? 'bg-white/20 group-hover:bg-white/35' : 'bg-black/15 group-hover:bg-black/25'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full shadow transition-transform duration-300 ${
            isDark ? 'translate-x-1 bg-white' : 'translate-x-[18px] bg-gray-700'
          }`}
        />
      </span>
      <Moon
        className={`w-3.5 h-3.5 transition-colors duration-300 ${
          isDark ? 'text-white group-hover:text-white' : 'text-black/25 group-hover:text-black/55'
        }`}
      />
    </button>
  );
};

const GithubIcon = ({className}: {className?: string}) => (
  <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

// ── Navigation ────────────────────────────────────────────────────────────
type Navigate = (href: string) => void;

const NavLink = ({doc, active, navigate}: {doc: Doc; active: boolean; navigate: Navigate}) => {
  const {isDark} = useTheme();
  const href = docUrl(doc.id);
  return (
    <a
      href={href}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(href);
      }}
      className={`block py-1.5 pl-3 border-l text-[13px] font-mono transition-colors ${
        active
          ? isDark
            ? 'border-orange-400 text-white'
            : 'border-orange-500 text-gray-900'
          : isDark
            ? 'border-white/10 text-white/50 hover:text-white hover:border-white/40'
            : 'border-black/10 text-black/50 hover:text-black hover:border-black/40'
      }`}
    >
      {doc.title}
    </a>
  );
};

const SideNav = ({current, navigate}: {current: string; navigate: Navigate}) => {
  const {isDark} = useTheme();
  return (
    <nav className="space-y-8">
      {sections.map((section, i) => (
        <div key={section.title}>
          <div
            className={`text-[10px] font-mono uppercase tracking-[0.3em] mb-3 ${
              isDark ? 'text-white/40' : 'text-black/40'
            }`}
          >
            {String(i + 1).padStart(2, '0')} // {section.title}
          </div>
          {section.docs.map(doc => (
            <NavLink key={doc.id} doc={doc} active={doc.id === current} navigate={navigate} />
          ))}
        </div>
      ))}
    </nav>
  );
};

const Toc = ({toc}: {toc: TocEntry[]}) => {
  const {isDark} = useTheme();
  if (toc.length < 2) return null;
  return (
    <nav>
      <div
        className={`text-[10px] font-mono uppercase tracking-[0.3em] mb-3 ${isDark ? 'text-white/40' : 'text-black/40'}`}
      >
        On this page
      </div>
      {toc.map(entry => (
        <a
          key={entry.id}
          href={`#${entry.id}`}
          className={`block py-1 text-xs font-mono transition-colors ${entry.level === 3 ? 'pl-3' : ''} ${
            isDark ? 'text-white/45 hover:text-white' : 'text-black/45 hover:text-black'
          }`}
        >
          {entry.text}
        </a>
      ))}
    </nav>
  );
};

// ── Layout ────────────────────────────────────────────────────────────────
const Header = ({navigate, onMenu, menuOpen}: {navigate: Navigate; onMenu: () => void; menuOpen: boolean}) => {
  const {isDark} = useTheme();
  const [hovered, setHovered] = React.useState(false);
  return (
    <header
      className={`border-b backdrop-blur-md sticky top-0 z-50 ${
        isDark ? 'border-white/10 bg-[#191a1c]/90' : 'border-black/10 bg-[#f5f4f0]/90'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onMenu}
            className={`lg:hidden p-1 -ml-1 cursor-pointer ${isDark ? 'text-white/60' : 'text-black/60'}`}
            aria-label="Menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <a
            href={base}
            onClick={e => {
              e.preventDefault();
              navigate(base);
            }}
            className="flex items-center gap-3 min-w-0"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {logo && <img src={logo} alt="" className="w-9 h-9 shrink-0" />}
            <span
              className={`font-mono font-bold text-xl tracking-tighter transition-all duration-200 ${
                hovered
                  ? isDark
                    ? 'text-white'
                    : 'text-gray-900'
                  : 'text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-violet-500'
              }`}
            >
              Orchescala
            </span>
          </a>
          <span
            className={`hidden sm:inline text-[10px] font-mono tracking-widest px-2 py-0.5 rounded border ${
              isDark ? 'border-white/10 text-white/40' : 'border-black/10 text-black/40'
            }`}
          >
            v{version}
          </span>
        </div>
        <div className="flex items-center gap-5">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Orchescala on GitHub"
            className={`transition-colors ${isDark ? 'text-white/50 hover:text-white' : 'text-black/45 hover:text-black'}`}
          >
            <GithubIcon className="w-5 h-5" />
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
};

const PrevNext = ({doc, navigate}: {doc: Doc; navigate: Navigate}) => {
  const {isDark} = useTheme();
  const i = allDocs.findIndex(d => d.id === doc.id);
  const prev = i > 0 ? allDocs[i - 1] : undefined;
  const next = i >= 0 && i < allDocs.length - 1 ? allDocs[i + 1] : undefined;
  const link = (d: Doc, dir: 'prev' | 'next') => (
    <a
      href={docUrl(d.id)}
      onClick={e => {
        e.preventDefault();
        navigate(docUrl(d.id));
      }}
      className={`flex-1 rounded-xl border p-4 transition-colors ${dir === 'next' ? 'text-right' : ''} ${
        isDark ? 'border-white/10 hover:border-white/30' : 'border-black/10 hover:border-black/30'
      }`}
    >
      <div
        className={`text-[10px] font-mono uppercase tracking-[0.25em] mb-1 flex items-center gap-1 ${
          dir === 'next' ? 'justify-end' : ''
        } ${isDark ? 'text-white/35' : 'text-black/35'}`}
      >
        {dir === 'prev' && <ChevronLeft className="w-3 h-3" />}
        {dir === 'prev' ? 'Previous' : 'Next'}
        {dir === 'next' && <ChevronRight className="w-3 h-3" />}
      </div>
      <div className={`font-mono text-sm ${isDark ? 'text-white/80' : 'text-black/80'}`}>{d.title}</div>
    </a>
  );
  return (
    <div className="flex flex-col sm:flex-row gap-4 mt-10">
      {prev ? link(prev, 'prev') : <div className="flex-1 hidden sm:block" />}
      {next ? link(next, 'next') : <div className="flex-1 hidden sm:block" />}
    </div>
  );
};

const Footer = ({doc}: {doc?: Doc}) => {
  const {isDark} = useTheme();
  const faint = isDark ? 'text-white/25' : 'text-black/35';
  const link = isDark ? 'text-white/25 hover:text-white/60' : 'text-black/35 hover:text-black/65';
  const sep = <span className={isDark ? 'text-white/10' : 'text-black/15'}>//</span>;
  return (
    <footer className={`py-10 px-6 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-4 justify-between items-start md:items-center text-[10px] font-mono tracking-widest">
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${faint}`}>
          <span>© pme123 // MIT License</span>
          {sep}
          <span title={`Orchescala ${version}`}>v{version}</span>
          {sep}
          <span title={`Build ${__BUILD_TIME__}${__BUILD_COMMIT__ ? ` · Commit ${__BUILD_COMMIT__}` : ''}`}>
            {import.meta.env.DEV
              ? 'local development'
              : `built ${BUILD_LABEL}${__BUILD_COMMIT__ ? ` · ${__BUILD_COMMIT__}` : ''}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {doc && (
            <>
              <a
                href={`${GITHUB_URL}/blob/develop/00-docs/src/docs/${doc.id}.md`}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 uppercase transition-colors ${link}`}
              >
                <Pencil className="w-3 h-3" /> Source of this page
              </a>
              {sep}
            </>
          )}
          <a
            href="https://z9nai.ch"
            target="_blank"
            rel="noopener noreferrer"
            title="z9nai GmbH - to the website"
            className={`inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${link}`}
          >
            by z9nai GmbH
            <img src={z9naiLogo} alt="" className="w-4 h-4 opacity-80" />
          </a>
        </div>
      </div>
    </footer>
  );
};

const NotFound = ({navigate}: {navigate: Navigate}) => (
  <article className="markdown-body">
    <h1>Page not found</h1>
    <p>
      This page does not exist (anymore).{' '}
      <a
        href={base}
        onClick={e => {
          e.preventDefault();
          navigate(base);
        }}
      >
        Back to the start page
      </a>
      .
    </p>
  </article>
);

const sectionOf = (doc: Doc) => {
  const i = sections.findIndex(s => s.docs.some(d => d.id === doc.id));
  return i < 0 ? undefined : {index: String(i + 1).padStart(2, '0'), title: sections[i].title};
};

/** Letters and digits only - `input--output-variables` (now) matches `input-output-variables` (Laika). */
const looseId = (id: string) => id.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The element of an anchor - for old links with Laika's ids also the heading whose id differs only in - and _. */
export function anchorTarget(hash: string): HTMLElement | null {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  if (!id) return null;
  const exact = document.getElementById(id);
  if (exact) return exact;
  const loose = looseId(id);
  return [...document.querySelectorAll<HTMLElement>('[id]')].find(el => looseId(el.id) === loose) ?? null;
}

function scrollToHash(hash: string) {
  const el = anchorTarget(hash);
  if (el) el.scrollIntoView();
  else window.scrollTo(0, 0);
}

// ssrPath lets the prerender build render a page without window.location.
export default function App({ssrPath}: {ssrPath?: string} = {}) {
  const [isDark, setIsDark] = React.useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved) return saved === 'dark';
    } catch {}
    return true;
  });
  const toggleTheme = () =>
    setIsDark(d => {
      const next = !d;
      try {
        localStorage.setItem('theme', next ? 'dark' : 'light');
      } catch {}
      return next;
    });

  const [docId, setDocId] = React.useState(() =>
    docIdOf(ssrPath ?? (typeof window === 'undefined' ? base : window.location.pathname)),
  );
  const [menuOpen, setMenuOpen] = React.useState(false);
  // after a navigation: scroll to the anchor (or the top) once the page is rendered
  const [scrollTarget, setScrollTarget] = React.useState<{hash: string} | null>(null);
  const doc = findDoc(docId);
  const rendered = doc ? renderDoc(doc) : undefined;

  const navigate = React.useCallback<Navigate>(href => {
    const url = new URL(href, window.location.href);
    if (url.pathname !== window.location.pathname) window.history.pushState(null, '', url.pathname + url.hash);
    else if (url.hash) window.history.replaceState(null, '', url.hash);
    setDocId(docIdOf(url.pathname));
    setMenuOpen(false);
    setScrollTarget({hash: url.hash});
  }, []);

  React.useEffect(() => {
    if (scrollTarget) scrollToHash(scrollTarget.hash);
  }, [scrollTarget]);

  // rendered in the visitor's theme - show the page (hidden by index.html for light mode)
  React.useEffect(() => {
    delete document.documentElement.dataset.theme;
  }, []);

  React.useEffect(() => {
    // old Laika URLs (…/specification.html) land here through 404.html - show the new URL
    if (doc && window.location.pathname !== docUrl(doc.id)) {
      window.history.replaceState(null, '', docUrl(doc.id) + window.location.hash);
    }
    if (window.location.hash) setScrollTarget({hash: window.location.hash});
    const onPop = () => {
      setDocId(docIdOf(window.location.pathname));
      setScrollTarget({hash: window.location.hash});
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    document.title = !doc ? 'Page not found | Orchescala' : doc.id === 'index' ? 'Orchescala' : `${doc.title} | Orchescala`;
  }, [doc]);

  // links between pages in the content stay in the app
  const onContentClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a || a.dataset.internal !== 'true' || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(a.getAttribute('href')!);
  };

  const section = doc ? sectionOf(doc) : undefined;
  const border = isDark ? 'border-white/10' : 'border-black/10';

  return (
    <ThemeContext.Provider value={{isDark, toggle: toggleTheme}}>
      <div
        className={`min-h-screen font-sans transition-colors duration-300 ${
          isDark
            ? 'bg-[#191a1c] text-white selection:bg-white selection:text-black'
            : 'light-mode bg-[#f5f4f0] text-gray-900 selection:bg-gray-900 selection:text-white'
        }`}
      >
        <Header navigate={navigate} onMenu={() => setMenuOpen(o => !o)} menuOpen={menuOpen} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-10">
          <aside
            className={`${
              menuOpen ? 'fixed inset-x-0 top-16 bottom-0 z-40 px-6 ' + (isDark ? 'bg-[#191a1c]' : 'bg-[#f5f4f0]') : 'hidden'
            } lg:block lg:static lg:px-0 lg:bg-transparent lg:w-60 shrink-0`}
          >
            <div className="lg:sticky lg:top-16 h-full lg:h-[calc(100vh-4rem)] overflow-y-auto py-10 pr-2">
              <SideNav current={docId} navigate={navigate} />
            </div>
          </aside>
          <main className="flex-1 min-w-0 py-10">
            {section && (
              <div
                className={`text-[10px] font-mono uppercase tracking-[0.3em] mb-6 ${
                  isDark ? 'text-white/40' : 'text-black/40'
                }`}
              >
                {section.index} // {section.title}
              </div>
            )}
            <div
              className={`p-6 md:p-10 rounded-2xl border backdrop-blur-sm ${border} ${
                isDark ? 'bg-white/[0.02]' : 'bg-black/[0.02]'
              }`}
              onClick={onContentClick}
            >
              {rendered ? <article className="markdown-body">{rendered.content}</article> : <NotFound navigate={navigate} />}
            </div>
            {doc && <PrevNext doc={doc} navigate={navigate} />}
          </main>
          <aside className="hidden xl:block w-52 shrink-0">
            <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-10">
              {rendered && <Toc toc={rendered.toc} />}
            </div>
          </aside>
        </div>
        <Footer doc={doc} />
      </div>
    </ThemeContext.Provider>
  );
}
