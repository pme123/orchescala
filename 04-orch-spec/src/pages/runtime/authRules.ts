// Die Regeln der Anmeldung ohne Browser und IdP - damit testbar (tests/pagesAuth.test.ts).

/** Gleichzeitige Aufrufe teilen sich einen laufenden: eine Erneuerung, eine Anmeldung - nicht je
  * Aufruf (ein rotierendes Refresh-Token gilt nur einmal). Ist er fertig, startet der nächste neu. */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  };
}

/** Wohin nach der Anmeldung: nur ein Pfad dieser Seite (ein /, nicht //host oder /\host) - der
  * state kommt mit der URL vom IdP zurück. Sonst die Startseite der App. */
export function safeReturnTo(state: unknown, base: string): string {
  return typeof state === 'string' && /^\/(?![/\\])/.test(state) ? state : base;
}

/** Nach dem Start der Weiterleitung zum IdP: geht die Seite (`pagehide`), endet das Warten mit ihr -
  * es bleibt offen. Bleibt sie nach `ms` (Weiterleitung blockiert) oder kommt sie zurück (`pageshow`
  * aus dem bfcache), ein Fehler statt ewig «busy». Vor dem Start scharf machen - die Weiterleitung kann
  * schon darin beginnen; `cancel`, wenn sie gar nicht erst startet. */
export function watchLeaving(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, ms: number, error: () => Error) {
  let cleanup = () => {};
  const wait = new Promise<never>((_, reject) => {
    const fail = () => { cleanup(); reject(error()); };
    const timer = setTimeout(fail, ms);
    const hide = () => clearTimeout(timer);
    cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener('pagehide', hide);
      target.removeEventListener('pageshow', fail);
    };
    target.addEventListener('pagehide', hide);
    target.addEventListener('pageshow', fail);
  });
  return { wait, cancel: () => cleanup() };
}
