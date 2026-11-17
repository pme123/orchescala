// «Einfügen»: what was copied in another place of Orch Spec (see transfer.ts) - pasted, planned,
// then written: new items created, those already there overwritten (with an entry in their log)
// or skipped, the type mappers and patterns the model lacks added.
import { useMemo, useState } from 'react';
import { AlertTriangle, ClipboardPaste, Loader2, X } from 'lucide-react';
import { useAuthor } from '../auth';
import { makeEntry } from '../audit';
import { useStore, type SaveResult } from '../store';
import { cls } from '../ui';
import { callableServices } from '../services/serviceProcess';
import { useServices } from '../services/store';
import { isCollection } from '../services/types';
import { storedOpenApiPath } from '../services/openApiFile';
import { planPaste, readTransfer, withPasted, type PasteAction, type PastePlan, type Transfer } from '../transfer';

/** why a save did not go through */
const saveProblem = (r: Exclude<SaveResult, { status: 'saved' }>) =>
  r.status === 'conflict' ? 'inzwischen hier geändert - neu laden und nochmals einfügen' : r.message;

export default function TransferPaste({ isDark, onClose, onDone, onWritten }: {
  isDark: boolean; onClose: () => void; onDone: (titles: string[]) => void;
  /** some were written, others not - the panel stays open with the problems, the lists are read again */
  onWritten?: () => void;
}) {
  const c = cls(isDark);
  const warn = isDark ? 'text-amber-400' : 'text-amber-600';
  const { model, specs, saveModel, createSpec, loadSpec, saveSpec, saveBpmn, saveDmn } = useStore();
  const { services, loadService, createService, saveService, saveOpenApi } = useServices();
  const author = useAuthor();
  const [text, setText] = useState('');
  const [actions, setActions] = useState<Record<string, PasteAction>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const read = useMemo(() => (text.trim() ? readTransfer(text) : null), [text]);
  const transfer: Transfer | null = read && !('error' in read) ? read : null;
  const plan: PastePlan | null = useMemo(() => {
    if (!transfer) return null;
    const processes = new Map(specs.map(s => [s.slug, { updatedAt: s.data.updatedAt, version: s.version }]));
    const collections = new Map(services.filter(s => isCollection(s.data)).map(s => [s.slug, { updatedAt: String(s.data.updatedAt ?? ''), version: s.version }]));
    const known = new Set(callableServices(services.map(s => s.data).filter(isCollection), model).keys());
    try {
      return planPaste(transfer, { processes, collections }, model, known);
    } catch {
      // what the checks of readTransfer let through and still does not fit: no plan, not a broken page
      return null;
    }
  }, [transfer, specs, services, model]);
  const actionOf = (slug: string, fallback: PasteAction) => actions[slug] ?? fallback;

  const fromClipboard = async () => {
    try { setText(await navigator.clipboard.readText()); setError(''); }
    catch { setError('Die Zwischenablage liess sich nicht lesen - mit Cmd/Ctrl+V ins Feld einfügen.'); }
  };

  const apply = async () => {
    if (!plan || !model) return;
    const done: string[] = [];
    const problems: string[] = [];
    try {
      // what the items use, first - a mapping then finds its type mapper
      if (plan.typeMappers.length || plan.patterns.length) {
        setBusy('Typ-Mapper und Patterns …');
        const r = await saveModel(withPasted(model, plan));
        if (!r.ok) { setError(r.message); return; }
      }
      for (const row of plan.rows) {
        const action = actionOf(row.item.slug, row.action);
        if (action === 'skip') continue;
        setBusy(`«${row.title}» …`);
        const item = row.item;
        if (item.kind === 'process') {
          if (action === 'create') {
            const r = await createSpec(item.spec);
            if (!r.ok) { problems.push(`«${row.title}»: ${r.message}`); continue; }
          } else {
            const cur = await loadSpec(item.slug);
            if (!cur) { problems.push(`«${row.title}» gibt es hier nicht mehr`); continue; }
            // what the plan showed is what is overwritten - changed here since then is a conflict
            if (cur.version !== row.existing?.version) { problems.push(`«${row.title}» wurde hier inzwischen geändert - nicht überschrieben, nochmals einfügen`); continue; }
            const entry = makeEntry(cur.data, item.spec, { source: 'import', note: 'Eingefügt aus einer anderen Orch Spec' }, author);
            const r = await saveSpec(item.spec, cur.version, entry ? [entry] : []);
            if (r.status !== 'saved') { problems.push(`«${row.title}»: ${saveProblem(r)}`); continue; }
          }
          // the spec is written - what of it is not is said with it, and it does not count as done
          const before = problems.length;
          const verb = action === 'create' ? 'angelegt' : 'überschrieben';
          if (item.bpmn) { const w = await saveBpmn(item.slug, item.bpmn); if (!w.ok) problems.push(`«${row.title}» ${verb}, aber das BPMN nicht: ${w.message}`); }
          for (const [id, xml] of Object.entries(item.dmns ?? {})) {
            const w = await saveDmn(item.slug, id, xml);
            if (!w.ok) problems.push(`«${row.title}» ${verb}, aber die DMN-Tabelle ${id} nicht: ${w.message}`);
          }
          if (problems.length > before) continue;
        } else {
          // where this place keeps its OpenAPI - in the spec before it is written, the file after it:
          // a spec that is not written leaves no OpenAPI behind
          const spec = item.openApi
            ? { ...item.spec, source: { ...(item.spec.source ?? {}), stored: storedOpenApiPath(item.slug, item.openApi.file) } }
            : item.spec;
          // the OpenAPI it kept here before (overwrite) - only that one may go when the ending changes
          let before: string | undefined;
          if (action === 'create') {
            const r = await createService(spec);
            if (!r.ok) { problems.push(`«${row.title}»: ${r.message}`); continue; }
          } else {
            // the version as it is now - as for a process
            const cur = await loadService(item.slug);
            if (!cur) { problems.push(`«${row.title}» gibt es hier nicht mehr`); continue; }
            if (cur.version !== row.existing?.version) { problems.push(`«${row.title}» wurde hier inzwischen geändert - nicht überschrieben, nochmals einfügen`); continue; }
            before = isCollection(cur.data) ? cur.data.source?.stored : undefined;
            const r = await saveService(spec, cur.version);
            if (r.status !== 'saved') { problems.push(`«${row.title}»: ${saveProblem(r)}`); continue; }
          }
          if (item.openApi && !(await saveOpenApi(item.slug, item.openApi, before))) {
            problems.push(`«${row.title}» ${action === 'create' ? 'angelegt' : 'überschrieben'}, aber die OpenAPI nicht`);
            continue;
          }
        }
        done.push(row.title);
      }
      // what went wrong stays in sight - with what was written all the same; the lists show it
      if (problems.length) { setError([...(done.length ? [`Eingefügt: ${done.join(', ')}`] : []), ...problems].join(' · ')); if (done.length) onWritten?.(); return; }
      onDone(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const nothing = !plan || plan.rows.every(r => actionOf(r.item.slug, r.action) === 'skip');
  return (
    <div className={`mb-4 rounded border ${c.border} ${isDark ? 'bg-white/5' : 'bg-black/5'} px-3 py-2 space-y-2`}>
      <div className="flex items-center gap-2">
        <ClipboardPaste size={12} className={c.muted2} />
        <span className={`text-[11px] font-semibold ${c.text}`}>Einfügen</span>
        <span className={`text-[10px] ${c.muted}`}>was in einer anderen Orch Spec mit «Kopieren» kopiert wurde</span>
        <button onClick={onClose} className={`ml-auto p-0.5 rounded ${c.btn}`} title="Schliessen"><X size={12} /></button>
      </div>
      {!transfer && (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="Hier einfügen (Cmd/Ctrl+V)"
            className={`w-full text-[10px] font-mono rounded border px-2 py-1 ${c.input}`} />
          <button onClick={fromClipboard} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border ${c.btn}`}>
            <ClipboardPaste size={12} /> Aus der Zwischenablage
          </button>
        </>
      )}
      {read && 'error' in read && <p className={`text-[10px] ${warn}`}><AlertTriangle size={10} className="inline mr-1 -mt-0.5" />{read.error}</p>}
      {plan && (
        <>
          <ul className="space-y-1">
            {plan.rows.map(r => (
              <li key={r.item.slug} className="flex items-center gap-2 text-[11px]">
                <span className={`text-[10px] uppercase tracking-wide w-20 ${c.muted2}`}>{r.item.kind === 'process' ? (r.item.spec.service ? 'Orchestr.' : 'Prozess') : 'Collection'}</span>
                <span className={c.text}>{r.title}</span>
                <span className={`text-[10px] font-mono ${c.muted}`}>{r.item.slug}</span>
                <select value={actionOf(r.item.slug, r.action)} onChange={e => setActions(a => ({ ...a, [r.item.slug]: e.target.value as PasteAction }))}
                  className={`ml-auto text-[10px] px-1 py-0.5 rounded border ${c.input}`}>
                  {r.existing
                    ? <><option value="overwrite">überschreiben (hier geändert {r.existing.updatedAt?.slice(0, 10) ?? '?'})</option><option value="skip">auslassen</option></>
                    : <><option value="create">neu anlegen</option><option value="skip">auslassen</option></>}
                </select>
              </li>
            ))}
          </ul>
          {(!!plan.typeMappers.length || !!plan.patterns.length) && (
            <p className={`text-[10px] ${c.muted2}`}>
              Kommt mit: {[...plan.typeMappers.map(m => `Typ-Mapper ${m.name?.trim() || m.id}`), ...plan.patterns.map(p => `Pattern ${String(p.name ?? p.id)}`)].join(', ')}
            </p>
          )}
          {!!plan.differing.length && <p className={`text-[10px] ${warn}`}>Hier anders, bleibt wie hier: {plan.differing.join(', ')}</p>}
          {plan.hints.map((h, i) => <p key={i} className={`text-[10px] ${warn}`}><AlertTriangle size={10} className="inline mr-1 -mt-0.5" />{h}</p>)}
        </>
      )}
      {error && <p className={`text-[10px] ${warn}`}><AlertTriangle size={10} className="inline mr-1 -mt-0.5" />{error}</p>}
      {plan && (
        <div className="flex items-center gap-2">
          {busy && <span className={`text-[10px] flex items-center gap-1 ${c.muted2}`}><Loader2 size={10} className="animate-spin" /> {busy}</span>}
          <button onClick={() => { setText(''); setActions({}); setError(''); }} disabled={!!busy} className={`text-[11px] px-2.5 py-1 rounded border disabled:opacity-40 ${c.btn}`}>Anderes einfügen</button>
          <button onClick={() => void apply()} disabled={nothing || !!busy}
            className={`ml-auto text-[11px] px-2.5 py-1 rounded border border-transparent disabled:opacity-40 ${c.btnPrimary}`}>
            Übernehmen
          </button>
        </div>
      )}
    </div>
  );
}
