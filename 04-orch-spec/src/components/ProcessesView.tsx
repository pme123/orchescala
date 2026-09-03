// Übersicht aller Spezifikationen im geteilten Ordner.
//
// Zwei Wege zu einer neuen Spezifikation:
//
//  · **Aus BPMN** — die Struktur kommt aus der Implementation, die Prosa
//    schreibt man danach.
//  · **Neu** — der Prozess startet mit der **Vorlage** (Admin → Vorlage für
//    neue Prozesse; ohne eigene gilt die eingebaute). Aus ihr entstehen
//    Diagramm und Ablaufbaum in einem Zug — mit der neuen Prozess-ID, denn
//    daran hängen Topics, Domain-Zuordnung und Dateiname.
import { useMemo, useRef, useState } from 'react';
import { FileCode2, FilePlus2, Upload, X } from 'lucide-react';
import { useStore } from '../store';
import { usePermissions } from '../auth';
import { importBpmn, statusCounts } from '../bpmn';
import { DEFAULT_ENGINE, ENGINES, applyTemplate, loadTemplate } from '../template';
import { STATUS_META, STATUSES, type EngineId, type Status, type Step } from '../types';
import { StatusChip, cls } from '../ui';
import { knownPrefixes, splitPrefix } from '../stepIds';
import { slugify } from '../util';

export default function ProcessesView({ onOpen }: { onOpen: (slug: string) => void }) {
  const { isDark, specs, createSpec, saveBpmn, model } = useStore();
  const { canEdit } = usePermissions();
  const c = cls(isDark);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [project, setProject] = useState('');
  const [version, setVersion] = useState('1');
  const [engine, setEngine] = useState<EngineId>(DEFAULT_ENGINE);
  // `company-project-processVversion` — so heissen die Prozesse im Haus, und
  // genau diese Teile trägt die Vorlage an ihren Platzhalter-Stellen.
  const processId = [company.trim(), project.trim(), name.trim() && `${name.trim()}V${version.trim() || '1'}`]
    .filter(Boolean).join('-');
  // Auswahl statt Raten: alle Firmen und Projekte, die Katalog und
  // vorhandene Spezifikationen kennen — Freitext bleibt für Neues möglich.
  const prefixes = useMemo(() => knownPrefixes(model, specs.map(s => s.data.project)), [model, specs]);
  const companies = useMemo(() => [...new Set(prefixes.map(p => splitPrefix(p).company))], [prefixes]);
  const projectOptions = useMemo(() => {
    const firma = company.trim();
    const passend = firma ? prefixes.filter(p => p.startsWith(`${firma}-`)) : prefixes;
    return [...new Set(passend.map(p => (firma ? p.slice(firma.length + 1) : splitPrefix(p).project)))].filter(Boolean);
  }, [prefixes, company]);
  // Firma und Projekt sind bei allen Prozessen eines Hauses dieselben — der
  // zuletzt angelegte ist deshalb der beste Vorschlag.
  const letztes = useMemo(() => {
    const voriges = specs.map(s => s.data.project).filter(Boolean).slice(-1)[0] ?? '';
    const [firma, ...rest] = voriges.split('-');
    return { company: firma ?? '', project: rest.join('-') };
  }, [specs]);

  const fromBpmn = async (file: File) => {
    setError('');
    try {
      const text = await file.text();
      const { spec, stepCount, unreachable } = importBpmn(text, file.name);
      const res = await createSpec(spec);
      if (!res.ok) { setError(res.message); return; }
      // Das BPMN bleibt neben der Spezifikation liegen — damit lässt es sich
      // in der Prozessansicht direkt bearbeiten.
      const w = await saveBpmn(spec.slug, text);
      if (!w.ok) setError(w.message);
      if (unreachable.length) {
        console.warn('[orch-spec] nicht erreichbare BPMN-Elemente:', unreachable);
      }
      console.info(`[orch-spec] ${stepCount} Schritte importiert`);
      onOpen(spec.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Aus der Vorlage entsteht beides: das Diagramm und der Baum daraus. So
  // fängt ein neuer Prozess dort an, wo im Haus alle anfangen.
  const createFromTemplate = async () => {
    if (!name.trim()) { setError('Bitte einen Prozessnamen angeben.'); return; }
    if (specs.some(s => s.data.processId === processId || s.slug === slugify(processId))) {
      setError(`«${processId}» gibt es schon.`);
      return;
    }
    setError('');
    try {
      const xml = applyTemplate(await loadTemplate(engine), { processId, title: title || processId });
      const { spec } = importBpmn(xml, `${slugify(processId)}.bpmn`);
      // Der Ablauf kommt aus der Vorlage, ist aber noch nicht umgesetzt —
      // und zwar auf allen Ebenen: Unterschritte, Zweige und Fehlerpfade.
      const entwurf = (steps: Step[]): Step[] => steps.map(s => ({
        ...s,
        status: 'draft' as Status,
        ...(s.children ? { children: entwurf(s.children) } : {}),
        ...(s.branches ? { branches: s.branches.map(b => ({ ...b, steps: entwurf(b.steps) })) } : {}),
        ...(s.errors ? { errors: s.errors.map(e => (e.steps ? { ...e, steps: entwurf(e.steps) } : e)) } : {}),
      }));
      const neu = { ...spec, title: title || processId, engine, status: 'draft' as Status, steps: entwurf(spec.steps) };
      const res = await createSpec(neu);
      if (!res.ok) { setError(res.message); return; }
      const w = await saveBpmn(neu.slug, xml);
      if (!w.ok) { setError(w.message); return; }
      setNewOpen(false); setTitle(''); setName('');
      onOpen(neu.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-5">
        <h1 className={`text-sm font-semibold uppercase tracking-widest ${c.muted2}`}>Prozess-Spezifikationen</h1>
        {canEdit && (
          <div className="ml-auto flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".bpmn,.xml" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void fromBpmn(f); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}>
              <Upload size={12} /> Aus BPMN
            </button>
            <button onClick={() => {
              setCompany(v => v || letztes.company);
              setProject(v => v || letztes.project);
              setNewOpen(true);
            }}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded font-semibold ${c.btnPrimary}`}>
              <FilePlus2 size={12} /> Neu
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className={`mb-4 text-[11px] px-3 py-2 rounded border ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
          {error}
        </div>
      )}

      {newOpen && (
        <div className={`mb-4 p-3 rounded border ${c.border2} ${c.panel}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-[11px] ${c.muted2}`}>Neue Spezifikation</span>
            <button onClick={() => setNewOpen(false)} className={`ml-auto ${c.muted}`}><X size={12} /></button>
          </div>
          <div className="flex gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Fachlicher Titel"
              className={`flex-1 text-[11px] px-2 py-1.5 rounded border outline-none ${c.input}`} />
            <button onClick={createFromTemplate} disabled={!name.trim()}
              className={`text-[11px] px-3 py-1.5 rounded font-semibold disabled:opacity-40 ${c.btnPrimary}`}>Anlegen</button>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            {/* Firma und Projekt mit den bekannten Werten aus Katalog und
                Spezifikationen als Auswahl — tippen für neue bleibt möglich */}
            {([['company', company, setCompany, 'company', 'w-28', 'firmen-liste'],
               ['project', project, setProject, 'project', 'w-28', 'projekte-liste'],
               ['process', name, setName, 'process', 'flex-1', undefined]] as const).map(([id, wert, setzen, platzhalter, breite, liste]) => (
              <div key={id} className={breite}>
                <input value={wert} onChange={e => setzen(e.target.value)} placeholder={platzhalter} list={liste}
                  className={`w-full text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
              </div>
            ))}
            <datalist id="firmen-liste">
              {companies.map(f => <option key={f} value={f} />)}
            </datalist>
            <datalist id="projekte-liste">
              {projectOptions.map(p => <option key={p} value={p} />)}
            </datalist>
            <span className={`text-[11px] font-mono ${c.muted}`}>V</span>
            <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1"
              className={`w-12 text-[11px] px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
          </div>
          {/* Die bereitgestellten Vorlagen — je Engine eine. */}
          <div className="flex items-center gap-1.5 mt-2">
            {ENGINES.map(e => (
              <button key={e.id} onClick={() => setEngine(e.id)}
                title={e.hint}
                className={`flex-1 text-left text-[11px] px-2.5 py-1.5 rounded border transition-colors ${
                  engine === e.id
                    ? (isDark ? 'border-white/40 text-white bg-white/10' : 'border-black/40 text-black bg-black/10')
                    : c.btn}`}>
                {e.label}
                <span className={`block text-[9px] ${c.muted}`}>{e.hint}</span>
              </button>
            ))}
          </div>
          <p className={`text-[10px] mt-1.5 ${c.muted}`}>
            Prozess-ID: <span className="font-mono">{processId || '…'}</span>
            {' · '}Vorlage <span className="font-mono">templates/{ENGINES.find(e => e.id === engine)?.file}</span>
          </p>
        </div>
      )}

      {!specs.length ? (
        <div className={`text-xs ${c.muted} py-10 text-center`}>
          Noch keine Spezifikation. {canEdit ? '«Aus BPMN» liest die Struktur direkt aus der Implementation.' : ''}
        </div>
      ) : (
        <div className="space-y-1.5">
          {specs.map(({ slug, data }) => {
            const counts = statusCounts(data);
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            return (
              <button key={slug} onClick={() => onOpen(slug)}
                className={`w-full text-left px-3 py-2.5 rounded border ${c.border2} ${c.hover} flex items-center gap-3`}>
                <FileCode2 size={14} className={c.muted} />
                <div className="min-w-0 flex-1">
                  <div className={`text-xs truncate ${c.text}`}>{data.title || slug}</div>
                  <div className={`text-[10px] font-mono truncate ${c.muted}`}>
                    {data.processId || data.name}{data.project ? ` · ${data.project}` : ''}
                  </div>
                </div>
                <div className="hidden sm:flex items-center gap-1">
                  {STATUSES.filter(s => counts[s] > 0).map(s => (
                    <span key={s} title={`${counts[s]} × ${STATUS_META[s].label}`}
                      className={`text-[9px] px-1 py-0.5 rounded border ${isDark ? STATUS_META[s].dark : STATUS_META[s].light}`}>
                      {counts[s]}
                    </span>
                  ))}
                </div>
                <span className={`text-[10px] ${c.muted} w-20 text-right`}>{total} Schritte</span>
                <StatusChip status={data.status as Status} isDark={isDark} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
