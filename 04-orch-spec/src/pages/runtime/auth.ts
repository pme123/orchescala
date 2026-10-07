import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { ApiError } from './gatewayTypes';

// Nur Seiten mit Login brauchen das – die öffentlichen laden nie einen IdP. Die Verbindung kommt
// zur Laufzeit aus config.json (neben index.html), so läuft dasselbe Bundle gegen jeden IdP.
type AuthConfig = { authority: string; clientId: string };

let manager: Promise<UserManager> | null = null;

// der Zustand einer begonnenen Anmeldung - ausdrücklich, completeLogin sucht ihn unter diesem Präfix
const STATE_PREFIX = 'oidc.';
const stateStorage = () => window.localStorage;

function userManager(): Promise<UserManager> {
  manager ??= fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' })
    .then((r) => {
      // ein Server, der für Unbekanntes index.html liefert (SPA-Fallback), antwortet auch mit 200
      if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw new Error('config.json fehlt – ohne IdP keine Anmeldung');
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
        // erneuert wird nur bei Bedarf (abgelaufen, 401) - eine zweite, eigene Erneuerung der Bibliothek
        // liefe sonst gleichzeitig, und ein rotierendes Refresh-Token gilt nur einmal
        automaticSilentRenew: false,
        userStore: new WebStorageStateStore({ store: window.sessionStorage }),
        stateStore: new WebStorageStateStore({ store: stateStorage(), prefix: STATE_PREFIX }),
      });
    })
    .catch((e) => {
      // nicht für immer: der nächste Aufruf versucht es wieder (z.B. nach einem Netzfehler)
      manager = null;
      throw e;
    });
  return manager;
}

/** Die Rückkehr vom IdP (code/state in der URL) – danach zurück auf die Seite vor der Anmeldung. */
export async function completeLogin(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  if (!(params.has('code') && state)) return false;
  // nur, wenn diese App eine Anmeldung begonnen hat - eine Seite darf eigene code/state-Parameter haben
  const pending = (() => {
    try {
      return stateStorage().getItem(`${STATE_PREFIX}${state}`) !== null;
    } catch {
      return false;
    }
  })();
  if (!pending) return false;
  try {
    const user = await (await userManager()).signinRedirectCallback();
    // nur ein Pfad dieser Seite (ein /, nicht //host) - der state kommt mit der URL zurück
    const returnTo = typeof user.state === 'string' && /^\/(?![/\\])/.test(user.state) ? user.state : import.meta.env.BASE_URL;
    window.history.replaceState({}, '', returnTo);
    return true;
  } catch (e) {
    // falscher state, abgelaufener Code, ein Fehler des IdP: code/state aus der URL, sonst
    // scheitert jedes Neuladen gleich - die Seite fragt dann neu nach der Anmeldung
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

/** Zur Anmeldung – und danach zurück auf diese Seite (mit ihren Parametern). */
export async function login(): Promise<void> {
  const here = window.location.pathname + window.location.search;
  await (await userManager()).signinRedirect({ state: here });
}

export async function logout(): Promise<void> {
  await (await userManager()).signoutRedirect();
}

export async function accessToken(): Promise<string> {
  const user = await (await userManager()).getUser();
  if (user && !user.expired) return user.access_token;
  // abgelaufen: zuerst still erneuern (Refresh-Token), erst dann zur Anmeldung - dieselbe Erneuerung
  // wie bei einem 401 (renewToken), nicht eine zweite daneben
  const renewed = user ? await renewToken() : null;
  return renewed ?? reauthenticate();
}

// gleichzeitige Aufrufe mit abgelaufenem Token oder 401: eine stille Erneuerung, nicht je Aufruf -
// ein rotierendes Refresh-Token gilt nur einmal
let renewingSilently: Promise<string | null> | null = null;

/** Das Token still erneuern - null, wenn das nicht geht (dann bleibt nur die Anmeldung). */
export function renewToken(): Promise<string | null> {
  renewingSilently ??= (async () => {
    const renewed = await (await userManager()).signinSilent().catch((e) => {
      // Netz, invalid_grant, kein Refresh-Token - alles endet in der Anmeldung, der Grund in der Konsole
      console.warn('[pages] stilles Erneuern des Tokens fehlgeschlagen:', e);
      return null;
    });
    return renewed && !renewed.expired ? renewed.access_token : null;
  })().finally(() => {
    renewingSilently = null;
  });
  return renewingSilently;
}

// mehrere Aufrufe mit 401 gleichzeitig: eine Anmeldung, nicht je Aufruf
let signingIn: Promise<never> | null = null;

/** Neu anmelden - einmal, auch wenn mehrere Aufrufe es wollen. */
export function reauthenticate(): Promise<never> {
  signingIn ??= sessionExpired().finally(() => {
    signingIn = null;
  });
  return signingIn;
}

/** Die Rollen im Access Token. */
export function rolesOf(user: User): string[] {
  try {
    const b64 = user.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    // UTF-8 - Namen mit Umlauten im Token
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
    const payload = JSON.parse(json);
    // Keycloak: realm_access.roles; Entra und andere: roles
    return [...(payload?.realm_access?.roles ?? []), ...(Array.isArray(payload?.roles) ? payload.roles : [])];
  } catch (e) {
    console.error('[pages] die Rollen im Token sind nicht lesbar:', e);
    return [];
  }
}

/** Die Anmeldung gilt nicht mehr: die Sitzung im Browser verwerfen und neu anmelden. */
export async function sessionExpired(): Promise<never> {
  // die Seite geht zum IdP: das Warten endet mit ihr. Bleibt sie (Weiterleitung blockiert), nach 5 s ein
  // Fehler - aber nicht, wenn sie schon am Gehen ist (langsame Weiterleitung). Die Listener vor login():
  // die Weiterleitung kann schon darin beginnen
  let leaving = false;
  const leave = () => { leaving = true; };
  window.addEventListener('pagehide', leave);
  window.addEventListener('beforeunload', leave);
  try {
    try {
      await (await userManager()).removeUser();
      await login();
    } catch (e) {
      // der IdP ist nicht erreichbar (oder config.json fehlt) - als Anmeldefehler, nicht «später»
      throw new ApiError(401, `Anmeldung nicht möglich: ${e instanceof Error ? e.message : String(e)}`, 'login');
    }
    await new Promise((r) => setTimeout(r, 5000));
  } finally {
    window.removeEventListener('pagehide', leave);
    window.removeEventListener('beforeunload', leave);
  }
  // am Gehen: noch kurz warten - wurde das Gehen abgebrochen, doch der Fehler statt ewig «busy»
  if (leaving || document.visibilityState === 'hidden') await new Promise((r) => setTimeout(r, 5000));
  throw new ApiError(401, 'Die Anmeldung wurde nicht gestartet - bitte die Seite neu laden.', 'login');
}
