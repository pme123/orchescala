// Taking an orchestration of before over into the process editor — the steps, without UI.
// It never leaves half a process behind: if the diagram cannot be written, the process is
// removed again and the old file stays. If only removing the old file fails, the process is
// there already — the take-over can be finished later (`removeOld`).
import type { ProcessSpec } from '../types';

type Result = { ok: true } | { ok: false; message: string };

/** A store call that throws is a failure like one that says so. */
const safe = async (call: () => Promise<Result>): Promise<Result> => {
  try { return await call(); }
  catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
};

/** What a take-over needs from the stores */
export interface TakeOverStore {
  createSpec: (spec: ProcessSpec) => Promise<Result>;
  saveBpmn: (slug: string, xml: string) => Promise<Result>;
  deleteSpec: (slug: string) => Promise<Result>;
  deleteService: (slug: string, expectedVersion: string) => Promise<Result>;
}

/** `written`: the process is there — whatever failed, the take-over only needs `removeOld` then. */
export type TakeOverResult = { ok: true } | { ok: false; written: boolean; message: string };

/** The old file under `services/` goes — the last step of a take-over. */
export async function removeOld(store: TakeOverStore, old: { slug: string; version: string }): Promise<TakeOverResult> {
  const d = await safe(() => store.deleteService(old.slug, old.version));
  return d.ok ? { ok: true } : {
    ok: false, written: true,
    message: `Der Prozess ist übernommen — services/${old.slug}.json liess sich aber nicht entfernen: ${d.message}. Wurde die Datei inzwischen geändert, die Seite neu laden und nochmals entfernen.`,
  };
}

/** The process with its diagram, then the old file removed. */
export async function takeOver(store: TakeOverStore, planned: { spec: ProcessSpec; xml: string }, old: { slug: string; version: string }): Promise<TakeOverResult> {
  const r = await safe(() => store.createSpec(planned.spec));
  if (!r.ok) return { ok: false, written: false, message: r.message };
  const w = await safe(() => store.saveBpmn(planned.spec.slug, planned.xml));
  if (!w.ok) {
    // no process without its diagram: back to before
    const back = await safe(() => store.deleteSpec(planned.spec.slug));
    return back.ok
      ? { ok: false, written: false, message: `Das Diagramm liess sich nicht speichern: ${w.message} — nichts übernommen, services/${old.slug}.json bleibt.` }
      : { ok: false, written: true, message: `Das Diagramm liess sich nicht speichern (${w.message}), und der angelegte Prozess «${planned.spec.slug}» nicht wieder entfernen: ${back.message} — ihn unter Prozesse löschen, dann nochmals übernehmen.` };
  }
  return removeOld(store, old);
}
