import { useMarkdown } from '../data';
import { Markdown } from '../markdown';
import type { CompanyDocs, Page } from '../types';
import { Card, Empty, cls } from '../ui';

export default function MdPage({ docs, page, isDark }: { docs: CompanyDocs; page: Page; isDark: boolean }) {
  const c = cls(isDark);
  const md = useMarkdown(`${docs.company}/${page.file}`);
  if (md.state === 'loading') return <p className={`text-[11px] ${c.muted}`}>Loading …</p>;
  if (md.state === 'error') return <Empty isDark={isDark}>{md.message}</Empty>;
  return (
    <Card isDark={isDark} className="p-6 max-w-4xl">
      <Markdown text={md.data} base={`${docs.company}/`} />
    </Card>
  );
}
