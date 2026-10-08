import { accessToken, reauthenticate, renewToken } from './auth';
import { ApiError, type Gateway } from './gatewayTypes';

export { ApiError, type Gateway };

/** Woher das Token kommt - im Test von aussen. */
export type TokenSource = {
  accessToken: () => Promise<string>;
  renewToken: () => Promise<string | null>;
  reauthenticate: () => Promise<never>;
};

/** Wie lange ein Aufruf höchstens dauert - länger als der Gateway selbst wartet (callTimeout). */
const CALL_TIMEOUT_MS = 60_000;

/** POST an den Gateway – öffentlich ohne Token, sonst mit dem Token des Benutzers. */
export function post(path: string, body: unknown, isPublic: boolean): Promise<unknown> {
  return postWith({ accessToken, renewToken, reauthenticate }, path, body, isPublic);
}

export async function postWith(
  { accessToken, renewToken, reauthenticate }: TokenSource, path: string, body: unknown, isPublic: boolean,
): Promise<unknown> {
  const send = (token?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    // ein Gateway, der nicht antwortet, hielte die Seite sonst für immer «busy»
    return fetch(path, { method: 'POST', headers, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'TimeoutError') throw new ApiError(504, 'Keine Antwort vom Gateway');
        // die Verbindung brach ab (fetch: TypeError) - vielleicht erst, nachdem der Aufruf ankam: wie
        // keine Antwort, ob es geklappt hat, ist offen (errorText 504) - nicht «später noch einmal»
        if (e instanceof TypeError) throw new ApiError(504, `Keine Verbindung zum Gateway: ${e.message}`);
        throw e;
      });
  };
  let response = await send(isPublic ? undefined : await accessToken());
  if (response.status === 401 && !isPublic) {
    // ein Token, das eben abgelaufen ist (oder eine schiefe Uhr): still erneuern und noch einmal -
    // erst dann zur Anmeldung (sie verliert, was auf der Seite eingegeben ist). Noch einmal senden
    // ist sicher, weil der Gateway das Token prüft, bevor er etwas tut: ein 401 heisst «nicht
    // ausgeführt» (ein Proxy dazwischen, der nach dem Ausführen 401 sagt, bräche das)
    const renewed = await renewToken();
    if (renewed) response = await send(renewed);
    if (response.status === 401) return reauthenticate();
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = text;
    try {
      const json = JSON.parse(text);
      message = json.errorMsg ?? json.message ?? text;
    } catch {
      // kein JSON
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  // geklappt ist es auch mit einer Antwort, die kein JSON ist (z.B. eine ID als Text) - kein Fehler
  // daraus machen: ein zweiter Klick startete den Prozess sonst noch einmal
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const q = (businessKey?: string) => (businessKey ? `?businessKey=${encodeURIComponent(businessKey)}` : '');
const seg = encodeURIComponent;

export const gateway: Gateway = {
  call: (service: string, input: unknown, isPublic: boolean) =>
    post(`${isPublic ? '/public' : ''}/worker/${seg(service)}`, input, isPublic),
  start: (process: string, businessKey: string | undefined, input: unknown, isPublic: boolean) =>
    post(`${isPublic ? '/public' : ''}/process/${seg(process)}/async${q(businessKey)}`, input, isPublic),
  message: (name: string, businessKey: string, input: unknown, isPublic: boolean) =>
    post(`${isPublic ? '/public' : ''}/message/${seg(name)}${q(businessKey)}`, input, isPublic),
  completeTask: (taskKey: string, taskId: string, input: unknown) =>
    post(`/userTask/${seg(taskKey)}/${seg(taskId)}/complete`, input, false),
};
