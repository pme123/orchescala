// Generate the catalog — only where the sources are.
//
// In the banking zone there are neither the project folders nor the docs site;
// there the catalog comes in as a file (see `CatalogTransfer`). Everything
// here is therefore **optional** and collapsed by default.
//
// Three ways in:
//
//  · **Project folders** — a named, sortable list for the
//    domain types. One chooses a folder above the projects
//    (`~/dev-mycompany/projects`); its subfolders come in as projects.
//    **What is on top wins**: the same package from a project further
//    down (`globex.core.banking.domain.client` after
//    `initech.core.banking.domain.client`) is discarded and reported.
//    «Neu aufbauen» reads the list freshly from top to bottom.
//  · **Read OpenAPI** — the `03-api/OpenApi.yml` of the projects. It
//    describes what is **actually deployed**: workers, processes,
//    user tasks and signals with their inputs and outputs.
//  · **Load from URL** — the Orchescala docs site. From there come the
//    processes of all projects with their `In`/`Out`, even without having the sources
//    locally.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronUp, FolderOpen, Globe, RefreshCw, Upload, X,
} from 'lucide-react';
import { load } from 'js-yaml';
import { mergeDomainTypes, type DiscardedPackage } from '../domainScan';
import { catalogFromOpenApi, mergeServices } from '../openApi';
import { forgetProject, grantAccess, move, projectsInFolder, rebuild, rememberProject } from '../projects';
import { countByKind, fillGapsOnly, readSite } from '../siteCatalog';
import type { DomainType, Model, ProjectFolder } from '../types';
import { cls } from '../ui';
import { useConfirm } from './Confirm';

/**
 * `Failed to fetch` has two quite different causes. An attempt with
 * `no-cors` tells them apart: if an (opaque) response comes back, the
 * server is reachable and only the CORS permission is missing — otherwise one
 * cannot reach it at all. That saves searching at the wrong end.
 */
async function diagnose(url: string): Promise<string> {
  const hinweis = 'Weg ohne CORS: «node tools/site2catalog.ts ' + url
    + '» im Terminal, dann hier die Katalog-Datei einlesen.';
  try {
    await fetch(url, { mode: 'no-cors' });
    return 'Der Server ist erreichbar, erlaubt aber keinen Zugriff von dieser Adresse aus '
      + '(kein Access-Control-Allow-Origin). ' + hinweis;
  } catch {
    return 'Der Server ist von hier nicht erreichbar — Netzwerk oder VPN prüfen. ' + hinweis;
  }
}

/** most recently used address as a suggestion */
function sourcesUrl(model: Model): string {
  return (model.domainSources ?? []).find(s => /^https?:/i.test(s)) ?? '';
}

/**
 * Recursively read the generated OpenAPI files of a folder — exactly
 * `OpenApi.yml` / `.yaml` / `.json`, not the Postman variant and no
 * foreign specifications lying next to them.
 */
const IS_SPEC = /^openapi\.(ya?ml|json)$/i;

async function readSpecs(
  dir: FileSystemDirectoryHandle,
  out: Array<{ name: string; text: string }>,
  onProgress: (n: number) => void,
) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') {
      if (['target', '.git', 'node_modules', '.bloop', '.scala-build'].includes(name)) continue;
      await readSpecs(handle as FileSystemDirectoryHandle, out, onProgress);
      continue;
    }
    if (!IS_SPEC.test(name)) continue;
    out.push({ name, text: await (handle as FileSystemFileHandle).getFile().then(f => f.text()) });
    onProgress(out.length);
  }
}

export default function CatalogBuild({ model, isDark, canEdit, onSave }: {
  model: Model;
  isDark: boolean;
  canEdit: boolean;
  onSave: (m: Model) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const confirm = useConfirm();
  const c = cls(isDark);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [dropped, setDropped] = useState<DiscardedPackage[]>([]);
  const [url, setUrl] = useState(() => sourcesUrl(model));
  const [offen, setOffen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const types = useMemo(() => model.domainTypes ?? [], [model.domainTypes]);
  const services = useMemo(() => model.services ?? [], [model.services]);
  const sources = model.domainSources ?? [];
  const projects = useMemo(() => model.projects ?? [], [model.projects]);

  // Each OpenAPI describes one project; several together make up the catalog.
  const applySpecs = async (files: Array<{ name: string; text: string }>) => {
    let next = services;
    let typen = model.domainTypes ?? [];
    let added = 0, gelesen = 0, prozesse = 0;
    const fehler: string[] = [];
    for (const f of files) {
      let doc: unknown;
      try { doc = /\.json$/i.test(f.name) ? JSON.parse(f.text) : load(f.text); }
      catch { fehler.push(f.name); continue; }
      const r = catalogFromOpenApi(doc, f.name);
      if (!r.services.length) continue;
      gelesen++;
      prozesse += r.processes.length;
      const m = mergeServices(next, r.services);
      next = m.services;
      added += m.added;
      typen = mergeDomainTypes(typen, r.types).types;
    }
    if (!gelesen) {
      setMsg(`Keine verwertbare OpenAPI gefunden${fehler.length ? ` (${fehler.length} Datei(en) unlesbar)` : ''}.`);
      return;
    }
    const res = await onSave({ ...model, services: next, domainTypes: typen });
    setMsg(res.ok
      ? `${gelesen} OpenAPI-Datei(en): ${added} neu, ${prozesse} Prozesse — ${next.length} Einträge im Katalog.`
      : res.message);
  };

  const importSpecs = async (files: FileList) => {
    setBusy(`${files.length} Dateien lesen …`); setMsg('');
    try {
      await applySpecs(await Promise.all([...files].map(async f => ({ name: f.name, text: await f.text() }))));
    } finally {
      setBusy('');
    }
  };

  // A project has its OpenAPI under `03-api/OpenApi.yml`. Choosing a folder
  // above it and collecting everything below is the most convenient way.
  const pickSpecFolder = async () => {
    if (!('showDirectoryPicker' in window)) {
      setMsg('Ordner einlesen geht nur in Chrome oder Edge. Alternative: die Dateien einzeln wählen.');
      return;
    }
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await window.showDirectoryPicker({ mode: 'read' });
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') setMsg(String(e));
      return;
    }
    setBusy('Dateien lesen …'); setMsg('');
    try {
      const specs: Array<{ name: string; text: string }> = [];
      await readSpecs(dir, specs, n => setBusy(`${n} Dateien gelesen …`));
      if (!specs.length) {
        setMsg(`In «${dir.name}» wurde keine OpenApi.yml gefunden.`);
        return;
      }
      setBusy(`${specs.length} Dateien auswerten …`);
      await applySpecs(specs);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const merge = async (found: DomainType[], source: string, alreadyDropped: DiscardedPackage[] = []) => {
    const before = new Set(types.map(t => t.id));
    // What is already in the catalog has precedence — the order of the sources
    // decides which package applies when names are equal.
    const { types: next, discarded } = mergeDomainTypes(types, found);
    const added = next.filter(t => !before.has(t.id)).length;
    const res = await onSave({
      ...model,
      domainTypes: next,
      domainSources: [...new Set([...sources, source])],
    });
    setDropped([...alreadyDropped, ...discarded]);
    setMsg(res.ok
      ? `${found.length} Typen gelesen, ${added} neu — ${next.length} im Katalog.`
      : res.message);
  };

  // ── Project folders ──────────────────────────────────────────────────────
  // One chooses the folder **above** the projects; its subfolders come
  // into the list as projects. If it is itself a project, that one comes in.
  const addProjects = async () => {
    if (!('showDirectoryPicker' in window)) {
      setMsg('Ordner wählen geht nur in Chrome oder Edge. Alternative: Katalog-Datei einlesen.');
      return;
    }
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await window.showDirectoryPicker({ mode: 'read' });
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') setMsg(String(e));
      return;
    }
    setBusy('Ordner ansehen …'); setMsg('');
    try {
      const gefunden = await projectsInFolder(dir);
      if (!gefunden.length) {
        setMsg(`In «${dir.name}» steckt kein Orchescala-Projekt (kein 01-domain darunter).`);
        return;
      }
      const bekannt = new Set(projects.map(p => p.name));
      const neu = gefunden.filter(g => !bekannt.has(g.project.name));
      for (const g of neu) await rememberProject(g.project, g.handle);
      // already known projects keep their place, but get the
      // fresh access — otherwise one would have to remove them first to renew
      for (const g of gefunden.filter(x => bekannt.has(x.project.name))) {
        const alt = projects.find(p => p.name === g.project.name)!;
        await rememberProject(alt, g.handle);
      }
      const liste = [...projects, ...neu.map(g => g.project)];
      await onSave({ ...model, projects: liste });
      // known projects that were remembered individually so far attach themselves to
      // the folder above — then from now on one permission suffices for all
      const liste2 = liste.map(p => {
        const g = gefunden.find(x => x.project.name === p.name);
        return g?.project.root && p.root !== g.project.root ? { ...p, root: g.project.root } : p;
      });
      if (liste2.some((p, i) => p !== liste[i])) await onSave({ ...model, projects: liste2 });
      setMsg(neu.length
        ? `${neu.length} Projekt(e) hinzugefügt: ${neu.map(g => g.project.name).join(', ')}. «Neu aufbauen» liest sie ein.`
        : `${gefunden.length} Projekt(e) bereits in der Liste — Zugriff erneuert.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const saveProjects = async (liste: ProjectFolder[]) => {
    await onSave({ ...model, projects: liste });
  };

  const removeProject = async (p: ProjectFolder) => {
    await forgetProject(p);
    await saveProjects(projects.filter(x => x.id !== p.id));
  };

  /**
   * The catalog is built **anew**, not extended — otherwise what was read
   * earlier would remain and reordering would have no effect.
   */
  /** without access: the roots or projects it is missing for — one button each on the message */
  const [noAccess, setNoAccess] = useState<{ roots: string[]; single: ProjectFolder[] }>({ roots: [], single: [] });
  /** grant access (or choose the folder) — and rebuild right away */
  const grantAndRebuild = async (target: { root: string } | { project: ProjectFolder }) => {
    if (await grantAccess(target)) await rebuildCatalog();
  };

  const rebuildCatalog = async () => {
    if (!projects.length) return;
    setBusy('…'); setMsg(''); setDropped([]); setNoAccess({ roots: [], single: [] });
    try {
      const r = await rebuild(projects, setBusy);
      // Save nothing as long as a project is missing: otherwise the catalog would
      // be poorer by its types, just because the browser forgot the access.
      if (r.missing.length) {
        // root without access → one button for everything below; if a project is
        // not in its (readable) root — such as a second folder with the same
        // name —, it needs its own access
        const roots = r.rootsWithoutAccess.filter(x => r.missing.some(p => p.root === x));
        const single = r.missing.filter(p => !p.root || !roots.includes(p.root));
        setNoAccess({ roots, single });
        setMsg(`Kein Zugriff auf ${r.missing.length} von ${projects.length} Projekten — der Katalog bleibt, wie er ist. `
          + 'Der Browser merkt sich den Zugriff je Adresse der App und fragt nur nach einem Klick — unten erteilen (oder den Ordner wählen); danach wird gleich neu aufgebaut. '
          + (single.some(p => p.root) ? `${single.filter(p => p.root).map(p => `«${p.name}»`).join(', ')} liegt nicht im gemerkten Ordner «${single.find(p => p.root)!.root}» — wohl ein anderer Ordner gleichen Namens: den Ordner des Projekts wählen. ` : '')
          + (single.some(p => !p.root) ? 'Einzeln gemerkte Projekte: besser einmal den Ordner darüber wählen («Projekte wählen»), dann reicht eine Erlaubnis für alle. ' : '')
          + 'Mit × verschwindet ein Projekt aus der Liste.');
        return;
      }
      setBusy(`${r.files} Dateien auswerten …`);
      const res = await onSave({
        ...model,
        domainTypes: r.types,
        domainDefaults: r.defaults,
        projects: r.projects,
        domainSources: [...new Set([...sources.filter(x => /^https?:/i.test(x)), ...projects.map(p => p.name)])],
      });
      setDropped(r.discarded);
      setMsg(res.ok
        ? `${r.types.length} Typen und ${r.defaults.length} Beispielwerte aus ${r.files} Dateien in ${projects.length} Projekten`
          + (r.skipped ? ` · ${r.skipped} ohne package übersprungen` : '')
        : res.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const fromUrl = async () => {
    const target = url.trim();
    if (!target) return;
    setBusy('Site lesen …'); setMsg('');
    try {
      const { entries, types: found, read } = await readSite(target, async u => {
        const res = await fetch(u);
        if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
        return res.text();
      });
      const counts = countByKind(entries);
      const neu = fillGapsOnly(found, types);
      const { types: next, discarded } = mergeDomainTypes(types, neu);
      const res = await onSave({
        ...model,
        domainTypes: next,
        domainSources: [...new Set([...sources, target])],
      });
      setDropped(discarded);
      setMsg(res.ok
        ? `${read.length} Katalogseite(n): ${counts.process} Prozesse, ${counts.worker} Worker. `
          + `${neu.length} Typen ergänzt${found.length - neu.length ? `, ${found.length - neu.length} waren schon exakt bekannt` : ''} — ${next.length} im Katalog.`
        : res.message);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setMsg(/failed to fetch|networkerror/i.test(raw) ? await diagnose(target) : raw);
    } finally {
      setBusy('');
    }
  };


  return (
    <div className={`rounded border ${c.border2}`}>
      <button onClick={() => setOffen(!offen)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${c.hover}`}>
        {offen ? <ChevronDown size={12} className={c.muted} /> : <ChevronRight size={12} className={c.muted} />}
        <span className={`text-[11px] ${c.text}`}>Katalog lokal erzeugen</span>
        <span className={`text-[10px] ${c.muted}`}>
          aus Projekt-Ordnern, OpenAPI und Doku-Site — nur wo die Quellen liegen
        </span>
        {!!projects.length && (
          <span className={`ml-auto text-[10px] flex-shrink-0 ${c.muted}`}>{projects.length} Projekte</span>
        )}
      </button>

      {offen && (
        <div className={`border-t px-3 py-3 ${c.border2}`}>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <input ref={fileRef} type="file" accept=".yml,.yaml,.json" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) void importSpecs(e.target.files); e.target.value = ''; }} />
            {canEdit && (
              <>
                <button onClick={addProjects} disabled={!!busy}
                  title="Ordner über den Projekten wählen — seine Unterordner kommen als Projekte in die Liste"
                  className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
                  <FolderOpen size={12} /> Projekte wählen
                </button>
                <button onClick={rebuildCatalog} disabled={!!busy || !projects.length}
                  title="Alle Projekte in der Reihenfolge der Liste frisch einlesen"
                  className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
                  <RefreshCw size={12} /> {busy || 'Neu aufbauen'}
                </button>
                <span className={`w-px h-5 ${c.border2} border-l`} />
                <button onClick={pickSpecFolder} disabled={!!busy}
                  title="Ordner wählen — alle OpenApi.yml darunter werden eingelesen"
                  className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
                  <FolderOpen size={12} /> OpenAPI einlesen
                </button>
                <button onClick={() => fileRef.current?.click()} disabled={!!busy}
                  title="Einzelne OpenAPI-Dateien wählen (03-api/OpenApi.yml)"
                  className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-40 ${c.btn}`}>
                  <Upload size={12} /> OpenAPI-Dateien
                </button>
              </>
            )}
            <span className={`ml-auto text-[10px] ${c.muted}`}>
              {services.length} Services · {types.length} Typen
            </span>
          </div>

          {!!projects.length && (
            <div className={`mb-2 rounded border ${c.border2}`}>
              <div className={`flex items-baseline gap-2 px-2 py-1.5 border-b ${c.border2}`}>
                <span className={`text-[10px] uppercase tracking-widest ${c.muted}`}>Projekt-Ordner</span>
                <span className={`text-[10px] ${c.muted}`}>oben steht, was bei gleichem Paket gewinnt</span>
              </div>
              {projects.map((p, i) => (
                <div key={p.id} className={`flex items-center gap-2 px-2 py-1 text-[11px] ${i ? `border-t ${c.border2}` : ''}`}>
                  <span className={`w-5 text-right tabular-nums ${c.muted}`}>{i + 1}</span>
                  <ColorPick value={p.color} fallback={model.projectColors?.[p.name]} disabled={!canEdit || !!busy} className={c.border2}
                    onChange={color => void saveProjects(projects.map(x => (x.id === p.id ? { ...x, color } : x)))} />
                  <span className={`font-mono ${c.text}`}>{p.name}</span>
                  {p.path && <span className={`font-mono text-[10px] truncate ${c.muted}`}>{p.path}</span>}
                  <span className={`ml-auto text-[10px] flex-shrink-0 ${c.muted}`}>
                    {p.types === undefined ? 'noch nicht eingelesen' : `${p.types} Typen`}
                  </span>
                  {canEdit && (
                    <>
                      <button onClick={() => void saveProjects(move(projects, i, -1))} disabled={!i || !!busy}
                        title="nach oben — höherer Vorrang"
                        className={`p-0.5 disabled:opacity-20 ${c.muted}`}><ChevronUp size={12} /></button>
                      <button onClick={() => void saveProjects(move(projects, i, 1))} disabled={i === projects.length - 1 || !!busy}
                        title="nach unten — geringerer Vorrang"
                        className={`p-0.5 disabled:opacity-20 ${c.muted}`}><ChevronDown size={12} /></button>
                      <button onClick={async () => {
                        if (await confirm({ title: `«${p.name}» aus der Liste nehmen?`, text: 'Der Ordner selbst bleibt, wie er ist.', confirmLabel: 'Entfernen' })) void removeProject(p);
                      }} disabled={!!busy}
                        title="aus der Liste nehmen" className={`p-0.5 ${c.muted}`}><X size={12} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded border ${c.border2}`}>
              <Globe size={11} className={c.muted} />
              <input value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && url.trim() && !busy) void fromUrl(); }}
                placeholder="https://…/site/  — Doku-Site oder eine catalog.html"
                className={`flex-1 bg-transparent outline-none text-[11px] font-mono ${c.text}`} />
              <button onClick={fromUrl} disabled={!!busy || !url.trim()}
                title="Prozesse aller Projekte von der Doku-Site holen"
                className={`text-[11px] px-2.5 py-1 rounded border disabled:opacity-40 ${c.btn}`}>
                Von URL laden
              </button>
            </div>
          )}

          {msg && <p className={`text-[11px] mt-2 ${c.muted2}`}>{msg}</p>}
          {canEdit && !busy && (noAccess.roots.length > 0 || noAccess.single.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {noAccess.roots.map(root => (
                <button key={root} onClick={() => void grantAndRebuild({ root })}
                  title="Zugriff bestätigen — oder, wenn keiner gemerkt ist, den Ordner wählen; danach wird neu aufgebaut"
                  className={`text-[11px] px-2 py-1 rounded border ${c.btn}`}>
                  Zugriff auf «{root}» erteilen
                </button>
              ))}
              {noAccess.single.map(p => (
                <button key={p.id} onClick={() => void grantAndRebuild({ project: p })}
                  className={`text-[11px] px-2 py-1 rounded border ${c.btn}`}>
                  {p.root ? `Ordner von «${p.name}» wählen` : `Zugriff auf «${p.name}» erteilen`}
                </button>
              ))}
            </div>
          )}
          {!!dropped.length && (
            <div className={`mt-2 text-[10px] px-2 py-1.5 rounded border ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
              <div className="flex items-center gap-2">
                <span className="font-semibold">
                  {dropped.length} Paket{dropped.length === 1 ? '' : 'e'} verworfen — das weiter oben stehende Projekt gilt.
                </span>
                <button onClick={() => setDropped([])} className={`ml-auto ${c.muted}`}><X size={10} /></button>
              </div>
              {dropped.slice(0, 8).map(d => (
                <div key={d.pkg} className="font-mono">{d.pkg} ({d.count}) → {d.insteadOf}</div>
              ))}
              {dropped.length > 8 && <div>… und {dropped.length - 8} weitere</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Project color (like `ProjectConfig.color`). It is only saved once the
 * color stays for a moment — not on every step while dragging in the color picker.
 */
function ColorPick({ value, fallback, disabled, className, onChange }: {
  value: string | undefined;
  /** color from the Orchescala configuration (generated catalog) — applies as long as none is set here */
  fallback?: string;
  disabled?: boolean; className?: string; onChange: (color: string) => void;
}) {
  const shown = value ?? (fallback && /^#[0-9a-f]{6}$/i.test(fallback) ? fallback : fallback ? expandHex(fallback) : '#ffffff');
  const [draft, setDraft] = useState(shown);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { setDraft(shown); }, [shown]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <input type="color" value={draft} disabled={disabled}
      onChange={e => {
        const v = e.target.value;
        setDraft(v);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onChange(v), 500);
      }}
      title={value ? `Projektfarbe ${value} — Worker und Teilprozesse aus diesem Projekt bekommen sie im Diagramm`
        : fallback ? `Projektfarbe ${fallback} aus der Orchescala-Konfiguration (prepareDocs) — hier überschreiben`
          : 'Projektfarbe wählen (wie ProjectConfig.color)'}
      className={`w-4 h-4 p-0 border rounded cursor-pointer flex-shrink-0 ${value || fallback ? '' : 'opacity-40'} ${className ?? ''}`} />
  );
}

/** `#abc` → `#aabbcc` (the color picker only knows the long form); anything else → white */
function expandHex(c: string): string {
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c.trim());
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : '#ffffff';
}
