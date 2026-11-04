// One entry of `services/` — a collection, or an orchestration of before to take over into the process editor.
import { Loader2 } from 'lucide-react';
import { lazy } from 'react';
import { useStore } from '../store';
import { cls } from '../ui';
import { useServices } from './store';

const CollectionView = lazy(() => import('./CollectionView'));
const OrchestrationTakeOver = lazy(() => import('./OrchestrationTakeOver'));

export default function ServiceView({ slug, onBack, onOpenProcess }: { slug: string; onBack: () => void; onOpenProcess: (slug: string) => void }) {
  const { isDark } = useStore();
  const { services, servicesLoading } = useServices();
  const kind = services.find(s => s.slug === slug)?.data.kind;
  if (!kind && servicesLoading) {
    return <div className={`p-6 text-xs ${cls(isDark).muted} flex items-center gap-2`}><Loader2 size={12} className="animate-spin" /> Lade …</div>;
  }
  return kind === 'serviceOrchestration'
    ? <OrchestrationTakeOver key={slug} slug={slug} onBack={onBack} onOpenProcess={onOpenProcess} />
    : <CollectionView key={slug} slug={slug} onBack={onBack} />;
}
