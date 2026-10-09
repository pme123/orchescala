import { Loader2, LogIn, LogOut, Moon, ShieldAlert, Sun } from 'lucide-react';
import type { User } from 'oidc-client-ts';
import { useEffect, useState } from 'react';
import { gateway } from './api';
import { completeLogin, currentUser, login, logout, rolesOf } from './auth';
import { homeParams } from './homeParams';
import PageView from './PageView';
import type { Page, Pages } from './spec';
import { themeStyle } from './theme';
import { appModeKey, cls, rememberMode, storedMode, useTheme } from './ui';

const base = import.meta.env.BASE_URL;

/** Eine der Rollen genügt; ohne Rollen jeder mit Login. Nur für die Anzeige - was ein Aufruf darf,
  * prüfen Gateway und Worker. */
function mayOpen(roles: string[], has: string[]): boolean {
  return roles.length === 0 || roles.some((r) => has.includes(r));
}

/** Der Pfad der Seite unter der App – `/app/democompany-customer/appointments/book` → `appointments/book`. */
function pagePath(): string {
  const path = window.location.pathname;
  const rel = (path.startsWith(base) ? path.slice(base.length) : path).replace(/^\/+|\/+$/g, '');
  // der Browser kodiert z.B. Umlaute (`%C3%BC`) - die Spezifikation nicht
  try {
    return decodeURIComponent(rel);
  } catch {
    return rel;
  }
}

type Loaded = { pages: Pages; page?: Page; user: User | null };

export default function App() {
  // die Vorgabe vom letzten Mal, bis pages.json da ist - eine dunkle App blitzt so nicht hell auf
  const [preferred, setPreferred] = useState<'light' | 'dark' | undefined>(() => storedMode(appModeKey(base)) ?? undefined);
  const { isDark, toggleTheme } = useTheme(preferred);
  const c = cls(isDark);
  const embedded = new URLSearchParams(window.location.search).has('embed');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // ein Logo des Themes, das nicht lädt (404, blockiert) - seine Adresse: dann wie ohne Logo; ein anderes
  // Logo wird wieder versucht, dasselbe erst nach dem Neuladen der Seite
  const [failedLogo, setFailedLogo] = useState<string | null>(null);

  useEffect(() => {
    let current = true; // StrictMode: nur der Lauf, der noch gilt, setzt den Zustand
    (async () => {
      const pages: Pages = await fetch(`${base}pages.json`, { cache: 'no-cache' }).then(async (r) => {
        if (!r.ok) {
          const detail = await r.json().then((j) => j?.error as string | undefined).catch(() => undefined);
          throw new Error(`pages.json: ${detail ?? r.status}`);
        }
        return r.json();
      });
      const loggedIn = await completeLogin().catch(() => false); // Rückkehr vom IdP
      // zur Startseite - mit den Parametern des Links, ohne eine Antwort des IdP, die nicht übernommen wurde
      if (pagePath() === '' && pages.app.home) {
        const rest = homeParams(window.location.search, loggedIn);
        window.history.replaceState({}, '', `${base}${pages.app.home}${rest ? `?${rest}` : ''}`);
      }
      const page = pages.pages.find((p) => p.path === pagePath());
      // ein IdP nur für Seiten mit Login - eine öffentliche Seite kommt ohne aus
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
  const logo = app?.theme?.logo && app.theme.logo !== failedLogo ? app.theme.logo : undefined;
  const style = themeStyle(app?.theme, isDark);
  // der Hintergrund auch am body - beim Überscrollen und eingebettet ist er sonst der z9nai-Hintergrund
  const bg = (style as Record<string, string | undefined>)['--orch-bg'];
  useEffect(() => {
    const root = document.documentElement.style;
    if (bg) root.setProperty('--orch-bg', bg);
    else root.removeProperty('--orch-bg');
    return () => void root.removeProperty('--orch-bg'); // nicht in einer Seite zurücklassen, die die App einbettet
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
          {/* das Logo nur als <img>: ein SVG darin führt kein Skript aus und lädt nichts - nie inline einsetzen */}
          {logo
            ? <img src={logo} alt="" onError={() => setFailedLogo(logo)} className="h-7 max-w-40 object-contain" />
            : <img src={`${base}favicon.png`} alt="" className="h-6 w-6 opacity-80" />}
          {/* ein langer Titel weicht (gekürzt, der Untertitel erst ab md) - Knöpfe und Byline behalten ihren Platz */}
          <span title={app?.title} className={`min-w-0 truncate text-xs font-bold tracking-widest ${c.title}`}>{app?.title ?? ''}</span>
          {app?.subtitle && <span title={app.subtitle} className={`hidden min-w-0 truncate text-[10px] md:inline ${c.muted}`}>{app.subtitle}</span>}
          <div className="ml-auto flex flex-shrink-0 items-center gap-3">
            {user && (
              <div className={`flex items-center gap-2 text-[11px] ${c.muted}`} title={user.profile.email}>
                <span>{user.profile.name ?? user.profile.preferred_username}</span>
                <button onClick={() => logout()} title="Abmelden" className={`rounded p-1 transition-colors ${c.icon}`}>
                  <LogOut size={12} />
                </button>
              </div>
            )}
            <button onClick={toggleTheme} title={isDark ? 'Hell' : 'Dunkel'} className={`rounded p-1.5 transition-colors ${c.icon}`}>
              {isDark ? <Sun size={13} /> : <Moon size={13} />}
            </button>
            {/* der Name am Link, wie er sichtbar ist - das Bild daneben ist Schmuck, ein Screenreader liest ihn einmal */}
            <a href="https://z9nai.ch" target="_blank" rel="noopener noreferrer" title="z9nai GmbH" aria-label="by z9nai GmbH"
              className={`${logo ? 'flex' : 'hidden sm:flex'} items-center gap-1.5 text-[10px] whitespace-nowrap opacity-70 transition-opacity hover:opacity-100 ${c.muted}`}>
              {/* ohne eigenes Logo zeigt die App links schon das von z9nai: dann nur der Text, und unter sm
                  gar nichts - neben Benutzer und Knopf ist dort kein Platz für ihn */}
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
