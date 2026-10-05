// «Mit BPMN abgleichen» — erst die Vorschau, dann übernehmen.
//
// Wie beim Anlegen aus BPMN: die App sucht über die Prozess-ID die Domain
// (Katalog, gemerkte Projekt-Ordner, sonst Ordner oder ZIP wählen) und zeigt,
// was entsteht — hier als Unterschied zum bisherigen Stand:
//
//  · **Ablauf**: neue, geänderte, umbenannte und entfallene Schritte,
//  · **Datenmodell**: Klassen und Interaktionen aus der Domain, zusammengeführt
//    mit den gepflegten (siehe `domainMerge.ts`),
//  · **Status**: welchen Status Neues und Geändertes bekommt — kommt das BPMN
//    aus der Implementation, ist das z. B. «Umgesetzt»,
//  · **Pattern**: welche im neuen Diagramm dazukommen, wegfallen oder andere
//    Parameter haben — erkannt wie beim Anlegen, mit den Pattern aus dem Admin,
//  · **Kommentare**: bleiben alle; was an einer entfallenen Stelle hängt,
//    steht danach im Panel unter «Ohne Stelle».
//
// Übernommen wird erst auf «Übernehmen».
//
// **Nur mit der Domain** (`mode: 'domain'`): dasselbe mit dem gespeicherten
// BPMN — der Ablauf bleibt, abgeglichen werden Klassen und Interaktionen,
// etwa nachdem die Domain im Projekt gewachsen ist.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Database, FolderOpen, Loader2, MessageSquare, RefreshCw, Upload, X } from 'lucide-react';
import { allSteps, patternDiff, type MergeReport, type MergeStatus } from '../bpmn';
import { commentTargets } from '../comments';
import { mergeDomain, type DomainMergeReport } from '../domainMerge';
import { enrichSpec, findDomain, prepareInteractions, readProjectDir, readProjectZip, scanDomain, type DomainHit } from '../projectImport';
import { STATUSES, STATUS_META, type Model, type ProcessSpec, type Status } from '../types';
import { cls } from '../ui';

export interface SyncPlan {
  spec: ProcessSpec;
  text: string;
  report: MergeReport;
  renames: Array<[string, string]>;
  /** Bericht des Abgleichs mit der Domain — fürs Änderungsprotokoll */
  domain?: DomainMergeReport;
}

interface Props {
  raw: string;
  from: string;
  current: ProcessSpec;
  model: Model | null;
  isDark: boolean;
  plan: (raw: string, from: string, st: MergeStatus) => SyncPlan | null;
  /** `domain`: nur das Datenmodell — das BPMN ist das gespeicherte */
  mode?: 'bpmn' | 'domain';
  onApply: (plan: SyncPlan) => void;
  onClose: () => void;
}

/** Eine Liste mit Zeichen davor — lange Listen scrollen. */
function Lines({ items, isDark }: { items: string[]; isDark: boolean }) {
  const c = cls(isDark);
  if (!items.length) return null;
  return (
    <div className={`font-mono text-[10px] max-h-32 overflow-y-auto ${c.muted}`}>
      {items.map((l, i) => <div key={i} className="truncate" title={l}>{l}</div>)}
    </div>
  );
}

function StatusSelect({ label, value, onChange, isDark }: { label: string; value: Status; onChange: (s: Status) => void; isDark: boolean }) {
  const c = cls(isDark);
  return (
    <label className={`flex items-center gap-1.5 text-[10px] ${c.muted2}`}>
      {label}
      <select value={value} onChange={e => onChange(e.target.value as Status)}
        className={`text-[11px] px-1.5 py-1 rounded border outline-none ${c.input}`}>
        {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
      </select>
    </label>
  );
}

export default function SyncPanel({ raw, from, current, model, isDark, plan, mode = 'bpmn', onApply, onClose }: Props) {
  const domainOnly = mode === 'domain';
  const c = cls(isDark);
  const warn = isDark ? 'text-amber-400' : 'text-amber-600';
  const zipRef = useRef<HTMLInputElement>(null);
  // undefined = wird gesucht, null = keine gefunden
  const [hit, setHit] = useState<DomainHit | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>('Domain wird gesucht …');
  const [error, setError] = useState('');
  // Nur mit der Domain: was neu dazukommt, steht schon im Projekt — umgesetzt
  const [st, setSt] = useState<MergeStatus>({ added: domainOnly ? 'implemented' : 'draft', changed: 'changed' });
  const [withDomain, setWithDomain] = useState(true);
  const [removeStale, setRemoveStale] = useState(false);
  const [prepare, setPrepare] = useState(true);

  // Die Domain über die Prozess-ID des gewählten Diagramms suchen
  const processId = useMemo(() => {
    try { return plan(raw, from, st)?.spec.processId ?? current.processId ?? ''; } catch { return current.processId ?? ''; }
    // nur je Datei — der Status ändert die Prozess-ID nicht
  }, [raw, from]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setHit(undefined);
    setBusy('Domain wird gesucht …');
    (processId ? findDomain(processId, model, t => alive && setBusy(t)) : Promise.resolve(null))
      .then(h => { if (alive) setHit(h); })
      .catch(e => { if (alive) { setHit(null); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (alive) setBusy(null); });
    return () => { alive = false; };
  }, [processId, model]);

  /** Domain aus einem gewählten Ordner oder ZIP nachreichen. */
  const domainFrom = async (read: () => Promise<Array<{ path: string; text: string }>>, source: string) => {
    try {
      setBusy(`${source} wird gelesen …`);
      const domain = scanDomain(await read());
      if (!domain.some(t => t.processName === processId && t.owner)) {
        setError(`In ${source} gibt es kein Objekt mit \`val processName = "${processId}"\`.`);
      } else { setError(''); setHit({ domain, source }); }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const pickDir = async () => {
    if (!('showDirectoryPicker' in window)) { setError('Ordner wählen geht nur in Chrome oder Edge — als Alternative ein ZIP wählen.'); return; }
    const dir = await window.showDirectoryPicker({ mode: 'read' }).catch(() => null);
    if (dir) await domainFrom(() => readProjectDir(dir), `Ordner ${dir.name}`);
  };

  // Das Ergebnis — bei jeder Einstellung neu gerechnet, gespeichert wird nichts
  const result = useMemo(() => {
    try {
      const p = plan(raw, from, st);
      if (!p) return null;
      const enriched = hit && withDomain ? enrichSpec(p.spec, hit.domain, model) : null;
      const dom = enriched ? mergeDomain(p.spec, enriched.spec, { status: st, removeStale, prepare }) : null;
      const bare = !enriched && prepare ? prepareInteractions(p.spec, model) : null;
      const spec = dom?.spec ?? bare?.spec ?? p.spec;
      // Kommentare an Stellen, die es danach nicht mehr gibt — sie bleiben
      const vorher = new Set(commentTargets(current, allSteps(current.steps)).map(t => t.key));
      const nachher = new Set(commentTargets(spec, allSteps(spec.steps)).map(t => t.key));
      const lost = (spec.comments ?? []).filter(t => vorher.has(t.target) && !nachher.has(t.target)).length;
      return { ok: true as const, plan: { ...p, spec, ...(dom ? { domain: dom.report } : {}) }, enriched, dom, prepared: dom?.report.prepared ?? bare?.prepared ?? [], lost, patterns: patternDiff(current, spec) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [plan, raw, from, st, hit, withDomain, removeStale, prepare, model, current]);

  const r = result?.ok ? result : null;
  const steps = r?.plan.report;
  const dom = r?.dom?.report;
  const pd = r?.patterns;
  const patternName = (id: string) => model?.patterns?.find(d => d.id === id)?.name ?? id;
  const params = (ps: Record<string, string>) => Object.entries(ps).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${v}`).join(', ');
  const patternLines = pd ? [
    ...pd.added.map(u => `+ ${patternName(u.id)} «${u.where}»${params(u.params) ? ` (${params(u.params)})` : ''}`),
    ...pd.changed.map(({ use, before }) => `~ ${patternName(use.id)} «${use.where}»: ${params(before) || '–'} → ${params(use.params) || '–'}`),
    ...pd.removed.map(u => `− ${patternName(u.id)} «${u.where}»`),
  ] : [];
  const nothing = !!steps && !steps.added.length && !steps.changed.length && !steps.removed.length && !steps.renamed.length
    && !steps.confirmed.length && !patternLines.length;
  const bestaetigt = `→ ${STATUS_META[st.changed].label}`;

  return (
    <div className={`flex-shrink-0 px-3 py-2.5 border-b space-y-2 ${c.border} ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
      <div className="flex items-center gap-2">
        {domainOnly ? <Database size={12} className={c.muted2} /> : <RefreshCw size={12} className={c.muted2} />}
        <span className={`text-[11px] font-semibold ${c.text}`}>{domainOnly ? 'Mit Domain abgleichen' : 'Mit BPMN abgleichen'}</span>
        {!domainOnly && <span className={`text-[10px] font-mono truncate ${c.muted}`}>{from}</span>}
        {busy && <span className={`flex items-center gap-1 text-[10px] ${c.muted}`}><Loader2 size={10} className="animate-spin" /> {busy}</span>}
        <button onClick={onClose} title="Abbrechen — nichts wird übernommen" className={`ml-auto ${c.muted}`}><X size={12} /></button>
      </div>

      {error && <p className={`text-[10px] ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>{error}</p>}
      {result && !result.ok && <p className={`text-[10px] ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>BPMN nicht lesbar: {result.error}</p>}

      {steps && (
        <div className={`grid gap-3 ${domainOnly && nothing ? '' : 'md:grid-cols-2'}`}>
          {/* Ablauf — beim Abgleich nur mit der Domain bloss, wenn das
              gespeicherte BPMN noch nicht übernommen war */}
          {!(domainOnly && nothing) && <div className="space-y-1 min-w-0">
            <p className={`text-[10px] uppercase tracking-wider ${c.muted}`}>Ablauf</p>
            <p className={`text-[10px] ${c.muted2}`}>
              {nothing ? `unverändert · ${steps.kept} Schritte` : <>
                {steps.kept} behalten · {steps.added.length} neu · {steps.changed.length} geändert
                {steps.renamed.length ? ` · ${steps.renamed.length} umbenannt` : ''} · {steps.removed.length} entfallen
                {steps.confirmed.length ? ` · ${steps.confirmed.length} Angepasste ${bestaetigt}` : ''}
              </>}
            </p>
            <Lines isDark={isDark} items={[...steps.added.map(n => `+ ${n}`), ...steps.changed.map(n => `~ ${n}`),
              ...steps.renamed.map(n => `✎ ${n}`), ...steps.removed.map(n => `− ${n}`),
              ...steps.confirmed.map(n => `✓ ${n} ${bestaetigt}`)]} />
            {/* Pattern: erkannt wie beim Anlegen — hier als Unterschied */}
            {!!patternLines.length && (
              <>
                <p className={`text-[10px] pt-1 ${c.muted2}`}>
                  Pattern: {pd!.added.length} neu · {pd!.changed.length} geändert · {pd!.removed.length} entfallen
                </p>
                <Lines isDark={isDark} items={patternLines} />
              </>
            )}
            {!model?.patterns?.length && <p className={`text-[10px] pt-1 ${c.muted}`}>Pattern: keine definiert (Admin → Pattern) — nichts erkannt.</p>}
          </div>}

          {/* Datenmodell */}
          <div className="space-y-1 min-w-0">
            <p className={`text-[10px] uppercase tracking-wider ${c.muted}`}>Datenmodell</p>
            {hit === undefined ? (
              <p className={`text-[10px] ${c.muted}`}>Domain wird gesucht …</p>
            ) : hit ? (
              <>
                <label className={`flex items-center gap-1.5 text-[10px] ${c.muted2}`}>
                  {!domainOnly && <input type="checkbox" checked={withDomain} onChange={e => setWithDomain(e.target.checked)} />}
                  {domainOnly ? 'Domain' : 'mit der Domain abgleichen'}
                  {r?.enriched && <> — <span className="font-mono">{r.enriched.object}</span> aus {hit.source}</>}
                </label>
                {hit.note && <p className={`text-[10px] ${warn}`}><AlertTriangle size={10} className="inline mr-1 -mt-0.5" />{hit.note}</p>}
                {withDomain && !r?.enriched && <p className={`text-[10px] ${warn}`}>Die Domain kennt <span className="font-mono">{processId}</span> nicht.</p>}
                {dom && (
                  <>
                    <p className={`text-[10px] ${c.muted2}`}>
                      {dom.kept} unverändert · {dom.added.length} neu · {dom.changed.length} geändert
                      {dom.stale.length ? ` · ${dom.stale.length} ${removeStale ? 'entfernt' : 'nur in der Spezifikation'}` : ''}
                      {dom.confirmed.length ? ` · ${dom.confirmed.length} Angepasste ${bestaetigt}` : ''}
                    </p>
                    <Lines isDark={isDark} items={[...dom.added.map(n => `+ ${n}`), ...dom.changed.map(n => `~ ${n}`),
                      ...dom.confirmed.map(n => `✓ ${n} ${bestaetigt}`),
                      ...dom.stale.map(n => `${removeStale ? '−' : '?'} ${n}`)]} />
                    {!!dom.stale.length && (
                      <label className={`flex items-center gap-1.5 text-[10px] ${c.muted2}`}
                        title="Nur was schon umgesetzt war — Entwürfe sind der Domain voraus und bleiben">
                        <input type="checkbox" checked={removeStale} onChange={e => setRemoveStale(e.target.checked)} />
                        was die Domain nicht mehr kennt, entfernen
                      </label>
                    )}
                  </>
                )}
                {r?.enriched && (r.enriched.warnings.length > 0 || r.enriched.unmatched.length > 0 || r.enriched.unresolved.length > 0) && (
                  <div className={`text-[10px] space-y-0.5 ${warn}`}>
                    {r.enriched.warnings.map((w, i) => <div key={i} className="flex items-start gap-1"><AlertTriangle size={10} className="flex-shrink-0 mt-0.5" /> <span>{w}</span></div>)}
                    {!!r.enriched.unmatched.length && <div>Ohne Schritt im Ablauf: {r.enriched.unmatched.join(', ')}</div>}
                    {!!r.enriched.unresolved.length && <div>Typen weder im Projekt noch im Katalog: {r.enriched.unresolved.join(', ')}</div>}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-1.5">
                <p className={`text-[10px] ${warn}`}>
                  <AlertTriangle size={10} className="inline mr-1 -mt-0.5" />
                  Kein Domain-Objekt mit <span className="font-mono">val processName = "{processId}"</span> im Katalog oder in den
                  gemerkten Projekt-Ordnern — Projekt-Ordner oder ZIP wählen{domainOnly ? '.' : ', oder nur den Ablauf abgleichen.'}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={pickDir} disabled={!!busy}
                    className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border disabled:opacity-40 ${c.btn}`}>
                    <FolderOpen size={12} /> Projekt-Ordner wählen
                  </button>
                  <input ref={zipRef} type="file" accept=".zip" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) void domainFrom(async () => readProjectZip(new Uint8Array(await f.arrayBuffer())), f.name);
                      e.target.value = '';
                    }} />
                  <button onClick={() => zipRef.current?.click()} disabled={!!busy}
                    className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border disabled:opacity-40 ${c.btn}`}>
                    <Upload size={12} /> ZIP wählen
                  </button>
                </div>
              </div>
            )}
            {r && (r.prepared.length > 0 || !prepare) && (
              <label className={`flex items-start gap-1.5 text-[10px] ${c.muted2}`}>
                <input type="checkbox" className="mt-0.5" checked={prepare} onChange={e => setPrepare(e.target.checked)} />
                <span>Schritte ohne Interaktion als Entwurf mit In/Out vorbereiten
                  {r.prepared.length ? `: ${r.prepared.join(', ')}` : ''}</span>
              </label>
            )}
          </div>
        </div>
      )}

      {r && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
          <StatusSelect label="Status für Neues" value={st.added} onChange={s => setSt({ ...st, added: s })} isDark={isDark} />
          <StatusSelect label="für Geändertes" value={st.changed} onChange={s => setSt({ ...st, changed: s })} isDark={isDark} />
          {!domainOnly && (
            <label className={`flex items-center gap-1.5 text-[10px] ${c.muted2}`}
              title={'Ein- und Ausgaben und Mock aller Schritte so, wie sie im BPMN stehen — auch dort, wo das Diagramm sie nicht geändert hat.\n'
                + 'Für eine Spezifikation, deren gespeicherte Mappings veraltet sind (z. B. aus einer älteren Version importiert). '
                + 'Die Bedeutung der Zeilen bleibt; was du in der Orch Spec an Mappings geändert hast, geht verloren.'}>
              <input type="checkbox" checked={!!st.mappingsFromBpmn} onChange={e => setSt({ ...st, mappingsFromBpmn: e.target.checked || undefined })} />
              Mappings aus dem BPMN übernehmen
            </label>
          )}
          {r.lost > 0 && (
            <span className={`flex items-center gap-1 text-[10px] ${c.muted}`}
              title="Kommentare werden nie gelöscht — sie stehen im Kommentar-Panel unter «Ohne Stelle», bis sie erledigt sind">
              <MessageSquare size={10} /> {r.lost} Kommentar{r.lost === 1 ? '' : 'e'} an entfallenen Stellen bleiben erhalten
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className={`text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>Abbrechen</button>
            <button onClick={() => onApply(r.plan)} disabled={(hit === undefined && !!busy) || (domainOnly && !r.dom && !r.prepared.length)}
              title={hit === undefined ? 'Domain wird noch gesucht' : domainOnly && !r.dom ? 'Ohne Domain gibt es nichts abzugleichen' : undefined}
              className={`text-[11px] px-3 py-1.5 rounded font-semibold disabled:opacity-40 ${c.btnPrimary}`}>
              Übernehmen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
