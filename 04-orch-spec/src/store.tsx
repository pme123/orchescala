// Datenhaltung: reine Client-App, die Dateien liegen in einem geteilten Ordner
// (lokal über die File System Access API oder in SharePoint über Microsoft
// Graph). Aufbau des Ordners:
//
//   config/model.json        Service-Katalog + Anmeldung (Stammdaten) — der
//                            Ordner config/ bekommt in SharePoint eigene
//                            Rechte: nur Admins schreiben
//   users.json               wer hier arbeitet — für @-Erwähnungen
//   processes/<slug>.json    eine Datei je Prozess-Spezifikation
//   processes/<slug>.audit.jsonl  ihr Änderungsprotokoll (siehe audit.ts)
//
// Übernommen aus arch-review — bewusst dieselbe Mechanik (Konflikterkennung
// über Version/ETag, gemerkter Ordner, Autosave im Aufrufer).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryUser, DomainType, Model, ProcessSpec, ServiceDef, ServiceParam, Step, UsersFile } from './types';
import { feelIfPossible, healExecution } from './juelFeel';
import { withOrchescalaTypes } from './orchescalaTypes';
import { getHandle, putHandle } from './handles.ts';
import { DEFAULT_MODEL } from './defaultModel';
import { nowIsoWithTimezone, todayIso } from './util';
import { DemoBackend, LocalBackend, StorageBackend } from './backend';
import { GRAPH_SCOPES, GraphBackend, resolveFolderLink, SharePointFolder } from './graph';
import { PENDING_FOLDER_KEY, useAuth } from './auth';
import { readCatalogFile, type CatalogFile } from './catalogImport';
import { appendAudit, auditPath, makeEntry, parseAudit, type AuditAuthor, type AuditEntry } from './audit';
import { dmnPath } from './dmn';

const DIR = 'processes';
/** Stammdaten — in `config/`, damit dort nur Admins schreiben können */
export const MODEL_PATH = 'config/model.json';
/** Frühere Ablage im Hauptordner — wird gelesen, bis ein Admin sie verschiebt */
export const LEGACY_MODEL_PATH = 'model.json';

export interface SpecListItem {
  slug: string;
  data: ProcessSpec;
  version: string;
}

export type SaveResult =
  /** `auditError`: gespeichert, aber das Protokoll nicht — die Einträge gehen mit dem nächsten Speichern nochmals */
  | { status: 'saved'; version: string; auditError?: string }
  | { status: 'conflict'; currentVersion: string }
  | { status: 'error'; message: string };

export interface StorageInfo { kind: 'local' | 'sharepoint'; name: string; webUrl?: string }

/**
 * Entra-Suche: Treffer — oder warum sie nicht möglich ist. 'consent' lässt
 * sich per requestDirectoryConsent nachholen; 'forbidden' = die Berechtigung
 * User.ReadBasic.All fehlt in der App-Registrierung (Admin in Entra);
 * 'noLogin' = keine Anmeldung (lokaler Ordner ohne Login).
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
  /** SharePoint-Ordner aus einem Einrichtungs- oder Kommentar-Link, der nach der Anmeldung geöffnet wird */
  pendingFolder: string | null;
  /** einen eingegebenen Ordner-Link über die Anmeldung (Redirect) hinweg merken — null vergisst ihn */
  rememberFolderLink: (link: string | null) => void;
  /** den gemerkten Ordner-Link jetzt verbinden (angemeldet); null, wenn keiner (mehr) wartet */
  connectPendingFolder: () => Promise<{ ok: true } | { ok: false; message: string } | null>;
  /** ein Ordner-Link, der nach der Anmeldung nicht verbunden werden konnte */
  folderLinkError: { link: string; message: string } | null;
  clearFolderLinkError: () => void;
  /** den gemerkten SharePoint-Ordner wieder öffnen (angemeldet) */
  reconnectSharePoint: () => Promise<void>;
  forgetSharePoint: () => void;
  disconnect: () => void;
  /** der Speicher vor «anderen Ordner wählen» — solange man noch zurück kann */
  previousStorage: StorageInfo | null;
  /** zurück zum vorigen Speicher, ohne neue Berechtigung oder Anmeldung */
  resumePrevious: () => Promise<void>;
  model: Model | null;
  modelError: string | null;
  /** wo die Stammdaten liegen: config/model.json oder (alt) model.json */
  modelPath: string;
  /** liegt neben config/model.json noch eine alte model.json im Hauptordner? */
  legacyModelLeftover: boolean;
  saveModel: (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** mitgelieferter Katalog (catalog.generated.json) — null, wenn keiner ausgeliefert ist */
  generatedCatalog: CatalogFile | null;
  specs: SpecListItem[];
  /** die Liste wird gerade (neu) gelesen */
  specsLoading: boolean;
  refreshSpecs: () => Promise<void>;
  /** `audit`: was beim Laden schon geändert wurde (ausgemusterte Felder) — geht mit dem nächsten Speichern ins Protokoll */
  loadSpec: (slug: string) => Promise<{ data: ProcessSpec; version: string; audit: AuditEntry[] } | null>;
  /** das BPMN zur Spezifikation — `processes/<slug>.bpmn` */
  loadBpmn: (slug: string) => Promise<string | null>;
  saveBpmn: (slug: string, xml: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** die Tabelle einer DMN Decision — `processes/<slug>/<decisionId>.dmn` */
  loadDmn: (slug: string, decisionId: string) => Promise<string | null>;
  saveDmn: (slug: string, decisionId: string, xml: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** `audit`: Protokoll-Einträge zu diesem Stand — angehängt, sobald die Spezifikation geschrieben ist */
  saveSpec: (data: ProcessSpec, expectedVersion: string | null, audit?: AuditEntry[]) => Promise<SaveResult>;
  /** das Änderungsprotokoll, älteste zuerst — null, wenn es nicht lesbar ist */
  loadAudit: (slug: string) => Promise<AuditEntry[] | null>;
  createSpec: (spec: ProcessSpec) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Spezifikation samt BPMN aus dem Ordner löschen — nur für Admins (siehe usePermissions) */
  deleteSpec: (slug: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Personen für @-Erwähnungen: users.json im geteilten Ordner */
  knownUsers: DirectoryUser[];
  searchDirectory: (query: string) => Promise<DirectorySearchResult>;
  requestDirectoryConsent: () => Promise<void>;
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
/** Vorgaben eines Katalog-Eintrags in FEEL — ältere Kataloge haben `#{name}` */
const feelParams = (s: ServiceDef): ServiceDef => {
  const conv = (ps: ServiceParam[] | undefined) => ps?.map(p => (p.expression ? { ...p, expression: feelIfPossible(p.expression) } : p));
  return { ...s, ...(s.inputs ? { inputs: conv(s.inputs) } : {}), ...(s.outputs ? { outputs: conv(s.outputs) } : {}) };
};

/** Angaben des Domain-Scans, die ältere Kataloge noch nicht haben */
const NEWER_SCAN = ['routing', 'topicName', 'ownerDescr', 'ownerDescrExpr'] as const satisfies ReadonlyArray<keyof DomainType>;

function mergeGeneratedCatalog(user0: Model, gen: CatalogFile | null): Model {
  // ProcessStatus & Co. aus orchescala.domain gibt es immer — als «generiert», also nie in der model.json
  const user = { ...user0, services: user0.services.map(feelParams), domainTypes: withOrchescalaTypes(user0.domainTypes) };
  if (!gen) return user;
  const genServices = (gen.services ?? []).map(s => ({ ...feelParams(s), generated: true }));
  // was ein neuerer Scan als die Tools des Katalogs erkennt, ergänzt den Eintrag —
  // der Katalog kommt erst mit dem nächsten Release dazu (Weichen des Decoders,
  // `final val topicName`, `override def descr`); was der Katalog selbst hat, gilt
  const ownTypes = new Map((user.domainTypes ?? []).map(t => [t.id, t]));
  const genTypes = (gen.domainTypes ?? []).map(t => {
    const own = ownTypes.get(t.id);
    const newer = Object.fromEntries(NEWER_SCAN.filter(k => own?.[k] != null && t[k] == null).map(k => [k, own![k]]));
    return { ...t, ...newer, generated: true };
  });
  const kennt = new Set<string>();
  for (const s of genServices) {
    kennt.add(s.id);
    if (s.topic) kennt.add(s.topic);
    if (s.calledProcess) kennt.add(s.calledProcess);
  }
  const typIds = new Set(genTypes.map(t => t.id));
  const genDefaults = (gen.domainDefaults ?? []).map(d => ({ ...d, generated: true }));
  const defaultIds = new Set(genDefaults.map(d => `${d.pkg}.${d.name}`));
  return {
    ...user,
    services: [
      ...genServices,
      ...user.services.filter(s => !kennt.has(s.id)
        && !(s.topic && kennt.has(s.topic)) && !(s.calledProcess && kennt.has(s.calledProcess))),
    ],
    domainTypes: [...genTypes, ...(user.domainTypes ?? []).filter(t => !typIds.has(t.id))],
    domainDefaults: [...genDefaults, ...(user.domainDefaults ?? []).filter(d => !defaultIds.has(`${d.pkg}.${d.name}`))],
    domainSources: gen.domainSources ?? user.domainSources,
    ...(gen.projectColors ? { projectColors: gen.projectColors } : {}),
  };
}

/**
 * «Offene Frage» (`open`) und «Technische Notiz» (`notes`) am Schritt gibt es
 * nicht mehr — dafür sind die Kommentare da —, ebenso die «Quelle» (`sourceUrl`)
 * am Prozess. Alte Einträge fallen beim Laden weg und verschwinden mit dem
 * nächsten Speichern aus der Datei.
 */
function withoutRetiredFields(spec: ProcessSpec): ProcessSpec {
  // `= execution.x` aus einem älteren Import: FEEL, wo es geht, sonst wieder JUEL
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
  return { ...rest, steps: clean(spec.steps) ?? [] };
}

/** ohne die generierten Einträge — nur das gehört in die model.json */
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
  // bis die Liste zum ersten Mal gelesen ist: laden, nicht «leer»
  const [specsLoading, setSpecsLoading] = useState(true);
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
  /** wer gerade schreibt — wie useAuthor */
  const authorOf = (): AuditAuthor => {
    const u = authRef.current.user;
    const name = u?.name?.trim() || 'Ich';
    return u?.email ? { name, email: u.email } : { name };
  };
  const [knownUsers, setKnownUsers] = useState<DirectoryUser[]>([]);
  const [modelPath, setModelPath] = useState(MODEL_PATH);
  const modelPathRef = useRef(MODEL_PATH);
  const [legacyModelLeftover, setLegacyModelLeftover] = useState(false);

  // Stammdaten liegen in config/model.json — der Ordner config/ bekommt in
  // SharePoint eigene Berechtigungen (nur Admins schreiben). Ältere Ordner
  // haben die model.json noch im Hauptordner: dann wird sie dort gelesen und
  // geschrieben, bis ein Admin sie von Hand nach config/ verschiebt.
  const loadModel = useCallback(async (be: StorageBackend) => {
    const usePath = (p: string) => { modelPathRef.current = p; setModelPath(p); };
    // Der Pfad gilt ab hier für diesen Ordner — schlägt schon das erste Lesen
    // fehl, nennt die Meldung config/model.json, nicht die Datei des vorigen
    // Ordners. Umgestellt wird nur, wenn es allein die alte Datei gibt.
    usePath(MODEL_PATH);
    try {
      const neu = await be.read(MODEL_PATH);
      // eine alte Kopie neben config/ gehört weg — sonst ist unklar, welche gilt
      // (nur ein Hinweis: scheitert das Lesen, gibt es eben keinen)
      const alt = neu ? null : await be.read(LEGACY_MODEL_PATH);
      setLegacyModelLeftover(neu ? !!(await be.read(LEGACY_MODEL_PATH).catch(() => null)) : false);
      if (alt) usePath(LEGACY_MODEL_PATH);
      let read = neu ?? alt;
      if (!read) {
        const ids = idsRef.current;
        const fresh: Model = ids
          ? { ...DEFAULT_MODEL, auth: { enabled: false, tenantId: ids.tenantId, clientId: ids.clientId, adminRole: 'OrchSpec.Admin', reviewerRole: 'OrchSpec.Editor', viewerRole: 'OrchSpec.Viewer' } }
          : DEFAULT_MODEL;
        // Ordner vorab anlegen; fehlt das Schreibrecht, meldet es gleich write
        try { await be.ensureDir('config'); } catch { /* s. u. */ }
        const w = await be.write(MODEL_PATH, JSON.stringify(fresh, null, 2), { createOnly: true });
        if (!w.ok && w.reason !== 'exists') {
          setModel(null);
          setModelError(w.reason === 'forbidden'
            ? `${MODEL_PATH} fehlt und kann nicht angelegt werden (keine Schreibberechtigung).`
            : `${MODEL_PATH} fehlt und konnte nicht angelegt werden.`);
          return;
        }
        if (w.ok) { setModel(fresh); setModelError(null); return; }
        // gleichzeitig von jemand anderem angelegt → deren Stand laden
        read = await be.read(MODEL_PATH);
        if (!read) throw new Error(`${MODEL_PATH} nicht gefunden.`);
      }
      try {
        setModel(normalizeModel(JSON.parse(read.text)));
        setModelError(null);
      } catch {
        setModel(null); // vorhandene, aber defekte Datei NICHT überschreiben
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
      // parallel lesen — bei SharePoint ist jede Datei ein eigener Aufruf;
      // höchstens 8 gleichzeitig, damit der Dienst nicht drosselt
      const files = (await be.list(DIR)).filter(f => f.name.endsWith('.json'));
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const f = files[next++];
          try {
            const read = await be.read(`${DIR}/${f.name}`);
            if (read) items.push({ slug: f.name.replace(/\.json$/, ''), data: JSON.parse(read.text) as ProcessSpec, version: read.version });
          } catch { /* unlesbare Datei überspringen */ }
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

  // ── users.json: wer arbeitet in diesem Ordner (für @-Erwähnungen) ──────────
  // null = Datei beschädigt (kein JSON, keine Liste «users») — das ist etwas
  // anderes als «noch niemand» und darf nie wie leer überschrieben werden
  // (siehe registerUser)
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
  // Angemeldete Person eintragen bzw. «zuletzt gesehen» nachziehen (ETag,
  // bei Konflikt wiederholen; ohne Schreibrecht still überspringen). Ist die
  // Datei beschädigt (z. B. abgebrochener Sync), wird sie zuerst unverändert
  // als users.broken-<Zeitstempel>.json gesichert und dann neu begonnen;
  // klappt die Sicherung nicht, wird nichts geschrieben.
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

  // Entra-Suche (Graph /users?$search) — nur mit Anmeldung; die Zustimmung zu
  // User.ReadBasic.All holt sich jede Person selbst (requestDirectoryConsent)
  const searchDirectory = useCallback(async (query: string): Promise<DirectorySearchResult> => {
    const q = query.trim().replace(/"/g, '');
    if (!q) return { ok: true, users: [] };
    const consent = 'Für die Suche im Verzeichnis fehlt noch deine Zustimmung zur Berechtigung «Grundlegende Profile aller Benutzer lesen» (User.ReadBasic.All).';
    const forbidden = 'Microsoft Graph verweigert die Benutzersuche: Die Berechtigung User.ReadBasic.All fehlt in der App-Registrierung (Entra → App-Registrierungen → API-Berechtigungen).';
    // Entwicklung: ?dirfail=consent|forbidden simuliert eine fehlende Berechtigung
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
    previousRef.current = null;
    setPreviousStorage(null);
    registeredRef.current = '';
    setStorage(info);
    setSavedHandleName(null);
    savedHandleRef.current = null;
    // Modell, Benutzer und Liste unabhängig voneinander — gleichzeitig lesen
    await Promise.all([
      loadModel(be),
      loadUsersIn(be),
      (async () => {
        try { await be.ensureDir(DIR); } catch { /* readonly? Liste bleibt leer */ }
        await refreshSpecsIn(be);
      })(),
    ]);
  }, [loadModel, loadUsersIn, refreshSpecsIn]);

  // ── lokaler Ordner ────────────────────────────────────────────────────────
  const pickDirectory = useCallback(async () => {
    try {
      const dir = new URLSearchParams(location.search).has('opfs')
        ? await navigator.storage.getDirectory()
        : await window.showDirectoryPicker({ mode: 'readwrite' });
      await persistHandle(dir);
      storeSharePoint(null); setSavedSharePoint(null);
      // ein Ordner aus einem Link gilt nicht mehr, sobald man selbst einen wählt
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

  // gemerkter Ordner schon (wieder) verbunden — der Start-Effekt unten tut es dann nicht nochmals
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

  // Wer den Link zuerst nimmt, verbindet — hier oder im Start-Effekt unten, nie beide
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

  // «Anderen Ordner wählen» trennt nur die Anzeige — der bisherige Speicher
  // bleibt in der Hinterhand, bis ein anderer gewählt ist. So führt die
  // Startkarte zurück, ohne neue Berechtigung (lokal) oder Anmeldung (SharePoint).
  const disconnect = useCallback(() => {
    if (backendRef.current && storageRef.current) {
      previousRef.current = { be: backendRef.current, info: storageRef.current };
      setPreviousStorage(storageRef.current);
    }
    backendRef.current = null;
    setStorage(null); setModel(null); setSpecs([]);
  }, []);
  const resumePrevious = useCallback(async () => {
    const prev = previousRef.current;
    if (!prev) return;
    await activate(prev.be, prev.info);
  }, [activate]);

  // Beim Start den gemerkten Ordner wiederherstellen (SharePoint sobald die
  // Anmeldung steht; lokal direkt, wenn die Berechtigung noch gilt).
  useEffect(() => {
    // Ein Link bringt seinen Ordner mit — der gilt, auch wenn ein anderer
    // gemerkt ist (ein Kommentar-Link aus Teams zeigt in genau diesen Ordner).
    // Ist es der gemerkte, geht es einfach normal weiter.
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
  }, [auth.status, activate, activateSharePoint, connectPendingFolder]);

  // ── Spezifikationen ───────────────────────────────────────────────────────
  const loadSpec = useCallback(async (slug: string) => {
    const be = backendRef.current;
    if (!be) return null;
    try {
      const read = await be.read(`${DIR}/${slug}.json`);
      if (!read) return null;
      const raw = JSON.parse(read.text) as ProcessSpec;
      const data = withoutRetiredFields(raw);
      const dropped = makeEntry(raw, data, { source: 'load', note: 'Ausgemusterte Felder entfernt (Offene Frage, Technische Notiz — dafür gibt es Kommentare; Quelle)' }, authorOf());
      return { data, version: read.version, audit: dropped ? [dropped] : [] };
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

  // Die Tabellen der DMN Decisions — im Unterordner der Spezifikation
  const loadDmn = useCallback(async (slug: string, decisionId: string) => {
    const be = backendRef.current;
    if (!be) return null;
    try {
      return (await be.read(dmnPath(DIR, slug, decisionId)))?.text ?? null;
    } catch {
      return null;
    }
  }, []);

  const saveDmn = useCallback(async (slug: string, decisionId: string, xml: string) => {
    const be = backendRef.current;
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    const w = await be.write(dmnPath(DIR, slug, decisionId), xml);
    return w.ok ? { ok: true as const } : { ok: false as const, message: w.message };
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
    // erst nach der Spezifikation: ins Protokoll kommt nur, was auch gespeichert ist
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
    try { await be.ensureDir(DIR); } catch { /* write meldet es */ }
    const w = await be.write(`${DIR}/${data.slug}.json`, json, { createOnly: true });
    if (!w.ok) {
      if (w.reason === 'exists') return { ok: false as const, message: 'Eine Spezifikation mit diesem Namen existiert bereits.' };
      return { ok: false as const, message: w.message };
    }
    setSpecs(prev => [...prev, { slug: data.slug, data, version: w.version }]
      .sort((a, b) => (a.data.title || a.slug).localeCompare(b.data.title || b.slug, 'de')));
    // der erste Eintrag: angelegt — mit allem, was dabei entstand
    const empty: ProcessSpec = { version: data.version, slug: data.slug, name: '', title: '', status: data.status, createdAt: data.createdAt, updatedAt: data.updatedAt, steps: [] };
    const first = makeEntry(empty, data, { source: 'manual', note: 'Spezifikation angelegt' }, authorOf());
    if (first) await appendAudit(be, DIR, data.slug, [first]);
    return { ok: true as const };
  }, []);

  // Löscht die Dateien der Spezifikation: `<slug>.json`, `<slug>.bpmn` und das Protokoll.
  // Erst die Spezifikation, dann das Diagramm — bleibt das BPMN nach einem
  // Fehler liegen, stört es nicht (die Liste kennt nur .json-Dateien).
  // Die Prüfung, wer löschen darf, liegt in der Oberfläche (canDelete).
  const deleteSpec = useCallback(async (slug: string) => {
    const be = backendRef.current;
    if (!be) return { ok: false as const, message: 'Kein Ordner gewählt.' };
    const json = await be.delete(`${DIR}/${slug}.json`);
    if (!json.ok) return { ok: false as const, message: json.message };
    setSpecs(prev => prev.filter(p => p.slug !== slug));
    const bpmn = await be.delete(`${DIR}/${slug}.bpmn`);
    if (!bpmn.ok) return { ok: false as const, message: `Spezifikation gelöscht, aber das BPMN nicht: ${bpmn.message}` };
    // das Protokoll gehört zur Spezifikation — eine neue mit demselben Namen fängt leer an
    // (Archive bleiben liegen: die nennt die Liste nicht, und sie stören nicht)
    await be.delete(auditPath(DIR, slug));
    // die Tabellen der DMN Decisions
    try {
      for (const f of await be.list(`${DIR}/${slug}`)) if (f.name.endsWith('.dmn')) await be.delete(`${DIR}/${slug}/${f.name}`);
    } catch { /* kein Unterordner */ }
    return { ok: true as const };
  }, []);

  const saveModel = useCallback(async (m: Model): Promise<{ ok: true } | { ok: false; message: string }> => {
    const be = backendRef.current;
    if (!be) return { ok: false, message: 'Kein Ordner gewählt.' };
    const user = stripGenerated(m); // der mitgelieferte Katalog gehört nicht in die model.json
    let json: string;
    try { json = JSON.stringify(user, null, 2); }
    catch { return { ok: false, message: 'Stammdaten konnten nicht serialisiert werden.' }; }
    const path = modelPathRef.current;
    const w = await be.write(path, json);
    if (!w.ok) return { ok: false, message: `${path} konnte nicht geschrieben werden: ${w.message}` };
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
      connectSharePoint, savedSharePoint, pendingFolder, rememberFolderLink, connectPendingFolder,
      folderLinkError, clearFolderLinkError: () => setFolderLinkError(null), reconnectSharePoint, forgetSharePoint, disconnect, previousStorage, resumePrevious,
      model: mergedModel, modelError, saveModel, generatedCatalog,
      modelPath, legacyModelLeftover,
      specs, specsLoading, refreshSpecs, loadSpec, saveSpec, loadAudit, createSpec, deleteSpec, loadBpmn, saveBpmn, loadDmn, saveDmn,
      knownUsers, searchDirectory, requestDirectoryConsent,
    }}>
      {children}
    </Ctx.Provider>
  );
}
