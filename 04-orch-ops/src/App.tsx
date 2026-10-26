import { useCallback, useEffect, useState } from 'react';
import { Sun, Moon, FolderOpen, AlertTriangle, Wrench, LogIn, LogOut, ShieldCheck, Cloud, X, KeyRound, BookOpen, UserRound } from 'lucide-react';
import { useStore } from './store';
import { APP_VERSION } from './version';
import {
  DEFAULT_ROLES, GUID_RE, LEVEL_LABELS, ROLE_KEYS, confirmNoRoles, peekPendingRoles, setPendingRoles, useAuth, usePermissions, type Roles,
} from './auth';
import { joinOr } from './util';
import RoleFields from './components/RoleFields';
import ErrorsView, { type ListState } from './components/ErrorsView';
import ErrorPanel from './components/ErrorPanel';
import HowtoView from './components/HowtoView';
import AdminView from './components/AdminView';
import { readRoute, writeRoute, type Route } from './route';

export default function App() {
  const { isDark, toggleTheme, storage, pickDirectory, savedHandleName, reconnectDirectory, model, modelError,
    connectSharePoint, savedSharePoint, forgetSharePoint, disconnect, actor, setLocalName } = useStore();
  const [spOpen, setSpOpen] = useState(false);
  const [spLink, setSpLink] = useState('');
  const [spBusy, setSpBusy] = useState(false);
  const [spError, setSpError] = useState('');
  const auth = useAuth();
  const { canAdmin, canView, level } = usePermissions();
  // view, selection and filters live in the address (#/…) — links can be shared
  const [route, setRouteState] = useState<Route>(() => readRoute());
  const setRoute = useCallback((r: Route, push = false) => { setRouteState(r); writeRoute(r, push); }, []);
  useEffect(() => {
    const on = () => setRouteState(readRoute());
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); };
  }, []);
  const view = route.view;
  const setList = (list: ListState) => setRoute({ ...route, list });
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  // sign-in active and not signed in yet → gate; admin only with role
  const gated = auth.status !== 'disabled' && auth.status !== 'signedIn';
  const dirHandle = storage; // short name: connected storage (local or SharePoint)

  // SharePoint: resolve the link and connect
  const doConnectSharePoint = async () => {
    setSpBusy(true); setSpError('');
    const res = await connectSharePoint(spLink);
    setSpBusy(false);
    if (res.ok) { setSpOpen(false); setSpLink(''); }
    else setSpError(res.message);
  };
  // Start of SharePoint mode: always ensure sign-in + Graph token first
  // (redirect if needed), only then the link dialog
  const [spPreparing, setSpPreparing] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupTenant, setSetupTenant] = useState('');
  const [setupClient, setSetupClient] = useState('');
  const [setupError, setSetupError] = useState('');
  const [setupRoles, setSetupRoles] = useState<Roles>({ ...DEFAULT_ROLES });
  const startSharePoint = async () => {
    setSpPreparing(true);
    try {
      const r = await auth.loginForSharePoint();
      if (r === 'ready') setSpOpen(true);
      else if (r === 'setup') { setSetupError(''); setSetupRoles(peekPendingRoles() ?? { ...DEFAULT_ROLES }); setSetupOpen(true); }
    } finally {
      setSpPreparing(false);
    }
  };
  const saveSetup = async () => {
    const t = setupTenant.trim(), c = setupClient.trim();
    if (!GUID_RE.test(t) || !GUID_RE.test(c)) { setSetupError('Beide IDs müssen gültige GUIDs sein (Format 8-4-4-4-12).'); return; }
    if (!confirmNoRoles(setupRoles)) return;
    // for the model.json of a new folder; without browser storage the IDs could not be kept either
    if (!setPendingRoles(setupRoles)) { setSetupError('Der Browser-Speicher ist nicht verfügbar (z. B. privates Fenster mit gesperrtem Speicher) — die Einrichtung lässt sich nicht merken.'); return; }
    auth.setLocalIds(t, c);
    setSetupOpen(false);
    // go straight on to the sign-in
    setTimeout(() => { void startSharePoint(); }, 50);
  };

  const denied = auth.status === 'signedIn' && !canView;

  // Docs button: only show it if there actually is an index.html one level
  // above the app (the app is embedded under /orch-ops/ in a docs site —
  // locally or without a surrounding site there is none).
  const [docHref, setDocHref] = useState<string | null>(null);
  useEffect(() => {
    // Resolve against the document URL, not the origin — with a relative
    // build base ('./') BASE_URL would otherwise wrongly point to the site root.
    const appBase = new URL(import.meta.env.BASE_URL, document.baseURI);
    const doc = new URL('../index.html', appBase);
    if (doc.pathname === new URL('index.html', appBase).pathname) return; // the app already sits at the root
    let gone = false;
    fetch(doc.href, { method: 'HEAD' }).then(r => {
      // a redirect back into the app (e.g. by the dev server) is not a hit
      const backIntoApp = new URL(r.url).pathname.startsWith(appBase.pathname);
      if (!gone && r.ok && !backIntoApp && (r.headers.get('content-type') ?? '').includes('text/html')) setDocHref(doc.href);
    }).catch(() => {});
    return () => { gone = true; };
  }, []);

  // the sign-in configuration comes from the shared folder's model.json
  const applyConfig = auth.applyConfig;
  useEffect(() => { if (model) applyConfig(model.auth); }, [model, applyConfig]);

  const bg = isDark ? 'bg-[#0e0f11]' : 'bg-[#f5f4f0]';
  const border = isDark ? 'border-white/8' : 'border-black/8';
  const topBg = isDark ? 'bg-[#0c0d0f]' : 'bg-[#eae9e5]';
  const textBase = isDark ? 'text-white' : 'text-black';
  const textMuted = isDark ? 'text-white/40' : 'text-black/40';

  return (
    <div className={`flex flex-col h-screen ${bg} ${textBase}`}>
      {/* Header. Company on the left, tools on the right — they share the
          width with the content below so they line up with the panels.
          The origin credit stays at the far right of the window edge,
          unaffected; its space is reserved where the row would otherwise
          run up to it. */}
      <div className={`relative border-b ${border} ${topBg} flex-shrink-0`}>
        <div className={`flex items-center gap-3 py-2 ${
          'max-w-6xl mx-auto px-6 max-xl:pr-14'}`}>
          {model?.logo && (
            <img src={model.logo} alt={model.company ?? ''} className="h-6 max-w-[9rem] object-contain flex-shrink-0" />
          )}
          <span title={`Orch Ops · Stand ${APP_VERSION}`}
            className={`text-xs font-bold tracking-widest ${isDark ? 'text-white/70' : 'text-black/70'}`}>
            {model?.company || 'Orch Ops'}
          </span>
          {model?.company && (
            <span title={`Stand ${APP_VERSION}`} className={`text-[11px] tracking-widest ${textMuted}`}>Orch Ops</span>
          )}

          {/* Navigation */}
          {!gated && !denied && dirHandle && model && (
            <nav className="flex items-center gap-1 ml-4">
              {([['list', 'Fehler'], ['howto', 'How-to']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setRoute({ ...route, view: k, id: null, isNew: false }, true)}
                  className={`text-[11px] px-2.5 py-1 rounded transition-colors ${view === k
                    ? (isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-black')
                    : (isDark ? 'text-white/45 hover:text-white/80' : 'text-black/45 hover:text-black/80')}`}>
                  {label}
                </button>
              ))}
            </nav>
          )}

        <div className="ml-auto flex items-center gap-3">
          {/* Documentation — only if the surrounding docs site exists */}
          {docHref && (
            <a href={docHref} title="Zur Dokumentation"
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border transition-colors ${
                isDark ? 'border-white/15 text-white/50 hover:border-white/30' : 'border-black/15 text-black/50 hover:border-black/30'}`}
            >
              <BookOpen size={12} />
              Doc
            </a>
          )}

          {/* Admin: branding, status values, import, sign-in */}
          {dirHandle && model && canAdmin && (
            <button
              onClick={() => setRoute({ ...route, view: view === 'admin' ? 'list' : 'admin', id: null, isNew: false }, true)}
              title="Admin — Auftritt, Status-Werte, Confluence-Import, Anmeldung"
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border transition-colors ${
                view === 'admin'
                  ? isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10'
                  : isDark ? 'border-white/15 text-white/50 hover:border-white/30' : 'border-black/15 text-black/50 hover:border-black/30'
              }`}
            >
              <Wrench size={12} />
              Admin
            </button>
          )}

          {/* Signed-in person */}
          {auth.status === 'signedIn' && auth.user && (
            <div className={`flex items-center gap-2 text-[11px] ${textMuted}`} title={auth.user.email}>
              <span className="flex items-center gap-1" title={`${auth.user.email} · ${LEVEL_LABELS[level]}`}>
                {auth.user.isAdmin && auth.config?.adminRole && <ShieldCheck size={11} />}
                {auth.user.name}
                <span className="opacity-60">· {LEVEL_LABELS[level]}</span>
              </span>
              <button onClick={auth.logout} title="Abmelden"
                className={`p-1 rounded transition-colors ${isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'}`}>
                <LogOut size={12} />
              </button>
            </div>
          )}

          {/* Without sign-in: set the name for «erfasst/gezählt von» yourself */}
          {auth.status !== 'signedIn' && dirHandle && (
            <button onClick={() => { setNameDraft(actor); setNameOpen(true); }}
              title="Dein Name — steht bei Erfassen, Bearbeiten und Zählen"
              className={`flex items-center gap-1 text-[11px] transition-colors ${actor
                ? (isDark ? 'text-white/50 hover:text-white/80' : 'text-black/50 hover:text-black/80')
                : (isDark ? 'text-amber-300/80 hover:text-amber-200' : 'text-amber-700 hover:text-amber-900')}`}>
              <UserRound size={12} /> {actor || 'Name setzen'}
            </button>
          )}

          {/* Shared folder (local or SharePoint) */}
          {!gated && !denied && dirHandle && (
          <button
            onClick={() => { disconnect(); setRoute({ ...route, view: 'list', id: null, isNew: false }); }}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border transition-colors ${isDark ? 'border-white/15 text-white/50 hover:border-white/30' : 'border-black/15 text-black/50 hover:border-black/30'}`}
            title={dirHandle.kind === 'sharepoint' ? `SharePoint: ${dirHandle.webUrl ?? ''} — Klick: anderen Ordner wählen` : 'Anderen Ordner wählen'}
          >
            {dirHandle.kind === 'sharepoint' ? <Cloud size={12} /> : <FolderOpen size={12} />}
            {dirHandle.name}
          </button>
          )}

          {/* Theme toggle */}
          <button onClick={toggleTheme}
            className={`flex items-center gap-1 p-1.5 rounded transition-colors ${isDark ? 'text-white/35 hover:text-white/70' : 'text-black/35 hover:text-black/70'}`}>
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
          </button>

        </div>
        </div>

        <a href="https://z9nai.ch" target="_blank" rel="noopener noreferrer"
          title="Z9nAI GmbH — zur Webseite"
          className={`absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 ${textMuted} opacity-80 hover:opacity-100 transition-opacity`}>
          <span className="text-[10px] whitespace-nowrap hidden 2xl:inline">by z9nai GmbH</span>
          <img src="favicon.png" alt="" className="w-5 h-5" />
        </a>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {gated ? (
          // sign-in (Microsoft Entra ID) — before anything else
          <div className="h-full flex items-center justify-center p-6">
            <div className={`max-w-md w-full rounded-xl border p-8 text-center ${border} ${isDark ? 'bg-white/2' : 'bg-black/2'}`}>
              <LogIn size={28} className={`mx-auto mb-4 ${textMuted}`} />
              <h1 className={`text-sm font-semibold uppercase tracking-widest mb-3 ${isDark ? 'text-white/70' : 'text-black/70'}`}>
                Betrieb Camunda
              </h1>
              {auth.status === 'loading' ? (
                <p className={`text-xs ${textMuted}`}>Anmeldung wird geprüft …</p>
              ) : auth.status === 'error' ? (
                <>
                  <p className={`text-xs leading-relaxed mb-4 ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>
                    Anmeldung nicht möglich: {auth.error}
                  </p>
                  <button onClick={() => window.location.reload()}
                    className={`text-xs px-4 py-2 rounded border transition-colors ${isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'}`}>
                    Erneut versuchen
                  </button>
                </>
              ) : (
                <>
                  <p className={`text-xs leading-relaxed mb-6 ${textMuted}`}>
                    Bitte mit dem Microsoft-Konto anmelden. Die Anmeldung läuft über
                    Microsoft Entra ID; die App selbst speichert keine Zugangsdaten.
                  </p>
                  <button onClick={auth.login}
                    className={`w-full flex items-center justify-center gap-2 text-xs px-4 py-2.5 rounded font-semibold transition-colors ${isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80'}`}>
                    <LogIn size={12} /> Mit Microsoft anmelden
                  </button>
                </>
              )}
            </div>
          </div>
        ) : denied ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className={`max-w-md w-full rounded-xl border p-8 text-center ${isDark ? 'border-rose-500/30 bg-rose-500/5' : 'border-rose-300 bg-rose-50'}`}>
              <AlertTriangle size={28} className={`mx-auto mb-4 ${isDark ? 'text-rose-400' : 'text-rose-600'}`} />
              <p className={`text-xs leading-relaxed mb-2 ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>
                Keine Berechtigung für diese App.
              </p>
              <p className={`text-[11px] leading-relaxed mb-6 ${textMuted}`}>
                {auth.user?.email} ist angemeldet, hat aber keine der Rollen{' '}
                <span className="font-mono">{joinOr(ROLE_KEYS.map(k => auth.config?.[k]))}</span>.
                Die Zuweisung erfolgt in Entra unter «Unternehmensanwendungen → Benutzer und Gruppen».
              </p>
              <button onClick={auth.logout}
                className={`text-xs px-4 py-2.5 rounded border transition-colors ${isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'}`}>
                Abmelden
              </button>
            </div>
          </div>
        ) : !dirHandle ? (
          // start / storage choice
          <div className="h-full flex items-center justify-center p-6">
            <div className={`max-w-md w-full rounded-xl border p-8 text-center ${border} ${isDark ? 'bg-white/2' : 'bg-black/2'}`}>
              <FolderOpen size={28} className={`mx-auto mb-4 ${textMuted}`} />
              <h1 className={`text-sm font-semibold uppercase tracking-widest mb-3 ${isDark ? 'text-white/70' : 'text-black/70'}`}>
                Betrieb Camunda
              </h1>
              <p className={`text-xs leading-relaxed mb-6 ${textMuted}`}>
                Wo liegen <span className="font-semibold">model.json</span> (Einstellungen) und der Unterordner{' '}
                <span className="font-semibold">errors/</span>? Fehlen sie, werden sie automatisch angelegt.
                Kein eigener Server — die Daten bleiben im gewählten Ordner.
              </p>
              <div className="space-y-3">
                {/* SharePoint */}
                {savedSharePoint ? (
                  <div className="space-y-1">
                    <button onClick={startSharePoint} disabled={spPreparing}
                      className={`w-full flex items-center justify-center gap-2 text-xs px-4 py-2.5 rounded font-semibold transition-colors disabled:opacity-50 ${isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80'}`}>
                      <Cloud size={12} /> {spPreparing ? 'Anmeldung …' : `Wieder verbinden: ${savedSharePoint.name}`}
                    </button>
                    <button onClick={forgetSharePoint} className={`text-[10px] ${textMuted} hover:underline`}>anderen SharePoint-Ordner wählen</button>
                  </div>
                ) : (
                  <button onClick={startSharePoint} disabled={spPreparing}
                    title={auth.loginAvailable ? '' : 'Beim ersten Mal: Einrichtungs-Link vom Admin öffnen oder IDs eintragen'}
                    className={`w-full flex items-center justify-center gap-2 text-xs px-4 py-2.5 rounded font-semibold transition-colors disabled:opacity-40 ${isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80'}`}>
                    <Cloud size={12} /> {spPreparing ? 'Anmeldung …' : 'SharePoint-Ordner verbinden'}
                  </button>
                )}
                {/* Local */}
                {savedHandleName ? (
                  <>
                    <button onClick={reconnectDirectory}
                      className={`w-full flex items-center justify-center gap-2 text-xs px-4 py-2 rounded border transition-colors ${isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'}`}>
                      <FolderOpen size={12} /> Wieder verbinden: {savedHandleName}
                    </button>
                    <button onClick={pickDirectory} className={`text-[10px] ${textMuted} hover:underline`}>anderen lokalen Ordner wählen</button>
                  </>
                ) : (
                  <button onClick={pickDirectory}
                    className={`w-full flex items-center justify-center gap-2 text-xs px-4 py-2 rounded border transition-colors ${isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'}`}>
                    <FolderOpen size={12} /> Lokalen Ordner wählen
                  </button>
                )}
              </div>
              <p className={`text-[10px] leading-relaxed mt-5 ${textMuted}`}>
                SharePoint: Link zum Ordner einfügen, Anmeldung mit dem Microsoft-Konto, Berechtigungen aus SharePoint —
                funktioniert in jedem Browser. Lokaler Ordner (auch OneDrive-/Drive-Sync): Chrome oder Edge.
              </p>
            </div>
          </div>
        ) : modelError ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className={`max-w-md w-full rounded-xl border p-8 text-center ${isDark ? 'border-rose-500/30 bg-rose-500/5' : 'border-rose-300 bg-rose-50'}`}>
              <AlertTriangle size={28} className={`mx-auto mb-4 ${isDark ? 'text-rose-400' : 'text-rose-600'}`} />
              <p className={`text-xs leading-relaxed mb-6 ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>{modelError}</p>
              <button onClick={pickDirectory}
                className={`text-xs px-4 py-2.5 rounded border transition-colors ${isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'}`}>
                Anderen Ordner wählen
              </button>
            </div>
          </div>
        ) : !model ? (
          <div className={`h-full flex items-center justify-center text-xs ${textMuted}`}>Lade model.json …</div>
        ) : view === 'howto' ? (
          <HowtoView />
        ) : view === 'admin' && canAdmin ? (
          <AdminView onBack={() => setRoute({ ...route, view: 'list' }, true)} />
        ) : (
          <ErrorsView state={route.list} setState={setList}
            onOpen={id => setRoute({ ...route, view: 'list', id, isNew: false }, true)}
            onNew={() => setRoute({ ...route, view: 'list', id: null, isNew: true }, true)} />
        )}
      </div>

      {/* Error in detail / create new */}
      {!gated && !denied && dirHandle && model && view === 'list' && (route.id || route.isNew) && (
        <ErrorPanel id={route.id} isNew={route.isNew}
          onClose={() => setRoute({ ...route, id: null, isNew: false }, true)}
          onOpen={id => setRoute({ ...route, id, isNew: false }, true)} />
      )}

      {/* Own name (without sign-in) */}
      {nameOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={() => setNameOpen(false)}>
          <div className={`max-w-sm w-full rounded-xl border p-6 ${isDark ? 'border-white/15 bg-[#16171a]' : 'border-black/15 bg-white'}`}
            onClick={e => e.stopPropagation()}>
            <h3 className={`text-sm font-semibold mb-2 ${isDark ? 'text-white' : 'text-black'}`}>Dein Name</h3>
            <p className={`text-[11px] leading-relaxed mb-3 ${textMuted}`}>
              Steht bei Erfassen, Bearbeiten und Zählen. Wird nur in diesem Browser gemerkt — mit Microsoft-Anmeldung kommt er von dort.
            </p>
            <input value={nameDraft} autoFocus onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setLocalName(nameDraft); setNameOpen(false); } }}
              placeholder="Vorname Nachname"
              className={`w-full text-xs px-3 py-2 rounded border outline-none transition-colors ${isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30' : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30'}`} />
            <div className="flex gap-2 pt-4">
              <button onClick={() => setNameOpen(false)}
                className={`flex-1 text-xs py-2 rounded border transition-colors ${isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'}`}>
                Abbrechen
              </button>
              <button onClick={() => { setLocalName(nameDraft); setNameOpen(false); }}
                className={`flex-1 text-xs py-2 rounded font-semibold transition-colors ${isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80'}`}>
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Setup: Microsoft sign-in for this browser (once) */}
      {setupOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={() => setSetupOpen(false)}>
          <div className={`max-w-lg w-full rounded-xl border p-6 ${isDark ? 'border-white/15 bg-[#16171a]' : 'border-black/15 bg-white'}`}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <h3 className={`flex items-center gap-2 text-sm font-semibold ${isDark ? 'text-white' : 'text-black'}`}>
                <KeyRound size={14} /> Microsoft-Anmeldung einrichten
              </h3>
              <button onClick={() => setSetupOpen(false)}
                className={`p-1 rounded flex-shrink-0 transition-colors ${isDark ? 'text-white/25 hover:text-white/70' : 'text-black/25 hover:text-black/70'}`}>
                <X size={14} />
              </button>
            </div>
            <p className={`text-[11px] leading-relaxed mb-3 ${textMuted}`}>
              Am einfachsten den <span className="font-semibold">Einrichtungs-Link</span> vom Admin öffnen — er
              richtet Anmeldung und SharePoint-Ordner in einem Schritt ein. Alternativ hier die beiden IDs der
              App-Registrierung in Microsoft Entra eintragen (einmalig pro Browser, keine Geheimnisse).
            </p>
            <div className="space-y-2">
              <label className={`block text-[10px] uppercase tracking-wider ${textMuted}`}>Verzeichnis-ID (Tenant)</label>
              <input value={setupTenant} onChange={e => setSetupTenant(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000"
                className={`w-full text-xs px-3 py-2 rounded border outline-none font-mono transition-colors ${isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30' : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30'}`} />
              <label className={`block text-[10px] uppercase tracking-wider ${textMuted}`}>Anwendungs-ID (Client)</label>
              <input value={setupClient} onChange={e => setSetupClient(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000"
                className={`w-full text-xs px-3 py-2 rounded border outline-none font-mono transition-colors ${isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30' : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30'}`} />
            </div>
            <div className="pt-4">
              <RoleFields roles={setupRoles} onChange={setSetupRoles} isDark={isDark} />
              <p className={`text-[10px] leading-relaxed mt-1 ${textMuted}`}>
                Gehen in die Einstellungen des nächsten neuen Ordners, den du verbindest (innert 24 Stunden).
                Hat der Ordner schon Einstellungen, gelten dessen Rollen (änderbar unter Admin → Anmeldung).
              </p>
            </div>
            {setupError && <p className={`text-[11px] mt-2 ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>{setupError}</p>}
            <div className="flex gap-2 pt-4">
              <button onClick={() => setSetupOpen(false)}
                className={`flex-1 text-xs py-2 rounded border transition-colors ${isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'}`}>
                Abbrechen
              </button>
              <button onClick={saveSetup} disabled={!GUID_RE.test(setupTenant.trim()) || !GUID_RE.test(setupClient.trim())}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded font-semibold transition-colors disabled:opacity-40 ${isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80'}`}>
                <LogIn size={12} /> Speichern und anmelden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connect a SharePoint folder */}
      {spOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={() => !spBusy && setSpOpen(false)}>
          <div className={`max-w-lg w-full rounded-xl border p-6 ${isDark ? 'border-white/15 bg-[#16171a]' : 'border-black/15 bg-white'}`}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-black'}`}>SharePoint-Ordner verbinden</h3>
              <button onClick={() => setSpOpen(false)} disabled={spBusy}
                className={`p-1 rounded flex-shrink-0 transition-colors ${isDark ? 'text-white/25 hover:text-white/70' : 'text-black/25 hover:text-black/70'}`}>
                <X size={14} />
              </button>
            </div>
            <p className={`text-[11px] leading-relaxed mb-3 ${textMuted}`}>
              Link zum Ordner aus SharePoint oder Teams einfügen (Ordner öffnen → «Link kopieren» bzw. die Adresse aus der
              Browserzeile). In diesem Ordner liegen model.json und errors/ — fehlen sie, legt die App sie an.
            </p>
            <input value={spLink} autoFocus disabled={spBusy}
              onChange={e => setSpLink(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && spLink.trim()) doConnectSharePoint(); }}
              placeholder="https://firma.sharepoint.com/sites/Betrieb/Freigegebene Dokumente/orch-ops"
              className={`w-full text-xs px-3 py-2 rounded border outline-none font-mono transition-colors ${isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/20 focus:border-white/30' : 'bg-black/5 border-black/10 text-black placeholder-black/20 focus:border-black/30'}`} />
            {spError && <p className={`text-[11px] mt-2 ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>{spError}</p>}
            <div className="flex gap-2 pt-4">
              <button onClick={() => setSpOpen(false)} disabled={spBusy}
                className={`flex-1 text-xs py-2 rounded border transition-colors ${isDark ? 'border-white/15 text-white/50 hover:border-white/30 hover:text-white' : 'border-black/15 text-black/50 hover:border-black/30 hover:text-black'}`}>
                Abbrechen
              </button>
              <button onClick={doConnectSharePoint} disabled={spBusy || !spLink.trim()}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded font-semibold transition-colors disabled:opacity-40 ${isDark ? 'bg-white text-black hover:bg-white/90' : 'bg-black text-white hover:bg-black/80'}`}>
                <Cloud size={12} /> {spBusy ? 'Verbinde …' : 'Verbinden'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
