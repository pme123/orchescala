import { AlertTriangle, BookOpen, ChevronDown, ClipboardList, FileText, GitFork, Home, Menu, Moon, PenTool, Sun, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import ApiDoc from './components/ApiDoc';
import Catalog from './components/Catalog';
import Dependencies from './components/Dependencies';
import DevStats from './components/DevStats';
import MdPage from './components/MdPage';
import Overview from './components/Overview';
import Release from './components/Release';
import { useCompanyDocs, useSiteIndex } from './data';
import { href, useRoute, type Route } from './router';
import type { CompanyDocs, CompanyRef, SiteIndex } from './types';
import { Card, Empty, cls } from './ui';

export default function App() {
  const [isDark, setIsDark] = useState(() => localStorage.getItem('orch-doc:theme') === 'dark'
    || (!localStorage.getItem('orch-doc:theme') && window.matchMedia('(prefers-color-scheme: dark)').matches));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('orch-doc:theme', isDark ? 'dark' : 'light');
  }, [isDark]);
  const route = useRoute();
  const company = 'company' in route ? route.company : undefined;
  const site = useSiteIndex();
  const docs = useCompanyDocs(company);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); window.scrollTo({ top: 0 }); }, [route]);
  const c = cls(isDark);
  const siteData = site.state === 'ok' ? site.data : undefined;
  const companyRef = siteData?.companies.find(x => x.id === company) ?? (company ? { id: company, name: company } : undefined);
  const companyName = companyRef?.name ?? company;
  const specUrl = siteData?.specUrl;
  const orchescalaUrl = siteData?.orchescalaUrl ?? 'https://pme123.github.io/orchescala/';
  useEffect(() => {
    document.title = company ? `${companyName} · Process Documentation` : (siteData?.title ?? 'Process Documentation');
  }, [company, companyName, siteData]);

  return (
    <div className={`min-h-screen flex flex-col ${c.bg} ${c.text}`}>
      {/* Top bar: customer (sidebar width) · buttons aligned with the content panels · z9nai */}
      <header className={`border-b ${c.border} ${c.top} sticky top-0 z-20`}>
        <div className="flex items-center">
          {company && (
            <div className="flex items-center gap-2 px-4 py-2 md:w-56 flex-shrink-0">
              <button onClick={() => setNavOpen(o => !o)} className={`md:hidden p-1 ${c.muted}`}>{navOpen ? <X size={14} /> : <Menu size={14} />}</button>
              <CustomerBrand co={companyRef} isDark={isDark} />
            </div>
          )}
          <div className="flex-1 max-w-[1400px] xl:max-w-[1800px] 2xl:max-w-[2200px] px-4 sm:px-8 py-2 flex items-center gap-1.5">
            {!company && (
              <a href={href.home()} className="flex items-center gap-2 mr-auto opacity-80 hover:opacity-100 transition-opacity">
                <img src="favicon.png" alt="Orchescala" className="w-6 h-6 object-contain" />
                <span className={`text-xs font-bold tracking-widest ${isDark ? 'text-white/70' : 'text-black/70'}`}>Orchescala</span>
              </a>
            )}
            {company && <span className={`text-[11px] hidden sm:inline mr-auto ${c.muted}`}>Process Documentation</span>}
            <a href={href.home()} title="All catalogs" className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${route.kind === 'home' ? c.btnActive : c.btn}`}>
              <Home size={12} /><span className="hidden sm:inline">Catalogs</span>
            </a>
            {specUrl && (
              <a href={specUrl} title="Process specifications (Orch Spec) — experimental"
                className={`relative flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 mr-1.5 rounded border ${c.btn}`}>
                <PenTool size={12} /><span className="hidden sm:inline">Spec</span>
                <span className="absolute -top-2 -right-3 rotate-6 text-[7px] leading-none px-1 py-0.5 rounded font-bold uppercase tracking-wider bg-amber-400 text-black shadow">
                  experimental
                </span>
              </a>
            )}
            <a href={orchescalaUrl} target="_blank" rel="noopener noreferrer" title="Orchescala documentation"
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
              <BookOpen size={12} /><span className="hidden sm:inline">Orchescala</span>
            </a>
            <button onClick={() => setIsDark(d => !d)} title="Toggle theme"
              className={`p-1.5 rounded transition-colors ${isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'}`}>
              {isDark ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          </div>
          <a href="https://z9nai.ch" target="_blank" rel="noopener noreferrer" title="z9nai GmbH"
            className={`ml-auto flex items-center gap-2 px-4 py-2 text-[10px] whitespace-nowrap opacity-70 hover:opacity-100 transition-opacity ${c.muted2}`}>
            <span className="hidden lg:inline">by z9nai GmbH</span>
            <img src="favicon.png" alt="z9nai" className="w-5 h-5" />
          </a>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {company && docs.state === 'ok' && (
          <Sidebar docs={docs.data} route={route} isDark={isDark} open={navOpen} />
        )}
        <main className="flex-1 min-w-0 px-4 sm:px-8 py-6 max-w-[1400px] xl:max-w-[1800px] 2xl:max-w-[2200px]">
          {route.kind === 'home'
            ? <HomeView site={site} isDark={isDark} />
            : docs.state === 'loading' ? <p className={`text-[11px] ${c.muted}`}>Loading {company} …</p>
            : docs.state === 'error' ? <ErrorBox isDark={isDark} message={docs.message} />
            : <CompanyView docs={docs.data} route={route} isDark={isDark} />}
        </main>
      </div>
    </div>
  );
}

function CustomerBrand({ co, isDark }: { co?: CompanyRef; isDark: boolean }) {
  const c = cls(isDark);
  if (!co) return null;
  const inner = <>
    {co.logo && <img src={co.logo} alt={co.name} className="h-6 max-w-[7rem] object-contain" />}
    <span className={`text-xs font-bold tracking-widest truncate ${isDark ? 'text-white/70' : 'text-black/70'}`}>{co.name}</span>
  </>;
  const k = `flex items-center gap-2 min-w-0 opacity-90 hover:opacity-100 transition-opacity ${c.text}`;
  return co.url
    ? <a href={co.url} target="_blank" rel="noopener noreferrer" title={co.url} className={k}>{inner}</a>
    : <a href={href.overview(co.id)} className={k}>{inner}</a>;
}

function ErrorBox({ message, isDark }: { message: string; isDark: boolean }) {
  return (
    <div className={`max-w-md rounded-xl border p-6 ${isDark ? 'border-rose-500/30 bg-rose-500/5' : 'border-rose-300 bg-rose-50'}`}>
      <AlertTriangle size={20} className={`mb-3 ${isDark ? 'text-rose-400' : 'text-rose-600'}`} />
      <p className={`text-xs leading-relaxed ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>{message}</p>
    </div>
  );
}

function HomeView({ site, isDark }: { site: ReturnType<typeof useSiteIndex>; isDark: boolean }) {
  const c = cls(isDark);
  if (site.state === 'loading') return <p className={`text-[11px] ${c.muted}`}>Loading …</p>;
  if (site.state === 'error') return <ErrorBox isDark={isDark} message={`index.json not found — ${site.message}`} />;
  const s: SiteIndex = site.data;
  return (
    <div className="max-w-3xl mx-auto pt-10">
      <h1 className={`text-xl font-bold tracking-tight mb-1 ${c.text}`}>{s.title}</h1>
      <p className={`text-[11px] mb-8 ${c.muted}`}>Find existing processes and workers in our catalogs.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {s.companies.map(co => (
          <Card key={co.id} isDark={isDark} className={`p-5 ${c.hover} transition-colors`}>
            <a href={href.overview(co.id)} className="block">
              <div className="flex items-center gap-2 mb-1">
                {/* the company's logo (00-docs/src/docs/logo.svg|png) - just the name otherwise */}
                {co.logo && <img src={co.logo} alt="" className="h-5 max-w-[5rem] object-contain" />}
                <span className={`text-sm font-bold ${c.text}`}>{co.name}</span>
                {co.release && <span className={`ml-auto text-[10px] ${c.muted}`}>{co.release}</span>}
              </div>
              <p className={`text-[11px] ${c.muted2}`}>Process documentation, release and dependencies.</p>
            </a>
            <div className={`flex gap-3 mt-3 text-[10px]`}>
              <a href={href.catalog(co.id)} className={c.link}>Catalog</a>
              <a href={href.release(co.id)} className={c.link}>Release</a>
              <a href={href.dependencies(co.id)} className={c.link}>Dependencies</a>
            </div>
          </Card>
        ))}
        {!s.companies.length && <Empty isDark={isDark}>No companies in index.json.</Empty>}
      </div>
      {s.specUrl && (
        <p className={`text-[11px] mt-10 ${c.muted}`}>
          New processes are specified in <a href={s.specUrl} className={c.link}>Orch Spec</a> — the specification app.
        </p>
      )}
    </div>
  );
}

function Sidebar({ docs, route, isDark, open }: { docs: CompanyDocs; route: Route; isDark: boolean; open: boolean }) {
  const c = cls(isDark);
  const co = docs.company;
  const is = (kind: Route['kind'], extra?: (r: Route) => boolean) => route.kind === kind && (!extra || extra(route));
  const item = (label: string, h: string, active: boolean, Icon?: typeof Home, sub = false) => (
    <a key={h} href={h} className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] transition-colors ${sub ? 'ml-3' : ''} ${
      active ? (isDark ? 'bg-white/10 text-white' : 'bg-black/8 text-black') : `${c.muted2} ${c.hover}`}`}>
      {Icon && <Icon size={11} className="opacity-70" />}{label}
    </a>
  );
  const sections = [...new Set(docs.pages.map(p => p.section).filter(Boolean))] as string[];
  const [versionsOpen, setVersionsOpen] = useState(false);
  return (
    <aside className={`${open ? 'block' : 'hidden'} md:block w-56 flex-shrink-0 border-r ${c.border} ${c.panel} px-3 py-4 sticky top-[41px] self-start max-h-[calc(100vh-41px)] overflow-y-auto`}>
      {/* Release / version switcher */}
      <div className="relative mb-4 px-2">
        <button onClick={() => setVersionsOpen(o => !o)} className={`flex items-center gap-1.5 text-[11px] ${c.muted2} hover:underline`}>
          Release <b className={c.text}>{docs.release.tag}</b>
          {docs.release.olderReleases.length > 0 && <ChevronDown size={11} />}
        </button>
        {!docs.release.released && <div className={`text-[9px] italic ${c.muted}`}>preview</div>}
        {versionsOpen && docs.release.olderReleases.length > 0 && (
          <div className={`absolute left-2 mt-1 rounded border ${c.border2} ${c.panelStrong} shadow-lg z-10 py-1 min-w-[8rem]`}>
            {docs.release.olderReleases.map(t => (
              <a key={t} href={`${co}/${t}/index.html`} className={`block px-3 py-1 text-[11px] ${c.muted2} ${c.hover}`} title="older release (classic site)">{t}</a>
            ))}
          </div>
        )}
      </div>
      <nav className="space-y-0.5">
        {item('Overview', href.overview(co), is('overview'), Home)}
        {item(`Release ${docs.release.tag}`, href.release(co), is('release'), FileText)}
        {item('Dependencies', href.dependencies(co), is('dependencies'), GitFork)}
        {item('Catalog', href.catalog(co), is('catalog'), BookOpen)}
        {docs.pages.filter(p => !p.section).map(p => item(p.title, href.page(co, p.slug), is('page', r => r.kind === 'page' && r.slug === p.slug)))}
        {docs.devStats.length > 0 && item('Development Statistics', href.devstats(co), is('devstats'), ClipboardList)}
        {sections.map(s => (
          <div key={s} className="pt-3">
            <div className={`px-2 text-[9px] font-bold uppercase tracking-widest mb-1 ${c.muted}`}>{s}</div>
            {docs.pages.filter(p => p.section === s).map(p => item(p.title, href.page(co, p.slug), is('page', r => r.kind === 'page' && r.slug === p.slug), undefined, true))}
          </div>
        ))}
        <div className="pt-3">
          <div className={`px-2 text-[9px] font-bold uppercase tracking-widest mb-1 ${c.muted}`}>Projects</div>
          {[...docs.projects].filter(p => p.hasDependencies).sort((a, b) => a.name.localeCompare(b.name)).map(p =>
            item(p.name, href.dependencies(co, p.name), is('dependencies', r => r.kind === 'dependencies' && r.project === p.name), undefined, true))}
        </div>
      </nav>
    </aside>
  );
}

function CompanyView({ docs, route, isDark }: { docs: CompanyDocs; route: Route; isDark: boolean }) {
  switch (route.kind) {
    case 'overview': return <Overview docs={docs} isDark={isDark} />;
    case 'release': return <Release docs={docs} isDark={isDark} />;
    case 'dependencies': return <Dependencies docs={docs} isDark={isDark} project={route.project} />;
    case 'catalog': return <Catalog docs={docs} isDark={isDark} query={route.query} />;
    case 'api': return <ApiDoc docs={docs} isDark={isDark} project={route.project} op={route.op} />;
    case 'devstats': return <DevStats docs={docs} isDark={isDark} />;
    case 'page': {
      const page = docs.pages.find(p => p.slug === route.slug);
      return page ? <MdPage docs={docs} page={page} isDark={isDark} /> : <Empty isDark={isDark}>Page not found: {route.slug}</Empty>;
    }
    default: return null;
  }
}
