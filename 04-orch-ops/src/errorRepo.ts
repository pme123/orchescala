// Reading and writing the errors — the logic behind the store, without React,
// so it can be tested against a backend that produces conflicts on purpose.
//
//   errors/<id>.json    one file per error
//
// Every write goes through the backend's version check (If-Match). Counting
// reads fresh, increments and writes; if someone else wrote in the meantime it
// re-reads and tries again. Writes to the same error from this tab run one
// after the other (`serialize`) — the list's and the drawer's +1 button don't
// race each other.
import { OCCURRENCE_LIMIT, type ErrorEntry, type Occurrence } from './types';
import type { StorageBackend } from './backend';
import { slugify } from './util';

export const DIR = 'errors';

export interface ErrorItem {
  data: ErrorEntry;
  version: string;
}

export type SaveResult =
  | { status: 'saved'; item: ErrorItem }
  | { status: 'conflict'; current: ErrorItem | null }
  | { status: 'error'; message: string };

export type ErrorDraft = Omit<ErrorEntry, 'id' | 'createdAt' | 'updatedAt' | 'count'> & { count?: number };

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function normalizeOccurrences(v: unknown): Occurrence[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((o): o is { at: unknown; by?: unknown } => !!o && typeof o === 'object' && typeof (o as { at?: unknown }).at === 'string')
    .map(o => ({ at: o.at as string, ...(typeof o.by === 'string' && o.by ? { by: o.by } : {}) }));
}

/** A file as it comes from the folder — maybe hand-edited — into a valid entry. */
export function normalizeError(raw: unknown, id: string): ErrorEntry {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ErrorEntry>;
  const count = Number(r.count);
  return {
    ...r,
    id,
    process: str(r.process), title: str(r.title), details: str(r.details), activity: str(r.activity),
    reporter: str(r.reporter), ticket: str(r.ticket), workaround: str(r.workaround),
    status: Array.isArray(r.status) ? r.status.map(String) : [],
    count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 1,
    occurrences: normalizeOccurrences(r.occurrences),
    createdAt: str(r.createdAt), updatedAt: str(r.updatedAt) || str(r.createdAt),
  };
}

export const toJson = (e: ErrorEntry) => JSON.stringify(e, null, 2);

/** null = not there; throws if the file is not JSON */
export async function readError(be: StorageBackend, id: string): Promise<ErrorItem | null> {
  const read = await be.read(`${DIR}/${id}.json`);
  if (!read) return null;
  return { data: normalizeError(JSON.parse(read.text), id), version: read.version };
}

/** All errors of the folder. `failed`: files that could not be read (broken JSON, network). */
export async function readAll(be: StorageBackend): Promise<{ items: ErrorItem[]; failed: string[] }> {
  const files = (await be.list(DIR)).filter(f => f.name.endsWith('.json'));
  const failed: string[] = [];
  const items = await Promise.all(files.map(async f => {
    const id = f.name.replace(/\.json$/, '');
    try {
      const item = await readError(be, id);
      if (!item) failed.push(id); // listed, but gone or unreadable meanwhile
      return item;
    } catch {
      failed.push(id);
      return null;
    }
  }));
  return { items: items.filter((x): x is ErrorItem => !!x), failed: failed.sort() };
}

/**
 * The result of a refresh into the list — without losing what is newer here:
 *  · an error written by this tab after the refresh started keeps the local state
 *    (the refresh read the file before that write)
 *  · an error whose file could not be read keeps its last known state
 *  · an error that is gone from the folder leaves the list
 */
export function mergeRefresh(
  prev: ErrorItem[],
  fresh: { items: ErrorItem[]; failed: string[] },
  startedAt: number,
  writtenAt: ReadonlyMap<string, number>,
): ErrorItem[] {
  const prevById = new Map(prev.map(p => [p.data.id, p]));
  const writtenSince = (id: string) => (writtenAt.get(id) ?? -Infinity) >= startedAt;
  const out = new Map<string, ErrorItem>();
  for (const f of fresh.items) {
    const p = prevById.get(f.data.id);
    out.set(f.data.id, p && writtenSince(f.data.id) ? p : f);
  }
  for (const id of fresh.failed) {
    const p = prevById.get(id);
    if (p && !out.has(id)) out.set(id, p);
  }
  // created here while the refresh was running — not in its listing yet
  for (const p of prev) if (!out.has(p.data.id) && writtenSince(p.data.id)) out.set(p.data.id, p);
  return [...out.values()];
}

/** Runs `fn` after everything queued before for the same key — one write per error at a time. */
export function serialize<T>(chains: Map<string, Promise<unknown>>, key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  chains.set(key, next);
  void next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => undefined);
  return next;
}

export async function createErrorIn(be: StorageBackend, draft: ErrorDraft, who: string, now: string):
  Promise<{ ok: true; item: ErrorItem } | { ok: false; message: string }> {
  const base = (`${slugify(draft.process) || 'fehler'}--${slugify(draft.title).slice(0, 60)}`).replace(/-+$/, '') || 'fehler';
  const count = Number.isFinite(draft.count) && draft.count! >= 0 ? Math.floor(draft.count!) : 1;
  try { await be.ensureDir(DIR); } catch { /* write reports it */ }
  for (let n = 1; n < 50; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    const data: ErrorEntry = {
      ...draft, id, count,
      // the first occurrence — unless it was created with count 0
      occurrences: count > 0 ? [{ at: now, ...(who ? { by: who } : {}) }] : [],
      createdAt: now, updatedAt: now, lastAction: 'created',
      ...(who ? { createdBy: who, updatedBy: who } : {}),
    };
    const w = await be.write(`${DIR}/${id}.json`, toJson(data), { createOnly: true });
    if (w.ok) return { ok: true, item: { data, version: w.version } };
    if (w.reason !== 'exists') return { ok: false, message: w.message };
  }
  return { ok: false, message: 'Keine freie ID gefunden.' };
}

export async function saveErrorIn(be: StorageBackend, data: ErrorEntry, expectedVersion: string, who: string, now: string): Promise<SaveResult> {
  const next: ErrorEntry = { ...data, updatedAt: now, lastAction: 'edited', ...(who ? { updatedBy: who } : {}) };
  const w = await be.write(`${DIR}/${data.id}.json`, toJson(next), { ifMatch: expectedVersion });
  if (w.ok) return { status: 'saved', item: { data: next, version: w.version } };
  if (w.reason === 'conflict') return { status: 'conflict', current: await readError(be, data.id).catch(() => null) };
  return { status: 'error', message: w.reason === 'forbidden' ? w.message : 'Schreiben fehlgeschlagen — die Änderung wurde NICHT gespeichert.' };
}

export const COUNT_ATTEMPTS = 6;

/** +1 with retry: on a conflict re-read and count on the newer state. */
export async function countErrorIn(
  be: StorageBackend, id: string, who: string, now: () => string,
  opts: { attempts?: number; pause?: (attempt: number) => Promise<void> } = {},
): Promise<{ ok: true; item: ErrorItem } | { ok: false; message: string }> {
  const attempts = opts.attempts ?? COUNT_ATTEMPTS;
  // short, growing pause with jitter — two writers don't hit the same moment again
  const pause = opts.pause ?? (a => new Promise<void>(r => setTimeout(r, 40 * (a + 1) + Math.random() * 60)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    let cur: ErrorItem | null;
    try { cur = await readError(be, id); }
    catch { return { ok: false, message: 'Fehler-Datei ist unlesbar (kein gültiges JSON).' }; }
    if (!cur) return { ok: false, message: 'Fehler-Datei nicht gefunden.' };
    const at = now();
    const occ = [{ at, ...(who ? { by: who } : {}) }, ...(cur.data.occurrences ?? [])].slice(0, OCCURRENCE_LIMIT);
    const next: ErrorEntry = {
      ...cur.data, count: cur.data.count + 1, occurrences: occ,
      updatedAt: at, lastAction: 'counted', ...(who ? { updatedBy: who } : {}),
    };
    const w = await be.write(`${DIR}/${id}.json`, toJson(next), { ifMatch: cur.version });
    if (w.ok) return { ok: true, item: { data: next, version: w.version } };
    if (w.reason !== 'conflict') return { ok: false, message: w.message };
    if (attempt < attempts - 1) await pause(attempt);
  }
  return { ok: false, message: 'Zu viele gleichzeitige Änderungen — bitte nochmals versuchen.' };
}
