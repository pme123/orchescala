import { accessToken, reauthenticate, renewToken } from './auth';
import { ApiError, type Gateway } from './gatewayTypes';

export { ApiError, type Gateway };

/** Where the token comes from - from outside in tests. */
export type TokenSource = {
  accessToken: () => Promise<string>;
  renewToken: () => Promise<string | null>;
  reauthenticate: () => Promise<never>;
};

/** How long a call may take at most - longer than the gateway itself waits (callTimeout). */
const CALL_TIMEOUT_MS = 60_000;
/** The network errors of fetch (Chrome, Firefox, Safari) - any other TypeError is an error of the page. */
const NETWORK_ERROR = /failed to fetch|networkerror|load failed|network connection was lost/i;

/** POST to the gateway – public without a token, otherwise with the user's token. */
export function post(path: string, body: unknown, isPublic: boolean): Promise<unknown> {
  return postWith({ accessToken, renewToken, reauthenticate }, path, body, isPublic);
}

export async function postWith(
  { accessToken, renewToken, reauthenticate }: TokenSource, path: string, body: unknown, isPublic: boolean,
): Promise<unknown> {
  const send = (token?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    // a gateway that does not respond would otherwise keep the page «busy» forever
    return fetch(path, { method: 'POST', headers, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'TimeoutError') throw new ApiError(504, 'Keine Antwort vom Gateway');
        // the connection dropped (fetch: TypeError) - perhaps only after the call arrived: like
        // no response, whether it worked is unknown (errorText 504) - not «später noch einmal»
        if (e instanceof TypeError && NETWORK_ERROR.test(e.message)) throw new ApiError(504, `Keine Verbindung zum Gateway: ${e.message}`);
        throw e;
      });
  };
  let response = await send(isPublic ? undefined : await accessToken());
  if (response.status === 401 && !isPublic) {
    // a token that has just expired (or a skewed clock): renew silently and try again -
    // only then go to sign-in (it loses what was entered on the page). Sending again
    // is safe because the gateway checks the token before it does anything: a 401 means «not
    // executed» (a proxy in between that answers 401 after executing would break this)
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
      // not JSON
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  // it also succeeded with a response that is not JSON (e.g. an ID as text) - don't make an error
  // of it: a second click would otherwise start the process again
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
