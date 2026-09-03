// Katalog erzeugen — nur dort, wo die Quellen liegen.
//
// In der Bankenzone gibt es weder die Projekt-Ordner noch die Doku-Site;
// dort kommt der Katalog als Datei herein (siehe `CatalogTransfer`). Alles
// hier ist deshalb **optional** und standardmässig zugeklappt.
//
// Drei Wege hinein:
//
//  · **Projekt-Ordner** — eine benannte, sortierbare Liste für die
//    Domain-Typen. Gewählt wird ein Ordner über den Projekten
//    (`~/dev-valiant/projects`); seine Unterordner kommen als Projekte
//    hinein. **Oben steht, was gewinnt**: dasselbe Paket aus einem weiter
//    unten stehenden Projekt (`valiant.fil.is.domain.client` nach
//    `swisscom.fil.is.domain.client`) wird verworfen und gemeldet.
//    «Neu aufbauen» liest die Liste von oben nach unten frisch ein.
//  · **OpenAPI einlesen** — die `03-api/OpenApi.yml` der Projekte. Sie
//    beschreibt, was **tatsächlich deployed** ist: Worker, Prozesse,
//    Benutzeraufgaben und Signale mit ihren Ein- und Ausgaben.
//  · **Von URL laden** — die Orchescala-Doku-Site. Von dort kommen die
//    Prozesse aller Projekte mit ihren `In`/`Out`, auch ohne die Quellen
//    lokal zu haben.
import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronUp, FolderOpen, Globe, RefreshCw, Upload, X,
} from 'lucide-react';
import { load } from 'js-yaml';
import { mergeDomainTypes, type DiscardedPackage } from '../domainScan';
import { catalogFromOpenApi, mergeServices } from '../openApi';
import { forgetProject, move, projectsInFolder, rebuild, rememberProject } from '../projects';
import { countByKind, fillGapsOnly, readSite } from '../siteCatalog';
import type { DomainType, Model, ProjectFolder } from '../types';
import { cls } from '../ui';

/**
 * `Failed to fetch` hat zwei ganz verschiedene Ursachen. Ein Versuch mit
 * `no-cors` unterscheidet sie: kommt eine (undurchsichtige) Antwort, ist der
 * Server erreichbar und es fehlt nur die CORS-Freigabe — sonst kommt man gar
 * nicht hin. Das spart die Suche am falschen Ende.
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

/** zuletzt genutzte Adresse als Vorschlag */
function sourcesUrl(model: Model): string {
  return (model.domainSources ?? []).find(s => /^https?:/i.test(s)) ?? '';
}

/**
 * Rekursiv die generierten OpenAPI-Dateien eines Ordners lesen — genau
 * `OpenApi.yml` / `.yaml` / `.json`, nicht die Postman-Variante und keine
 * fremden Spezifikationen, die daneben liegen.
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

  // Jede OpenAPI beschreibt ein Projekt; mehrere ergeben zusammen den Katalog.
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

  // Ein Projekt hat seine OpenAPI unter `03-api/OpenApi.yml`. Einen Ordner
  // darüber wählen und darunter alles einsammeln ist der bequemste Weg.
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
    // Was schon im Katalog steht, hat Vorrang — die Reihenfolge der Quellen
    // entscheidet, welches Paket bei Namensgleichheit gilt.
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

  // ── Projekt-Ordner ───────────────────────────────────────────────────────
  // Gewählt wird der Ordner **über** den Projekten; seine Unterordner kommen
  // als Projekte in die Liste. Ist es selbst ein Projekt, kommt eben dieses.
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
      // schon bekannte Projekte behalten ihren Platz, bekommen aber den
      // frischen Zugriff — sonst müsste man sie zum Erneuern erst entfernen
      for (const g of gefunden.filter(x => bekannt.has(x.project.name))) {
        const alt = projects.find(p => p.name === g.project.name)!;
        await rememberProject(alt, g.handle);
      }
      const liste = [...projects, ...neu.map(g => g.project)];
      await onSave({ ...model, projects: liste });
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
   * Der Katalog wird **neu** gebaut, nicht ergänzt — sonst bliebe das früher
   * Gelesene stehen und ein Umsortieren hätte keine Wirkung.
   */
  const rebuildCatalog = async () => {
    if (!projects.length) return;
    setBusy('…'); setMsg(''); setDropped([]);
    try {
      const r = await rebuild(projects, setBusy);
      // Nichts speichern, solange ein Projekt fehlt: sonst wäre der Katalog
      // um dessen Typen ärmer, nur weil der Browser den Zugriff vergessen hat.
      if (r.missing.length) {
        setMsg(`Kein Zugriff auf ${r.missing.map(p => p.name).join(', ')} — der Katalog bleibt, wie er ist. `
          + '«Projekte wählen» und denselben Ordner nochmals bestätigen stellt den Zugriff wieder her; '
          + 'mit × verschwindet ein Projekt aus der Liste.');
        return;
      }
      setBusy(`${r.files} Dateien auswerten …`);
      const res = await onSave({
        ...model,
        domainTypes: r.types,
        projects: r.projects,
        domainSources: [...new Set([...sources.filter(x => /^https?:/i.test(x)), ...projects.map(p => p.name)])],
      });
      setDropped(r.discarded);
      setMsg(res.ok
        ? `${r.types.length} Typen aus ${r.files} Dateien in ${projects.length} Projekten`
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
                      <button onClick={() => void removeProject(p)} disabled={!!busy}
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
