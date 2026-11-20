// The dialogs of the runs (E25) - a chunk of their own, loaded when one opens:
//   - the preview before «Auf Testumgebung» (P12): on the left what is new in the spec (spec with spec,
//     specDiff.ts), on the right what the merge will do in the code and whether there are conflicts; the
//     first run of a work asks for its name;
//   - the run: the status of every step, what failed with its log, go on or cancel;
//   - «Übergeben»: the pull request.
import { AlertTriangle, Check, Circle, ExternalLink, GitPullRequest, Info, Loader2, Lock, Play, Rocket, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuthor } from '../auth';
import { diffSpecFolders, formatSpecDiff, isEmptyDiff, type SpecDiff } from '../specDiff';
import { useStore } from '../store';
import { cls } from '../ui';
import { collectSpec, memoryFolder } from './collect';
import { callPlatform, driftForCommit, driftNote, duration, PLAN_ACTION, planLine, platformPath, runOpen, WORK_NAME, type PlatformProject, type Preview, type ProjectStatus, type RunStatus, type RunStep } from './config';
import type { RunDialog } from './RunControls';

type Props = {
  isDark: boolean;
  project: PlatformProject;
  value: ProjectStatus;
  dialog: RunDialog;
  mayEdit: boolean;
  onDialog: (d: RunDialog | null) => void;
  onValue: (v: ProjectStatus) => void;
  onRefresh: () => Promise<void>;
};

/** The editors save a second after the last change - the preview takes the folder after that. */
const SAVE_WAIT_MS = 1200;
const ACTION = PLAN_ACTION;

function Shell({ isDark, icon, title, wide, busy, onClose, children, footer }: {
  isDark: boolean; icon: React.ReactNode; title: string; wide?: boolean; busy?: boolean; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  const c = cls(isDark);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-label={title} className={`${wide ? 'max-w-4xl' : 'max-w-lg'} w-full max-h-full flex flex-col rounded-xl border ${c.border2} ${c.panelStrong}`} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center gap-2 px-5 py-3 border-b ${c.border}`}>
          <span className={c.muted2}>{icon}</span>
          <h3 className={`text-sm font-semibold flex-1 ${c.text}`}>{title}</h3>
          <button onClick={onClose} disabled={busy} title="Schliessen" className={`p-1 rounded ${c.muted} hover:opacity-100 disabled:opacity-30`}><X size={14} /></button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-auto">{children}</div>
        <div className={`flex items-center gap-2 px-5 py-3 border-t ${c.border}`}>{footer}</div>
      </div>
    </div>
  );
}

const Problem = ({ isDark, text }: { isDark: boolean; text: string }) => (
  <p className={`flex items-start gap-1.5 text-[11px] px-2 py-1 rounded border whitespace-pre-wrap ${isDark ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-rose-300 bg-rose-50 text-rose-700'}`}>
    <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> <span>{text}</span>
  </p>
);

function PreviewDialog(p: Props) {
  const c = cls(p.isDark);
  const { getBackend } = useStore();
  const author = useAuthor();
  const [loaded, setLoaded] = useState<{ preview: Preview; diff: SpecDiff; skipped: string[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useState('');
  const [summary, setSummary] = useState('');

  useEffect(() => {
    const gone = { value: false };
    void (async () => {
      const be = getBackend();
      if (!be) return setError('Kein Ordner offen.');
      await new Promise(done => setTimeout(done, SAVE_WAIT_MS));
      const { files, skipped } = await collectSpec(be);
      const r = await callPlatform<Preview>(platformPath(p.project.name, 'preview'), { files });
      if (gone.value) return;
      if ('error' in r) return setError(r.error);
      setLoaded({ preview: r.ok, diff: diffSpecFolders(memoryFolder(r.ok.before), memoryFolder(files)), skipped });
    })().catch((e: unknown) => { if (!gone.value) setError(e instanceof Error ? e.message : String(e)); });
    return () => { gone.value = true; };
    // once, when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plan = loaded?.preview.plan ?? null;
  const first = !!loaded && loaded.preview.work === null;
  const name = first ? work.trim() : loaded?.preview.work ?? '';
  const changes = !!loaded && (!isEmptyDiff(loaded.diff) || Object.entries(plan?.summary ?? {}).some(([action, n]) => action !== 'unchanged' && n > 0));
  const diffText = loaded ? formatSpecDiff(loaded.diff).trimEnd() : '';
  // what the merge changes although the RE did not: the project's code and spec were not in sync
  const drift = driftNote(plan?.files ?? []);
  const start = async () => {
    if (!loaded) return;
    setBusy(true);
    setError('');
    const r = await callPlatform<ProjectStatus>(platformPath(p.project.name, 'test'), {
      previewId: loaded.preview.previewId,
      ...(first ? { work: name } : {}),
      // the commit: what the RE wrote, what changed in the spec - and what changes without that
      summary: [summary.trim() || `Orch Spec: ${name}`, '', diffText, ...(drift ? ['', driftForCommit(plan?.files ?? [])] : [])].join('\n'),
      ...(author.email ? { author: { name: author.name, email: author.email } } : {}),
    });
    setBusy(false);
    if ('error' in r) return setError(r.error);
    p.onValue(r.ok);
    p.onDialog('run');
  };
  const heading = `text-[10px] uppercase tracking-wider ${c.muted}`;
  return (
    <Shell isDark={p.isDark} wide icon={<Rocket size={14} />} busy={busy} onClose={() => p.onDialog(null)}
      title={`Auf die Testumgebung – ${loaded?.preview.work ?? p.project.name}`}
      footer={<>
        <button onClick={() => p.onDialog(null)} disabled={busy} className={`text-xs px-3 py-2 rounded border transition-colors disabled:opacity-40 ${c.btn}`}>Abbrechen</button>
        <button onClick={() => void start()} disabled={busy || !loaded || !changes || (first && !WORK_NAME.test(name))}
          className={`ml-auto flex items-center gap-1.5 text-xs px-4 py-2 rounded font-semibold transition-colors disabled:opacity-40 ${c.btnPrimary}`}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />} Auf Testumgebung
        </button>
      </>}>
      {!loaded && !error && (
        <p className={`flex items-center gap-2 text-[11px] ${c.muted2}`}><Loader2 size={12} className="animate-spin" /> Das Studio vergleicht die Spez mit dem Code des Projekts «{p.project.name}» …</p>
      )}
      {loaded && (
        <>
          <div className="grid gap-4 min-[800px]:grid-cols-2">
            <div className="space-y-1 min-w-0">
              <div className={heading}>Fachlich</div>
              <pre data-run="diff" className={`text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-72 overflow-auto ${c.text}`}>{diffText}</pre>
            </div>
            <div className="space-y-1 min-w-0">
              <div className={heading}>Technisch</div>
              <p data-run="plan" className={`text-[11px] ${c.text}`}>{plan ? planLine(plan.summary) : 'Das Studio hat keinen Plan des Merge.'}</p>
              {!!plan?.conflicts.length && (
                <div className={`text-[11px] rounded border px-2 py-1 ${p.isDark ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-amber-400 bg-amber-50 text-amber-800'}`}>
                  <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={12} /> {plan.conflicts.length === 1 ? 'Ein Konflikt' : `${plan.conflicts.length} Konflikte`} – die Entwicklung muss helfen</div>
                  {plan.conflicts.map(f => <div key={f} className="font-mono text-[10px] break-all">{f}</div>)}
                </div>
              )}
              {drift && (
                <div data-run="drift" className={`flex items-start gap-1.5 text-[11px] rounded border px-2 py-1 ${p.isDark ? 'border-sky-400/40 bg-sky-400/10 text-sky-200' : 'border-sky-400 bg-sky-50 text-sky-800'}`}>
                  <Info size={12} className="mt-0.5 flex-shrink-0" /> <span>{drift}</span>
                </div>
              )}
              {!!plan?.files.length && (
                <details className={`text-[10px] ${c.muted2}`}>
                  <summary className="cursor-pointer">Dateien</summary>
                  {plan.files.map(f => (
                    <div key={f.path} className="font-mono break-all">
                      {ACTION[f.action] ?? f.action}: {f.path}
                      {f.drift && <span className="font-sans italic"> – {f.drift === 'only' ? 'nicht von dieser Änderung' : 'wich schon vorher ab'}</span>}
                    </div>
                  ))}
                </details>
              )}
              {!!loaded.skipped.length && (
                <p className={`text-[10px] ${c.muted}`}>Nicht übertragen (keine Textdatei): {loaded.skipped.join(', ')}</p>
              )}
            </div>
          </div>
          {!changes && <p className={`text-[11px] ${c.muted2}`}>Die Spez ist gleich wie im Projekt – es gibt nichts zu übernehmen.</p>}
          {changes && (
            <div className="grid gap-3 min-[800px]:grid-cols-2">
              {first && (
                <label className="space-y-1 block">
                  <span className={heading}>Name der Arbeit</span>
                  <input value={work} onChange={e => setWork(e.target.value)} placeholder="termin-filiale" autoFocus
                    className={`w-full text-xs px-2 py-1.5 rounded border outline-none font-mono ${c.input}`} />
                  <span className={`block text-[10px] ${c.muted}`}>Klein, mit Ziffern und «-». Daraus wird der Arbeits-Branch orch-spec/{p.project.name}/{name || '…'}.</span>
                </label>
              )}
              <label className="space-y-1 block">
                <span className={heading}>Kurz, was sich ändert</span>
                <input value={summary} onChange={e => setSummary(e.target.value)} placeholder={`Orch Spec: ${name || '…'}`}
                  className={`w-full text-xs px-2 py-1.5 rounded border outline-none ${c.input}`} />
                <span className={`block text-[10px] ${c.muted}`}>Wird mit dem Vergleich links zur Commit-Meldung.</span>
              </label>
            </div>
          )}
          <p className={`flex items-center gap-1.5 text-[10px] ${c.muted}`}><Lock size={10} /> Während des Laufs ist die Spez gesperrt.</p>
        </>
      )}
      {error && <Problem isDark={p.isDark} text={error} />}
    </Shell>
  );
}

function StepRow({ isDark, step }: { isDark: boolean; step: RunStep }) {
  const c = cls(isDark);
  const icon = step.state === 'ok' ? <Check size={12} className={isDark ? 'text-emerald-300' : 'text-emerald-600'} />
    : step.state === 'running' ? <Loader2 size={12} className={`animate-spin ${isDark ? 'text-sky-300' : 'text-sky-600'}`} />
    : step.state === 'failed' ? <AlertTriangle size={12} className={isDark ? 'text-rose-300' : 'text-rose-600'} />
    : <Circle size={10} className={c.muted} />;
  return (
    <div data-step={step.state} className={`flex items-center gap-2 text-[11px] ${step.state === 'pending' ? c.muted : c.text}`}>
      <span className="w-4 flex justify-center">{icon}</span>
      <span className="flex-1">{step.name}</span>
      <span className={`text-[10px] ${c.muted}`}>
        {step.durationMs !== undefined && step.state !== 'pending' ? duration(step.durationMs) : step.expectedMs ? `ca. ${duration(step.expectedMs)}` : ''}
      </span>
    </div>
  );
}

/** The bar: one part per step, as wide as the step took the last time. */
function Bar({ isDark, steps }: { isDark: boolean; steps: RunStep[] }) {
  const known = steps.flatMap(s => (s.expectedMs ? [s.expectedMs] : []));
  const usual = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const color = (s: RunStep) => s.state === 'ok' ? 'bg-emerald-500' : s.state === 'running' ? 'bg-sky-500 animate-pulse' : s.state === 'failed' ? 'bg-rose-500' : isDark ? 'bg-white/10' : 'bg-black/10';
  return (
    <div className="flex gap-0.5 h-1.5 rounded overflow-hidden">
      {steps.map(s => <div key={s.name} title={s.name} className={color(s)} style={{ flexGrow: Math.max(s.expectedMs ?? usual, usual / 20) }} />)}
    </div>
  );
}

function RunStatusDialog(p: Props & { status: RunStatus }) {
  const c = cls(p.isDark);
  const s = p.status;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const call = async (what: 'continue' | 'cancel') => {
    setBusy(true);
    setError('');
    const r = await callPlatform<ProjectStatus>(platformPath(p.project.name, what), {});
    setBusy(false);
    if ('error' in r) return setError(r.error);
    p.onValue(r.ok);
  };
  const count = (what: string, n: RunStatus['tests']) => (n ? `${n.passed} ${what} ok${n.failed ? `, ${n.failed} fehlgeschlagen` : ''}` : null);
  const facts = [count('Tests', s.tests), count('Simulationen', s.simulations), s.version ? `Version ${s.version}` : null].filter(Boolean).join(' · ');
  const title = s.state === 'running' ? 'Auf die Testumgebung – läuft' : s.state === 'waiting' ? 'Auf die Testumgebung – wartet'
    : s.state === 'ok' ? 'Auf der Testumgebung' : 'Auf die Testumgebung – abgebrochen';
  return (
    <Shell isDark={p.isDark} icon={<Rocket size={14} />} title={title} busy={busy} onClose={() => p.onDialog(null)}
      footer={<>
        <button onClick={() => p.onDialog(null)} disabled={busy} className={`text-xs px-3 py-2 rounded border transition-colors disabled:opacity-40 ${c.btn}`}>Schliessen</button>
        {s.state === 'waiting' && p.mayEdit && (
          <>
            <button onClick={() => void call('cancel')} disabled={busy} title="Den Lauf aufgeben: Die Spez ist wieder frei, der Arbeits-Branch bleibt"
              className={`ml-auto text-xs px-3 py-2 rounded border transition-colors disabled:opacity-40 ${c.btn}`}>Lauf abbrechen</button>
            <button onClick={() => void call('continue')} disabled={busy} title="Nach der Korrektur auf dem Arbeits-Branch"
              className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded font-semibold transition-colors disabled:opacity-40 ${c.btnPrimary}`}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Fortsetzen
            </button>
          </>
        )}
        {s.state === 'ok' && p.mayEdit && p.project.handOver && (
          <button onClick={() => p.onDialog('handOver')}
            className={`ml-auto flex items-center gap-1.5 text-xs px-4 py-2 rounded font-semibold transition-colors ${c.btnPrimary}`}>
            <GitPullRequest size={12} /> Übergeben
          </button>
        )}
      </>}>
      <p className={`text-[11px] ${c.muted2}`}>
        Arbeit «{s.work}» · <span className="font-mono">{s.workBranch}</span> · Lauf {s.runId}
      </p>
      <Bar isDark={p.isDark} steps={s.steps} />
      <div className="space-y-1">{s.steps.map(step => <StepRow key={step.name} isDark={p.isDark} step={step} />)}</div>
      {facts && <p data-run="facts" className={`text-[11px] ${c.text}`}>{facts}</p>}
      {(s.testUrl || s.pullRequest) && (
        <p className="flex flex-wrap gap-3 text-[11px]">
          {s.testUrl && <a href={s.testUrl} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 underline ${c.text}`}><ExternalLink size={11} /> Test-Umgebung</a>}
          {s.pullRequest && <a href={s.pullRequest.url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 underline ${c.text}`}><GitPullRequest size={11} /> Pull Request{s.pullRequest.merged ? ' (gemergt)' : ''}</a>}
        </p>
      )}
      {runOpen(s) && <p className={`flex items-center gap-1.5 text-[10px] ${c.muted}`}><Lock size={10} /> Die Spez ist gesperrt, bis der Lauf endet.</p>}
      {s.error && (
        <div className="space-y-1.5">
          <Problem isDark={p.isDark} text={`${s.error.step}: ${s.error.message}`} />
          {s.error.conflicts.map(f => <div key={f} className={`font-mono text-[10px] break-all ${c.muted2}`}>Konflikt: {f}</div>)}
          {s.state === 'waiting' && (
            <p className={`text-[11px] ${c.muted2}`}>
              Der Lauf wartet auf die Entwicklung: Sie behebt es auf dem Arbeits-Branch, danach «Fortsetzen».
            </p>
          )}
          {s.error.log && (
            <details className={`text-[10px] ${c.muted2}`}>
              <summary className="cursor-pointer">Log</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono">{s.error.log}</pre>
            </details>
          )}
        </div>
      )}
      {error && <Problem isDark={p.isDark} text={error} />}
    </Shell>
  );
}

function HandOverDialog(p: Props) {
  const c = cls(p.isDark);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pr = p.value.work?.pullRequest ?? null;
  const [done, setDone] = useState(false);
  const handOver = async () => {
    setBusy(true);
    setError('');
    const r = await callPlatform<ProjectStatus>(platformPath(p.project.name, 'hand-over'), {});
    setBusy(false);
    if ('error' in r) return setError(r.error);
    p.onValue(r.ok);
    setDone(true);
  };
  return (
    <Shell isDark={p.isDark} icon={<GitPullRequest size={14} />} title={`Übergeben – ${p.value.work?.work ?? ''}`} busy={busy} onClose={() => p.onDialog(null)}
      footer={<>
        <button onClick={() => p.onDialog(null)} disabled={busy} className={`text-xs px-3 py-2 rounded border transition-colors disabled:opacity-40 ${c.btn}`}>{done ? 'Schliessen' : 'Abbrechen'}</button>
        {!done && (
          <button onClick={() => void handOver()} disabled={busy}
            className={`ml-auto flex items-center gap-1.5 text-xs px-4 py-2 rounded font-semibold transition-colors disabled:opacity-40 ${c.btnPrimary}`}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />} Übergeben
          </button>
        )}
      </>}>
      <p className={`text-[11px] leading-relaxed ${c.muted2}`}>
        Du hast auf der Test-Umgebung getestet und bist zufrieden: Das Studio legt den Pull Request nach develop an
        {pr ? ' – oder führt den bestehenden nach' : ''}. Die Entwicklung prüft und mergt ihn. Weitere Runden auf die Test-Umgebung bleiben möglich.
      </p>
      {pr && (
        <p className="text-[11px]">
          <a href={pr.url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 underline ${c.text}`}>
            <GitPullRequest size={11} /> Pull Request #{pr.number}{pr.merged ? ' (gemergt)' : ''}
          </a>
          {done && <span className={`ml-2 ${c.muted2}`}>ist übergeben.</span>}
        </p>
      )}
      {error && <Problem isDark={p.isDark} text={error} />}
    </Shell>
  );
}

export default function RunDialogs(p: Props) {
  if (p.dialog === 'preview') return <PreviewDialog {...p} />;
  if (p.dialog === 'handOver') return <HandOverDialog {...p} />;
  return p.value.status ? <RunStatusDialog {...p} status={p.value.status} /> : null;
}
