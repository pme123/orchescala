import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { ApiError } from './gatewayTypes';

// Nur Seiten mit Login brauchen das – die öffentlichen laden nie einen IdP. Die Verbindung kommt
// zur Laufzeit aus config.json (neben index.html), so läuft dasselbe Bundle gegen jeden IdP.
type AuthConfig = { authority: string; clientId: string };

let manager: Promise<UserManager> | null = null;

function userManager(): Promise<UserManager> {
  manager ??= fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error('config.json fehlt – ohne IdP keine Anmeldung');
      return r.json() as Promise<AuthConfig>;
    })
    .then((config) => {
      const appUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;
      return new UserManager({
        authority: config.authority,
        client_id: config.clientId,
        redirect_uri: appUrl,
        post_logout_redirect_uri: appUrl,
        response_type: 'code', // Authorization Code + PKCE
        scope: 'openid profile email',
        automaticSilentRenew: true,
        userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      });
    });
  return manager;
}

/** Die Rückkehr vom IdP (code/state in der URL) – danach zurück auf die Seite vor der Anmeldung. */
export async function completeLogin(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  if (!(params.has('code') && params.has('state'))) return false;
  const user = await (await userManager()).signinRedirectCallback();
  const returnTo = typeof user.state === 'string' ? user.state : import.meta.env.BASE_URL;
  window.history.replaceState({}, '', returnTo);
  return true;
}

export async function currentUser(): Promise<User | null> {
  const user = await (await userManager()).getUser();
  return user && !user.expired ? user : null;
}

/** Zur Anmeldung – und danach zurück auf diese Seite (mit ihren Parametern). */
export async function login(): Promise<void> {
  const here = window.location.pathname + window.location.search;
  await (await userManager()).signinRedirect({ state: here });
}

export async function logout(): Promise<void> {
  await (await userManager()).signoutRedirect();
}

export async function accessToken(): Promise<string> {
  const um = await userManager();
  const user = await um.getUser();
  if (user && !user.expired) return user.access_token;
  // abgelaufen: zuerst still erneuern (Refresh-Token), erst dann zur Anmeldung
  if (user) {
    const renewed = await um.signinSilent().catch(() => null);
    if (renewed && !renewed.expired) return renewed.access_token;
  }
  return sessionExpired();
}

/** Die Rollen im Access Token (Keycloak: realm_access.roles). */
export function rolesOf(user: User): string[] {
  try {
    const payload = JSON.parse(atob(user.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.realm_access?.roles ?? [];
  } catch {
    return [];
  }
}

/** Die Anmeldung gilt nicht mehr: die Sitzung im Browser verwerfen und neu anmelden. */
export async function sessionExpired(): Promise<never> {
  try {
    await (await userManager()).removeUser();
    await login();
  } catch (e) {
    // der IdP ist nicht erreichbar (oder config.json fehlt) - als Anmeldefehler, nicht «später»
    throw new ApiError(401, `Anmeldung nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
  }
  return new Promise<never>(() => {}); // die Seite geht zum IdP
}
