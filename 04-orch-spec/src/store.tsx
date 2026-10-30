// Data storage: pure client app, the files live in a shared folder
// (locally via the File System Access API or in SharePoint via Microsoft
// Graph). Layout of the folder:
//
//   config/model.json        service catalog + sign-in (master data) — the
//                            folder config/ gets its own permissions
//                            in SharePoint: only admins write
//   users.json               who works here — for @ mentions
//   processes/<slug>.json    one file per process specification
//   processes/<slug>.audit.jsonl  its change log (see audit.ts)
//
// Taken over from arch-review — deliberately the same mechanics (conflict detection
// via version/ETag, remembered folder, autosave in the caller).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryUser, Model, ProcessSpec, Step, UsersFile } from './types';
import { healExecution } from './juelFeel';
import { withoutWiringInteractions } from './interactions';
import { getHandle, putHandle } from './handles.ts';
import { DEFAULT_MODEL } from './defaultModel';
import { nowIsoWithTimezone, todayIso } from './util';
import { DemoBackend, LocalBackend, StorageBackend } from './backend';
import { readSpecFile } from './specFile';
import { GRAPH_SCOPES, GraphBackend, resolveFolderLink, SharePointFolder } from './graph';
import { PENDING_FOLDER_KEY, useAuth } from './auth';
import { readCatalogFile, type CatalogFile } from './catalogImport';
import { mergeGeneratedCatalog } from './catalogMerge';
import { appendAudit, auditPath, createdPageEntry, deleteAudit, makeEntry, parseAudit, type AuditAuthor, type AuditEntry } from './audit';
import { withIds } from './pages/designer/model';
import { dmnPath } from './dmn';
import type { App as PagesApp, Page } from './pages/runtime/spec';
import { appProblem, pageProblem, pageSlugProblem } from './pages/runtime/validate';

const DIR = 'processes';
/** The pages of the app (E15) - one file per page, plus `app.json` */
const PAGES_DIR = 'pages';
/** The app settings (title, start page, texts for values) - next to the pages in pages/ */
const APP_FILE = 'app.json';
/** Master data — in `config/`, so that only admins can write there */
export const MODEL_PATH = 'config/model.json';
/** Former location in the main folder — read until an admin moves it */
export const LEGACY_MODEL_PATH = 'model.json';

export interface SpecListItem {
  slug: string;
  data: ProcessSpec;
  version: string;
}

/** A page of the app - `pages/<slug>.json` */
export interface PageListItem {
  slug: string;
  data: Page;
  version: string;
}

/** The pages by their path */
const byPath = (a: PageListItem, b: PageListItem) => (a.data.path || a.slug).localeCompare(b.data.path || b.slug, 'de');

export type SaveResult =
  /** `auditError`: saved, but the log was not — the entries go again with the next save */
  | { status: 'saved'; version: string; auditError?: string }
  | { status: 'conflict'; currentVersion: string }
  | { status: 'error'; message: string };

export interface StorageInfo { kind: 'local' | 'sharepoint'; name: string; webUrl?: string }

/**
 * Entra search: matches — or why it is not possible. 'consent' can
 * be obtained later via requestDirectoryConsent; 'forbidden' = the permission
 * User.ReadBasic.All is missing in the app registration (admin in Entra);
 * 'noLogin' = not signed in (local folder without login).
 */
export type DirectorySearchResult =
  | { ok: true; users: DirectoryUser[] }
  | { ok: false; reason: 'noLogin' | 'consent' | 'forbidden' | 'error'; message: string };
export const DIRECTORY_SCOPES = ['User.ReadBasic.All'];

interface StoreCtx {
  isDark: boolean;
  toggleTheme: () => void;
  storage: StorageInfo | null;
  pickDirectory: () => Promise<void>;
  savedHandleName: string | null;
  reconnectDirectory: () => Promise<void>;
  connectSharePoint: (link: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  savedSharePoint: SharePointFolder | null;
  /** SharePoint folder from a setup or comment link, opened after sign-in */
  pendingFolder: string | null;
  /** remember an entered folder link across the sign-in (redirect) — null forgets it */
  rememberFolderLink: (link: string | null) => void;
  /** connect the remembered folder link now (signed in); null if none is waiting (any more) */
  connectPendingFolder: () => Promise<{ ok: true } | { ok: false; message: string } | null>;
  /** a folder link that could not be connected after sign-in */
  folderLinkError: { link: string; message: string } | null;
  clearFolderLinkError: () => void;
  /** reopen the remembered SharePoint folder (signed in) */
  reconnectSharePoint: () => Promise<void>;
  forgetSharePoint: () => void;
  disconnect: () => void;
  /** the storage before «anderen Ordner wählen» — as long as you can still go back */
  previousStorage: StorageInfo | null;
  /** back to the previous storage, without new permission or sign-in */
  resumePrevious: () => Promise<void>;
  model: Model | null;
  modelError: string | null;
  /** where the master data lives: config/model.json or (old) model.json */
  modelPath: string;
  /** is there still an old model.json in the main folder next to config/model.json? */
  legacyModelLeftover: boolean;
  saveModel: (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** bundled catalog (catalog.generated.json) — null if none is shipped */
  generatedCatalog: CatalogFile | null;
  specs: SpecListItem[];
  /** the list is currently being (re)read */
  specsLoading: boolean;
  refreshSpecs: () => Promise<void>;
  /** `audit`: what was already changed on load (retired fields) — goes into the log with the next save.
   *  null: not in the folder (or no folder); a read error rejects */
  loadSpec: (slug: string) => Promise<{ data: ProcessSpec; version: string; audit: AuditEntry[] } | null>;
  /** the BPMN for the specification — `processes/<slug>.bpmn`. null: no diagram yet; a read error rejects */
  loadBpmn: (slug: string) => Promise<string | null>;
  saveBpmn: (slug: string, xml: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** the table of a DMN decision — `processes/<slug>/<decisionId>.dmn` */
  loadDmn: (slug: string, decisionId: string) => Promise<string | null>;
  /** `createOnly`: never overwrite a stored table — then `exists` */
  saveDmn: (slug: string, decisionId: string, xml: string, opts?: { createOnly?: boolean }) => Promise<{ ok: true } | { ok: false; message: string; exists?: boolean }>;
  /** `audit`: log entries for this state — appended as soon as the specification is written */
  saveSpec: (data: ProcessSpec, expectedVersion: string | null, audit?: AuditEntry[]) => Promise<SaveResult>;
  /** the change log, oldest first — null if it is not readable */
  loadAudit: (slug: string) => Promise<AuditEntry[] | null>;
  createSpec: (spec: ProcessSpec) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** delete the specification including the BPMN from the folder — admins only (see usePermissions) */
  deleteSpec: (slug: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** the pages of the app (`pages/*.json`) */
  pages: PageListItem[];
  /** the app settings (`pages/app.json`) - null if there are none */
  pagesApp: { data: PagesApp; version: string } | null;
  /** files in pages/ that are not readable or don't fit - with the reason */
  pagesUnreadable: { file: string; problem: string }[];
  /** `audit`: the entries of the change log up to this state - appended once the page is saved */
  savePage: (slug: string, data: Page, expectedVersion: string | null, audit?: AuditEntry[]) => Promise<SaveResult>;
  /** the change log of a page (`pages/<slug>.audit.jsonl`) - null if not readable */
  loadPageAudit: (slug: string) => Promise<AuditEntry[] | null>;
  /** `auditError`: the page is there, its first log entry is not */
  createPage: (slug: string, data: Page) => Promise<{ ok: true; auditError?: string } | { ok: false; message: string }>;
  /** `auditError`: the page is gone, its log is not - a new page with the same name would continue it */
  deletePage: (slug: string, expectedVersion: string) => Promise<{ ok: true; auditError?: string } | { ok: false; message: string }>;
  savePagesApp: (data: PagesApp, expectedVersion: string | null) => Promise<SaveResult>;
  /** People for @ mentions: users.json in the shared folder */
  knownUsers: DirectoryUser[];
  searchDirectory: (query: string) => Promise<DirectorySearchResult>;
  requestDirectoryConsent: () => Promise<void>;
  /** the backend of the open folder — for the other kinds of files (services/, see services/store.tsx) */
  getBackend: () => StorageBackend | null;
}

// The chosen data folder is remembered as a handle (see `handles.ts`).
const persistHandle = (h: FileSystemDirectoryHandle) => putHandle('dir', h);
const loadStoredHandle = () => getHandle('dir');

const Ctx = createContext<StoreCtx>(null!);
export const useStore = () => useContext(Ctx);

// ── localStorage: remembered SharePoint folder + chosen mode ────────────────
const SP_KEY = 'orch-spec.sharepoint';
const MODE_KEY = 'orch-spec.mode';

function loadSharePoint(): SharePointFolder | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SP_KEY) ?? 'null');
    return raw && raw.driveId && raw.itemId ? raw as SharePointFolder : null;
  } catch { return null; }
}
function storeSharePoint(f: SharePointFolder | null) {
  try {
    if (f) { localStorage.setItem(SP_KEY, JSON.stringify(f)); localStorage.setItem(MODE_KEY, 'sharepoint'); }
    else { localStorage.removeItem(SP_KEY); localStorage.removeItem(MODE_KEY); }
  } catch { /* ignore */ }
}

const graphBase = (): string | undefined =>
  import.meta.env.DEV ? (new URLSearchParams(location.search).get('graph') ?? undefined) : undefined;

function normalizeModel(raw: unknown): Model {
  const r = (raw ?? {}) as Partial<Model>;
  return { ...DEFAULT_MODEL, ...r, services: Array.isArray(r.services) ? r.services : [] };
}

/**
 * «Offene Frage» (`open`) and «Technische Notiz» (`notes`) on the step no longer
 * exist — that is what comments are for —, likewise the «Quelle» (`sourceUrl`)
 * on the process, and prepared interactions on pattern steps. Old entries
 * are dropped on load and disappear from the file with the next save.
 */
function withoutRetiredFields(spec: ProcessSpec): ProcessSpec {
  // `= execution.x` from an older import: FEEL where possible, otherwise back to JUEL
  const heal = (ms: Step['inputs']) => ms?.map(m => { const e = healExecution(m.expression); return e === m.expression ? m : { ...m, expression: e }; });
  const clean = (steps: Step[] | undefined): Step[] | undefined => steps?.map(s => {
    const { open: _o, notes: _n, ...rest } = s as Step & { open?: unknown; notes?: unknown };
    const next: Step = { ...rest };
    if (s.inputs) next.inputs = heal(s.inputs);
    if (s.outputs) next.outputs = heal(s.outputs);
    if (s.children) next.children = clean(s.children);
    if (s.branches) next.branches = s.branches.map(b => ({ ...b, steps: clean(b.steps) ?? [] }));
    if (s.errors) next.errors = s.errors.map(e => (e.steps ? { ...e, steps: clean(e.steps) } : e));
    return next;
  });
  const { sourceUrl: _s, ...rest } = spec as ProcessSpec & { sourceUrl?: unknown };
  // an interaction prepared earlier on a pattern step (see wiringSteps)
  return withoutWiringInteractions({ ...rest, steps: clean(spec.steps) ?? [] });
}

/** without the generated entries — only that belongs in the model.json */
function stripGenerated(m: Model): Model {
  return {
    ...m,
    services: m.services.filter(s => !s.generated),
    domainTypes: m.domainTypes?.filter(t => !t.generated),
    domainDefaults: m.domainDefaults?.filter(d => !d.generated),
    projectColors: undefined,
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [isDark, setIsDark] = useState(false);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  // bundled catalog — if it is missing (404, fresh checkout), everything runs as before
  const [generatedCatalog, setGeneratedCatalog] = useState<CatalogFile | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('catalog.generated.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.text() : null))
      .then(t => {
        if (!t || !alive) return;
        const read = readCatalogFile(t);
        if (read.ok) setGeneratedCatalog(read.data);
        else console.warn('[orch-spec] catalog.generated.json:', read.message);
      })
      .catch(() => { /* not present — not an error */ });
    return () => { alive = false; };
  }, []);
  const [specs, setSpecs] = useState<SpecListItem[]>([]);
  // until the list has been read for the first time: loading, not «empty»
  const [specsLoading, setSpecsLoading] = useState(true);
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [pagesApp, setPagesApp] = useState<{ data: PagesApp; version: string } | null>(null);
  // an app.json that exists but is not readable - never overwrite it like «none»
  const pagesAppBroken = useRef(false);
  const [pagesUnreadable, setPagesUnreadable] = useState<{ file: string; problem: string }[]>([]);
  // a read that ran during a write does not overwrite the list with the state from
  // before - it reads again; a newer read wins over an older one
  const pagesRefreshSeq = useRef(0);
  const pagesWriteSeq = useRef(0);
  const pagesLoaded = useRef(false); // the list of this folder has already been read once
  const [savedHandleName, setSavedHandleName] = useState<string | null>(null);
  const [savedSharePoint, setSavedSharePoint] = useState<SharePointFolder | null>(() => loadSharePoint());
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [folderLinkError, setFolderLinkError] = useState<{ link: string; message: string } | null>(null);
  const backendRef = useRef<StorageBackend | null>(null);
  const savedHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const getTokenRef = useRef(auth.getToken);
  getTokenRef.current = auth.getToken;
  const idsRef = useRef(auth.ids);
  idsRef.current = auth.ids;
  const authRef = useRef(auth);
  authRef.current = auth;
  /** who is currently writing — like useAuthor */
  const authorOf = (): AuditAuthor => {
    const u = authRef.current.user;
    const name = u?.name?.trim() || 'Ich';
    return u?.email ? { name, email: u.email } : { name };
  };
  const [knownUsers, setKnownUsers] = useState<DirectoryUser[]>([]);
  const [modelPath, setModelPath] = useState(MODEL_PATH);
  const modelPathRef = useRef(MODEL_PATH);
  const [legacyModelLeftover, setLegacyModelLeftover] = useState(false);

  // Master data lives in config/model.json — the folder config/ gets its own
  // permissions in SharePoint (only admins write). Older folders
  // still have the model.json in the main folder: then it is read and
  // written there until an admin moves it to config/ by hand.
  const loadModel = useCallback(async (be: StorageBackend) => {
    const usePath = (p: string) => { modelPathRef.current = p; setModelPath(p); };
    // From here on the path applies to this folder — if even the first read
    // fails, the message names config/model.json, not the file of the previous
    // folder. It is switched only if only the old file exists.
    usePath(MODEL_PATH);
    try {
      const neu = await be.read(MODEL_PATH);
      // an old copy next to config/ should go — otherwise it is unclear which one applies
      // (only a hint: if reading fails, there simply is none)
      const alt = neu ? null : await be.read(LEGACY_MODEL_PATH);
      setLegacyModelLeftover(neu ? !!(await be.read(LEGACY_MODEL_PATH).catch(() => null)) : false);
      if (alt) usePath(LEGACY_MODEL_PATH);
      let read = neu ?? alt;
      if (!read) {
        const ids = idsRef.current;
        const fresh: Model = ids
          ? { ...DEFAULT_MODEL, auth: { enabled: false, tenantId: ids.tenantId, clientId: ids.clientId, adminRole: 'OrchSpec.Admin', reviewerRole: 'OrchSpec.Editor', viewerRole: 'OrchSpec.Viewer' } }
          : DEFAULT_MODEL;
        // create the folder up front; if write permission is missing, write reports it right away
        try { await be.ensureDir('config'); } catch { /* see below */ }
        const w = await be.write(MODEL_PATH, JSON.stringify(fresh, null, 2), { createOnly: true });
        if (!w.ok && w.reason !== 'exists') {
          setModel(null);
          setModelError(w.reason === 'forbidden'
            ? `${MODEL_PATH} fehlt und kann nicht angelegt werden (keine Schreibberechtigung).`
            : `${MODEL_PATH} fehlt und konnte nicht angelegt werden.`);
          return;
        }
        if (w.ok) { setModel(fresh); setModelError(null); return; }
        // created by someone else at the same time → load their state
        read = await be.read(MODEL_PATH);
        if (!read) throw new Error(`${MODEL_PATH} nicht gefunden.`);
      }
      try {
        setModel(normalizeModel(JSON.parse(read.text)));
        setModelError(null);
      } catch {
        setModel(null); // do NOT overwrite an existing but broken file
        setModelError(`${modelPathRef.current} ist unlesbar (kein gültiges JSON).`);
      }
    } catch (e) {
      console.error('[orch-spec] loadModel:', e);
      setModel(null);
      setModelError(`${modelPathRef.current} konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const refreshSpecsIn = useCallback(async (be: StorageBackend) => {
    const items: SpecListItem[] = [];
    setSpecsLoading(true);
    try {
      // read in parallel — with SharePoint every file is a separate call;
      // at most 8 at once, so that the service does not throttle
      const files = (await be.list(DIR)).filter(f => f.name.endsWith('.json'));
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const f = files[next++];
          try {
            const read = await be.read(`${DIR}/${f.name}`);
            if (read) items.push({ slug: f.name.replace(/\.json$/, ''), data: JSON.parse(read.text) as ProcessSpec, version: read.version });
          } catch { /* skip unreadable file */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
    } catch (e) {
      console.error('[orch-spec] refreshSpecs:', e);
    } finally {
      setSpecsLoading(false);
    }
    items.sort((a, b) => (a.data.title || a.slug).localeCompare(b.data.title || b.slug, 'de'));
    setSpecs(items);
  }, []);

  const refreshSpecs = useCallback(async () => {
    if (backendRef.current) await refreshSpecsIn(backendRef.current);
  }, [refreshSpecsIn]);

  // The pages: a few small files - one that doesn't fit counts as unreadable
  const refreshPagesIn = useCallback(async function refresh(be: StorageBackend, attempt = 1): Promise<void> {
    const seq = ++pagesRefreshSeq.current;
    const writes = pagesWriteSeq.current;
    const items: PageListItem[] = [];
    const unreadable: { file: string; problem: string }[] = [];
    let app = null as { data: PagesApp; version: string } | null;
    let brokenApp = false;
    let ioFailed = false;
    try {
      // read concurrently - with SharePoint every file is a separate call
      await Promise.all((await be.list(PAGES_DIR)).filter(f => f.name.endsWith('.json')).map(async f => {
        let read;
        try {
          read = await be.read(`${PAGES_DIR}/${f.name}`);
        } catch (e) {
          // unreachable (e.g. SharePoint briefly down) is not broken - the previous state stays
          console.error(`[orch-spec] ${PAGES_DIR}/${f.name} ist gerade nicht erreichbar:`, e);
          ioFailed = true;
          return;
        }
        if (!read) return;
        try {
          const data: unknown = JSON.parse(read.text);
          // the renderer relies on the shape (body as a list, known building blocks)
          const problem = f.name === APP_FILE ? appProblem(data) : pageProblem(data);
          if (problem) throw new Error(problem);
          if (f.name === APP_FILE) app = { data: data as PagesApp, version: read.version };
          else items.push({ slug: f.name.replace(/\.json$/, ''), data: data as Page, version: read.version });
        } catch (e) {
          // an unreadable page is missing from the list - creating only works as new (createOnly), it stays in place
          console.error(`[orch-spec] ${PAGES_DIR}/${f.name} ist nicht lesbar:`, e);
          unreadable.push({ file: f.name, problem: e instanceof Error ? e.message : String(e) });
          if (f.name === APP_FILE) brokenApp = true;
        }
      }));
    } catch (e) {
      // the list is not readable (e.g. SharePoint briefly down): the previous state stays - app.json
      // therefore does not mean «broken», and without a version it would only be created anew anyway (createOnly)
      console.error('[orch-spec] refreshPages:', e);
      return;
    }
    // a late read of another folder (folder changed) or an outdated one overwrites nothing
    if (backendRef.current !== be || pagesRefreshSeq.current !== seq || ioFailed) return;
    pagesAppBroken.current = brokenApp;
    setPagesUnreadable(unreadable.sort((a, b) => a.file.localeCompare(b.file)));
    // written in the meantime - read again, at most three times (the designer saves continuously; with
    // SharePoint every file is a call). After that the list stays as the writers have set
    // it - only the first read of the folder gets the state that was read (otherwise it would bring back a page
    // that was just deleted)
    if (pagesWriteSeq.current !== writes) {
      if (attempt < 3) return refresh(be, attempt + 1);
      if (pagesLoaded.current) return;
    }
    pagesLoaded.current = true;
    setPages(items.sort(byPath));
    setPagesApp(app);
  }, []);

  const resetPages = useCallback(() => {
    pagesRefreshSeq.current++; // a read that is still running belongs to the previous folder
    pagesAppBroken.current = false;
    pagesLoaded.current = false;
    setPages([]); setPagesApp(null); setPagesUnreadable([]);
  }, []);

  // ── users.json: who works in this folder (for @ mentions) ──────────────────
  // null = file corrupt (not JSON, no list «users») — that is something
  // other than «nobody yet» and must never be overwritten as if empty
  // (see registerUser)
  const parseUsers = (text: string): DirectoryUser[] | null => {
    try {
      const f = JSON.parse(text) as Partial<UsersFile>;
      return Array.isArray(f?.users) ? f.users.filter(u => u && typeof u.email === 'string' && typeof u.name === 'string') : null;
    } catch {
      return null;
    }
  };
  const loadUsersIn = useCallback(async (be: StorageBackend) => {
    try {
      const read = await be.read('users.json');
      setKnownUsers((read ? parseUsers(read.text) : null) ?? []);
    } catch {
      setKnownUsers([]);
    }
  }, []);
  // Add the signed-in person or update «last seen» (ETag,
  // retry on conflict; skip silently without write permission). If the
  // file is corrupt (e.g. an aborted sync), it is first backed up unchanged
  // as users.broken-<timestamp>.json and then started afresh;
  // if the backup fails, nothing is written.
  const registerUser = useCallback(async (be: StorageBackend, u: { name: string; email: string }) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let cur: { text: string; version: string } | null = null;
      try { cur = await be.read('users.json'); } catch { return; }
      let prev = cur ? parseUsers(cur.text) : [];
      if (!prev && cur) {
        const backup = `users.broken-${nowIsoWithTimezone().replace(/[^0-9]/g, '').slice(0, 14)}.json`;
        const b = await be.write(backup, cur.text, { createOnly: true });
        if (!b.ok && b.reason !== 'exists') { console.warn('[orch-spec] users.json ist beschädigt und konnte nicht gesichert werden:', b.message); return; }
        console.warn(`[orch-spec] users.json war beschädigt — unverändert als ${backup} gesichert, neu begonnen.`);
      }
      prev ??= [];
      const key = u.email.toLowerCase();
      const users = [
        ...prev.filter(x => x.email.toLowerCase() !== key),
        { ...(prev.find(x => x.email.toLowerCase() === key) ?? {}), name: u.name, email: u.email, lastSeen: nowIsoWithTimezone() },
      ].sort((a, b) => a.name.localeCompare(b.name, 'de'));
      const file: UsersFile = { version: 1, users };
      const w = await be.write('users.json', JSON.stringify(file, null, 2), cur ? { ifMatch: cur.version } : { createOnly: true });
      if (w.ok) { setKnownUsers(users); return; }
      if (w.reason !== 'conflict' && w.reason !== 'exists') return;
    }
  }, []);
  const registeredRef = useRef('');
  useEffect(() => {
    const be = backendRef.current;
    const u = auth.user;
    if (!storage || !be || !u?.email) return;
    const key = `${storage.kind}:${storage.name}:${u.email}`;
    if (registeredRef.current === key) return;
    registeredRef.current = key;
    void registerUser(be, { name: u.name, email: u.email });
  }, [storage, auth.user, registerUser]);

  // Entra search (Graph /users?$search) — only when signed in; each person grants
  // consent to User.ReadBasic.All themselves (requestDirectoryConsent)
  const searchDirectory = useCallback(async (query: string): Promise<DirectorySearchResult> => {
    const q = query.trim().replace(/"/g, '');
    if (!q) return { ok: true, users: [] };
    const consent = 'Für die Suche im Verzeichnis fehlt noch deine Zustimmung zur Berechtigung «Grundlegende Profile aller Benutzer lesen» (User.ReadBasic.All).';
    const forbidden = 'Microsoft Graph verweigert die Benutzersuche: Die Berechtigung User.ReadBasic.All fehlt in der App-Registrierung (Entra → App-Registrierungen → API-Berechtigungen).';
    // development: ?dirfail=consent|forbidden simulates a missing permission
    const simulate = import.meta.env.DEV ? new URLSearchParams(location.search).get('dirfail') : null;
    if (simulate === 'consent') return { ok: false, reason: 'consent', message: consent };
    if (simulate === 'forbidden') return { ok: false, reason: 'forbidden', message: forbidden };
    const t = await authRef.current.tryToken(DIRECTORY_SCOPES);
    if (!t.ok) {
      if (t.reason === 'noAccount') return { ok: false, reason: 'noLogin', message: 'Keine Anmeldung — die Entra-Suche steht nur mit Microsoft-Anmeldung zur Verfügung.' };
      if (t.reason === 'interaction') return { ok: false, reason: 'consent', message: consent };
      return { ok: false, reason: 'error', message: t.message };
    }
    const search = encodeURIComponent(`"displayName:${q}" OR "mail:${q}" OR "userPrincipalName:${q}"`);
    try {
      const res = await fetch(`https://graph.microsoft.com/v1.0/users?$search=${search}&$select=displayName,mail,userPrincipalName&$top=8`, {
        headers: { Authorization: `Bearer ${t.token}`, ConsistencyLevel: 'eventual' },
      });
      if (res.status === 403 || res.status === 401) return { ok: false, reason: 'forbidden', message: forbidden };
      if (!res.ok) return { ok: false, reason: 'error', message: `Benutzersuche fehlgeschlagen (HTTP ${res.status}).` };
      const data = await res.json();
      const users: DirectoryUser[] = (data.value ?? [])
        .map((u: { displayName?: string; mail?: string; userPrincipalName?: string }) => ({
          name: String(u.displayName ?? '').trim(), email: String(u.mail ?? u.userPrincipalName ?? '').trim(),
        }))
        .filter((u: DirectoryUser) => u.name && u.email);
      return { ok: true, users };
    } catch (e) {
      return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }, []);
  const requestDirectoryConsent = useCallback(() => authRef.current.requestConsent(DIRECTORY_SCOPES), []);

  const storageRef = useRef<StorageInfo | null>(null);
  storageRef.current = storage;
  const previousRef = useRef<{ be: StorageBackend; info: StorageInfo } | null>(null);
  const [previousStorage, setPreviousStorage] = useState<StorageInfo | null>(null);
  const activate = useCallback(async (be: StorageBackend, info: StorageInfo) => {
    backendRef.current = be;
    resetPages(); // nothing from the previous folder - even if the first read here fails
    previousRef.current = null;
    setPreviousStorage(null);
    registeredRef.current = '';
    setStorage(info);
    setSavedHandleName(null);
    savedHandleRef.current = null;
    // model, users and list are independent of each other — read them concurrently
    await Promise.all([
      loadModel(be),
      loadUsersIn(be),
      (async () => {
        try { await be.ensureDir(DIR); } catch { /* readonly? list stays empty */ }
        await refreshSpecsIn(be);
      })(),
      refreshPagesIn(be),
    ]);
  }, [loadModel, loadUsersIn, refreshSpecsIn, refreshPagesIn, resetPages]);

  // ── local folder ──────────────────────────────────────────────────────────
  const pickDirectory = useCallback(async () => {
    try {
      const dir = new URLSearchParams(location.search).has('opfs')
        ? await navigator.storage.getDirectory()
        : await window.showDirectoryPicker({ mode: 'readwrite' });
      await persistHandle(dir);
      storeSharePoint(null); setSavedSharePoint(null);
      // a folder from a link no longer applies as soon as you choose one yourself
      try { localStorage.removeItem(PENDING_FOLDER_KEY); } catch { /* ignore */ }
      setPendingFolder(null);
      await activate(new LocalBackend(dir), { kind: 'local', name: dir.name || 'Ordner' });
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') console.error('[orch-spec] pickDirectory:', e);
    }
  }, [activate]);

  const reconnectDirectory = useCallback(async () => {
    const handle = savedHandleRef.current;
    if (!handle) return;
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') await activate(new LocalBackend(handle), { kind: 'local', name: handle.name || 'Ordner' });
    } catch (e) {
      console.error('[orch-spec] reconnectDirectory:', e);
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
      console.error('[orch-spec] connectSharePoint:', e);
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  }, [activateSharePoint, tokenProvider]);

  // remembered folder already (re)connected — the start effect below then does not do it again
  const autoRef = useRef(false);
  const reconnectSharePoint = useCallback(async () => {
    const sp = loadSharePoint();
    if (!sp) return;
    autoRef.current = true;
    await activateSharePoint(sp).catch(e => console.error('[orch-spec] SharePoint reconnect:', e));
  }, [activateSharePoint]);

  const rememberFolderLink = useCallback((link: string | null) => {
    try {
      if (link) { localStorage.setItem(PENDING_FOLDER_KEY, link); localStorage.setItem(MODE_KEY, 'sharepoint'); }
      else localStorage.removeItem(PENDING_FOLDER_KEY);
    } catch { /* ignore */ }
    setPendingFolder(link);
  }, []);

  // whoever takes the link first connects — here or in the start effect below, never both
  const takePendingFolder = (): string | null => {
    try {
      const link = localStorage.getItem(PENDING_FOLDER_KEY);
      if (link) localStorage.removeItem(PENDING_FOLDER_KEY);
      return link;
    } catch { return null; }
  };

  const connectPendingFolder = useCallback(async () => {
    const link = takePendingFolder();
    setPendingFolder(null);
    if (!link) return null;
    autoRef.current = true;
    return connectSharePoint(link);
  }, [connectSharePoint]);

  const forgetSharePoint = useCallback(() => {
    storeSharePoint(null); setSavedSharePoint(null);
    try { localStorage.removeItem(PENDING_FOLDER_KEY); } catch { /* ignore */ }
    setPendingFolder(null);
  }, []);

  // «Anderen Ordner wählen» only disconnects the display — the previous storage
  // is kept in reserve until another one is chosen. That way the
  // start card leads back without new permission (local) or sign-in (SharePoint).
  const disconnect = useCallback(() => {
    if (backendRef.current && storageRef.current) {
      previousRef.current = { be: backendRef.current, info: storageRef.current };
      setPreviousStorage(storageRef.current);
    }
    backendRef.current = null;
    setStorage(null); setModel(null); setSpecs([]);
    resetPages();
  }, [resetPages]);
  const resumePrevious = useCallback(async () => {
    const prev = previousRef.current;
    if (!prev) return;
    await activate(prev.be, prev.info);
  }, [activate]);

  // On start, restore the remembered folder (SharePoint as soon as the
  // sign-in is in place; local directly if the permission is still valid).
  useEffect(() => {
    // A link brings its folder along — it applies even if another one
    // is remembered (a comment link from Teams points into exactly this folder).
    // If it is the remembered one, things simply continue as normal.
    let pending = (() => { try { return localStorage.getItem(PENDING_FOLDER_KEY); } catch { return null; } })();
    if (pending && pending === loadSharePoint()?.webUrl) {
      try { localStorage.removeItem(PENDING_FOLDER_KEY); } catch { /* ignore */ }
      pending = null;
    }
    setPendingFolder(pending);
    if (pending) {
      if (auth.status === 'signedIn' || (auth.status === 'disabled' && graphBase())) {
        const link = pending;
        connectPendingFolder().then(r => {
          if (r && !r.ok) {
            console.error('[orch-spec] Ordner aus dem Link:', r.message);
            setFolderLinkError({ link, message: r.message });
          }
        });
      }
      return;
    }
    if (autoRef.current) return;
    // development: ?demo starts directly with the sample data
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
        activateSharePoint(sp).catch(e => console.error('[orch-spec] SharePoint reconnect:', e));
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
  }, [auth.status, activate, activateSharePoint, connectPendingFolder]);

  // ── Specifications ────────────────────────────────────────────────────────
  // null: there is no such specification in the folder; a read or parse error is thrown -
  // the view says which one it was instead of waiting forever
  const loadSpec = useCallback(async (slug: string) => {
    const be = backendRef.current;
    if (!be) return null;
    const read = await readSpecFile(be, `${DIR}/${slug}.json`);
    if (!read) return null;
    const { raw } = read;
    const data = withoutRetiredFields(raw);
    const dropped = makeEntry(raw, data, { source: 'load', note: 'Ausgemusterte Felder entfernt (Offene Frage, Technische Notiz — dafür gibt es Kommentare; Quelle)' }, authorOf());
    return { data, version: read.version, audit: dropped ? [dropped] : [] };
  }, []);

  // The BPMN lives next to the specification in the same folder. That way it belongs
  // to the app and can be edited here — instead of choosing it anew every time.
  // null: no diagram yet; a read error rejects - the view says so instead of just showing none
  const loadBpmn = useCallback(async (slug: string) => {
    const be = backendRef.current;
    if (!be) return null;
    const read = await be.read(`${DIR}/${slug}.bpmn`);
    return read?.text ?? null;
  }, []);

  const saveBpmn = useCallback(async (slug: string, xml: string) => {
    const be = backendRef.current;
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    const w = await be.write(`${DIR}/${slug}.bpmn`, xml);
    return w.ok ? { ok: true as const } : { ok: false as const, message: w.message };
  }, []);

  // The tables of the DMN decisions — in the specification's subfolder
  const loadDmn = useCallback(async (slug: string, decisionId: string) => {
    const be = backendRef.current;
    if (!be) return null;
    try {
      return (await be.read(dmnPath(DIR, slug, decisionId)))?.text ?? null;
    } catch {
      return null;
    }
  }, []);

  const saveDmn = useCallback(async (slug: string, decisionId: string, xml: string, opts: { createOnly?: boolean } = {}) => {
    const be = backendRef.current;
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    const w = await be.write(dmnPath(DIR, slug, decisionId), xml, opts.createOnly ? { createOnly: true } : {});
    return w.ok ? { ok: true as const } : { ok: false as const, message: w.message, ...(w.reason === 'exists' ? { exists: true } : {}) };
  }, []);

  const saveSpec = useCallback(async (data: ProcessSpec, expectedVersion: string | null, audit: AuditEntry[] = []): Promise<SaveResult> => {
    const be = backendRef.current;
    if (!be) return { status: 'error', message: 'Kein Ordner gewählt.' };
    let json: string;
    try { json = JSON.stringify(data, null, 2); }
    catch { return { status: 'error', message: 'Spezifikation konnte nicht serialisiert werden.' }; }
    const w = await be.write(`${DIR}/${data.slug}.json`, json, expectedVersion != null ? { ifMatch: expectedVersion } : {});
    if (!w.ok) {
      if (w.reason === 'conflict') return { status: 'conflict', currentVersion: w.currentVersion ?? '' };
      return { status: 'error', message: w.reason === 'forbidden' ? w.message : 'Schreiben fehlgeschlagen — die Datei wurde NICHT gespeichert.' };
    }
    setSpecs(prev => [...prev.filter(p => p.slug !== data.slug), { slug: data.slug, data, version: w.version }]
      .sort((a, b) => (a.data.title || a.slug).localeCompare(b.data.title || b.slug, 'de')));
    // only after the specification: only what has also been saved goes into the log
    const a = await appendAudit(be, DIR, data.slug, audit);
    return { status: 'saved', version: w.version, ...(a.ok ? {} : { auditError: a.message }) };
  }, []);

  const loadAudit = useCallback(async (slug: string) => {
    const be = backendRef.current;
    if (!be) return null;
    try {
      const read = await be.read(auditPath(DIR, slug));
      return read ? parseAudit(read.text) : [];
    } catch {
      return null;
    }
  }, []);

  const createSpec = useCallback(async (spec: ProcessSpec) => {
    const be = backendRef.current;
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    const data: ProcessSpec = { ...spec, createdAt: spec.createdAt || todayIso(), updatedAt: nowIsoWithTimezone() };
    let json: string;
    try { json = JSON.stringify(data, null, 2); }
    catch { return { ok: false as const, message: 'Spezifikation konnte nicht serialisiert werden.' }; }
    try { await be.ensureDir(DIR); } catch { /* write reports it */ }
    const w = await be.write(`${DIR}/${data.slug}.json`, json, { createOnly: true });
    if (!w.ok) {
      if (w.reason === 'exists') return { ok: false as const, message: 'Eine Spezifikation mit diesem Namen existiert bereits.' };
      return { ok: false as const, message: w.message };
    }
    setSpecs(prev => [...prev, { slug: data.slug, data, version: w.version }]
      .sort((a, b) => (a.data.title || a.slug).localeCompare(b.data.title || b.slug, 'de')));
    // the first entry: created — with everything that came about in the process
    const empty: ProcessSpec = { version: data.version, slug: data.slug, name: '', title: '', status: data.status, createdAt: data.createdAt, updatedAt: data.updatedAt, steps: [] };
    const first = makeEntry(empty, data, { source: 'manual', note: 'Spezifikation angelegt' }, authorOf());
    if (first) await appendAudit(be, DIR, data.slug, [first]);
    return { ok: true as const };
  }, []);

  // Deletes the files of the specification: `<slug>.json`, `<slug>.bpmn` and the log.
  // First the specification, then the diagram — if the BPMN remains after an
  // error, it does no harm (the list only knows .json files).
  // The check of who may delete lives in the UI (canDelete).
  const deleteSpec = useCallback(async (slug: string) => {
    const be = backendRef.current;
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    const json = await be.delete(`${DIR}/${slug}.json`);
    if (!json.ok) return { ok: false as const, message: json.message };
    setSpecs(prev => prev.filter(p => p.slug !== slug));
    const bpmn = await be.delete(`${DIR}/${slug}.bpmn`);
    if (!bpmn.ok) return { ok: false as const, message: `Spezifikation gelöscht, aber das BPMN nicht: ${bpmn.message}` };
    // the log belongs to the specification — a new one with the same name starts empty
    // (archives stay in place: the list does not name them, and they do no harm)
    await be.delete(auditPath(DIR, slug));
    // the tables of the DMN decisions
    try {
      for (const f of await be.list(`${DIR}/${slug}`)) if (f.name.endsWith('.dmn')) await be.delete(`${DIR}/${slug}/${f.name}`);
    } catch { /* no subfolder */ }
    return { ok: true as const };
  }, []);

  // ── Pages ─────────────────────────────────────────────────────────────────
  // `stale`: another folder has been chosen in the meantime - the result does not belong in its list
  const writePageFile = useCallback(async (path: string, data: unknown, expectedVersion: string | null): Promise<SaveResult & { exists?: true; stale?: boolean }> => {
    const be = backendRef.current;
    if (!be) return { status: 'error', message: 'Kein Ordner gewählt.' };
    try { await be.ensureDir(PAGES_DIR); } catch { /* write reports it */ }
    // without a version only create new - an existing file is never overwritten blindly
    const w = await be.write(path, JSON.stringify(data, null, 2) + '\n', expectedVersion != null ? { ifMatch: expectedVersion } : { createOnly: true });
    if (!w.ok) {
      if (w.reason === 'conflict') return { status: 'conflict', currentVersion: w.currentVersion ?? '' };
      if (w.reason === 'exists') return { status: 'error', message: 'Die Datei gibt es schon – Seite neu laden.', exists: true };
      return { status: 'error', message: w.reason === 'forbidden' ? w.message : 'Schreiben fehlgeschlagen — die Datei wurde NICHT gespeichert.' };
    }
    pagesWriteSeq.current++;
    return { status: 'saved', version: w.version, stale: backendRef.current !== be };
  }, []);

  const savePage = useCallback(async (slug: string, data: Page, expectedVersion: string | null, audit: AuditEntry[] = []): Promise<SaveResult> => {
    const bad = pageSlugProblem(slug);
    if (bad) return { status: 'error', message: bad };
    const be = backendRef.current;
    const r = await writePageFile(`${PAGES_DIR}/${slug}.json`, data, expectedVersion);
    if (r.status === 'saved' && !r.stale)
      setPages(prev => [...prev.filter(p => p.slug !== slug), { slug, data, version: r.version }].sort(byPath));
    // as for a process: only what has also been saved goes into the log - next to the page, never in it
    if (r.status !== 'saved' || !be || r.stale) return r;
    const a = await appendAudit(be, PAGES_DIR, slug, audit);
    return a.ok ? r : { ...r, auditError: a.message };
  }, [writePageFile]);

  const loadPageAudit = useCallback(async (slug: string) => {
    const be = backendRef.current;
    if (!be) return null;
    try {
      const read = await be.read(auditPath(PAGES_DIR, slug));
      return read ? parseAudit(read.text) : [];
    } catch {
      return null;
    }
  }, []);

  const createPage = useCallback(async (slug: string, raw: Page) => {
    const bad = pageSlugProblem(slug);
    if (bad) return { ok: false as const, message: bad };
    // the building blocks with their IDs from the start - the first log entry names them by it
    const data = { ...raw, body: withIds(raw.body) };
    const be = backendRef.current;
    // without a version: only create new (createOnly)
    const r = await writePageFile(`${PAGES_DIR}/${slug}.json`, data, null);
    if (r.status !== 'saved')
      return { ok: false as const, message: 'exists' in r && r.exists ? 'Eine Seite mit diesem Namen gibt es schon (vielleicht unlesbar - siehe Konsole).'
        : r.status === 'error' ? r.message
        // createOnly knows no conflict - if one comes anyway, name the backend's version instead of guessing
        : `Unerwartete Antwort beim Anlegen (Konflikt, Version ${r.currentVersion || '?'}) – Seite neu laden.` };
    // another folder in the meantime: the page and its log belong to the old one - as in savePage
    if (r.stale || !be) return { ok: true as const };
    setPages(prev => [...prev, { slug, data, version: r.version }].sort(byPath));
    // the first entry: created - with what the new page brings; not written: said, the page is there
    const first = createdPageEntry(data, authorOf());
    const a = first ? await appendAudit(be, PAGES_DIR, slug, [first]) : { ok: true as const };
    return a.ok ? { ok: true as const } : { ok: true as const, auditError: a.message };
  }, [writePageFile]);

  const deletePage = useCallback(async (slug: string, expectedVersion: string) => {
    const be = backendRef.current;
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    const bad = pageSlugProblem(slug);
    if (bad) return { ok: false as const, message: bad };
    // only the version the list shows - a page that someone has changed in the meantime stays
    const d = await be.delete(`${PAGES_DIR}/${slug}.json`, { ifMatch: expectedVersion });
    if (!d.ok) return { ok: false as const, message: d.reason === 'conflict' ? 'Die Seite wurde inzwischen geändert – Seite neu laden.' : d.message };
    pagesWriteSeq.current++;
    if (backendRef.current === be) setPages(prev => prev.filter(p => p.slug !== slug));
    // the log belongs to the page - a new one with the same name starts empty; the page is gone either way
    const a = await deleteAudit(be, PAGES_DIR, slug);
    return a.ok ? { ok: true as const } : { ok: true as const, auditError: a.message };
  }, []);

  const savePagesApp = useCallback(async (data: PagesApp, expectedVersion: string | null): Promise<SaveResult> => {
    if (pagesAppBroken.current)
      return { status: 'error', message: `${PAGES_DIR}/${APP_FILE} ist nicht lesbar – sie wird nicht überschrieben. Bitte von Hand reparieren.` };
    const r = await writePageFile(`${PAGES_DIR}/${APP_FILE}`, data, expectedVersion);
    if (r.status === 'saved' && !r.stale) setPagesApp({ data, version: r.version });
    return r;
  }, [writePageFile]);

  const saveModel = useCallback(async (m: Model): Promise<{ ok: true } | { ok: false; message: string }> => {
    const be = backendRef.current;
    if (!be) return { ok: false, message: 'Kein Ordner gewählt.' };
    const user = stripGenerated(m); // the bundled catalog does not belong in the model.json
    let json: string;
    try { json = JSON.stringify(user, null, 2); }
    catch { return { ok: false, message: 'Stammdaten konnten nicht serialisiert werden.' }; }
    const path = modelPathRef.current;
    const w = await be.write(path, json);
    if (!w.ok) return { ok: false, message: `${path} konnte nicht geschrieben werden: ${w.message}` };
    setModel(user);
    return { ok: true };
  }, []);

  // towards the outside always the merged view: generated catalog + model.json
  const mergedModel = useMemo(() => (model ? mergeGeneratedCatalog(model, generatedCatalog) : model), [model, generatedCatalog]);

  const toggleTheme = () => setIsDark(d => !d);
  const getBackend = useCallback(() => backendRef.current, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
  }, [isDark]);

  return (
    <Ctx.Provider value={{
      isDark, toggleTheme, storage,
      pickDirectory, savedHandleName, reconnectDirectory,
      connectSharePoint, savedSharePoint, pendingFolder, rememberFolderLink, connectPendingFolder,
      folderLinkError, clearFolderLinkError: () => setFolderLinkError(null), reconnectSharePoint, forgetSharePoint, disconnect, previousStorage, resumePrevious,
      model: mergedModel, modelError, saveModel, generatedCatalog,
      modelPath, legacyModelLeftover,
      specs, specsLoading, refreshSpecs, loadSpec, saveSpec, loadAudit, createSpec, deleteSpec, loadBpmn, saveBpmn, loadDmn, saveDmn,
      pages, pagesApp, pagesUnreadable, savePage, loadPageAudit, createPage, deletePage, savePagesApp,
      knownUsers, searchDirectory, requestDirectoryConsent, getBackend,
    }}>
      {children}
    </Ctx.Provider>
  );
}
