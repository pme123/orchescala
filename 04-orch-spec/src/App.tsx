import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { C7_LABEL, C8_LABEL } from './engineLabels';
import { Sun, Moon, FolderOpen, AlertTriangle, Wrench, LogIn, LogOut, ShieldCheck, Cloud, KeyRound, BookOpen, Loader2, Undo2, SquareFunction, AppWindow, Workflow, Sparkles } from 'lucide-react';
import { SettingsDialog } from './ai/SettingsDialog';
import { aiEnabled, useAiKey } from './ai/key';
import { useStore } from './store';
import { APP_VERSION } from './version';
import { GUID_RE, useAuth, usePermissions } from './auth';
import ProcessesView from './components/ProcessesView';
import ProcessView from './components/ProcessView';
import { GuidField, MicrosoftMark, StartCard, StartDialog, StartOption, initialsOf } from './components/StartCard';
import { AccountChip, HeaderButton } from './components/Header';
import FeelCheatSheet from './components/FeelCheatSheet';
// the pages (E15) only load when someone opens them - the designer including the renderer is a separate chunk
// The administration (catalog, patterns, theme …) is rarely needed — like the
// pages a separate chunk that only loads on opening; the main chunk stays below the limit
const AdminView = lazy(() => import('./components/AdminView'));
const PagesView = lazy(() => import('./pages/designer/PagesView'));
const PageEditor = lazy(() => import('./pages/designer/PageEditor'));
import { cls } from './ui';
import { CompanyFolderHint, useCompanyFolder } from './companyFolder';

type View = { kind: 'list' } | { kind: 'spec'; slug: string; commentId?: string; stepId?: string } | { kind: 'admin' }
  | { kind: 'pages' } | { kind: 'page'; slug: string; aiPrompt?: string; commentId?: string; notice?: string };

// Deep link (?spec=<slug>&comment=<id> or ?page=<slug>&comment=<id> for a page, see util.deepLink): on start take it from
// the URL and remember it in the tab — so it survives the login redirect — and
// redeem it as soon as folder and model.json are there.
const DEEP_LINK_KEY = 'orch-spec.deepLink';
type DeepLink = { slug: string; commentId?: string; page?: boolean };
function takeDeepLink(): DeepLink | null {
  try {
    const u = new URL(window.location.href);
    const page = (u.searchParams.get('page') ?? '').trim();
    const slug = page || (u.searchParams.get('spec') ?? '').trim();
    const commentId = (u.searchParams.get('comment') ?? '').trim();
    if (slug) {
      u.searchParams.delete('spec'); u.searchParams.delete('page'); u.searchParams.delete('comment');
      window.history.replaceState(null, '', u.toString());
      const link: DeepLink = { slug, ...(commentId ? { commentId } : {}), ...(page ? { page: true } : {}) };
      sessionStorage.setItem(DEEP_LINK_KEY, JSON.stringify(link));
      return link;
    }
    const stored = sessionStorage.getItem(DEEP_LINK_KEY);
    return stored ? JSON.parse(stored) as DeepLink : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [feelOpen, setFeelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const aiOn = aiEnabled(useAiKey());
  const companyFolder = useCompanyFolder();
  const { isDark, toggleTheme, storage, pickDirectory, savedHandleName, reconnectDirectory, model, modelError,
    savedSharePoint, pendingFolder, rememberFolderLink, connectPendingFolder, folderLinkError, clearFolderLinkError, reconnectSharePoint, forgetSharePoint, disconnect, previousStorage, resumePrevious } = useStore();
  const [spOpen, setSpOpen] = useState(false);
  const [spLink, setSpLink] = useState('');
  const [spBusy, setSpBusy] = useState(false);
  const [spError, setSpError] = useState('');
  const auth = useAuth();
  const { canAdmin, canView, level } = usePermissions();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [deepLink] = useState(takeDeepLink);
  const deepLinkUsed = useRef(false);
  useEffect(() => {
    if (!deepLink || deepLinkUsed.current || !storage || !model) return;
    deepLinkUsed.current = true;
    try { sessionStorage.removeItem(DEEP_LINK_KEY); } catch { /* ignore */ }
    setView(deepLink.page
      ? { kind: 'page', slug: deepLink.slug, ...(deepLink.commentId ? { commentId: deepLink.commentId } : {}) }
      : { kind: 'spec', slug: deepLink.slug, ...(deepLink.commentId ? { commentId: deepLink.commentId } : {}) });
  }, [deepLink, storage, model]);
  const dirHandle = storage; // Short name: connected storage (local or SharePoint)
  // Login active and not yet logged in → gate; admin only with the role.
  // First the folder, then the login: whether it is needed is said by the model.json
  // of the folder, and for the SharePoint folder the start card itself leads in.
  // That is why without a folder the start card is shown, not the gate.
  const needsLogin = auth.status !== 'disabled' && auth.status !== 'signedIn';
  const gated = needsLogin && !!dirHandle;

  // SharePoint: first the link, then the login. The link is remembered before
  // going to Microsoft — after the return the store connects it. If you are
  // already logged in, it connects right here.
  const doConnectSharePoint = async () => {
    const link = spLink.trim();
    if (!link) return;
    setSpBusy(true); setSpError('');
    rememberFolderLink(link);
    const r = await auth.loginForSharePoint();
    if (r === 'setup') { setSpBusy(false); setSpOpen(false); setSetupError(''); setSetupOpen(true); return; }
    if (r !== 'ready') { setSpBusy(false); return; } // Redirect to Microsoft in progress
    const res = await connectPendingFolder();
    setSpBusy(false);
    if (res && !res.ok) { setSpError(res.message); return; }
    setSpOpen(false); setSpLink('');
  };
  // not connected after returning from login → show link and error again
  useEffect(() => {
    if (!folderLinkError) return;
    setSpLink(folderLinkError.link); setSpError(folderLinkError.message); setSpOpen(true);
    clearFolderLinkError();
  }, [folderLinkError, clearFolderLinkError]);
  // Remembered folder or one from a link: log in, then go in.
  // Otherwise the link dialog first — login happens when connecting.
  const [spPreparing, setSpPreparing] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupTenant, setSetupTenant] = useState('');
  const [setupClient, setSetupClient] = useState('');
  const [setupError, setSetupError] = useState('');
  const startSharePoint = async () => {
    if (!pendingFolder && !savedSharePoint) { setSpError(''); setSpOpen(true); return; }
    setSpPreparing(true);
    try {
      const r = await auth.loginForSharePoint();
      // Folder from the link or remembered folder → straight in; otherwise ask for the link
      if (r === 'ready') {
        const link = pendingFolder;
        if (link) {
          const res = await connectPendingFolder();
          if (res && !res.ok) { setSpError(res.message); setSpLink(link); setSpOpen(true); }
        } else if (savedSharePoint) await reconnectSharePoint();
      }
      else if (r === 'setup') { setSetupError(''); setSetupOpen(true); }
    } finally {
      setSpPreparing(false);
    }
  };
  const saveSetup = async () => {
    const t = setupTenant.trim(), c = setupClient.trim();
    if (!GUID_RE.test(t) || !GUID_RE.test(c)) { setSetupError('Beide IDs müssen gültige GUIDs sein (Format 8-4-4-4-12).'); return; }
    auth.setLocalIds(t, c);
    setSetupOpen(false);
    // straight on to the login
    setTimeout(() => { void startSharePoint(); }, 50);
  };

  const denied = auth.status === 'signedIn' && !canView && !!dirHandle;

  // Docs button: only show it if there actually is an index.html one level above
  // the app (the app is mounted under /orch-spec/ into a docs page
  // — locally or without a surrounding page there is none).
  const [docHref, setDocHref] = useState<string | null>(null);
  useEffect(() => {
    // Resolve against the document URL, not the origin — with a relative
    // build base ('./') BASE_URL would otherwise wrongly point to the site root.
    const appBase = new URL(import.meta.env.BASE_URL, document.baseURI);
    const doc = new URL('../index.html', appBase);
    if (doc.pathname === new URL('index.html', appBase).pathname) return; // App already lives in the root
    let gone = false;
    fetch(doc.href, { method: 'HEAD' }).then(r => {
      // A redirect back into the app (as e.g. the dev server does) is not a hit
      const backIntoApp = new URL(r.url).pathname.startsWith(appBase.pathname);
      if (!gone && r.ok && !backIntoApp && (r.headers.get('content-type') ?? '').includes('text/html')) setDocHref(doc.href);
    }).catch(() => {});
    return () => { gone = true; };
  }, []);

  // Login configuration comes from the model.json of the shared folder
  const applyConfig = auth.applyConfig;
  useEffect(() => { if (model) applyConfig(model.auth); }, [model, applyConfig]);

  const c = cls(isDark);
  // For which folder the login is — and the way to another one
  const folderOfGate = dirHandle && (
    <div className={`flex items-center gap-2 rounded border px-3 py-2 mb-3 ${c.border2}`}>
      <span className={c.muted2}>{dirHandle.kind === 'sharepoint' ? <Cloud size={12} /> : <FolderOpen size={12} />}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-xs font-semibold truncate ${c.text}`}>{dirHandle.name}</span>
        <span className={`block text-[10px] truncate ${c.muted}`} title={dirHandle.webUrl}>
          {dirHandle.kind === 'sharepoint' ? dirHandle.webUrl ?? 'SharePoint-Ordner' : 'lokaler Ordner'}
        </span>
      </span>
      <button onClick={() => { disconnect(); setView({ kind: 'list' }); }}
        className={`text-[10px] flex-shrink-0 ${c.muted} hover:underline`}>anderer Ordner</button>
    </div>
  );

  const bg = isDark ? 'bg-[#0e0f11]' : 'bg-[#f5f4f0]';
  const border = isDark ? 'border-white/8' : 'border-black/8';
  const topBg = isDark ? 'bg-[#0c0d0f]' : 'bg-[#eae9e5]';
  const textBase = isDark ? 'text-white' : 'text-black';
  const textMuted = isDark ? 'text-white/40' : 'text-black/40';
  // the process view and the page editor use the whole width — no margins, no scrollbar track
  const fullWidth = view.kind === 'spec' || view.kind === 'page';
  // the navigation (and the word mark as a link to the list) only once a folder is open and access is granted
  const navOn = !gated && !denied && !!dirHandle && !!model;

  return (
    <div className={`flex flex-col h-screen ${bg} ${textBase}`}>
      {/* Header in three parts: the middle one is as wide as the content below
          (max-w-5xl, px-6) — logo and customer on the left, the navigation of the
          app (Prozesse, Seiten, Admin) and the references (FEEL, docs) right-aligned
          with it. Everything else — folder, account, display — stands at the right
          window edge (the origin is in the footer). Parts: margin as next to the
          content | up to 64rem | the rest, at least as wide as the right group — if
          the margin cannot hold the group, the middle gets narrower; if the
          navigation and the right group do not fit side by side, the right group
          wraps to a second row instead of overlapping. The process view and the
          page editor have no margins: there the middle takes the whole width.
          The same scrollbar track as the content below — otherwise the header
          shifts by half a scrollbar as soon as the content scrolls. */}
      <div className={`border-b ${border} ${topBg} flex-shrink-0 overflow-hidden ${fullWidth ? '' : '[scrollbar-gutter:stable]'}`}>
        <div className="flex flex-wrap items-center gap-y-1 py-2">
          {!fullWidth && <div className="flex-shrink-0 w-[max(0px,calc((100%_-_64rem)/2))]" />}
          <div className={`flex items-center gap-2 min-w-0 flex-[1000_1_auto] ${fullWidth ? 'px-3' : 'max-w-[64rem] px-6'}`}>
            {/* Word mark: logo and customer bold, «Orch Spec» small next to it; the version in the tooltip.
                On a narrow window it gives way first (the name is cut, down to 6rem) — not the navigation.
                Without navigation it is inert and out of the tab order, but not `disabled`: some
                browsers drop the tooltip on disabled buttons. */}
            <div className="flex-1 w-0 min-w-24 overflow-hidden mr-2">
              <button onClick={() => { if (navOn) setView({ kind: 'list' }); }} aria-disabled={!navOn} tabIndex={navOn ? undefined : -1}
                className={`flex items-center gap-2 min-w-0 max-w-full ${navOn ? '' : 'cursor-default'}`}
                title={`Orch Spec · Stand ${APP_VERSION}${navOn ? ' — zur Prozessliste' : ''}`}>
                {model?.logo && (
                  <img src={model.logo} alt={model.company ?? ''} className="h-6 max-w-[9rem] object-contain flex-shrink-0" />
                )}
                <span className={`text-xs font-bold tracking-widest truncate ${isDark ? 'text-white/80' : 'text-black/80'}`}>
                  {model?.company || 'Orch Spec'}
                </span>
                {model?.company && (
                  <span className={`text-[10px] tracking-widest hidden sm:inline ${textMuted}`}>Orch Spec</span>
                )}
              </button>
            </div>

            {/* Navigation, then the references (FEEL cheat sheet, docs) — always there */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {navOn && (
                <>
                  <HeaderButton isDark={isDark} icon={<Workflow size={12} />} label="Prozesse"
                    active={view.kind === 'list' || view.kind === 'spec'}
                    title="Prozesse — alle Prozess-Spezifikationen"
                    onClick={() => setView({ kind: 'list' })} />
                  <HeaderButton isDark={isDark} icon={<AppWindow size={12} />} label="Seiten" active={view.kind === 'pages' || view.kind === 'page'}
                    title="Seiten der App - öffentlich oder mit Login, mit Live-Vorschau (pages/*.json)"
                    onClick={() => setView({ kind: 'pages' })} />
                  {canAdmin && (
                    <HeaderButton isDark={isDark} icon={<Wrench size={12} />} label="Admin" active={view.kind === 'admin'}
                      title="Admin — Auftritt, Katalog, Pattern, Epics, Anmeldung, Benachrichtigungen"
                      onClick={() => setView({ kind: 'admin' })} />
                  )}
                  <span className={`w-px h-5 mx-1 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
                </>
              )}
              <HeaderButton isDark={isDark} icon={<SquareFunction size={12} />} label="FEEL" active={feelOpen}
                title={`FEEL-Spickzettel — Syntax, Funktionen, ${C7_LABEL} → ${C8_LABEL}`} onClick={() => setFeelOpen(true)} />
              {docHref && (
                <HeaderButton isDark={isDark} href={docHref} icon={<BookOpen size={12} />} label="Doc" title="Zur Dokumentation" />
              )}
            </div>
          </div>

          {/* Context on the right: folder, account, display */}
          <div className="flex flex-[1_0_auto] justify-end px-4">
            <div className="flex items-center gap-2">
              {!gated && !denied && dirHandle && (
                <HeaderButton isDark={isDark} label={dirHandle.name}
                  icon={dirHandle.kind === 'sharepoint' ? <Cloud size={12} /> : <FolderOpen size={12} />}
                  title={dirHandle.kind === 'sharepoint'
                    ? `SharePoint-Ordner «${dirHandle.name}»\n${dirHandle.webUrl ?? ''}\n\nKlick: anderen Ordner wählen`
                    : `Lokaler Ordner «${dirHandle.name}»\n\nKlick: anderen Ordner wählen`}
                  onClick={() => { disconnect(); setView({ kind: 'list' }); }} />
              )}
              {auth.status === 'signedIn' && auth.user && (
                <AccountChip isDark={isDark} user={auth.user} level={level} onLogout={auth.logout} />
              )}

              {/* Display and the AI mode - the key is personal, only in this browser (violet: on) */}
              <span className={`w-px h-5 mx-1 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
              <button onClick={() => setSettingsOpen(true)}
                title={aiOn ? 'KI-Modus an – API-Key (nur dieser Browser)' : 'KI-Modus – mit eigenem API-Key einschalten (nur dieser Browser)'}
                className={`flex items-center gap-1 p-1.5 rounded transition-colors ${aiOn
                  ? (isDark ? 'text-violet-300 hover:text-violet-200' : 'text-violet-600 hover:text-violet-800')
                  : (isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70')}`}>
                <Sparkles size={13} />
              </button>
              <button onClick={toggleTheme} title={isDark ? 'Helle Darstellung' : 'Dunkle Darstellung'}
                className={`flex items-center gap-1 p-1.5 rounded transition-colors ${isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'}`}>
                {isDark ? <Sun size={13} /> : <Moon size={13} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {feelOpen && <FeelCheatSheet isDark={isDark} onClose={() => setFeelOpen(false)} />}
      {settingsOpen && <SettingsDialog isDark={isDark} onClose={() => setSettingsOpen(false)} />}

      {/* Main content */}
      <div className={`flex-1 ${fullWidth ? 'overflow-hidden' : 'overflow-y-auto [scrollbar-gutter:stable]'}`}>
        {gated ? (
          // Login (Microsoft Entra ID) — before everything else
          <StartCard isDark={isDark} model={model} icon={<LogIn size={20} />} tone={auth.status === 'error' ? 'red' : 'blue'}
            title={auth.status === 'error' ? 'Anmeldung nicht möglich' : 'Anmelden'}
            lead={auth.status === 'loading'
              ? undefined
              : auth.status === 'error'
                ? undefined
                : 'Dieser Ordner verlangt eine Anmeldung mit dem Microsoft-Konto. Sie läuft über Microsoft Entra ID; die App selbst speichert keine Zugangsdaten.'}>
            {folderOfGate}
            {auth.status === 'loading' ? (
              <div className="flex justify-center">
                <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border ${isDark ? 'border-blue-500/40 text-blue-300' : 'border-blue-300 text-blue-700'}`}>
                  <Loader2 size={12} className="animate-spin" /> Anmeldung wird geprüft …
                </span>
              </div>
            ) : auth.status === 'error' ? (
              <div className="space-y-3">
                <div className="flex justify-center">
                  <span className={`inline-flex items-start gap-1.5 text-[11px] px-2 py-1 rounded border text-left ${isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
                    <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> <span>{auth.error}</span>
                  </span>
                </div>
                <button onClick={() => window.location.reload()}
                  className={`w-full text-xs px-4 py-2 rounded border transition-colors ${c.btn}`}>
                  Erneut versuchen
                </button>
              </div>
            ) : (
              <button onClick={auth.login}
                className={`w-full flex items-center justify-center gap-2 text-xs px-4 py-2.5 rounded font-semibold transition-colors ${c.btnPrimary}`}>
                <MicrosoftMark /> Mit Microsoft anmelden
              </button>
            )}
          </StartCard>
        ) : denied ? (
          <StartCard isDark={isDark} model={model} icon={<ShieldCheck size={20} />} tone="red"
            title="Keine Berechtigung für diese App"
            lead="Das Konto ist angemeldet, hat aber keine der Rollen dieser App. Die Zuweisung erfolgt in Entra unter «Unternehmensanwendungen → Benutzer und Gruppen»."
            footnote={auth.user?.roles.length ? <>Rollen des Kontos: {auth.user.roles.join(', ')}</> : 'Das Konto trägt keine App-Rollen.'}>
            {folderOfGate}
            <div className="space-y-3">
              {/* the account, as with the comments: initials, name, e-mail */}
              {auth.user && (
                <div className={`flex items-center gap-2 rounded border px-3 py-2 ${c.border2}`}>
                  <span className={`inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-full text-[10px] font-bold border flex-shrink-0 ${
                    isDark ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' : 'bg-blue-50 text-blue-700 border-blue-300'}`}>
                    {initialsOf(auth.user.name)}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-xs font-semibold truncate ${c.text}`}>{auth.user.name}</span>
                    <span className={`block text-[10px] truncate ${c.muted}`}>{auth.user.email}</span>
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1.5 flex-wrap justify-center">
                <span className={`text-[10px] ${c.muted}`}>Nötig ist eine von:</span>
                {(['adminRole', 'reviewerRole', 'viewerRole'] as const).map(k => auth.config?.[k] && (
                  <span key={k} title={k === 'adminRole' ? 'Admin' : k === 'reviewerRole' ? 'Bearbeiten' : 'Lesen'}
                    className={`text-[10px] font-mono px-1.5 py-px rounded border ${isDark ? 'border-white/15 text-white/60' : 'border-black/15 text-black/60'}`}>
                    {auth.config[k]}
                  </span>
                ))}
              </div>
              <button onClick={auth.logout}
                className={`w-full flex items-center justify-center gap-2 text-xs px-4 py-2 rounded border transition-colors ${c.btn}`}>
                <LogOut size={12} /> Abmelden und anderes Konto verwenden
              </button>
            </div>
          </StartCard>
        ) : !dirHandle ? (
          // Start / storage choice: SharePoint or local folder, side by side
          <StartCard isDark={isDark} model={model} icon={<FolderOpen size={20} />} wide
            title="Wo liegen die Spezifikationen?"
            lead="Kein eigener Server — die Daten bleiben im gewählten Ordner, geteilt über SharePoint oder ein lokales Laufwerk."
            footnote={<>Im Ordner liegen <span className="font-semibold">model.json</span> (Katalog und Einstellungen) und der
              Unterordner <span className="font-semibold">processes/</span> mit den Spezifikationen. Fehlen sie, werden sie angelegt.</>}>
            {/* back to the storage that was just open — without new permission or login */}
            {auth.status === 'error' && auth.error && (
              <div className={`mb-3 flex items-start gap-1.5 text-[11px] px-2 py-1.5 rounded border ${isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> <span>Anmeldung: {auth.error}</span>
              </div>
            )}
            {previousStorage && (
              <button onClick={() => void resumePrevious()}
                className={`w-full mb-3 flex items-center justify-center gap-2 text-xs px-3 py-2 rounded border transition-colors ${
                  isDark ? 'border-blue-500/40 text-blue-300 hover:bg-blue-500/10' : 'border-blue-300 text-blue-700 hover:bg-blue-50'}`}>
                <Undo2 size={12} /> Zurück zu «{previousStorage.name}»
                <span className={`text-[10px] ${textMuted}`}>({previousStorage.kind === 'sharepoint' ? 'SharePoint' : 'lokaler Ordner'})</span>
              </button>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StartOption isDark={isDark} icon={<Cloud size={12} />} title="SharePoint"
                text={pendingFolder
                  ? <>Aus dem Link:{' '}
                      <span className={`font-mono break-all ${c.muted2}`} title={pendingFolder}>{(() => { try { return decodeURI(pendingFolder); } catch { return pendingFolder; } })()}</span>
                      {auth.status !== 'signedIn' && <> — zum Öffnen mit dem Microsoft-Konto anmelden.</>}</>
                  : savedSharePoint
                  ? <>Zuletzt verbunden:{' '}
                      <span className={`font-mono break-all ${c.muted2}`} title={savedSharePoint.webUrl}>{savedSharePoint.webUrl || savedSharePoint.name}</span>
                      {auth.status !== 'signedIn' && <> — zum Öffnen mit dem Microsoft-Konto anmelden.</>}</>
                  : 'Link zum Ordner einfügen, Anmeldung mit dem Microsoft-Konto, Berechtigungen aus SharePoint. Funktioniert in jedem Browser.'}
                remembered={pendingFolder ? null : savedSharePoint?.name ?? null}
                primary={{
                  label: spPreparing || ((savedSharePoint || pendingFolder) && auth.status === 'loading') ? 'Anmeldung …'
                    : savedSharePoint || pendingFolder ? (auth.status === 'signedIn' ? 'Verbinden' : 'Anmelden und verbinden')
                    : 'Ordner verbinden',
                  onClick: startSharePoint, disabled: spPreparing || (!!(savedSharePoint || pendingFolder) && auth.status === 'loading'), strong: true,
                  title: auth.loginAvailable ? '' : 'Beim ersten Mal: Einrichtungs-Link vom Admin öffnen oder IDs eintragen',
                }}
                secondary={savedSharePoint || pendingFolder ? { label: 'anderen SharePoint-Ordner wählen', onClick: forgetSharePoint } : undefined} />
              <StartOption isDark={isDark} icon={<FolderOpen size={12} />} title="Lokaler Ordner"
                text={<>Ein Ordner auf dem Rechner, auch ein synchronisierter (OneDrive, Google Drive). Chrome oder Edge.
                  {companyFolder && <CompanyFolderHint path={companyFolder} muted={c.muted2} />}</>}
                remembered={savedHandleName}
                primary={{
                  label: savedHandleName ? 'Wieder verbinden' : 'Ordner wählen',
                  onClick: savedHandleName ? reconnectDirectory : pickDirectory,
                }}
                secondary={savedHandleName ? { label: 'anderen lokalen Ordner wählen', onClick: pickDirectory } : undefined} />
            </div>
          </StartCard>
        ) : modelError ? (
          <StartCard isDark={isDark} model={model} icon={<AlertTriangle size={20} />} tone="red"
            title="Der Ordner lässt sich nicht lesen" lead={modelError}>
            <button onClick={pickDirectory}
              className={`w-full text-xs px-4 py-2 rounded border transition-colors ${c.btn}`}>
              Anderen Ordner wählen
            </button>
          </StartCard>
        ) : !model ? (
          <StartCard isDark={isDark} icon={<FolderOpen size={20} />} title="Ordner wird gelesen" lead="model.json und processes/ …" />
        ) : view.kind === 'list' ? (
          <ProcessesView onOpen={slug => setView({ kind: 'spec', slug })} />
        ) : view.kind === 'pages' ? (
          <Suspense fallback={<Loader2 size={14} className="animate-spin m-6" />}>
            <PagesView onOpen={(slug, aiPrompt, notice) => setView({ kind: 'page', slug, aiPrompt, notice })}
              onOpenTask={(slug, stepId) => setView({ kind: 'spec', slug, stepId })} />
          </Suspense>
        ) : view.kind === 'page' ? (
          <Suspense fallback={<Loader2 size={14} className="animate-spin m-6" />}>
            <PageEditor key={view.slug} slug={view.slug} aiPrompt={view.aiPrompt} focusCommentId={view.commentId} notice={view.notice} onBack={() => setView({ kind: 'pages' })}
              onOpenTask={(slug, stepId) => setView({ kind: 'spec', slug, stepId })} />
          </Suspense>
        ) : view.kind === 'admin' ? (
          canAdmin
            ? (
              <Suspense fallback={<Loader2 size={14} className="animate-spin m-6" />}>
                <AdminView onBack={() => setView({ kind: 'list' })} />
              </Suspense>
            )
            : <ProcessesView onOpen={slug => setView({ kind: 'spec', slug })} />
        ) : (
          <ProcessView key={view.slug} slug={view.slug} focusCommentId={view.commentId} focusStepId={view.stepId} onBack={() => setView({ kind: 'list' })}
            onOpenPage={pageSlug => setView({ kind: 'page', slug: pageSlug })} />
        )}
      </div>

      {/* Footer: the origin, far right at the window edge */}
      <footer className={`border-t ${border} ${topBg} flex-shrink-0 overflow-hidden ${fullWidth ? '' : '[scrollbar-gutter:stable]'}`}>
        <div className="px-4 py-1.5 flex justify-end">
          <a href="https://z9nai.ch" target="_blank" rel="noopener noreferrer"
            title="Z9nAI GmbH — zur Webseite"
            className={`flex items-center gap-1.5 ${textMuted} opacity-80 hover:opacity-100 transition-opacity`}>
            <span className="text-[10px] whitespace-nowrap">by z9nai GmbH</span>
            <img src="favicon.png" alt="" className="w-4 h-4" />
          </a>
        </div>
      </footer>

      {/* Setup: Microsoft login for this browser (one-time) */}
      {setupOpen && (
        <StartDialog isDark={isDark} icon={<KeyRound size={14} />} title="Microsoft-Anmeldung einrichten"
          onClose={() => setSetupOpen(false)}
          lead={<>Am einfachsten den <span className="font-semibold">Einrichtungs-Link</span> vom Admin öffnen — er
            richtet Anmeldung und SharePoint-Ordner in einem Schritt ein. Alternativ hier die beiden IDs der
            App-Registrierung in Microsoft Entra eintragen (einmalig pro Browser, keine Geheimnisse).</>}
          error={setupError}
          primary={{ label: 'Speichern und anmelden', icon: <LogIn size={12} />, onClick: () => void saveSetup(),
            disabled: !GUID_RE.test(setupTenant.trim()) || !GUID_RE.test(setupClient.trim()) }}>
          <GuidField isDark={isDark} label="Verzeichnis-ID (Tenant)" value={setupTenant} onChange={setSetupTenant} autoFocus />
          <GuidField isDark={isDark} label="Anwendungs-ID (Client)" value={setupClient} onChange={setSetupClient} />
        </StartDialog>
      )}

      {/* Connect SharePoint folder */}
      {spOpen && (
        <StartDialog isDark={isDark} icon={<Cloud size={14} />} title="SharePoint-Ordner verbinden"
          onClose={() => !spBusy && setSpOpen(false)} busy={spBusy}
          lead={<>Link zum Ordner aus SharePoint oder Teams einfügen (Ordner öffnen → «Link kopieren» bzw. die Adresse aus der
            Browserzeile). In diesem Ordner liegen model.json und processes/ — fehlen sie, legt die App sie an.
            {auth.status !== 'signedIn' && <> Danach geht es zur Anmeldung mit dem Microsoft-Konto; der Link bleibt gemerkt.</>}</>}
          error={spError}
          primary={{ label: spBusy ? 'Verbinde …' : auth.status === 'signedIn' ? 'Verbinden' : 'Anmelden und verbinden', icon: spBusy ? <Loader2 size={12} className="animate-spin" /> : <Cloud size={12} />,
            onClick: () => void doConnectSharePoint(), disabled: spBusy || !spLink.trim() }}>
          <div>
            <label className={`block text-[10px] uppercase tracking-wider mb-1 ${c.text}`}>Link zum Ordner</label>
            <input value={spLink} autoFocus disabled={spBusy} spellCheck={false}
              onChange={e => { setSpLink(e.target.value); setSpError(''); }}
              onKeyDown={e => { if (e.key === 'Enter' && spLink.trim()) doConnectSharePoint(); }}
              placeholder="https://firma.sharepoint.com/sites/Team/Freigegebene Dokumente/orch-spec"
              className={`w-full text-xs px-3 py-2 rounded border outline-none font-mono transition-colors ${c.input}`} />
            {spLink.trim() && !/^https:\/\/[^/]+\.sharepoint\.com\//i.test(spLink.trim()) && !/^https:\/\/teams\.microsoft\.com\//i.test(spLink.trim()) && (
              <p className={`text-[10px] mt-1 ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                Sieht nicht nach SharePoint aus — erwartet wird eine Adresse unter <span className="font-mono">…sharepoint.com/…</span>.
              </p>
            )}
          </div>
        </StartDialog>
      )}
    </div>
  );
}
