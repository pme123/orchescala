import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useDerived } from '../data';
import { href, navigate } from '../router';
import type { CompanyDocs } from '../types';
import { Card, Empty, PageTitle, ProjectChip, Section, cls } from '../ui';
import DepGraph from './DepGraph';

export default function Dependencies({ docs, isDark, project }: { docs: CompanyDocs; isDark: boolean; project?: string }) {
  const c = cls(isDark);
  const { byName, dependsOn, usedBy } = useDerived(docs);
  const p = project ? byName.get(project) : undefined;
  const dep = project ? docs.dependencies.find(d => d.project === project) : undefined;
  const withPages = docs.projects.filter(x => x.hasDependencies);

  const chipList = (list: { project: string; version: string }[] | undefined) => (
    !list?.length ? <Empty isDark={isDark}>none</Empty> :
    <div className="flex flex-wrap gap-1.5">
      {[...list].sort((a, b) => a.project.localeCompare(b.project)).map(d => (
        <ProjectChip key={d.project} name={d.project} version={d.version} color={byName.get(d.project)?.color} isDark={isDark} size="md"
          href={byName.get(d.project)?.hasDependencies ? href.dependencies(docs.company, d.project) : undefined} />
      ))}
    </div>
  );

  return (
    <div>
      <PageTitle isDark={isDark}
        title={p ? <span className="flex items-center gap-3">{p.name}
          {dep?.version && <span className={`text-sm font-normal ${c.muted}`}>{dep.version}</span>}</span> : 'Dependencies'}
        meta={p ? <>
          <span>{p.group}</span>
          {dep?.preview && <span className="italic">preview to the next release</span>}
          <a href={href.api(docs.company, p.name)} className={c.link}>API Documentation</a>
        </> : <span>Which project uses which — select a project in the graph or the list.</span>} />

      <Section title="Graph" isDark={isDark}
        right={p && <a href={href.dependencies(docs.company)} className={`text-[10px] ${c.link}`}>show all</a>}>
        <Card isDark={isDark} className="p-3 overflow-x-auto">
          <DepGraph docs={docs} isDark={isDark} focus={project} onSelect={n => navigate(href.dependencies(docs.company, n))} />
        </Card>
      </Section>

      {p ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Section isDark={isDark} title={<span className="flex items-center gap-1.5"><ArrowDownToLine size={11} /> depends on</span>}>
            {chipList(dep?.dependsOn ?? dependsOn.get(p.name))}
          </Section>
          <Section isDark={isDark} title={<span className="flex items-center gap-1.5"><ArrowUpFromLine size={11} /> used by</span>}>
            {chipList(usedBy.get(p.name))}
          </Section>
        </div>
      ) : (
        <Section title="Projects" isDark={isDark}>
          <Card isDark={isDark} className="overflow-x-auto">
            <table className="text-[11px] w-full">
              <thead><tr className={c.muted2}>
                <th className="text-left font-semibold px-3 py-2">Project</th>
                <th className="text-left font-semibold px-2 py-2">Version</th>
                <th className="text-left font-semibold px-2 py-2">depends on</th>
                <th className="text-left font-semibold px-2 py-2">used by</th>
              </tr></thead>
              <tbody>
                {withPages.map(x => {
                  const d = docs.dependencies.find(dd => dd.project === x.name);
                  return (
                    <tr key={x.name} className={`border-t ${c.border} ${c.hover}`}>
                      <td className="px-3 py-1.5"><ProjectChip name={x.name} color={x.color} isDark={isDark} href={href.dependencies(docs.company, x.name)} /></td>
                      <td className={`px-2 py-1.5 ${c.muted2}`}>{d?.version}{d?.preview && <span className={`ml-1 italic ${c.muted}`}>preview</span>}</td>
                      <td className="px-2 py-1.5"><div className="flex flex-wrap gap-1">{(d?.dependsOn ?? []).map(u =>
                        <ProjectChip key={u.project} name={u.project} version={u.version} color={byName.get(u.project)?.color} isDark={isDark} />)}</div></td>
                      <td className="px-2 py-1.5"><div className="flex flex-wrap gap-1">{(usedBy.get(x.name) ?? []).map(u =>
                        <ProjectChip key={u.project} name={u.project} color={byName.get(u.project)?.color} isDark={isDark} href={href.dependencies(docs.company, u.project)} />)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </Section>
      )}
    </div>
  );
}
