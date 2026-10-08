import { Loader2, LogIn, LogOut, Moon, ShieldAlert, Sun } from 'lucide-react';
import type { User } from 'oidc-client-ts';
import { useEffect, useState } from 'react';
import { gateway } from './api';
import { completeLogin, currentUser, login, logout, rolesOf } from './auth';
import PageView from './PageView';
import type { Page, Pages } from './spec';
import { themeStyle } from './theme';
import { cls, useTheme } from './ui';

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
  const [preferred, setPreferred] = useState<'light' | 'dark' | undefined>();
  const { isDark, toggleTheme } = useTheme(preferred);
  const c = cls(isDark);
  const embedded = new URLSearchParams(window.location.search).has('embed');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

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
      // zur Startseite - mit den Parametern des Links (z.B. ?token=…). An der Wurzel kommt nur der IdP zurück:
      // code/state, die nicht übernommen wurden (z.B. mit «Zurück» auf die alte Rückkehr), nicht mitnehmen
      if (pagePath() === '' && pages.app.home) {
        const params = new URLSearchParams(window.location.search);
        if (!loggedIn) for (const p of ['code', 'state', 'session_state', 'iss']) params.delete(p);
        const rest = params.toString();
        window.history.replaceState({}, '', `${base}${pages.app.home}${rest ? `?${rest}` : ''}`);
      }
      const page = pages.pages.find((p) => p.path === pagePath());
      // ein IdP nur für Seiten mit Login - eine öffentliche Seite kommt ohne aus
      const user = page && (page.access !== 'public' || loggedIn) ? await currentUser().catch(() => null) : null;
      if (!current) return;
      setPreferred(pages.app.theme?.mode);
      setLoaded({ pages, page, user });
      document.title = [page?.title, pages.app.title].filter(Boolean).join(' · ');
    })().catch((e) => current && setFailure(e instanceof Error ? e.message : String(e)));
    return () => {
      current = false;
    };
  }, []);

  const app = loaded?.pages.app;
  const page = loaded?.page;
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
    <div className={`flex min-h-screen flex-col ${embedded ? '' : c.bg} ${c.text}`} style={themeStyle(app?.theme, isDark)}>
      {!embedded && (
        <div className={`flex flex-shrink-0 items-center gap-3 border-b px-4 py-2 ${c.border} ${c.top}`}>
          {app?.theme?.logo
            ? <img src={app.theme.logo} alt="" className="h-7 max-w-40 object-contain" />
            : <img src={`${base}favicon.png`} alt="" className="h-6 w-6 opacity-80" />}
          <span className={`text-xs font-bold tracking-widest ${c.title}`}>{app?.title ?? ''}</span>
          {app?.subtitle && <span className={`text-[10px] ${c.muted}`}>{app.subtitle}</span>}
          <div className="ml-auto flex items-center gap-3">
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
