// The rules of the sign-in without browser and IdP - so they are testable (tests/pagesAuth.test.ts).

/** Concurrent calls share a running one: one renewal, one sign-in - not one per
  * call (a rotating refresh token is valid only once). When it is done, the next one starts anew. */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  };
}

/** Where to go after the sign-in: only a path of this page (one /, not //host or /\host) - the
  * state comes back with the URL from the IdP. Otherwise the start page of the app. */
export function safeReturnTo(state: unknown, base: string): string {
  return typeof state === 'string' && /^\/(?![/\\])/.test(state) ? state : base;
}

/** The redirect to the IdP: if the page goes away (`pagehide`), the waiting ends with it - it stays open.
  * If it stays `ms` after `started()` (redirect blocked) or comes back (`pageshow` from the
  * bfcache), an error instead of «busy» forever. The listeners before the start - the redirect may already
  * begin inside it; the clock only afterwards (a slow IdP is not an error); `cancel` if it does not
  * start at all. Before `started()`, `wait` never rejects - nobody is waiting for it yet then. */
export function watchLeaving(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, ms: number, error: () => Error) {
  let left = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail = () => {};
  const hide = () => { left = true; clearTimeout(timer); };
  const show = () => { left = false; if (timer !== undefined) fail(); };
  const cleanup = () => {
    clearTimeout(timer);
    target.removeEventListener('pagehide', hide);
    target.removeEventListener('pageshow', show);
  };
  const wait = new Promise<never>((_, reject) => {
    fail = () => { cleanup(); reject(error()); };
  });
  target.addEventListener('pagehide', hide);
  target.addEventListener('pageshow', show);
  return {
    wait,
    started: () => { if (!left) timer = setTimeout(fail, ms); },
    cancel: cleanup,
  };
}
