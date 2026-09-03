import { useState } from 'react';
import { useDerived } from '../data';
import { InlineMd, Markdown } from '../markdown';
import { href } from '../router';
import type { CompanyDocs, ReleaseTable } from '../types';
import { Card, Empty, ExtLink, PageTitle, ProjectChip, ReleaseStatus, Section, cls } from '../ui';

function DepTable({ t, docs, isDark }: { t: ReleaseTable; docs: CompanyDocs; isDark: boolean }) {
  const c = cls(isDark);
  const { byName } = useDerived(docs);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const rows = onlyChanged ? t.rows.filter(r => r.status !== 'unchanged') : t.rows;
  return (
    <Section title={t.title} isDark={isDark}
      right={<label className={`flex items-center gap-1.5 text-[10px] cursor-pointer ${c.muted2}`}>
        <input type="checkbox" checked={onlyChanged} onChange={e => setOnlyChanged(e.target.checked)} /> only changed
      </label>}>
      <Card isDark={isDark} className="overflow-x-auto">
        <table className="text-[10.5px] border-collapse w-full">
          <thead>
            <tr className={`${c.muted2}`}>
              <th className="text-left font-semibold px-3 py-2 sticky left-0 bg-inherit">Package</th>
              <th className="text-left font-semibold px-2 py-2">Version</th>
              <th className="text-left font-semibold px-2 py-2 whitespace-nowrap">Previous</th>
              {t.columns.map(col => (
                <th key={col.project} className="font-semibold px-2 py-2 text-center align-bottom">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{col.project}</span>
                    <span className={`${c.muted} font-normal`}>{col.version}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.project} className={`border-t ${c.border} ${c.hover}`}>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <ProjectChip name={r.project} color={byName.get(r.project)?.color} isDark={isDark}
                    href={byName.get(r.project)?.hasDependencies ? href.dependencies(docs.company, r.project) : undefined} />
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <span className={r.status !== 'unchanged' ? 'font-bold' : ''}>{r.version}</span>
                  <span className="ml-1.5"><ReleaseStatus status={r.status} isDark={isDark} /></span>
                </td>
                <td className={`px-2 py-1.5 whitespace-nowrap ${c.muted}`}>{r.previousVersion}</td>
                {t.columns.map(col => {
                  const v = r.uses[col.project];
                  const outdated = v && v !== col.version;
                  return (
                    <td key={col.project} className={`px-2 py-1.5 text-center whitespace-nowrap ${
                      outdated ? (isDark ? 'text-amber-300' : 'text-amber-700') : c.muted2}`}
                      title={outdated ? `uses ${v}, release has ${col.version}` : undefined}>
                      {v ? (outdated ? v : '●') : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className={`text-[10px] mt-2 ${c.muted}`}>● uses the release version · a number marks an older version in use</p>
    </Section>
  );
}

export default function Release({ docs, isDark }: { docs: CompanyDocs; isDark: boolean }) {
  const c = cls(isDark);
  const { byName } = useDerived(docs);
  const r = docs.release;
  const notes = docs.releaseNotes.filter(n => n.groups.length);
  return (
    <div>
      <PageTitle isDark={isDark} title={`Release ${r.tag}`}
        meta={<>
          {!r.released && <span className="italic">preview — not yet released</span>}
          {r.approvedBy && <span>approved by {r.approvedBy.name} · {r.approvedBy.date}</span>}
          <span>created {r.createdDay}</span>
          {r.jiraUrl && <ExtLink href={r.jiraUrl} isDark={isDark}>JIRA release planning</ExtLink>}
        </>} />

      {r.notes && (
        <Section title="Summary" isDark={isDark}>
          <Card isDark={isDark} className="p-4"><Markdown text={r.notes} /></Card>
        </Section>
      )}

      {docs.releaseTables.map(t => <DepTable key={t.kind} t={t} docs={docs} isDark={isDark} />)}

      <Section title="Release Notes" isDark={isDark}
        right={<span className={`text-[10px] ${c.muted}`}>from the projects' change logs</span>}>
        {!notes.length && <Empty isDark={isDark}>No changes in this release.</Empty>}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {notes.map(n => <ProjectChip key={n.project} name={n.project} color={byName.get(n.project)?.color} isDark={isDark} href={`#${window.location.hash.slice(1).split('#')[0]}`} onClick={() => document.getElementById(`notes-${n.project}`)?.scrollIntoView({ behavior: 'smooth' })} />)}
        </div>
        <div className="space-y-4">
          {notes.map(n => (
            <Card key={n.project} isDark={isDark} className="p-4 scroll-mt-4" style={undefined}>
              <div id={`notes-${n.project}`} className="flex items-center gap-3 mb-3 scroll-mt-4">
                <ProjectChip name={n.project} color={byName.get(n.project)?.color} isDark={isDark} size="md"
                  href={byName.get(n.project)?.hasDependencies ? href.dependencies(docs.company, n.project) : undefined} />
                <a href={href.api(docs.company, n.project)} className={`text-[10px] ${c.link}`}>API Doc</a>
              </div>
              {n.groups.map(g => (
                <div key={g.name} className="mb-3 last:mb-0">
                  <div className={`text-[10px] uppercase tracking-widest mb-1.5 ${c.muted}`}>{g.name}</div>
                  <div className="space-y-2">
                    {g.tickets.map((t, i) => (
                      <div key={i} className={`grid grid-cols-[7rem_1fr] gap-2 text-[11px]`}>
                        <div className="whitespace-nowrap">
                          {t.url ? <ExtLink href={t.url} isDark={isDark}>{t.ticket}</ExtLink> : <span className={c.muted}>{t.ticket ?? '—'}</span>}
                        </div>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {t.entries.map((e, j) => <li key={j}><InlineMd text={e} /></li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}
