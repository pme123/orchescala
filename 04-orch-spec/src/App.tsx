import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Sun, Moon, FolderOpen, AlertTriangle, Wrench, LogIn, LogOut, ShieldCheck, Cloud, KeyRound, BookOpen, Loader2, Undo2, SquareFunction, AppWindow } from 'lucide-react';
import { useStore } from './store';
import { APP_VERSION } from './version';
import { GUID_RE, useAuth, usePermissions } from './auth';
import ProcessesView from './components/ProcessesView';
import ProcessView from './components/ProcessView';
import AdminView from './components/AdminView';
import { GuidField, MicrosoftMark, StartCard, StartDialog, StartOption, initialsOf } from './components/StartCard';
import { AccountChip, Breadcrumb, HeaderButton } from './components/Header';
import FeelCheatSheet from './components/FeelCheatSheet';
// die Seiten (E15) kommen erst, wenn jemand sie öffnet - der Designer samt Renderer ist ein eigener Chunk
const PagesView = lazy(() => import('./pages/designer/PagesView'));
const PageEditor = lazy(() => import('./pages/designer/PageEditor'));
import { cls } from './ui';

type View = { kind: 'list' } | { kind: 'spec'; slug: string; commentId?: string } | { kind: 'admin' }
  | { kind: 'pages' } | { kind: 'page'; slug: string };

// Deep Link (?spec=<slug>&comment=<id>, siehe util.deepLink): beim Start aus
// der URL nehmen und im Tab merken — so überlebt er den Login-Redirect — und
// einlösen, sobald Ordner und model.json da sind.
const DEEP_LINK_KEY = 'orch-spec.deepLink';
function takeDeepLink(): { slug: string; commentId?: string } | null {
  try {
    const u = new URL(window.location.href);
    const slug = (u.searchParams.get('spec') ?? '').trim();
    const commentId = (u.searchParams.get('comment') ?? '').trim();
    if (slug) {
      u.searchParams.delete('spec'); u.searchParams.delete('comment');
      window.history.replaceState(null, '', u.toString());
      const link = { slug, ...(commentId ? { commentId } : {}) };
      sessionStorage.setItem(DEEP_LINK_KEY, JSON.stringify(link));
      return link;
    }
    const stored = sessionStorage.getItem(DEEP_LINK_KEY);
    return stored ? JSON.parse(stored) as { slug: string; commentId?: string } : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [feelOpen, setFeelOpen] = useState(false);
  const { isDark, toggleTheme, storage, pickDirectory, savedHandleName, reconnectDirectory, model, modelError,
    savedSharePoint, pendingFolder, rememberFolderLink, connectPendingFolder, folderLinkError, clearFolderLinkError, reconnectSharePoint, forgetSharePoint, disconnect, specs, pages, previousStorage, resumePrevious } = useStore();
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
    setView({ kind: 'spec', ...deepLink });
  }, [deepLink, storage, model]);
  const dirHandle = storage; // Kurzname: verbundener Speicher (lokal oder SharePoint)
  // Anmeldung aktiv und noch nicht angemeldet → Gate; Admin nur mit Rolle.
  // Erst der Ordner, dann die Anmeldung: ob sie nötig ist, sagt die model.json
  // des Ordners, und beim SharePoint-Ordner führt die Startkarte selbst hinein.
  // Ohne Ordner steht deshalb die Startkarte da, nicht das Gate.
  const needsLogin = auth.status !== 'disabled' && auth.status !== 'signedIn';
  const gated = needsLogin && !!dirHandle;

  // SharePoint: erst der Link, dann die Anmeldung. Der Link wird gemerkt, bevor
  // es zu Microsoft geht — nach der Rückkehr verbindet ihn der Store. Ist man
  // schon angemeldet, wird gleich hier verbunden.
  const doConnectSharePoint = async () => {
    const link = spLink.trim();
    if (!link) return;
    setSpBusy(true); setSpError('');
    rememberFolderLink(link);
    const r = await auth.loginForSharePoint();
    if (r === 'setup') { setSpBusy(false); setSpOpen(false); setSetupError(''); setSetupOpen(true); return; }
    if (r !== 'ready') { setSpBusy(false); return; } // Redirect zu Microsoft läuft
    const res = await connectPendingFolder();
    setSpBusy(false);
    if (res && !res.ok) { setSpError(res.message); return; }
    setSpOpen(false); setSpLink('');
  };
  // nach der Rückkehr vom Login nicht verbunden → Link und Fehler wieder zeigen
  useEffect(() => {
    if (!folderLinkError) return;
    setSpLink(folderLinkError.link); setSpError(folderLinkError.message); setSpOpen(true);
    clearFolderLinkError();
  }, [folderLinkError, clearFolderLinkError]);
  // Gemerkter Ordner oder einer aus einem Link: anmelden, dann hinein.
  // Sonst zuerst der Link-Dialog — angemeldet wird beim Verbinden.
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
      // Ordner aus dem Link oder gemerkter Ordner → direkt hinein; sonst den Link erfragen
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
    // direkt weiter zur Anmeldung
    setTimeout(() => { void startSharePoint(); }, 50);
  };

  const denied = auth.status === 'signedIn' && !canView && !!dirHandle;

  // Doku-Button: nur zeigen, wenn eine Ebene über der App tatsächlich eine
  // index.html liegt (die App wird unter /orch-spec/ in eine Doku-Seite
  // eingehängt — lokal oder ohne umgebende Seite gibt es die nicht).
  const [docHref, setDocHref] = useState<string | null>(null);
  useEffect(() => {
    // Gegen die Dokument-URL auflösen, nicht den Origin — bei relativer
    // Build-Base ('./') zeigt BASE_URL sonst fälschlich auf den Site-Root.
    const appBase = new URL(import.meta.env.BASE_URL, document.baseURI);
    const doc = new URL('../index.html', appBase);
    if (doc.pathname === new URL('index.html', appBase).pathname) return; // App liegt schon im Root
    let gone = false;
    fetch(doc.href, { method: 'HEAD' }).then(r => {
      // Redirect zurück in die App (macht z.B. der Dev-Server) ist kein Treffer
      const backIntoApp = new URL(r.url).pathname.startsWith(appBase.pathname);
      if (!gone && r.ok && !backIntoApp && (r.headers.get('content-type') ?? '').includes('text/html')) setDocHref(doc.href);
    }).catch(() => {});
    return () => { gone = true; };
  }, []);

  // Anmelde-Konfiguration kommt aus der model.json des geteilten Ordners
  const applyConfig = auth.applyConfig;
  useEffect(() => { if (model) applyConfig(model.auth); }, [model, applyConfig]);

  const c = cls(isDark);
  // Für welchen Ordner angemeldet wird — und der Weg zu einem anderen
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

  return (
    <div className={`flex flex-col h-screen ${bg} ${textBase}`}>
      {/* Kopfzeile. Links der Kunde, rechts die Werkzeuge — die teilen sich
          die Breite mit dem Inhalt darunter, damit sie mit den Panels
          fluchten (die Prozessansicht ist als einzige randlos). Die Herkunft
          steht davon unberührt ganz rechts am Fensterrand; der Platz dafür
          ist reserviert, wo die Zeile sonst bis dorthin liefe. */}
      <div className={`relative border-b ${border} ${topBg} flex-shrink-0`}>
        <div className={`flex items-center gap-3 py-2 ${
          view.kind === 'spec' || view.kind === 'page' ? 'pl-3 pr-[9.5rem] max-xl:pr-14' : 'max-w-5xl mx-auto px-6 max-xl:pr-14'}`}>
          {/* Wortmarke: Logo und Kunde fett, «Orch Spec» klein daneben; die Version im Tooltip */}
          <span className="flex items-center gap-2 flex-shrink-0" title={`Orch Spec · Stand ${APP_VERSION}`}>
            {model?.logo && (
              <img src={model.logo} alt={model.company ?? ''} className="h-6 max-w-[9rem] object-contain flex-shrink-0" />
            )}
            <span className={`text-xs font-bold tracking-widest ${isDark ? 'text-white/80' : 'text-black/80'}`}>
              {model?.company || 'Orch Spec'}
            </span>
            {model?.company && (
              <span className={`text-[10px] tracking-widest hidden sm:inline ${textMuted}`}>Orch Spec</span>
            )}
          </span>

          {/* Ort: Prozesse › Titel bzw. Administration — die Glieder führen zurück */}
          {!gated && !denied && dirHandle && model && (
            <Breadcrumb isDark={isDark} items={[
              { label: 'Prozesse', onClick: view.kind !== 'list' ? () => setView({ kind: 'list' }) : undefined },
              ...(view.kind === 'admin' ? [{ label: 'Administration' }] : []),
              ...(view.kind === 'pages' ? [{ label: 'Seiten' }] : []),
              ...(view.kind === 'page' ? [{ label: 'Seiten', onClick: () => setView({ kind: 'pages' }) },
                { label: pages.find(x => x.slug === view.slug)?.data.title || view.slug }] : []),
              ...(view.kind === 'spec' ? [{ label: specs.find(x => x.slug === view.slug)?.data.title || view.slug }] : []),
            ]} />
          )}

        <div className="ml-auto flex items-center gap-2">
          {/* Navigation: FEEL-Spickzettel, Doku, Admin */}
          <HeaderButton isDark={isDark} icon={<SquareFunction size={12} />} label="FEEL" active={feelOpen}
            title="FEEL-Spickzettel — Syntax, Funktionen, Camunda 7 / Operaton → Camunda 8" onClick={() => setFeelOpen(true)} />
          {docHref && (
            <HeaderButton isDark={isDark} href={docHref} icon={<BookOpen size={12} />} label="Doc" title="Zur Dokumentation" />
          )}
          {dirHandle && model && (
            <HeaderButton isDark={isDark} icon={<AppWindow size={12} />} label="Seiten" active={view.kind === 'pages' || view.kind === 'page'}
              title="Seiten der App - öffentlich oder mit Login, mit Live-Vorschau (pages/*.json)"
              onClick={() => setView(v => v.kind === 'pages' ? { kind: 'list' } : { kind: 'pages' })} />
          )}
          {dirHandle && model && canAdmin && (
            <HeaderButton isDark={isDark} icon={<Wrench size={12} />} label="Admin" active={view.kind === 'admin'}
              title="Admin — Auftritt, Katalog, Pattern, Epics, Anmeldung, Benachrichtigungen"
              onClick={() => setView(v => v.kind === 'admin' ? { kind: 'list' } : { kind: 'admin' })} />
          )}

          {/* Kontext: Ordner, Konto */}
          {((!gated && !denied && dirHandle) || (auth.status === 'signedIn' && auth.user)) && (
            <span className={`w-px h-5 mx-1 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
          )}
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

          {/* Darstellung */}
          <span className={`w-px h-5 mx-1 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
          <button onClick={toggleTheme} title={isDark ? 'Helle Darstellung' : 'Dunkle Darstellung'}
            className={`flex items-center gap-1 p-1.5 rounded transition-colors ${isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'}`}>
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>
        </div>

        <a href="https://z9nai.ch" target="_blank" rel="noopener noreferrer"
          title="Z9nAI GmbH — zur Webseite"
          className={`absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 ${textMuted} opacity-80 hover:opacity-100 transition-opacity`}>
          <span className="text-[10px] whitespace-nowrap hidden xl:inline">by z9nai GmbH</span>
          <img src="favicon.png" alt="" className="w-5 h-5" />
        </a>
      </div>

      {feelOpen && <FeelCheatSheet isDark={isDark} onClose={() => setFeelOpen(false)} />}

      {/* Main content */}
      <div className={`flex-1 ${view.kind === 'spec' || view.kind === 'page' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {gated ? (
          // Anmeldung (Microsoft Entra ID) — vor allem anderen
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
              {/* das Konto, wie bei den Kommentaren: Kürzel, Name, E-Mail */}
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
          // Start / Speicherwahl: SharePoint oder lokaler Ordner, nebeneinander
          <StartCard isDark={isDark} model={model} icon={<FolderOpen size={20} />} wide
            title="Wo liegen die Spezifikationen?"
            lead="Kein eigener Server — die Daten bleiben im gewählten Ordner, geteilt über SharePoint oder ein lokales Laufwerk."
            footnote={<>Im Ordner liegen <span className="font-semibold">model.json</span> (Katalog und Einstellungen) und der
              Unterordner <span className="font-semibold">processes/</span> mit den Spezifikationen. Fehlen sie, werden sie angelegt.</>}>
            {/* zurück zum Speicher, der eben noch offen war — ohne neue Berechtigung oder Anmeldung */}
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
                text="Ein Ordner auf dem Rechner, auch ein synchronisierter (OneDrive, Google Drive). Chrome oder Edge."
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
            <PagesView onOpen={slug => setView({ kind: 'page', slug })} />
          </Suspense>
        ) : view.kind === 'page' ? (
          <Suspense fallback={<Loader2 size={14} className="animate-spin m-6" />}>
            <PageEditor key={view.slug} slug={view.slug} onBack={() => setView({ kind: 'pages' })} />
          </Suspense>
        ) : view.kind === 'admin' ? (
          canAdmin
            ? <AdminView onBack={() => setView({ kind: 'list' })} />
            : <ProcessesView onOpen={slug => setView({ kind: 'spec', slug })} />
        ) : (
          <ProcessView key={view.slug} slug={view.slug} focusCommentId={view.commentId} onBack={() => setView({ kind: 'list' })} />
        )}
      </div>

      {/* Einrichtung: Microsoft-Anmeldung für diesen Browser (einmalig) */}
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

      {/* SharePoint-Ordner verbinden */}
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
