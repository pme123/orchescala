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
