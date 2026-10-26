// Data storage: pure client app, the files live in a shared folder (locally
// via the File System Access API or in SharePoint via Microsoft Graph).
// Folder layout:
//
//   model.json          settings (branding, status values, how-to, sign-in)
//   errors/<id>.json    one file per error
//
// Taken over from orch-spec — the same mechanics (conflict detection via
// version/ETag, remembered folder). The error logic itself (count with retry,
// create, save, merging a refresh) lives in errorRepo.ts — this file connects
// it to React state.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ErrorEntry, Model, StatusDef } from './types';
import { getHandle, putHandle } from './handles';
import { DEFAULT_MODEL, DEFAULT_STATUSES } from './defaultModel';
import { nowIso } from './util';
import { DemoBackend, LocalBackend, type StorageBackend } from './backend';
import { GRAPH_SCOPES, GraphBackend, resolveFolderLink, type SharePointFolder } from './graph';
import { PENDING_FOLDER_KEY, clearPendingRoles, newFolderRoles, peekPendingRoles, useAuth } from './auth';
import { parseConfluence } from './confluence';
import { isAttachmentPath, newAttachmentPath, prepareImage } from './attachments';
import {
  DIR, countErrorIn, createErrorIn, mergeRefresh, readAll, saveErrorIn, serialize, toJson,
  type ErrorDraft, type ErrorItem, type SaveResult,
} from './errorRepo';

export type { ErrorItem, SaveResult } from './errorRepo';

const REFRESH_MS = 60_000;

export interface StorageInfo { kind: 'local' | 'sharepoint'; name: string; webUrl?: string }

export interface ImportSummary { total: number; created: number; skipped: number; statusesAdded: number; howto: boolean }

interface StoreCtx {
  isDark: boolean;
  toggleTheme: () => void;
  storage: StorageInfo | null;
  pickDirectory: () => Promise<void>;
  savedHandleName: string | null;
  reconnectDirectory: () => Promise<void>;
  connectSharePoint: (link: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  savedSharePoint: SharePointFolder | null;
  forgetSharePoint: () => void;
  disconnect: () => void;
  model: Model | null;
  modelError: string | null;
  saveModel: (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;
  errors: ErrorItem[];
  loading: boolean;
  lastRefresh: number | null;
  /** what the last refresh could not read (file names) — or that the folder itself failed */
  refreshProblems: string[];
  refreshErrors: () => Promise<void>;
  createError: (draft: ErrorDraft) => Promise<{ ok: true; item: ErrorItem } | { ok: false; message: string }>;
  saveError: (data: ErrorEntry, expectedVersion: string) => Promise<SaveResult>;
  countError: (id: string) => Promise<{ ok: true; item: ErrorItem } | { ok: false; message: string }>;
  importConfluence: (html: string, initialCount?: number) => Promise<{ ok: true; summary: ImportSummary } | { ok: false; message: string }>;
  /** put an image into the folder → path for the Markdown reference */
  saveAttachment: (file: Blob) => Promise<{ ok: true; path: string } | { ok: false; message: string }>;
  /** image from the folder as object URL (cached); null = missing */
  resolveAttachment: (path: string) => Promise<string | null>;
  /** who is working — name from the sign-in or entered by the user */
  actor: string;
  setLocalName: (name: string) => void;
}

const persistHandle = (h: FileSystemDirectoryHandle) => putHandle('dir', h);
const loadStoredHandle = () => getHandle('dir');

const Ctx = createContext<StoreCtx>(null!);
export const useStore = () => useContext(Ctx);

// ── localStorage ─────────────────────────────────────────────────────────────
const SP_KEY = 'orch-ops.sharepoint';
const MODE_KEY = 'orch-ops.mode';
const NAME_KEY = 'orch-ops.name';
const THEME_KEY = 'orch-ops.theme';

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } },
};

function loadSharePoint(): SharePointFolder | null {
  try {
    const raw = JSON.parse(ls.get(SP_KEY) ?? 'null');
    return raw && raw.driveId && raw.itemId ? raw as SharePointFolder : null;
  } catch { return null; }
}
function storeSharePoint(f: SharePointFolder | null) {
  ls.set(SP_KEY, f ? JSON.stringify(f) : null);
  ls.set(MODE_KEY, f ? 'sharepoint' : null);
}

const graphBase = (): string | undefined =>
  import.meta.env.DEV ? (new URLSearchParams(location.search).get('graph') ?? undefined) : undefined;

function normalizeModel(raw: unknown): Model {
  const r = (raw ?? {}) as Partial<Model>;
  const statuses = Array.isArray(r.statuses) && r.statuses.length
    ? (r.statuses as StatusDef[]).filter(s => s && typeof s.label === 'string')
    : DEFAULT_STATUSES;
  return { ...DEFAULT_MODEL, ...r, statuses };
}

const MODEL_CONFLICT = 'model.json wurde inzwischen von jemand anderem geändert — der neue Stand ist geladen. Bitte die Änderung nochmals machen.';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [isDark, setIsDark] = useState(() => ls.get(THEME_KEY) === 'dark');
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [refreshProblems, setRefreshProblems] = useState<string[]>([]);
  const [savedHandleName, setSavedHandleName] = useState<string | null>(null);
  const [savedSharePoint, setSavedSharePoint] = useState<SharePointFolder | null>(() => loadSharePoint());
  const [localName, setLocalNameState] = useState(() => ls.get(NAME_KEY) ?? '');
  const backendRef = useRef<StorageBackend | null>(null);
  // images: path → object URL (per connected folder)
  const attachmentCache = useRef(new Map<string, Promise<string | null>>());
  // version of model.json as read — saving checks it (two admins at once)
  const modelVersionRef = useRef<string | null>(null);
  // when this tab last wrote an error — a refresh that started before keeps the local state
  const writtenAt = useRef(new Map<string, number>());
  // one write per error at a time (counts and saves)
  const writeChains = useRef(new Map<string, Promise<unknown>>());
  const savedHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const getTokenRef = useRef(auth.getToken);
  getTokenRef.current = auth.getToken;
  const idsRef = useRef(auth.ids);
  idsRef.current = auth.ids;

  const actor = (auth.status === 'signedIn' && auth.user?.name?.trim()) || localName.trim();
  const actorRef = useRef(actor);
  actorRef.current = actor;
  const setLocalName = useCallback((n: string) => { setLocalNameState(n); ls.set(NAME_KEY, n.trim() || null); }, []);

  // a write of this tab into the list (and remembered for mergeRefresh)
  const upsert = useCallback((item: ErrorItem) => {
    writtenAt.current.set(item.data.id, Date.now());
    setErrors(prev => [...prev.filter(p => p.data.id !== item.data.id), item]);
  }, []);

  // object URLs of the images: give them back when the folder changes
  const clearAttachments = useCallback(() => {
    for (const p of attachmentCache.current.values()) void p.then(u => { if (u) URL.revokeObjectURL(u); });
    attachmentCache.current.clear();
  }, []);

  // ── model.json ────────────────────────────────────────────────────────────
  // only the backend that is still active may set the model (folder changed meanwhile)
  const loadModel = useCallback(async (be: StorageBackend) => {
    const current = () => backendRef.current === be;
    try {
      const read = await be.read('model.json');
      if (!current()) return;
      if (!read) {
        const ids = idsRef.current;
        const fresh: Model = ids
          ? { ...DEFAULT_MODEL, auth: { enabled: false, tenantId: ids.tenantId, clientId: ids.clientId, ...newFolderRoles(peekPendingRoles()) } }
          : DEFAULT_MODEL;
        const w = await be.write('model.json', JSON.stringify(fresh, null, 2), { createOnly: true });
        if (!current()) return;
        if (w.ok) modelVersionRef.current = w.version;
        else if (w.reason === 'exists') { await loadModel(be); return; } // someone else just created it
        if (!w.ok) {
          setModel(null);
          setModelError(w.reason === 'forbidden'
            ? 'model.json fehlt und kann nicht angelegt werden (keine Schreibberechtigung).'
            : 'model.json fehlt und konnte nicht angelegt werden.');
          return;
        }
        setModel(fresh); setModelError(null);
        clearPendingRoles(); // used up by this new folder
        return;
      }
      try {
        setModel(normalizeModel(JSON.parse(read.text)));
        modelVersionRef.current = read.version;
        setModelError(null);
        clearPendingRoles(); // an existing folder keeps its own roles
      } catch {
        setModel(null); // do NOT overwrite a broken file
        setModelError('model.json ist unlesbar (kein gültiges JSON).');
      }
    } catch (e) {
      console.error('[orch-ops] loadModel:', e);
      if (!current()) return;
      setModel(null);
      setModelError(`model.json konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  // ── load errors ───────────────────────────────────────────────────────────
  // Merged into the list, not replacing it: what this tab wrote meanwhile and
  // what could not be read stay (see mergeRefresh); problems are shown.
  const refreshIn = useCallback(async (be: StorageBackend) => {
    const startedAt = Date.now();
    setLoading(true);
    try {
      const res = await readAll(be);
      if (backendRef.current !== be) return;
      setErrors(prev => mergeRefresh(prev, res, startedAt, writtenAt.current));
      setRefreshProblems(res.failed.map(id => `${DIR}/${id}.json`));
      setLastRefresh(Date.now());
    } catch (e) {
      console.error('[orch-ops] refreshErrors:', e);
      if (backendRef.current === be) setRefreshProblems([`Ordner ${DIR}/ konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshErrors = useCallback(async () => {
    if (backendRef.current) await refreshIn(backendRef.current);
  }, [refreshIn]);

  const activate = useCallback(async (be: StorageBackend, info: StorageInfo) => {
    backendRef.current = be;
    clearAttachments();
    modelVersionRef.current = null;
    writtenAt.current.clear();
    writeChains.current.clear();
    setStorage(info);
    setSavedHandleName(null);
    savedHandleRef.current = null;
    setErrors([]);
    setRefreshProblems([]);
    await loadModel(be);
    try { await be.ensureDir(DIR); } catch { /* read only? list stays empty */ }
    await refreshIn(be);
  }, [loadModel, refreshIn, clearAttachments]);

  // What others count or change should become visible without reloading:
  // re-read periodically and when returning to the window.
  useEffect(() => {
    if (!storage) return;
    const tick = () => { if (document.visibilityState === 'visible') void refreshErrors(); };
    const t = window.setInterval(tick, REFRESH_MS);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(t); window.removeEventListener('focus', tick); };
  }, [storage, refreshErrors]);

  // ── local folder ──────────────────────────────────────────────────────────
  const pickDirectory = useCallback(async () => {
    try {
      const dir = new URLSearchParams(location.search).has('opfs')
        ? await navigator.storage.getDirectory()
        : await window.showDirectoryPicker({ mode: 'readwrite' });
      await persistHandle(dir);
      storeSharePoint(null); setSavedSharePoint(null);
      await activate(new LocalBackend(dir), { kind: 'local', name: dir.name || 'Ordner' });
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') console.error('[orch-ops] pickDirectory:', e);
    }
  }, [activate]);

  const reconnectDirectory = useCallback(async () => {
    const handle = savedHandleRef.current;
    if (!handle) return;
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') await activate(new LocalBackend(handle), { kind: 'local', name: handle.name || 'Ordner' });
    } catch (e) {
      console.error('[orch-ops] reconnectDirectory:', e);
    }
  }, [activate]);

  // ── SharePoint folder ─────────────────────────────────────────────────────
  const tokenProvider = useCallback(() => getTokenRef.current(GRAPH_SCOPES), []);

  const activateSharePoint = useCallback(async (folder: SharePointFolder) => {
    await activate(new GraphBackend(folder, tokenProvider, graphBase()), { kind: 'sharepoint', name: folder.name, webUrl: folder.webUrl });
  }, [activate, tokenProvider]);

  const connectSharePoint = useCallback(async (link: string) => {
    try {
      const folder = await resolveFolderLink(tokenProvider, link, graphBase());
      storeSharePoint(folder); setSavedSharePoint(folder);
      await activateSharePoint(folder);
      return { ok: true as const };
    } catch (e) {
      console.error('[orch-ops] connectSharePoint:', e);
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  }, [activateSharePoint, tokenProvider]);

  const forgetSharePoint = useCallback(() => {
    storeSharePoint(null); setSavedSharePoint(null);
  }, []);

  const disconnect = useCallback(() => {
    backendRef.current = null;
    clearAttachments();
    setStorage(null); setModel(null); setErrors([]); setRefreshProblems([]);
  }, [clearAttachments]);

  // restore the remembered folder on start
  const autoRef = useRef(false);
  useEffect(() => {
    const pending = ls.get(PENDING_FOLDER_KEY);
    if (pending && !loadSharePoint()) {
      if (auth.status === 'signedIn' || (auth.status === 'disabled' && graphBase())) {
        ls.set(PENDING_FOLDER_KEY, null);
        connectSharePoint(pending).then(r => { if (!r.ok) console.error('[orch-ops] Einrichtungs-Link:', r.message); });
      }
      return;
    }
    if (autoRef.current) return;
    // development: ?demo starts right away with the sample data
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
      autoRef.current = true;
      const be = new DemoBackend();
      void activate(be, { kind: 'local', name: be.name });
      return;
    }
    const sp = loadSharePoint();
    if (sp) {
      if (auth.status === 'signedIn' || (auth.status === 'disabled' && graphBase())) {
        autoRef.current = true;
        activateSharePoint(sp).catch(e => console.error('[orch-ops] SharePoint reconnect:', e));
      }
      return;
    }
    autoRef.current = true;
    (async () => {
      try {
        const handle = await loadStoredHandle();
        if (!handle) return;
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          await activate(new LocalBackend(handle), { kind: 'local', name: handle.name || 'Ordner' });
        } else {
          savedHandleRef.current = handle;
          setSavedHandleName(handle.name || 'gemerkter Ordner');
        }
      } catch { /* IndexedDB not available or handle invalid */ }
    })();
  }, [auth.status, activate, activateSharePoint, connectSharePoint]);

  // ── write errors ──────────────────────────────────────────────────────────
  const createError: StoreCtx['createError'] = useCallback(async draft => {
    const be = backendRef.current;
    if (!be) return { ok: false, message: 'Kein Ordner gewählt.' };
    const r = await createErrorIn(be, draft, actorRef.current, nowIso());
    if (r.ok && backendRef.current === be) upsert(r.item);
    return r;
  }, [upsert]);

  const saveError = useCallback((data: ErrorEntry, expectedVersion: string): Promise<SaveResult> => {
    const be = backendRef.current;
    if (!be) return Promise.resolve({ status: 'error', message: 'Kein Ordner gewählt.' });
    return serialize(writeChains.current, data.id, async () => {
      const r = await saveErrorIn(be, data, expectedVersion, actorRef.current, nowIso());
      if (backendRef.current === be) {
        if (r.status === 'saved') upsert(r.item);
        else if (r.status === 'conflict' && r.current) setErrors(prev => [...prev.filter(p => p.data.id !== data.id), r.current!]);
      }
      return r;
    });
  }, [upsert]);

  const countError = useCallback((id: string) => {
    const be = backendRef.current;
    if (!be) return Promise.resolve({ ok: false as const, message: 'Kein Ordner gewählt.' });
    return serialize(writeChains.current, id, async () => {
      const r = await countErrorIn(be, id, actorRef.current, nowIso);
      if (r.ok && backendRef.current === be) upsert(r.item);
      return r;
    });
  }, [upsert]);

  // ── images ────────────────────────────────────────────────────────────────

  const saveAttachment = useCallback(async (file: Blob) => {
    const be = backendRef.current;
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    let prepared;
    try { prepared = await prepareImage(file); }
    catch (e) { return { ok: false as const, message: e instanceof Error ? e.message : String(e) }; }
    const path = newAttachmentPath(prepared.ext);
    try { await be.ensureDir(path.split('/').slice(0, -1).join('/')); } catch { /* write reports it */ }
    const w = await be.write(path, prepared.blob, { createOnly: true });
    if (!w.ok) return { ok: false as const, message: w.reason === 'forbidden' ? w.message : `Bild konnte nicht gespeichert werden: ${w.message}` };
    attachmentCache.current.set(path, Promise.resolve(URL.createObjectURL(prepared.blob)));
    return { ok: true as const, path };
  }, []);

  const resolveAttachment = useCallback((path: string): Promise<string | null> => {
    const be = backendRef.current;
    if (!be || !isAttachmentPath(path)) return Promise.resolve(null);
    let p = attachmentCache.current.get(path);
    if (!p) {
      p = be.readBlob(path).then(b => (b ? URL.createObjectURL(b) : null)).catch(() => null);
      attachmentCache.current.set(path, p);
      // failed → try again next time
      p.then(u => { if (!u) attachmentCache.current.delete(path); });
    }
    return p;
  }, []);

  // ── write model.json ──────────────────────────────────────────────────────
  // With the version read: if another admin saved meanwhile, nothing is
  // overwritten — the newer state is loaded and the change has to be made again.
  const saveModel = useCallback(async (m: Model): Promise<{ ok: true } | { ok: false; message: string }> => {
    const be = backendRef.current;
    if (!be) return { ok: false, message: 'Kein Ordner gewählt.' };
    const ifMatch = modelVersionRef.current ?? undefined;
    const w = await be.write('model.json', JSON.stringify(m, null, 2), ifMatch ? { ifMatch } : {});
    if (!w.ok) {
      if (w.reason === 'conflict') { await loadModel(be); return { ok: false, message: MODEL_CONFLICT }; }
      return { ok: false, message: `model.json konnte nicht geschrieben werden: ${w.message}` };
    }
    if (backendRef.current !== be) return { ok: true };
    modelVersionRef.current = w.version;
    setModel(m);
    return { ok: true };
  }, [loadModel]);

  // ── Confluence import ─────────────────────────────────────────────────────
  // Existing errors (same ID) stay untouched — so the import can be repeated
  // safely. New status values are added.
  const importConfluence = useCallback(async (html: string, initialCount?: number) => {
    const be = backendRef.current;
    if (!be || !model) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    let res;
    try {
      res = parseConfluence(html, h => new DOMParser().parseFromString(h, 'text/html'), { initialCount });
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
    const known = new Set(model.statuses.map(s => s.label));
    const added = res.statuses.filter(s => !known.has(s.label));
    const howto = !!res.howto && !model.howto?.trim();
    if (added.length || howto) {
      const m = await saveModel({ ...model, statuses: [...model.statuses, ...added], ...(howto ? { howto: res.howto } : {}) });
      if (!m.ok) return m;
    }
    try { await be.ensureDir(DIR); } catch { /* write reports it */ }
    const now = nowIso();
    let created = 0, skipped = 0;
    for (const e of res.errors) {
      const data: ErrorEntry = { ...e, createdAt: now, updatedAt: now, createdBy: 'Confluence-Import' };
      const w = await be.write(`${DIR}/${e.id}.json`, toJson(data), { createOnly: true });
      if (w.ok) created++;
      else if (w.reason === 'exists') skipped++;
      else return { ok: false as const, message: `${e.id}: ${w.message}` };
    }
    await refreshIn(be);
    return { ok: true as const, summary: { total: res.errors.length, created, skipped, statusesAdded: added.length, howto } };
  }, [model, saveModel, refreshIn]);

  const toggleTheme = () => setIsDark(d => { ls.set(THEME_KEY, d ? 'light' : 'dark'); return !d; });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
  }, [isDark]);

  return (
    <Ctx.Provider value={{
      isDark, toggleTheme, storage,
      pickDirectory, savedHandleName, reconnectDirectory,
      connectSharePoint, savedSharePoint, forgetSharePoint, disconnect,
      model, modelError, saveModel,
      errors, loading, lastRefresh, refreshProblems, refreshErrors, createError, saveError, countError, importConfluence,
      saveAttachment, resolveAttachment,
      actor, setLocalName,
    }}>
      {children}
    </Ctx.Provider>
  );
}
