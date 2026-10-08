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

/** Die Weiterleitung zum IdP: geht die Seite (`pagehide`), endet das Warten mit ihr - es bleibt offen.
  * Bleibt sie `ms` nach `started()` (Weiterleitung blockiert) oder kommt sie zurück (`pageshow` aus dem
  * bfcache), ein Fehler statt ewig «busy». Die Listener vor dem Start - die Weiterleitung kann schon
  * darin beginnen; die Uhr erst danach (ein langsamer IdP ist kein Fehler); `cancel`, wenn sie gar
  * nicht erst startet. Vor `started()` lehnt `wait` nie ab - niemand wartet dann schon darauf. */
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
