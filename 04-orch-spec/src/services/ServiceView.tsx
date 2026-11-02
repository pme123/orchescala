// One entry of `services/` — a collection or an orchestration, each with its own view.
import { Loader2 } from 'lucide-react';
import { lazy } from 'react';
import { useStore } from '../store';
import { cls } from '../ui';
import { useServices } from './store';

const CollectionView = lazy(() => import('./CollectionView'));
const OrchestrationView = lazy(() => import('./OrchestrationView'));

export default function ServiceView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { isDark } = useStore();
  const { services, servicesLoading } = useServices();
  const kind = services.find(s => s.slug === slug)?.data.kind;
  if (!kind && servicesLoading) {
    return <div className={`p-6 text-xs ${cls(isDark).muted} flex items-center gap-2`}><Loader2 size={12} className="animate-spin" /> Lade …</div>;
  }
  return kind === 'serviceOrchestration'
    ? <OrchestrationView key={slug} slug={slug} onBack={onBack} />
    : <CollectionView key={slug} slug={slug} onBack={onBack} />;
}
