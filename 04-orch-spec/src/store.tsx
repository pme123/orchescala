// Datenhaltung: reine Client-App, die Dateien liegen in einem geteilten Ordner
// (lokal über die File System Access API oder in SharePoint über Microsoft
// Graph). Aufbau des Ordners:
//
//   model.json               Service-Katalog + Anmeldung (Stammdaten)
//   processes/<slug>.json    eine Datei je Prozess-Spezifikation
//
// Übernommen aus arch-review — bewusst dieselbe Mechanik (Konflikterkennung
// über Version/ETag, gemerkter Ordner, Autosave im Aufrufer).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Model, ProcessSpec } from './types';
import { getHandle, putHandle } from './handles.ts';
import { DEFAULT_MODEL } from './defaultModel';
import { nowIsoWithTimezone, todayIso } from './util';
import { DemoBackend, LocalBackend, StorageBackend } from './backend';
import { GRAPH_SCOPES, GraphBackend, resolveFolderLink, SharePointFolder } from './graph';
import { PENDING_FOLDER_KEY, useAuth } from './auth';
import { readCatalogFile, type CatalogFile } from './catalogImport';

const DIR = 'processes';

export interface SpecListItem {
  slug: string;
  data: ProcessSpec;
  version: string;
}

export type SaveResult =
  | { status: 'saved'; version: string }
  | { status: 'conflict'; currentVersion: string }
  | { status: 'error'; message: string };

export interface StorageInfo { kind: 'local' | 'sharepoint'; name: string; webUrl?: string }

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
  /** mitgelieferter Katalog (catalog.generated.json) — null, wenn keiner ausgeliefert ist */
  generatedCatalog: CatalogFile | null;
  specs: SpecListItem[];
  refreshSpecs: () => Promise<void>;
  loadSpec: (slug: string) => Promise<{ data: ProcessSpec; version: string } | null>;
  /** das BPMN zur Spezifikation — `processes/<slug>.bpmn` */
  loadBpmn: (slug: string) => Promise<string | null>;
  saveBpmn: (slug: string, xml: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  saveSpec: (data: ProcessSpec, expectedVersion: string | null) => Promise<SaveResult>;
  createSpec: (spec: ProcessSpec) => Promise<{ ok: true } | { ok: false; message: string }>;
  deleteSpec: (slug: string) => void;
}

// Der gewählte Datenordner wird als Handle gemerkt (siehe `handles.ts`).
const persistHandle = (h: FileSystemDirectoryHandle) => putHandle('dir', h);
const loadStoredHandle = () => getHandle('dir');

const Ctx = createContext<StoreCtx>(null!);
export const useStore = () => useContext(Ctx);

// ── localStorage: gemerkter SharePoint-Ordner + gewählter Modus ─────────────
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

// ── Mitgelieferter Katalog ───────────────────────────────────────────────────
// `catalog.generated.json` wird mit dem App-Build ausgeliefert (public/,
// erzeugt von orchescala bei jedem Release aus OpenAPI + Site-Katalog).
// Er IST der Service-/Domain-Katalog: bei gleicher Kennung (id, Topic,
// gerufener Prozess bzw. Typ-Id) gewinnt er; Einträge aus der model.json
// bleiben nur sichtbar, wo der generierte Katalog nichts hat (Altbestand).
// Der Benutzer pflegt keinen Katalog — model.json gehört den Spezifikationen.
function mergeGeneratedCatalog(user: Model, gen: CatalogFile | null): Model {
  if (!gen) return user;
  const genServices = (gen.services ?? []).map(s => ({ ...s, generated: true }));
  const genTypes = (gen.domainTypes ?? []).map(t => ({ ...t, generated: true }));
  const kennt = new Set<string>();
  for (const s of genServices) {
    kennt.add(s.id);
    if (s.topic) kennt.add(s.topic);
    if (s.calledProcess) kennt.add(s.calledProcess);
  }
  const typIds = new Set(genTypes.map(t => t.id));
  return {
    ...user,
    services: [
      ...genServices,
      ...user.services.filter(s => !kennt.has(s.id)
        && !(s.topic && kennt.has(s.topic)) && !(s.calledProcess && kennt.has(s.calledProcess))),
    ],
    domainTypes: [...genTypes, ...(user.domainTypes ?? []).filter(t => !typIds.has(t.id))],
    domainSources: gen.domainSources ?? user.domainSources,
  };
}

/** ohne die generierten Einträge — nur das gehört in die model.json */
function stripGenerated(m: Model): Model {
  return {
    ...m,
    services: m.services.filter(s => !s.generated),
    domainTypes: m.domainTypes?.filter(t => !t.generated),
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [isDark, setIsDark] = useState(false);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  // mitgelieferter Katalog — fehlt er (404, frischer Checkout), läuft alles wie bisher
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
      .catch(() => { /* nicht vorhanden — kein Fehler */ });
    return () => { alive = false; };
  }, []);
  const [specs, setSpecs] = useState<SpecListItem[]>([]);
  const [savedHandleName, setSavedHandleName] = useState<string | null>(null);
  const [savedSharePoint, setSavedSharePoint] = useState<SharePointFolder | null>(() => loadSharePoint());
  const backendRef = useRef<StorageBackend | null>(null);
  const savedHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const getTokenRef = useRef(auth.getToken);
  getTokenRef.current = auth.getToken;
  const idsRef = useRef(auth.ids);
  idsRef.current = auth.ids;

  const loadModel = useCallback(async (be: StorageBackend) => {
    try {
      const read = await be.read('model.json');
      if (!read) {
        const ids = idsRef.current;
        const fresh: Model = ids
          ? { ...DEFAULT_MODEL, auth: { enabled: false, tenantId: ids.tenantId, clientId: ids.clientId, adminRole: 'OrchSpec.Admin', reviewerRole: 'OrchSpec.Editor', viewerRole: 'OrchSpec.Viewer' } }
          : DEFAULT_MODEL;
        const w = await be.write('model.json', JSON.stringify(fresh, null, 2), { createOnly: true });
        if (!w.ok && w.reason !== 'exists') {
          setModel(null);
          setModelError(w.reason === 'forbidden'
            ? 'model.json fehlt und kann nicht angelegt werden (keine Schreibberechtigung).'
            : 'model.json fehlt und konnte nicht angelegt werden.');
          return;
        }
        setModel(fresh); setModelError(null);
        return;
      }
      try {
        setModel(normalizeModel(JSON.parse(read.text)));
        setModelError(null);
      } catch {
        setModel(null); // vorhandene, aber defekte Datei NICHT überschreiben
        setModelError('model.json ist unlesbar (kein gültiges JSON).');
      }
    } catch (e) {
      console.error('[orch-spec] loadModel:', e);
      setModel(null);
      setModelError(`model.json konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const refreshSpecsIn = useCallback(async (be: StorageBackend) => {
    const items: SpecListItem[] = [];
    try {
      for (const f of await be.list(DIR)) {
        if (!f.name.endsWith('.json')) continue;
        const read = await be.read(`${DIR}/${f.name}`);
        if (!read) continue;
        try {
          items.push({ slug: f.name.replace(/\.json$/, ''), data: JSON.parse(read.text) as ProcessSpec, version: read.version });
        } catch { /* unlesbare Datei überspringen */ }
      }
    } catch (e) {
      console.error('[orch-spec] refreshSpecs:', e);
    }
    items.sort((a, b) => (a.data.title || a.slug).localeCompare(b.data.title || b.slug, 'de'));
    setSpecs(items);
  }, []);

  const refreshSpecs = useCallback(async () => {
    if (backendRef.current) await refreshSpecsIn(backendRef.current);
  }, [refreshSpecsIn]);

  const activate = useCallback(async (be: StorageBackend, info: StorageInfo) => {
    backendRef.current = be;
    setStorage(info);
    setSavedHandleName(null);
    savedHandleRef.current = null;
    await loadModel(be);
    try { await be.ensureDir(DIR); } catch { /* readonly? Liste bleibt leer */ }
    await refreshSpecsIn(be);
  }, [loadModel, refreshSpecsIn]);

  // ── lokaler Ordner ────────────────────────────────────────────────────────
  const pickDirectory = useCallback(async () => {
    try {
      const dir = new URLSearchParams(location.search).has('opfs')
        ? await navigator.storage.getDirectory()
        : await window.showDirectoryPicker({ mode: 'readwrite' });
      await persistHandle(dir);
      storeSharePoint(null); setSavedSharePoint(null);
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

  // ── SharePoint-Ordner ─────────────────────────────────────────────────────
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

  const forgetSharePoint = useCallback(() => {
    storeSharePoint(null); setSavedSharePoint(null);
  }, []);

  const disconnect = useCallback(() => {
    backendRef.current = null;
    setStorage(null); setModel(null); setSpecs([]);
  }, []);

  // Beim Start den gemerkten Ordner wiederherstellen (SharePoint sobald die
  // Anmeldung steht; lokal direkt, wenn die Berechtigung noch gilt).
  const autoRef = useRef(false);
  useEffect(() => {
    const pending = (() => { try { return localStorage.getItem(PENDING_FOLDER_KEY); } catch { return null; } })();
    if (pending && !loadSharePoint()) {
      if (auth.status === 'signedIn' || (auth.status === 'disabled' && graphBase())) {
        try { localStorage.removeItem(PENDING_FOLDER_KEY); } catch { /* ignore */ }
        connectSharePoint(pending).then(r => { if (!r.ok) console.error('[orch-spec] Einrichtungs-Link:', r.message); });
      }
      return;
    }
    if (autoRef.current) return;
    // Entwicklung: ?demo startet direkt mit den Beispieldaten
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
      } catch { /* IndexedDB nicht verfügbar oder Handle ungültig */ }
    })();
  }, [auth.status, activate, activateSharePoint, connectSharePoint]);

  // ── Spezifikationen ───────────────────────────────────────────────────────
  const loadSpec = useCallback(async (slug: string) => {
    const be = backendRef.current;
    if (!be) return null;
    try {
      const read = await be.read(`${DIR}/${slug}.json`);
      if (!read) return null;
      return { data: JSON.parse(read.text) as ProcessSpec, version: read.version };
    } catch {
      return null;
    }
  }, []);

  // Das BPMN liegt neben der Spezifikation im selben Ordner. Damit gehört es
  // der App und lässt sich hier bearbeiten — statt es jedes Mal neu zu wählen.
  const loadBpmn = useCallback(async (slug: string) => {
    const be = backendRef.current;
    if (!be) return null;
    try {
      const read = await be.read(`${DIR}/${slug}.bpmn`);
      return read?.text ?? null;
    } catch {
      return null;
    }
  }, []);

  const saveBpmn = useCallback(async (slug: string, xml: string) => {
    const be = backendRef.current;
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    const w = await be.write(`${DIR}/${slug}.bpmn`, xml);
    return w.ok ? { ok: true as const } : { ok: false as const, message: w.message };
  }, []);

  const saveSpec = useCallback(async (data: ProcessSpec, expectedVersion: string | null): Promise<SaveResult> => {
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
    return { status: 'saved', version: w.version };
  }, []);

  const createSpec = useCallback(async (spec: ProcessSpec) => {
    const be = backendRef.current;
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    const data: ProcessSpec = { ...spec, createdAt: spec.createdAt || todayIso(), updatedAt: nowIsoWithTimezone() };
    let json: string;
    try { json = JSON.stringify(data, null, 2); }
    catch { return { ok: false as const, message: 'Spezifikation konnte nicht serialisiert werden.' }; }
    try { await be.ensureDir(DIR); } catch { /* write meldet es */ }
    const w = await be.write(`${DIR}/${data.slug}.json`, json, { createOnly: true });
    if (!w.ok) {
      if (w.reason === 'exists') return { ok: false as const, message: 'Eine Spezifikation mit diesem Namen existiert bereits.' };
      return { ok: false as const, message: w.message };
    }
    setSpecs(prev => [...prev, { slug: data.slug, data, version: w.version }]
      .sort((a, b) => (a.data.title || a.slug).localeCompare(b.data.title || b.slug, 'de')));
    return { ok: true as const };
  }, []);

  // Nur aus der Liste nehmen — Dateien löscht die App bewusst nicht.
  const deleteSpec = useCallback((slug: string) => {
    setSpecs(prev => prev.filter(p => p.slug !== slug));
  }, []);

  const saveModel = useCallback(async (m: Model): Promise<{ ok: true } | { ok: false; message: string }> => {
    const be = backendRef.current;
    if (!be) return { ok: false, message: 'Kein Ordner gewählt.' };
    const user = stripGenerated(m); // der mitgelieferte Katalog gehört nicht in die model.json
    let json: string;
    try { json = JSON.stringify(user, null, 2); }
    catch { return { ok: false, message: 'Stammdaten konnten nicht serialisiert werden.' }; }
    const w = await be.write('model.json', json);
    if (!w.ok) return { ok: false, message: `model.json konnte nicht geschrieben werden: ${w.message}` };
    setModel(user);
    return { ok: true };
  }, []);

  // nach aussen immer der zusammengeführte Blick: generierter Katalog + model.json
  const mergedModel = useMemo(() => (model ? mergeGeneratedCatalog(model, generatedCatalog) : model), [model, generatedCatalog]);

  const toggleTheme = () => setIsDark(d => !d);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
  }, [isDark]);

  return (
    <Ctx.Provider value={{
      isDark, toggleTheme, storage,
      pickDirectory, savedHandleName, reconnectDirectory,
      connectSharePoint, savedSharePoint, forgetSharePoint, disconnect,
      model: mergedModel, modelError, saveModel, generatedCatalog,
      specs, refreshSpecs, loadSpec, saveSpec, createSpec, deleteSpec, loadBpmn, saveBpmn,
    }}>
      {children}
    </Ctx.Provider>
  );
}
