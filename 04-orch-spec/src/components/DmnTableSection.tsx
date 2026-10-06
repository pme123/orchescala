// Die Tabelle einer DMN Decision am Schritt — holen (Projekt oder Datei),
// neu anlegen, bearbeiten. Nach jedem Übernehmen folgen In, Out und die
// Ergebnisform der Tabelle (siehe dmn.ts); die Tabelle selbst liegt neben der
// Spezifikation und kommt mit «Process from Spec» ins Projekt.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileUp, FolderSearch, Loader2, Plus, Table2 } from 'lucide-react';
import type { Interaction, Model, ProcessSpec, Step } from '../types';
import { useStore } from '../store';
import { cls } from '../ui';
import { decisionResultOf, dmnFileName, findDecision, newDmn, parseDmn, syncDecision, type DmnDecision } from '../dmn';
import { findDmnInProject } from '../dmnProject';
import { suggestName, withOrigin } from '../interactions';
import { packageOf } from '../scala';
import { uid } from '../util';

// dmn-js ist gross — es kommt erst, wenn die Tabelle geöffnet wird
const DmnEditor = lazy(() => import('./DmnEditor'));

export default function DmnTableSection({ step, spec, model, isDark, canEdit, onSpecChange }: {
  step: Step; spec: ProcessSpec; model: Model | null; isDark: boolean; canEdit: boolean;
  onSpecChange: (spec: ProcessSpec) => void;
}) {
  const c = cls(isDark);
  const { loadDmn, saveDmn } = useStore();
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id && i.kind === 'decision') ?? null;
  const decisionId = ia?.key || step.topic || '';
  const [stored, setStored] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warn'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // die Tabelle, die die App führt
  useEffect(() => {
    let alive = true;
    if (!ia?.dmnFile || !decisionId) { setStored(null); return; }
    void loadDmn(spec.slug, decisionId).then(x => { if (alive) setStored(x); });
    return () => { alive = false; };
  }, [ia?.dmnFile, decisionId, spec.slug, loadDmn]);

  if (!decisionId) return null;
  const table: DmnDecision | null = stored ? findDecision(stored, decisionId) : null;
  const company = (spec.processId ?? '').split('-')[0] || undefined;

  /** die Interaktion — entsteht, wenn es sie noch nicht gibt */
  const withInteraction = (s: ProcessSpec): { spec: ProcessSpec; ia: Interaction } => {
    const own = (s.interactions ?? []).find(i => i.stepId === step.id && i.kind === 'decision');
    if (own) return { spec: s, ia: own };
    const neu = withOrigin({
      id: uid('ia'), stepId: step.id, kind: 'decision', key: decisionId,
      name: suggestName(step, 'decision', s.processId ?? '', model),
      ...(step.description ? { descr: step.description } : {}),
      status: 'draft',
    }, model, packageOf(s, model));
    return { spec: { ...s, interactions: [...(s.interactions ?? []), neu] }, ia: neu };
  };

  /** Tabelle ablegen und In/Out abgleichen */
  const take = async (xml: string, file: string | undefined, from: string) => {
    const d = findDecision(xml, decisionId);
    if (!d) {
      const all = parseDmn(xml);
      setNotice({ tone: 'warn', text: 'error' in all
        ? `DMN nicht lesbar: ${all.error}`
        : `In dieser Datei steht keine Entscheidung «${decisionId}» (gefunden: ${all.map(x => x.id).join(', ') || 'keine'}).` });
      return;
    }
    const w = await saveDmn(spec.slug, decisionId, xml);
    if (!w.ok) { setNotice({ tone: 'warn', text: `Tabelle nicht gespeichert: ${w.message}` }); return; }
    const base = withInteraction(spec);
    const named = { ...base.spec, interactions: (base.spec.interactions ?? []).map(i => (i.id === base.ia.id ? { ...i, dmnFile: file ?? dmnFileName(i, company) } : i)) };
    const r = syncDecision(named, base.ia.id, d);
    onSpecChange(r.spec);
    setStored(xml);
    setNotice({ tone: 'info', text: `${from} — ${r.changes.length ? r.changes.join(' · ') : 'In und Out passten schon'}.` });
  };

  const fromProject = async () => {
    setBusy('Projekt wird durchsucht …'); setNotice(null);
    try {
      const hit = await findDmnInProject(decisionId, spec.processId ?? '', model, spec.engine, t => setBusy(t));
      if (hit) await take(hit.xml, hit.file, `Aus ${hit.project}/${hit.file}`);
      else setNotice({ tone: 'warn', text: `In den gemerkten Projekt-Ordnern (Admin → Katalog) liegt unter src/main/resources/${spec.engine === 'c8' ? 'camunda8' : 'camunda'} keine Tabelle «${decisionId}» — Datei wählen oder neu anlegen.` });
    } catch (e) {
      setNotice({ tone: 'warn', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const fromFile = async (f: File) => {
    setNotice(null);
    await take(await f.text(), f.name, `Aus ${f.name}`);
  };

  // neu: je Feld von In und Out eine Spalte — gespeichert wird erst beim Übernehmen
  const create = () => {
    const types = spec.types ?? [];
    const fieldsOf = (id?: string) => types.find(t => t.id === id)?.fields ?? [];
    setEditing(newDmn(decisionId, step.name || ia?.name || decisionId, fieldsOf(ia?.inTypeId), fieldsOf(ia?.outTypeId), ia?.decisionResult ?? step.decisionResult ?? 'singleResult', spec.engine));
  };

  const btn = `flex items-center gap-1 text-[10px] px-2 py-1 rounded border disabled:opacity-40 ${c.btn}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <h3 className={`text-[10px] uppercase tracking-widest ${c.text}`}>DMN-Tabelle</h3>
        {busy && <span className={`flex items-center gap-1 text-[10px] ${c.muted}`}><Loader2 size={10} className="animate-spin" /> {busy}</span>}
      </div>
      {table ? (
        <button onClick={() => setEditing(stored)} title={canEdit ? 'Tabelle bearbeiten' : 'Tabelle ansehen'}
          className={`w-full flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border text-left ${c.border2} ${c.hover}`}>
          <Table2 size={12} className={c.muted2} />
          <span className="flex-1 min-w-0">
            <span className={`block font-mono truncate ${c.text}`}>{ia?.dmnFile}</span>
            <span className={`block text-[10px] ${c.muted}`}>
              {table.inputs.length} Eingaben · {table.outputs.length} Ausgaben · {table.hitPolicy}{table.aggregation ? ` ${table.aggregation}` : ''} → {decisionResultOf(table)}
            </span>
          </span>
          <span className={`text-[10px] ${c.muted}`}>{canEdit ? 'bearbeiten' : 'ansehen'}</span>
        </button>
      ) : (
        <p className={`text-[10px] ${c.muted}`}>
          {ia?.dmnFile ? 'Tabelle wird geladen …' : 'Noch keine Tabelle in der Spezifikation — aus dem Projekt holen, eine Datei wählen oder neu anlegen. In und Out folgen danach den Spalten.'}
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => { void fromProject(); }} disabled={!!busy}
            title={`In den gemerkten Projekt-Ordnern unter src/main/resources/${spec.engine === 'c8' ? 'camunda8' : 'camunda'} suchen`}
            className={btn}><FolderSearch size={10} /> {table ? 'Mit Projekt abgleichen' : 'Aus dem Projekt'}</button>
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className={btn}><FileUp size={10} /> Datei wählen</button>
          {!table && <button onClick={create} disabled={!!busy} title="Neue Tabelle — je Feld von In und Out eine Spalte" className={btn}><Plus size={10} /> Neu anlegen</button>}
          <input ref={fileRef} type="file" accept=".dmn,.xml" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void fromFile(f); }} />
        </div>
      )}
      {notice && (
        <p className={`text-[10px] flex items-start gap-1 ${notice.tone === 'warn' ? (isDark ? 'text-amber-300' : 'text-amber-700') : c.muted2}`}>
          {notice.tone === 'warn' && <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />} <span>{notice.text}</span>
        </p>
      )}
      {editing && (
        <Suspense fallback={null}>
          <DmnEditor xml={editing} decisionId={decisionId} title={ia?.name ?? step.name} isDark={isDark} canEdit={canEdit}
            onClose={() => setEditing(null)}
            onSave={xml => { setEditing(null); void take(xml, ia?.dmnFile, 'Tabelle übernommen'); }} />
        </Suspense>
      )}
    </div>
  );
}
