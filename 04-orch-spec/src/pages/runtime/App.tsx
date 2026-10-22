import { Loader2, LogIn, LogOut, Moon, ShieldAlert, Sun } from 'lucide-react';
import type { User } from 'oidc-client-ts';
import { useEffect, useState } from 'react';
import { gateway } from './api';
import { completeLogin, currentUser, login, logout, rolesOf } from './auth';
import { homeParams } from './homeParams';
import PageView from './PageView';
import type { Page, Pages } from './spec';
import { themeStyle } from './theme';
import { appModeKey, cls, effectiveLogo, logoutTitle, rememberMode, storedMode, useTheme } from './ui';

const base = import.meta.env.BASE_URL;

/** One of the roles suffices; without roles anyone with login. Only for display - what a call may do
  * is checked by gateway and worker. */
function mayOpen(roles: string[], has: string[]): boolean {
  return roles.length === 0 || roles.some((r) => has.includes(r));
}

/** The path of the page below the app – `/app/democompany-customer/appointments/book` → `appointments/book`. */
function pagePath(): string {
  const path = window.location.pathname;
  const rel = (path.startsWith(base) ? path.slice(base.length) : path).replace(/^\/+|\/+$/g, '');
  // the browser encodes e.g. umlauts (`%C3%BC`) - the specification does not
  try {
    return decodeURIComponent(rel);
  } catch {
    return rel;
  }
}

type Loaded = { pages: Pages; page?: Page; user: User | null };

export default function App() {
  // the default from last time, until pages.json is there - that way a dark app does not flash light
  const [preferred, setPreferred] = useState<'light' | 'dark' | undefined>(() => storedMode(appModeKey(base)) ?? undefined);
  const { isDark, toggleTheme } = useTheme(preferred);
  const c = cls(isDark);
  const embedded = new URLSearchParams(window.location.search).has('embed');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // a logo of the theme that does not load (404, blocked) - its address: then as without a logo; another
  // logo is tried again, the same one only after reloading the page
  const [failedLogo, setFailedLogo] = useState<string | null>(null);

  useEffect(() => {
    let current = true; // StrictMode: only the run that is still current sets the state
    (async () => {
      const pages: Pages = await fetch(`${base}pages.json`, { cache: 'no-cache' }).then(async (r) => {
        if (!r.ok) {
          const detail = await r.json().then((j) => j?.error as string | undefined).catch(() => undefined);
          throw new Error(`pages.json: ${detail ?? r.status}`);
        }
        return r.json();
      });
      const loggedIn = await completeLogin().catch(() => false); // return from the IdP
      // to the start page - with the parameters of the link, without an IdP response that was not taken over
      if (pagePath() === '' && pages.app.home) {
        const rest = homeParams(window.location.search, loggedIn);
        window.history.replaceState({}, '', `${base}${pages.app.home}${rest ? `?${rest}` : ''}`);
      }
      const page = pages.pages.find((p) => p.path === pagePath());
      // an IdP only for pages with login - a public page does without
      const user = page && (page.access !== 'public' || loggedIn) ? await currentUser().catch(() => null) : null;
      if (!current) return;
      setPreferred(pages.app.theme?.mode);
      rememberMode(appModeKey(base), pages.app.theme?.mode ?? 'light');
      setLoaded({ pages, page, user });
      document.title = [page?.title, pages.app.title].filter(Boolean).join(' · ');
    })().catch((e) => current && setFailure(e instanceof Error ? e.message : String(e)));
    return () => {
      current = false;
    };
  }, []);

  const app = loaded?.pages.app;
  const page = loaded?.page;
  const logo = effectiveLogo(app?.theme?.logo, failedLogo);
  const style = themeStyle(app?.theme, isDark);
  // the background also on the body - otherwise on overscroll and when embedded it is the z9nai background
  const bg = (style as Record<string, string | undefined>)['--orch-bg'];
  useEffect(() => {
    const root = document.documentElement.style;
    if (bg) root.setProperty('--orch-bg', bg);
    else root.removeProperty('--orch-bg');
    return () => void root.removeProperty('--orch-bg'); // do not leave it behind in a page that embeds the app
  }, [bg]);
  const user = loaded?.user;

  let content: React.ReactNode;
  if (failure) content = <Card isDark={isDark} icon={<ShieldAlert size={26} />} title="Die App lädt nicht" text={failure} />;
  else if (!loaded) content = <Spinner isDark={isDark} />;
  else if (!page) content = <Card isDark={isDark} icon={<ShieldAlert size={26} />} title="Seite nicht gefunden" text="Diesen Link gibt es nicht (mehr)." />;
  else if (page.access !== 'public' && !user)
    content = (
      <Card isDark={isDark} icon={<LogIn size={26} />} title={page.title} text="Für diese Seite braucht es eine Anmeldung.">
        <button onClick={() => login()} className={`mt-4 rounded-lg px-4 py-2 text-xs font-bold ${c.btnPrimary}`}>Anmelden</button>
      </Card>
    );
  else if (page.access !== 'public' && user && !mayOpen(page.access.roles, rolesOf(user)))
    content = (
      <Card isDark={isDark} icon={<ShieldAlert size={26} />} title="Keine Berechtigung"
        text={`Dafür braucht es ${page.access.roles.length > 1 ? 'eine der Rollen' : 'die Rolle'} «${page.access.roles.join(', ')}». Bitte beim Admin anfragen.`} />
    );
  else
    content = (
      <PageView key={page.path} page={page} app={app!} isDark={isDark} gateway={gateway}
        user={user ? { name: user.profile.name, email: user.profile.email, roles: rolesOf(user) } : undefined} />
    );

  return (
    <div className={`flex min-h-screen flex-col ${embedded ? '' : c.bg} ${c.text}`} style={style}>
      {!embedded && (
        <div className={`flex flex-shrink-0 items-center gap-3 border-b px-4 py-2 ${c.border} ${c.top}`}>
          {/* the logo only as <img>: an SVG in it runs no script and loads nothing - never insert it inline */}
          {logo
            ? <img src={logo} alt="" onError={() => setFailedLogo(logo)} className="h-7 max-w-28 flex-shrink-0 object-contain sm:max-w-40" />
            : <img src={`${base}favicon.png`} alt="" className="h-6 w-6 flex-shrink-0 opacity-80" />}
          {/* a long title gives way (truncated, the subtitle only from sm on - on the phone there is no room for it) -
              logo, buttons and byline keep their place; the logo narrower on the phone, so that some of the title remains */}
          <span title={app?.title} className={`min-w-0 truncate text-xs font-bold tracking-widest ${c.title}`}>{app?.title ?? ''}</span>
          {app?.subtitle && <span title={app.subtitle} className={`hidden min-w-0 truncate text-[10px] sm:inline ${c.muted}`}>{app.subtitle}</span>}
          <div className="ml-auto flex flex-shrink-0 items-center gap-3">
            {user && (
              <div className={`flex items-center gap-2 text-[11px] ${c.muted}`} title={user.profile.email}>
                {/* the name only from sm on, truncated - on the phone there is not enough room next to logo and buttons */}
                <span className="hidden max-w-[12rem] truncate sm:inline">{user.profile.name ?? user.profile.preferred_username}</span>
                <button onClick={() => logout()} title={logoutTitle(user.profile.name ?? user.profile.preferred_username)}
                  aria-label={logoutTitle(user.profile.name ?? user.profile.preferred_username)}
                  className={`rounded p-1 transition-colors ${c.icon}`}>
                  <LogOut size={12} />
                </button>
              </div>
            )}
            <button onClick={toggleTheme} title={isDark ? 'Hell' : 'Dunkel'} aria-label={isDark ? 'Hell' : 'Dunkel'}
              className={`rounded p-1.5 transition-colors ${c.icon}`}>
              {isDark ? <Sun size={13} /> : <Moon size={13} />}
            </button>
            {/* the name on the link as it is visible - the image next to it is decoration, a screen reader reads it once */}
            <a href="https://z9nai.ch" target="_blank" rel="noopener noreferrer" title="z9nai GmbH" aria-label="by z9nai GmbH"
              className={`${logo ? 'flex' : 'hidden sm:flex'} items-center gap-1.5 text-[10px] whitespace-nowrap opacity-70 transition-opacity hover:opacity-100 ${c.muted}`}>
              {/* without its own logo the app already shows the z9nai one on the left: then only the text, and below sm
                  nothing at all - next to the user and button there is no room for it */}
              <span className={logo ? 'hidden sm:inline' : ''}>by z9nai GmbH</span>
              {logo && <img src={`${base}favicon.png`} alt="" className="h-5 w-5" />}
            </a>
          </div>
        </div>
      )}
      <div className="flex-1">{content}</div>
    </div>
  );
}

function Spinner({ isDark }: { isDark: boolean }) {
  return (
    <div className={`flex h-64 items-center justify-center ${cls(isDark).muted}`}>
      <Loader2 size={16} className="animate-spin" />
    </div>
  );
}

function Card({ isDark, icon, title, text, children }: {
  isDark: boolean; icon: React.ReactNode; title: string; text: string; children?: React.ReactNode;
}) {
  const c = cls(isDark);
  return (
    <div className="flex justify-center p-6 pt-16">
      <div className={`w-full max-w-md rounded-xl border p-8 text-center ${c.border} ${c.panel}`}>
        <div className={`mx-auto mb-4 flex justify-center ${c.muted}`}>{icon}</div>
        <div className="text-sm font-bold">{title}</div>
        <p className={`mt-2 text-xs ${c.muted2}`}>{text}</p>
        {children}
      </div>
    </div>
  );
}
