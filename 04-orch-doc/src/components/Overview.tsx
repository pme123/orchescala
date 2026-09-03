import { BookOpen, Boxes, FileText, GitFork, Network } from 'lucide-react';
import { useDerived } from '../data';
import { Markdown } from '../markdown';
import { href } from '../router';
import type { CompanyDocs } from '../types';
import { Card, PageTitle, ProjectChip, Section, cls, groupColor } from '../ui';
import DepGraph from './DepGraph';

export default function Overview({ docs, isDark }: { docs: CompanyDocs; isDark: boolean }) {
  const c = cls(isDark);
  const { usedBy, dependsOn } = useDerived(docs);
  const r = docs.release;
  const counts = {
    processes: docs.catalog.reduce((s, p) => s + p.entries.filter(e => e.kind === 'Bpmn').length, 0),
    workers: docs.catalog.reduce((s, p) => s + p.entries.filter(e => e.kind === 'Worker').length, 0),
    projects: docs.projects.filter(p => !p.external).length,
  };
  return (
    <div>
      <PageTitle isDark={isDark} title={docs.title}
        meta={<>
          <span>Release <b className={c.text}>{r.tag}</b>{!r.released && <span className="ml-1 italic">(preview)</span>}</span>
          {r.approvedBy && <span>approved by {r.approvedBy.name} · {r.approvedBy.date}</span>}
          <span>created {r.createdDay}</span>
        </>}
        right={<>
          <a href={href.catalog(docs.company)} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}><BookOpen size={12} /> Catalog</a>
          <a href={href.release(docs.company)} className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border ${c.btn}`}><FileText size={12} /> Release</a>
        </>} />

      {/* key figures */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { n: counts.projects, l: 'projects', i: Boxes, h: href.dependencies(docs.company) },
          { n: counts.processes, l: 'processes', i: GitFork, h: href.catalog(docs.company, 'Process') },
          { n: counts.workers, l: 'workers', i: Network, h: href.catalog(docs.company, 'Worker') },
          { n: docs.releaseNotes.filter(n => n.groups.length).length, l: 'changed in release', i: FileText, h: href.release(docs.company) },
        ].map(k => (
          <a key={k.l} href={k.h} className={`rounded-lg border p-3 ${c.border} ${c.panelStrong} ${c.hover} transition-colors`}>
            <div className="flex items-center gap-2">
              <k.i size={13} className={c.muted} />
              <span className={`text-xl font-bold ${c.text}`}>{k.n}</span>
            </div>
            <div className={`text-[10px] uppercase tracking-widest mt-1 ${c.muted}`}>{k.l}</div>
          </a>
        ))}
      </div>

      {r.notes && (
        <Section title={`Release ${r.tag}`} isDark={isDark}
          right={<a href={href.release(docs.company)} className={`text-[10px] ${c.link}`}>details →</a>}>
          <Card isDark={isDark} className="p-4"><Markdown text={r.notes} /></Card>
        </Section>
      )}

      <Section title="BPMN Projects" isDark={isDark}
        right={<span className={`text-[10px] ${c.muted}`}>hover: dependencies · click: details</span>}>
        <Card isDark={isDark} className="p-3 overflow-x-auto">
          <DepGraph docs={docs} isDark={isDark} />
        </Card>
      </Section>

      {docs.groups.map(g => {
        const ps = docs.projects.filter(p => p.group === g.name);
        if (!ps.length) return null;
        return (
          <Section key={g.name} title={<span style={{ color: groupColor(g.color, isDark) }}>{g.name}</span>} isDark={isDark}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ps.map(p => (
                <Card key={p.name} isDark={isDark} className="p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <ProjectChip name={p.name} color={p.color} isDark={isDark} size="md"
                      href={p.hasDependencies ? href.dependencies(docs.company, p.name) : undefined} />
                    {p.external && <span className={`text-[9px] ${c.muted}`}>external</span>}
                  </div>
                  <div className={`text-[10px] flex flex-wrap gap-x-3 ${c.muted2}`}>
                    {p.version && <span>bpmn <b>{p.version}</b></span>}
                    {p.workerVersion && <span>worker <b>{p.workerVersion}</b></span>}
                    {!p.version && !p.workerVersion && <span className="italic">no processes</span>}
                  </div>
                  <div className={`text-[10px] flex flex-wrap gap-x-3 mt-auto ${c.muted}`}>
                    <a href={href.api(docs.company, p.name)} className={c.link}>API Doc</a>
                    {p.hasDependencies && <a href={href.dependencies(docs.company, p.name)} className={c.link}>Dependencies</a>}
                    <span className="ml-auto">{dependsOn.get(p.name)?.length ?? 0} ↓ · {usedBy.get(p.name)?.length ?? 0} ↑</span>
                  </div>
                </Card>
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
