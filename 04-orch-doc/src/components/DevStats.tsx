import { useDerived } from '../data';
import { href } from '../router';
import type { CompanyDocs } from '../types';
import { Card, Empty, PageTitle, ProjectChip, Section, cls } from '../ui';

export default function DevStats({ docs, isDark }: { docs: CompanyDocs; isDark: boolean }) {
  const c = cls(isDark);
  const { byName } = useDerived(docs);
  if (!docs.devStats.length) return <Empty isDark={isDark}>No development statistics.</Empty>;
  return (
    <div>
      <PageTitle isDark={isDark} title="Development Statistics" meta={<span>files and lines of code per project and kind</span>} />
      <div className="grid gap-4 lg:grid-cols-2">
        {docs.devStats.map(s => {
          const max = Math.max(1, ...s.rows.map(r => r.lines));
          const rows = [...s.rows].sort((a, b) => b.lines - a.lines);
          return (
            <Section key={s.title} isDark={isDark} title={s.title}
              right={<span className={`text-[10px] ${c.muted}`}><b className={c.text}>{s.total.lines.toLocaleString()}</b> lines · {s.total.files} files</span>}>
              <Card isDark={isDark} className="p-3">
                <div className="space-y-1">
                  {rows.map(r => (
                    <div key={r.project} className="grid grid-cols-[11rem_1fr_6rem] items-center gap-2 text-[10px]">
                      <ProjectChip name={r.project} color={byName.get(r.project)?.color} isDark={isDark}
                        href={byName.get(r.project)?.hasDependencies ? href.dependencies(docs.company, r.project) : undefined} />
                      <div className={`h-2 rounded ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                        <div className={`h-2 rounded ${isDark ? 'bg-sky-400/60' : 'bg-sky-700/60'}`} style={{ width: `${(r.lines / max) * 100}%` }} />
                      </div>
                      <span className={`text-right ${r.lines ? c.muted2 : c.muted}`}>{r.lines.toLocaleString()} · {r.files}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>
          );
        })}
      </div>
    </div>
  );
}
