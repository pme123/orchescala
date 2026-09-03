// Anmeldung über Microsoft Entra ID (MSAL, Authorization Code Flow + PKCE).
//
// Die App ist eine reine Client-App. Beim lokalen Ordner ist die Anmeldung
// ein Zugangs-Gate für die Oberfläche (wer darf rein, wer ist Prüfer/in,
// welche Stufe); beim SharePoint-Ordner liefert sie zusätzlich das Token für
// Microsoft Graph — dort setzt SharePoint die Berechtigungen serverseitig
// durch.
//
// Konfiguration:
// - Tenant-/Client-ID (öffentliche Werte): `auth` in der model.json (Admin)
//   und lokal im Browser gemerkt (localStorage). Damit der SharePoint-Modus
//   schon VOR dem Ordner anmelden kann, lassen sich die IDs pro Browser
//   einmalig hinterlegen: über einen Einrichtungs-Link
//   (?tenant=…&client=…), eine Konfigurationsdatei oder manuell — beides
//   erzeugt der Admin in der App. Nichts davon liegt im Repo/Deployment.
// - Rollen (Admin/Reviewer/Viewer) und enabled (Login-Pflicht beim lokalen
//   Ordner): `auth` in der model.json.
// Die lokal gemerkten IDs bleiben erhalten, auch wenn eine model.json ohne
// IDs geladen wird. MSAL wird nur geladen, wenn eine Anmeldung ansteht.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import type { AuthSettings } from './types';

export type AuthConfig = AuthSettings;

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AccessLevel = 'admin' | 'reviewer' | 'viewer' | 'none';

export interface AuthUser {
  name: string;
  email: string;
  roles: string[];
  level: AccessLevel;
  isAdmin: boolean;
}

export const LEVEL_LABELS: Record<AccessLevel, string> = {
  admin: 'Admin', reviewer: 'Reviewer', viewer: 'Viewer (nur lesen)', none: 'keine Berechtigung',
};

type AuthStatus = 'loading' | 'disabled' | 'signedOut' | 'signedIn' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  config: AuthConfig | null;
  /** Tenant-/Client-ID bekannt → Login möglich */
  loginAvailable: boolean;
  /** wirksame IDs */
  ids: { tenantId: string; clientId: string } | null;
  /** IDs für diesen Browser hinterlegen (Einrichtung) */
  setLocalIds: (tenantId: string, clientId: string) => void;
  login: () => Promise<void>;
  /** Anmeldung für den SharePoint-Modus (mit Graph-Berechtigung), auch ohne enabled.
   *  'ready' = angemeldet mit Graph-Token; 'redirect' = Anmeldung läuft; 'setup' = IDs fehlen */
  loginForSharePoint: () => Promise<'ready' | 'redirect' | 'setup'>;
  logout: () => Promise<void>;
  /** Access-Token für die angegebenen Scopes (still, sonst Redirect) */
  getToken: (scopes: string[]) => Promise<string>;
  /** Konfiguration aus der model.json übernehmen (beim Laden und nach Admin-Änderungen) */
  applyConfig: (cfg: AuthSettings | null | undefined) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LOGIN_SCOPES = ['openid', 'profile', 'email'];
const GRAPH_LOGIN_SCOPES = ['openid', 'profile', 'email', 'Files.ReadWrite.All'];

// Redirect-URI = Ursprung + Basis-Pfad der App (lokal wie auf GitHub Pages)
const redirectUri = () => `${window.location.origin}${import.meta.env.BASE_URL}`;

const CACHE_KEY = 'orch-spec.auth';
const MODE_KEY = 'orch-spec.mode';

function normalize(raw: unknown): AuthConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    tenantId: String(r.tenantId ?? '').trim(),
    clientId: String(r.clientId ?? '').trim(),
    ...(r.adminRole ? { adminRole: String(r.adminRole).trim() } : {}),
    ...(r.reviewerRole ? { reviewerRole: String(r.reviewerRole).trim() } : {}),
    ...(r.viewerRole ? { viewerRole: String(r.viewerRole).trim() } : {}),
  };
}

// Zugriffsstufe aus den App-Rollen im ID-Token
export function levelOf(roles: string[], cfg: AuthConfig | null): AccessLevel {
  const adminRole = cfg?.adminRole, reviewerRole = cfg?.reviewerRole, viewerRole = cfg?.viewerRole;
  if (!adminRole && !reviewerRole && !viewerRole) return 'admin';
  if (adminRole && roles.includes(adminRole)) return 'admin';
  if (reviewerRole && roles.includes(reviewerRole)) return 'reviewer';
  if (viewerRole && roles.includes(viewerRole)) return 'viewer';
  // keine passende Rolle: ohne konfigurierte Reviewer-Rolle gilt «angemeldet = Reviewer»
  return reviewerRole ? 'none' : 'reviewer';
}

function readCache(): AuthConfig | null {
  try { return normalize(JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')); } catch { return null; }
}
function writeCache(cfg: AuthConfig | null) {
  try {
    if (cfg) localStorage.setItem(CACHE_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
}

export const PENDING_FOLDER_KEY = 'orch-spec.pendingFolder';

// Einrichtungs-Link: ?tenant=…&client=…[&folder=…] einmalig übernehmen und aus
// der URL entfernen. Der SharePoint-Ordner wird nach der Anmeldung verbunden.
function takeIdsFromUrl(): { tenantId: string; clientId: string } | null {
  try {
    const u = new URL(window.location.href);
    const tenantId = (u.searchParams.get('tenant') ?? '').trim();
    const clientId = (u.searchParams.get('client') ?? '').trim();
    const folder = (u.searchParams.get('folder') ?? '').trim();
    if (!GUID_RE.test(tenantId) || !GUID_RE.test(clientId)) return null;
    if (/^https:\/\//i.test(folder)) {
      try { localStorage.setItem(PENDING_FOLDER_KEY, folder); localStorage.setItem(MODE_KEY, 'sharepoint'); } catch { /* ignore */ }
    }
    u.searchParams.delete('tenant'); u.searchParams.delete('client'); u.searchParams.delete('folder');
    window.history.replaceState(null, '', u.toString());
    return { tenantId, clientId };
  } catch {
    return null;
  }
}

// Einrichtungs-Link für die Weitergabe (Admin): IDs + SharePoint-Ordner
export function setupLink(tenantId: string, clientId: string, folderUrl?: string): string {
  const u = new URL(`${window.location.origin}${import.meta.env.BASE_URL}`);
  u.searchParams.set('tenant', tenantId);
  u.searchParams.set('client', clientId);
  if (folderUrl) u.searchParams.set('folder', folderUrl);
  return u.toString();
}

const devBypass = () => import.meta.env.DEV && new URLSearchParams(location.search).has('noauth');
const isValidIds = (cfg: { tenantId: string; clientId: string } | null | undefined): cfg is { tenantId: string; clientId: string } =>
  !!cfg && GUID_RE.test(cfg.tenantId) && GUID_RE.test(cfg.clientId);
const sharePointMode = () => { try { return localStorage.getItem(MODE_KEY) === 'sharepoint'; } catch { return false; } };

function toUser(account: AccountInfo, cfg: AuthConfig | null): AuthUser {
  const claims = (account.idTokenClaims ?? {}) as Record<string, unknown>;
  const name = String(claims.name ?? account.name ?? account.username);
  const email = String(claims.preferred_username ?? claims.email ?? account.username);
  const roles = Array.isArray(claims.roles) ? (claims.roles as unknown[]).map(String) : [];
  const level = levelOf(roles, cfg);
  return { name, email, roles, level, isAdmin: level === 'admin' };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const pcaRef = useRef<PublicClientApplication | null>(null);
  const accountRef = useRef<AccountInfo | null>(null);
  const configRef = useRef<AuthConfig | null>(null);
  const runningKeyRef = useRef<string>(''); // IDs, mit denen MSAL läuft

  const effectiveIds = (cfg: AuthConfig | null) =>
    isValidIds(cfg) ? { tenantId: cfg.tenantId, clientId: cfg.clientId } : null;

  // MSAL starten: Rückkehr vom Login verarbeiten, sonst vorhandenes Konto verwenden
  const startMsal = useCallback(async (ids: { tenantId: string; clientId: string }) => {
    const key = `${ids.tenantId}|${ids.clientId}`;
    if (runningKeyRef.current === key && pcaRef.current) return pcaRef.current;
    runningKeyRef.current = key;
    setStatus('loading');
    setError(null);
    try {
      const { PublicClientApplication } = await import('@azure/msal-browser');
      const pca = new PublicClientApplication({
        auth: {
          clientId: ids.clientId,
          authority: `https://login.microsoftonline.com/${ids.tenantId}`,
          redirectUri: redirectUri(),
          postLogoutRedirectUri: redirectUri(),
        },
        cache: { cacheLocation: 'localStorage' },
      });
      await pca.initialize();
      pcaRef.current = pca;
      const result = await pca.handleRedirectPromise();
      // Konto des konfigurierten Tenants bevorzugen (Browser kann mehrere kennen)
      const all = pca.getAllAccounts();
      const account = result?.account ?? all.find(a => a.tenantId === ids.tenantId) ?? all[0] ?? null;
      if (runningKeyRef.current !== key) return pca; // inzwischen andere IDs
      if (account) {
        pca.setActiveAccount(account);
        accountRef.current = account;
        setUser(toUser(account, configRef.current));
        setStatus('signedIn');
      } else {
        accountRef.current = null;
        setUser(null);
        setStatus('signedOut');
      }
      return pca;
    } catch (e) {
      console.error('[orch-spec] auth:', e);
      if (runningKeyRef.current === key) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
      return null;
    }
  }, []);

  const applyConfig = useCallback((raw: AuthSettings | null | undefined) => {
    let cfg = normalize(raw);
    // Lokal bekannte IDs behalten, wenn die model.json keine (gültigen) liefert
    const prev = readCache();
    if (!isValidIds(cfg) && isValidIds(prev)) {
      cfg = { ...(cfg ?? { enabled: false, tenantId: '', clientId: '' }), tenantId: prev.tenantId, clientId: prev.clientId };
    }
    writeCache(cfg);
    setConfig(cfg);
    configRef.current = cfg;
    // Stufe mit den neuen Rollen neu berechnen
    if (accountRef.current) setUser(toUser(accountRef.current, cfg));
    if (devBypass()) { setStatus('disabled'); return; }
    const needLogin = cfg?.enabled === true || sharePointMode();
    if (!needLogin) { setStatus('disabled'); return; }
    const ids = effectiveIds(cfg);
    if (!ids) {
      if (cfg?.enabled) {
        setError('Anmeldung ist aktiviert, aber Tenant-ID/Client-ID sind keine gültigen IDs (Admin → Anmeldung).');
        setStatus('error');
      } else {
        setStatus('disabled');
      }
      return;
    }
    void startMsal(ids);
  }, [startMsal]);

  // IDs für diesen Browser hinterlegen (Einrichtungsdialog / Link / Datei)
  const setLocalIds = useCallback((tenantId: string, clientId: string) => {
    const prev = readCache();
    const cfg: AuthConfig = { ...(prev ?? { enabled: false, tenantId: '', clientId: '' }), tenantId: tenantId.trim(), clientId: clientId.trim() };
    applyConfig(cfg);
  }, [applyConfig]);

  // Start: Einrichtungs-Link auswerten, dann zuletzt bekannte Konfiguration
  // anwenden (z. B. Rückkehr vom Microsoft-Login); die model.json des Ordners
  // aktualisiert sie anschliessend über applyConfig
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    const fromUrl = takeIdsFromUrl();
    if (fromUrl) setLocalIds(fromUrl.tenantId, fromUrl.clientId);
    else applyConfig(readCache());
  }, [applyConfig, setLocalIds]);

  const login = async () => {
    const pca = pcaRef.current;
    if (!pca) return;
    try {
      await pca.loginRedirect({ scopes: sharePointMode() ? GRAPH_LOGIN_SCOPES : LOGIN_SCOPES, prompt: 'select_account' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  };

  const loginForSharePoint = async (): Promise<'ready' | 'redirect' | 'setup'> => {
    if (devBypass()) return 'ready'; // Entwicklung mit Graph-Mock
    const ids = effectiveIds(configRef.current ?? readCache());
    if (!ids) return 'setup';
    try { localStorage.setItem(MODE_KEY, 'sharepoint'); } catch { /* ignore */ }
    const pca = await startMsal(ids);
    if (!pca) return 'redirect';
    const account = pca.getActiveAccount();
    try {
      if (account) {
        // Schon angemeldet: Graph-Token still holen; klappt das nicht (z. B.
        // fehlende Zustimmung oder fremde Browser-Sitzung), interaktiv nachholen
        try {
          await pca.acquireTokenSilent({ scopes: GRAPH_LOGIN_SCOPES, account });
          return 'ready';
        } catch {
          await pca.acquireTokenRedirect({ scopes: GRAPH_LOGIN_SCOPES, account, loginHint: account.username });
          return 'redirect';
        }
      }
      await pca.loginRedirect({ scopes: GRAPH_LOGIN_SCOPES, prompt: 'select_account' });
      return 'redirect';
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
      return 'redirect';
    }
  };

  const logout = async () => {
    const pca = pcaRef.current;
    if (!pca) return;
    await pca.logoutRedirect({ account: pca.getActiveAccount() ?? undefined });
  };

  const getToken = useCallback(async (scopes: string[]): Promise<string> => {
    if (devBypass()) return 'dev-token';
    const pca = pcaRef.current;
    const account = pca?.getActiveAccount() ?? accountRef.current;
    if (!pca || !account) throw new Error('Nicht angemeldet.');
    try {
      const res = await pca.acquireTokenSilent({ scopes, account });
      return res.accessToken;
    } catch (e) {
      const code = (e as { errorCode?: string })?.errorCode ?? (e instanceof Error ? e.name : 'unbekannt');
      console.warn('[orch-spec] acquireTokenSilent:', code, e);
      // Stille Erneuerung gescheitert (fehlende Zustimmung, abgelaufene oder
      // fremde Browser-Sitzung) → einmal interaktiv; Schleifenschutz pro Sitzung
      const guardKey = `orch-spec.tokenRedirect:${scopes.join(' ')}`;
      const last = Number(sessionStorage.getItem(guardKey) ?? 0);
      if (Date.now() - last > 20_000) {
        sessionStorage.setItem(guardKey, String(Date.now()));
        try {
          await pca.acquireTokenRedirect({ scopes, account, loginHint: account.username });
          throw new Error('Anmeldung wird erneuert …');
        } catch (e2) {
          const code2 = (e2 as { errorCode?: string })?.errorCode;
          if (code2 === 'interaction_in_progress') {
            throw new Error('Eine Anmeldung ist noch in Arbeit — bitte Seite neu laden.');
          }
          throw e2;
        }
      }
      throw new Error(`Token-Erneuerung fehlgeschlagen (${code}) — bitte Seite neu laden und erneut anmelden.`);
    }
  }, []);

  const ids = effectiveIds(config);
  const loginAvailable = !!ids;

  return (
    <AuthContext.Provider value={{ status, user, error, config, loginAvailable, ids, setLocalIds, login, loginForSharePoint, logout, getToken, applyConfig }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth ausserhalb von AuthProvider');
  return ctx;
}

// Was darf die aktuelle Person? Ohne aktive Anmeldung: alles.
/**
 * Wer schreibt gerade? Für Kommentare. Ohne Anmeldung (Entwicklung, lokaler
 * Ordner ohne Entra) gibt es keinen Namen — dann steht «Ich» daneben, was
 * ehrlicher ist als ein erfundener.
 */
export function useAuthorName(): string {
  const { user } = useAuth();
  return user?.name?.trim() || 'Ich';
}

export function usePermissions(): { level: AccessLevel; canAdmin: boolean; canEdit: boolean; canView: boolean } {
  const { status, user } = useAuth();
  // Entwicklung: ?noauth&as=viewer|reviewer simuliert eine Stufe ohne Login
  const devAs = import.meta.env.DEV ? new URLSearchParams(location.search).get('as') : null;
  const level: AccessLevel = status === 'disabled'
    ? (devAs === 'viewer' || devAs === 'reviewer' ? devAs : 'admin')
    : (user?.level ?? 'none');
  return {
    level,
    canAdmin: level === 'admin',
    canEdit: level === 'admin' || level === 'reviewer',
    canView: level !== 'none',
  };
}
