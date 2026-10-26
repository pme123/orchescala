// Sign-in via Microsoft Entra ID (MSAL, authorization code flow + PKCE).
//
// The app is a pure client app. With a local folder the sign-in is an access
// gate for the UI (who may enter, who is a reviewer, which level); with a
// SharePoint folder it additionally provides the token for Microsoft Graph —
// there SharePoint enforces the permissions on the server side.
//
// Configuration:
// - Tenant/client ID (public values): `auth` in the model.json (admin) and
//   remembered locally in the browser (localStorage). So that SharePoint mode
//   can sign in BEFORE the folder is known, the IDs can be stored once per
//   browser: via a setup link (?tenant=…&client=…), a configuration file or
//   manually — the admin generates both in the app. None of it lives in the
//   repo/deployment.
// - Roles (admin/reviewer/viewer) and enabled (sign-in required for the
//   local folder): `auth` in the model.json. Defaults are the OrchOps roles
//   (DEFAULT_ROLES); the setup dialog lets them be overridden (e.g. with the
//   orch-spec ones). Those are kept apart as pending roles and only go into
//   the model.json of the next new folder.
// The locally remembered IDs are kept even if a model.json without IDs is
// loaded. MSAL is only loaded when a sign-in is due.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import type { AuthSettings } from './types';

export type AuthConfig = AuthSettings;

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AccessLevel = 'admin' | 'reviewer' | 'viewer' | 'none';

// Roles: the own OrchOps roles by default. Whoever wants the same as orch-spec
// (one role assignment in Entra for both apps) puts in ORCH_SPEC_ROLES.
export const ROLE_KEYS = ['adminRole', 'reviewerRole', 'viewerRole'] as const;
export type RoleKey = typeof ROLE_KEYS[number];
export type Roles = Pick<AuthSettings, RoleKey>;
export const DEFAULT_ROLES: Required<Roles> = {
  adminRole: 'OrchOps.Admin',
  reviewerRole: 'OrchOps.Editor',
  viewerRole: 'OrchOps.Viewer',
};
export const ORCH_SPEC_ROLES: Required<Roles> = {
  adminRole: 'OrchSpec.Admin',
  reviewerRole: 'OrchSpec.Editor',
  viewerRole: 'OrchSpec.Viewer',
};

/** clean up roles: trimmed, empty ones left out */
export function cleanRoles(r: Roles): Roles {
  const out: Roles = {};
  for (const k of ROLE_KEYS) { const v = (r[k] ?? '').trim(); if (v) out[k] = v; }
  return out;
}

/** no role set: everyone signed in is admin */
export const hasNoRoles = (r: Roles): boolean => ROLE_KEYS.every(k => !(r[k] ?? '').trim());

/** ask before saving settings without roles; true = go ahead */
export function confirmNoRoles(r: Roles): boolean {
  return !hasNoRoles(r) || confirm('Keine Rollen gesetzt: jede angemeldete Person ist Admin und darf alles, auch die Einstellungen ändern.\n\nTrotzdem so speichern?');
}

/** same roles once cleaned (spaces and empty fields do not count) */
export function sameRoles(a: Roles, b: Roles): boolean {
  const x = cleanRoles(a), y = cleanRoles(b);
  return ROLE_KEYS.every(k => x[k] === y[k]);
}

/** settings with these roles instead of their own (cleaned) */
export function withRoles(cfg: AuthSettings, roles: Roles): AuthSettings {
  const out: AuthSettings = { ...cfg };
  for (const k of ROLE_KEYS) delete out[k];
  return { ...out, ...cleanRoles(roles) };
}

/** roles from stored JSON; anything unusable → null */
export function parseRoles(v: unknown): Roles | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const out: Roles = {};
  for (const k of ROLE_KEYS) if (typeof r[k] === 'string') out[k] = r[k] as string;
  return cleanRoles(out);
}

// Roles chosen in the setup dialog («pending»): kept apart from the cached
// settings (which carry the roles of the last folder) and survive the
// sign-in redirect. Only a folder the user connects (picked, link, setup
// link) uses them — a folder restored on start never does. A new one gets
// them in its model.json; an existing one keeps its own (modelRepo.ts). If
// they could not be written (create failed, no IDs) they stay for another
// try, but expire after a day.
export const PENDING_ROLES_TTL_MS = 24 * 60 * 60 * 1000;
/** a clock set back a little (time sync) must not drop the choice */
const CLOCK_SKEW_MS = 10 * 60 * 1000;
const PENDING_ROLES_KEY = 'orch-ops.pendingRoles';

/** stored pending roles; expired or unusable → null. `{ roles: {} }` is a
 *  valid choice (deliberately no roles) — the time stamp tells it apart
 *  from nothing stored or a broken entry. */
export function parsePendingRoles(raw: string | null, now: number): Roles | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { roles?: unknown; at?: unknown } | null;
    if (!v || typeof v.at !== 'number' || now - v.at > PENDING_ROLES_TTL_MS || v.at - now > CLOCK_SKEW_MS) return null;
    return parseRoles(v.roles);
  } catch {
    return null;
  }
}

/** what loading a folder came to (failures always keep the pending roles) */
export type FolderLoad = 'existing' | 'created' | 'createdWithoutAuth';

/** roles for the model.json of a new folder: those chosen at setup when the
 *  user connected it (none chosen = none, everyone signed in is admin),
 *  otherwise the defaults */
export function newFolderRoles(pending: Roles | null, connected: boolean): Roles {
  return connected && pending ? cleanRoles(pending) : { ...DEFAULT_ROLES };
}

/** after loading a folder: are the pending roles used up? */
export function pendingRolesAfterLoad(connected: boolean, outcome: FolderLoad): 'clear' | 'keep' {
  return connected && outcome !== 'createdWithoutAuth' ? 'clear' : 'keep';
}

/** remember the roles chosen at setup; false = browser storage not available */
export function setPendingRoles(roles: Roles): boolean {
  try {
    localStorage.setItem(PENDING_ROLES_KEY, JSON.stringify({ roles: cleanRoles(roles), at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}
export function peekPendingRoles(): Roles | null {
  return readPendingRoles()?.roles ?? null;
}
/** the pending roles with their stored text, so that clearPendingRoles(raw)
 *  clears only this very choice — not a newer one saved while a folder loaded */
export function readPendingRoles(): { roles: Roles; raw: string } | null {
  try {
    const raw = localStorage.getItem(PENDING_ROLES_KEY);
    const roles = parsePendingRoles(raw, Date.now());
    if (raw && !roles) localStorage.removeItem(PENDING_ROLES_KEY); // expired or unusable
    return raw && roles ? { roles, raw } : null;
  } catch {
    return null;
  }
}
export function clearPendingRoles(raw: string) {
  try {
    if (localStorage.getItem(PENDING_ROLES_KEY) === raw) localStorage.removeItem(PENDING_ROLES_KEY);
  } catch { /* nothing stored then either */ }
}

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
  /** tenant/client ID known → sign-in possible */
  loginAvailable: boolean;
  /** effective IDs */
  ids: { tenantId: string; clientId: string } | null;
  /** store IDs for this browser (setup) */
  setLocalIds: (tenantId: string, clientId: string) => void;
  login: () => Promise<void>;
  /** Sign-in for SharePoint mode (with Graph permission), even without enabled.
   *  'ready' = signed in with Graph token; 'redirect' = sign-in in progress; 'setup' = IDs missing */
  loginForSharePoint: () => Promise<'ready' | 'redirect' | 'setup'>;
  logout: () => Promise<void>;
  /** access token for the given scopes (silently, otherwise redirect) */
  getToken: (scopes: string[]) => Promise<string>;
  /** take over the configuration from the model.json (on load and after admin changes) */
  applyConfig: (cfg: AuthSettings | null | undefined) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LOGIN_SCOPES = ['openid', 'profile', 'email'];
const GRAPH_LOGIN_SCOPES = ['openid', 'profile', 'email', 'Files.ReadWrite.All'];

/**
 * Where the app lives — resolved against the document URL, not the origin: in
 * the docs site it is built with a relative base (`./`), `origin + BASE_URL`
 * would give `https://host./` there. Locally `…/orch-ops/`, in the site its sub-folder.
 */
export const appUrl = () => new URL(import.meta.env.BASE_URL, document.baseURI);

// Redirect URI = the address of the app (without query) — register it like this in Entra
const redirectUri = () => appUrl().href;

const CACHE_KEY = 'orch-ops.auth';
const MODE_KEY = 'orch-ops.mode';

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

// Access level from the app roles in the ID token
export function levelOf(roles: string[], cfg: AuthConfig | null): AccessLevel {
  const adminRole = cfg?.adminRole, reviewerRole = cfg?.reviewerRole, viewerRole = cfg?.viewerRole;
  if (!adminRole && !reviewerRole && !viewerRole) return 'admin';
  if (adminRole && roles.includes(adminRole)) return 'admin';
  if (reviewerRole && roles.includes(reviewerRole)) return 'reviewer';
  if (viewerRole && roles.includes(viewerRole)) return 'viewer';
  // no matching role: without a configured reviewer role, «signed in = reviewer»
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

export const PENDING_FOLDER_KEY = 'orch-ops.pendingFolder';

// Setup link: take over ?tenant=…&client=…[&folder=…] once and remove it from
// the URL. The SharePoint folder is connected after the sign-in.
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

// Setup link to pass on (admin): IDs + SharePoint folder
export function setupLink(tenantId: string, clientId: string, folderUrl?: string): string {
  const u = appUrl();
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
  const runningKeyRef = useRef<string>(''); // IDs MSAL is running with

  const effectiveIds = (cfg: AuthConfig | null) =>
    isValidIds(cfg) ? { tenantId: cfg.tenantId, clientId: cfg.clientId } : null;

  // start MSAL: handle the return from sign-in, otherwise use an existing account
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
      // prefer the account of the configured tenant (the browser may know several)
      const all = pca.getAllAccounts();
      const account = result?.account ?? all.find(a => a.tenantId === ids.tenantId) ?? all[0] ?? null;
      if (runningKeyRef.current !== key) return pca; // other IDs meanwhile
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
      console.error('[orch-ops] auth:', e);
      if (runningKeyRef.current === key) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
      return null;
    }
  }, []);

  const applyConfig = useCallback((raw: AuthSettings | null | undefined) => {
    let cfg = normalize(raw);
    // keep locally known IDs if the model.json provides no (valid) ones
    const prev = readCache();
    if (!isValidIds(cfg) && isValidIds(prev)) {
      cfg = { ...(cfg ?? { enabled: false, tenantId: '', clientId: '' }), tenantId: prev.tenantId, clientId: prev.clientId };
    }
    writeCache(cfg);
    setConfig(cfg);
    configRef.current = cfg;
    // recompute the level with the new roles
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

  // store IDs for this browser (setup dialog / link / file)
  const setLocalIds = useCallback((tenantId: string, clientId: string) => {
    const prev = readCache();
    const cfg: AuthConfig = { ...(prev ?? { enabled: false, tenantId: '', clientId: '' }), tenantId: tenantId.trim(), clientId: clientId.trim() };
    applyConfig(cfg);
  }, [applyConfig]);

  // Start: evaluate the setup link, then apply the last known configuration
  // (e.g. return from the Microsoft sign-in); the folder's model.json then
  // updates it via applyConfig
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
    if (devBypass()) return 'ready'; // development with Graph mock
    const ids = effectiveIds(configRef.current ?? readCache());
    if (!ids) return 'setup';
    try { localStorage.setItem(MODE_KEY, 'sharepoint'); } catch { /* ignore */ }
    const pca = await startMsal(ids);
    if (!pca) return 'redirect';
    const account = pca.getActiveAccount();
    try {
      if (account) {
        // Already signed in: get the Graph token silently; if that fails (e.g.
        // missing consent or a foreign browser session), catch up interactively
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
      console.warn('[orch-ops] acquireTokenSilent:', code, e);
      // Silent renewal failed (missing consent, expired or foreign browser
      // session) → once interactively; loop guard per session
      const guardKey = `orch-ops.tokenRedirect:${scopes.join(' ')}`;
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

/**
 * Who is writing? For comments. Without sign-in (development, local folder
 * without Entra) there is no name — then «Ich» is shown, which is more honest
 * than a made-up one.
 */
export function useAuthorName(): string {
  const { user } = useAuth();
  return user?.name?.trim() || 'Ich';
}

// What may the current person do? Without active sign-in: everything.
export function usePermissions(): { level: AccessLevel; canAdmin: boolean; canEdit: boolean; canView: boolean } {
  const { status, user } = useAuth();
  // development: ?noauth&as=viewer|reviewer simulates a level without sign-in
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
