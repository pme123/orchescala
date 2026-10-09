// Die Parameter eines Links auf die Wurzel der App, mit denen sie zur Startseite geht.

/** Die Antwort des IdP auf eine Anmeldung (OIDC Authorization Code). */
const IDP_REPLY = ['code', 'state', 'session_state', 'iss'];

/** Die Parameter für die Startseite (ohne «?»): die des Links (z.B. `?token=…`). Ist die Anmeldung nicht
  * zustande gekommen (z.B. mit «Zurück» auf die alte Rückkehr), fällt die Antwort des IdP weg - nur, wenn
  * es eine ist (`code` und `state`): ein App-Parameter `state` oder `code` allein bleibt. */
export function homeParams(search: string, loggedIn: boolean): string {
  const params = new URLSearchParams(search);
  if (!loggedIn && params.has('code') && params.has('state')) for (const p of IDP_REPLY) params.delete(p);
  return params.toString();
}
