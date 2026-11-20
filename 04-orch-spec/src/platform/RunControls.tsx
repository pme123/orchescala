// The buttons of the runs in the header (E25): «Auf Testumgebung» and «Übergeben» - only when the studio
// has runs for the project of the open folder, and for who may edit. While a run is running or waiting,
// the buttons give way to its status, and the spec is locked. The dialogs are a chunk of their own.
import { AlertTriangle, Check, GitPullRequest, Loader2, Lock, Rocket } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { usePermissions } from '../auth';
import { HeaderButton } from '../components/Header';
import { useStore } from '../store';
import { projectOf, runLabel, runOpen } from './config';
import { usePlatformConfig, useProjectStatus } from './usePlatform';

const RunDialogs = lazy(() => import('./RunDialogs'));

export type RunDialog = 'preview' | 'run' | 'handOver';

export default function RunControls({ isDark }: { isDark: boolean }) {
  const config = usePlatformConfig();
  const { specs, pages } = useStore();
  const { mayEdit } = usePermissions();
  const project = projectOf(config, [...specs.map(s => s.data.project), ...pages.map(p => p.data.spec?.project)]);
  const { value, setValue, refresh } = useProjectStatus(project?.name);
  const [dialog, setDialog] = useState<RunDialog | null>(null);
  if (!project) return null;

  const { status, work } = value;
  const open = runOpen(status);
  const tone = !status ? ''
    : status.state === 'waiting' ? (isDark ? 'border-amber-400/50 text-amber-300' : 'border-amber-500/60 text-amber-700')
    : status.state === 'running' ? (isDark ? 'border-sky-400/50 text-sky-300' : 'border-sky-500/60 text-sky-700')
    : status.state === 'ok' ? (isDark ? 'border-emerald-400/40 text-emerald-300' : 'border-emerald-600/40 text-emerald-700')
    : (isDark ? 'border-white/15 text-white/50' : 'border-black/15 text-black/50');
  return (
    <>
      {status && (
        <button onClick={() => setDialog('run')} data-run-state={status.state}
          title={open ? 'Ein Lauf des Studios ist offen – die Spez ist gesperrt. Klick: der Stand jedes Schritts' : 'Der letzte Lauf auf die Test-Umgebung'}
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border max-w-[18rem] ${tone}`}>
          {status.state === 'running' ? <Loader2 size={12} className="animate-spin flex-shrink-0" />
            : status.state === 'waiting' ? <AlertTriangle size={12} className="flex-shrink-0" />
            : status.state === 'ok' ? <Check size={12} className="flex-shrink-0" /> : null}
          <span className="truncate">{runLabel(status)}</span>
          {open && <Lock size={10} className="flex-shrink-0 opacity-70" />}
        </button>
      )}
      {mayEdit && !open && (
        <HeaderButton isDark={isDark} icon={<Rocket size={12} />} label="Auf Testumgebung"
          title={`Die Spez dieses Ordners in das Projekt «${project.name}» bringen, bauen, testen und auf die Test-Umgebung`}
          onClick={() => setDialog('preview')} />
      )}
      {mayEdit && !open && project.handOver && !!work?.rounds.length && (
        <HeaderButton isDark={isDark} icon={<GitPullRequest size={12} />} label="Übergeben"
          title={`Getestet und zufrieden: der Pull Request der Arbeit «${work.work}»`}
          onClick={() => setDialog('handOver')} />
      )}
      {dialog && (
        <Suspense fallback={null}>
          <RunDialogs isDark={isDark} project={project} value={value} dialog={dialog} mayEdit={mayEdit}
            onDialog={setDialog} onValue={setValue} onRefresh={refresh} />
        </Suspense>
      )}
    </>
  );
}
