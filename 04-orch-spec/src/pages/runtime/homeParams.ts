// The parameters of a link to the root of the app with which it goes to the start page.

/** The response of the IdP to a sign-in (OIDC authorization code). */
const IDP_REPLY = ['code', 'state', 'session_state', 'iss'];

/** The parameters for the start page (without «?»): those of the link (e.g. `?token=…`). If the sign-in did not
  * come about (e.g. with «Zurück» to the old return), the response of the IdP is dropped - only if
  * it is one (`code` and `state`): an app parameter `state` or `code` alone stays. */
export function homeParams(search: string, loggedIn: boolean): string {
  const params = new URLSearchParams(search);
  if (!loggedIn && params.has('code') && params.has('state')) for (const p of IDP_REPLY) params.delete(p);
  return params.toString();
}
