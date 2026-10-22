import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { safeReturnTo, singleFlight, watchLeaving } from './authRules';
import { ApiError } from './gatewayTypes';

// Only pages with login need this – the public ones never load an IdP. The connection comes
// at runtime from config.json (next to index.html), so the same bundle runs against any IdP.
type AuthConfig = { authority: string; clientId: string };

let manager: Promise<UserManager> | null = null;

// the state of a started sign-in - explicit, completeLogin looks for it under this prefix.
// Per tab (sessionStorage, like the user): a second tab neither sees nor consumes it
const STATE_PREFIX = 'oidc.';
const stateStorage = () => window.sessionStorage;

function userManager(): Promise<UserManager> {
  manager ??= fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' })
    .then((r) => {
      // a server that serves index.html for unknown paths (SPA fallback) also answers with 200
      if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw new Error('config.json fehlt – ohne IdP keine Anmeldung');
      return r.json() as Promise<AuthConfig>;
    })
    .then((config) => {
      const appUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;
      const um = new UserManager({
        authority: config.authority,
        client_id: config.clientId,
        redirect_uri: appUrl,
        post_logout_redirect_uri: appUrl,
        response_type: 'code', // Authorization Code + PKCE
        scope: 'openid profile email',
        // renewed only when needed (expired, 401) - a second, separate renewal by the library
        // would otherwise run at the same time, and a rotating refresh token is valid only once
        automaticSilentRenew: false,
        userStore: new WebStorageStateStore({ store: window.sessionStorage }),
        stateStore: new WebStorageStateStore({ store: stateStorage(), prefix: STATE_PREFIX }),
        // an aborted sign-in (other tab, back) no longer counts as started after 15 minutes
        staleStateAgeInSeconds: 15 * 60,
      });
      // ... and its state does not stay around forever
      void um.clearStaleState().catch(() => {});
      return um;
    })
    .catch((e) => {
      // not forever: the next call tries again (e.g. after a network error)
      manager = null;
      throw e;
    });
  return manager;
}

/** The return from the IdP (code/state in the URL) – afterwards back to the page before the sign-in. */
// once per page load - StrictMode calls effects twice, the first one consumes the state
let completing: Promise<boolean> | null = null;
export function completeLogin(): Promise<boolean> {
  completing ??= completeLoginOnce();
  return completing;
}

async function completeLoginOnce(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  if (!(params.has('code') && state)) return false;
  // only if this app started a sign-in - a page may have its own code/state parameters
  const pending = (() => {
    try {
      return stateStorage().getItem(`${STATE_PREFIX}${state}`) !== null;
    } catch {
      return false;
    }
  })();
  if (!pending) {
    // not an error (a page may have its own parameters) - but visible, in case it was a return after all
    console.warn('[pages] code/state in der URL, aber keine begonnene Anmeldung in diesem Tab - nicht übernommen');
    return false;
  }
  try {
    const user = await (await userManager()).signinRedirectCallback();
    window.history.replaceState({}, '', safeReturnTo(user.state, import.meta.env.BASE_URL));
    return true;
  } catch (e) {
    // wrong state, expired code, an error of the IdP: code/state out of the URL, otherwise
    // every reload fails the same way - the page then asks for the sign-in anew
    console.error('[pages] Rückkehr von der Anmeldung:', e);
    const url = new URL(window.location.href);
    for (const p of ['code', 'state', 'session_state', 'iss']) url.searchParams.delete(p);
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    return false;
  }
}

export async function currentUser(): Promise<User | null> {
  const user = await (await userManager()).getUser();
  return user && !user.expired ? user : null;
}

/** To the sign-in – and afterwards back to this page (with its parameters). */
export async function login(): Promise<void> {
  const here = window.location.pathname + window.location.search;
  await (await userManager()).signinRedirect({ state: here });
}

export async function logout(): Promise<void> {
  await (await userManager()).signoutRedirect();
}

export async function accessToken(): Promise<string> {
  // without IdP (config.json missing, network down) this is a sign-in error, not an error of the gateway
  const um = await userManager().catch((e) => {
    throw new ApiError(401, `Anmeldung nicht möglich: ${e instanceof Error ? e.message : String(e)}`, 'login');
  });
  const user = await um.getUser();
  if (user && !user.expired) return user.access_token;
  // expired: first renew silently (refresh token), only then to the sign-in - the same renewal
  // as for a 401 (renewToken), not a second one alongside
  const renewed = user ? await renewToken() : null;
  return renewed ?? reauthenticate();
}

/** Renew the token silently - null if that is not possible (then only the sign-in remains). Concurrent
  * calls (expired token, 401) share one renewal. */
export const renewToken: () => Promise<string | null> = singleFlight(async () => {
  // network, invalid_grant, no refresh token, no IdP - all end in the sign-in (which itself says
  // when it does not work), the reason in the console
  const renewed = await userManager().then((um) => um.signinSilent()).catch((e) => {
    console.warn('[pages] stilles Erneuern des Tokens fehlgeschlagen:', e);
    return null;
  });
  return renewed && !renewed.expired ? renewed.access_token : null;
});

/** Sign in again - once, even if several calls want it. */
export const reauthenticate: () => Promise<never> = singleFlight(() => sessionExpired());

/** The roles in the access token. */
export function rolesOf(user: User): string[] {
  try {
    const b64 = user.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    // UTF-8 - names with umlauts in the token
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
    const payload = JSON.parse(json);
    // Keycloak: realm_access.roles; Entra and others: roles
    return [...(payload?.realm_access?.roles ?? []), ...(Array.isArray(payload?.roles) ? payload.roles : [])];
  } catch (e) {
    console.error('[pages] die Rollen im Token sind nicht lesbar:', e);
    return [];
  }
}

/** The sign-in is no longer valid: discard the session in the browser and sign in again. */
export async function sessionExpired(): Promise<never> {
  const leaving = watchLeaving(window, 8000,
    () => new ApiError(401, 'Die Anmeldung wurde nicht gestartet - bitte die Seite neu laden.', 'login'));
  try {
    await (await userManager()).removeUser();
    await login();
  } catch (e) {
    leaving.cancel();
    // the IdP is not reachable (or config.json is missing) - as a sign-in error, not «später»
    throw new ApiError(401, `Anmeldung nicht möglich: ${e instanceof Error ? e.message : String(e)}`, 'login');
  }
  leaving.started();
  return leaving.wait;
}
