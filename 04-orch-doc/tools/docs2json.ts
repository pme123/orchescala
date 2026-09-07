// CLI: an Orchescala `00-docs` folder (markdown) → orch-doc data.
//
//   node tools/docs2json.ts <path/to/00-docs> [--out site] [--company valiant] [--spec spec/]
//
// Reads CONFIG.conf, VERSIONS.conf and src/docs/*.md and writes
//   <out>/index.json                       list of companies (merged if it exists)
//   <out>/<company>/docs.json              everything the app renders
//   <out>/<company>/pages/*.md             hand-written pages (pattern, onboarding, …)
//   <out>/<company>/pattern/*.png          images referenced by the pages
//
// Orchescala's helper does the same in Scala (`DocsJson`, used by prepareDocs / publishDocs) -
// this tool stays for the app's own development (`npm run sample` / `npm run site`) and as the
// executable specification of the format: the helper's DocsJsonTest compares both outputs.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type {
  CatalogEntry, CatalogKind, CatalogProject, CompanyDocs, DevStatsSection, Page, Project, ProjectDependencies,
  ProjectGroup, ReleaseNotes, ReleaseRow, ReleaseTable, SiteIndex, CompanyRef,
} from '../src/types.ts';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const docsDir = args[0];
if (!docsDir || docsDir.startsWith('--') || !existsSync(join(docsDir, 'src/docs'))) {
  console.error('Usage: node tools/docs2json.ts <path/to/00-docs> [--out site] [--company valiant]');
  process.exit(1);
}
const out = opt('--out', 'site');
const spec = opt('--spec', '');   // where orch-spec is deployed, relative to the site root
const src = join(docsDir, 'src/docs');
const read = (f: string) => existsSync(join(src, f)) ? readFileSync(join(src, f), 'utf8') : '';

// ── CONFIG.conf ───────────────────────────────────────────────────────────────
const conf = existsSync(join(docsDir, 'CONFIG.conf')) ? readFileSync(join(docsDir, 'CONFIG.conf'), 'utf8') : '';
const confStr = (key: string) => conf.match(new RegExp(`^\\s*${key.replace('.', '\\.')}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
const releaseTag = confStr('release.tag') ?? 'unknown';
const released = /^\s*released\s*=\s*true/m.test(conf);
const olderReleases = (conf.match(/releases\.older\s*=\s*\[([^\]]*)\]/)?.[1] ?? '')
  .split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
const notes = conf.match(/release\.notes\s*=\s*"""([\s\S]*?)"""/)?.[1]?.trim() ?? '';
const respName = conf.match(/release\.responsible\s*\{[^}]*name\s*=\s*"([^"]*)"/)?.[1];
const respDate = conf.match(/release\.responsible\s*\{[^}]*date\s*=\s*"([^"]*)"/)?.[1];
const jiraUrl = confStr('jira.release.url');

// ── VERSIONS.conf: <camelProject>Version / <camelProject>WorkerVersion ────────
const versions = existsSync(join(docsDir, 'VERSIONS.conf')) ? readFileSync(join(docsDir, 'VERSIONS.conf'), 'utf8') : '';
const versionMap = new Map<string, string>();
for (const m of versions.matchAll(/^\s*(\w+)Version\s*=\s*"([^"]*)"/gm)) versionMap.set(m[1], m[2]);
const camel = (project: string) => project.split('-').map((p, i) => i ? p[0].toUpperCase() + p.slice(1) : p).join('');

// ── index.md: groups, projects, colors, graph ─────────────────────────────────
const index = read('index.md');
// company: --company, else `<company>-orchescala` from the repo folder, else the index.md title
const repoName = basename(resolve(docsDir, '..'));
const company = opt('--company',
  repoName.endsWith('-orchescala') ? repoName.slice(0, -'-orchescala'.length)
    : index.match(/^# (\w+)/m)?.[1]?.toLowerCase() ?? basename(docsDir));
const mdTitle = index.match(/^# (.+)$/m)?.[1]?.trim();
// some repos carry a copy-pasted title of another company — then build our own
const title = mdTitle?.toLowerCase().includes(company) ? mdTitle
  : `${company[0].toUpperCase() + company.slice(1)} Process Documentation`;
const createdDay = read('directory.conf').match(/created\.day\s*=\s*"([^"]*)"/)?.[1] ?? '';

const groupOrder: ProjectGroup[] = [];
const projectGroup = new Map<string, string>();
for (const m of index.matchAll(/subgraph (\S+)\s*\n([\s\S]*?)\n\s*end/g)) {
  const group = m[1];
  const color = index.match(new RegExp(`style ${group} fill:[^,]*,color:(\\w+)`))?.[1] ?? 'gray';
  groupOrder.push({ name: group, color });
  for (const p of m[2].matchAll(/([\w-]+)\(/g)) projectGroup.set(p[1], group);
}
const colors = new Map<string, string>();
for (const m of index.matchAll(/^\s*style ([\w-]+) fill:\s*(#[0-9a-fA-F]{3,6}|\w+)\s*$/gm)) colors.set(m[1], m[2]);
// direct edges: `a --> b & c` (only outside the subgraph blocks)
const graph: { from: string; to: string }[] = [];
for (const m of index.matchAll(/^\s*([\w-]+) --> ([\w\- &]+)$/gm))
  for (const to of m[2].split('&').map(s => s.trim()).filter(Boolean)) graph.push({ from: m[1], to });

// flat list of "- **project:** [API Doc](..) - [Dependencies](..)" tells us who has a dependency page
const hasDepPage = new Set<string>();
for (const m of index.matchAll(/\*\*([\w-]+):\*\*[^\n]*\[Dependencies\]/g)) hasDepPage.add(m[1]);

const projects: Project[] = [...projectGroup.keys()].map(name => {
  const external = !name.startsWith(company);
  return {
    name, group: projectGroup.get(name)!, color: colors.get(name) ?? 'white',
    version: versionMap.get(camel(name)) || undefined,
    workerVersion: versionMap.get(camel(name) + 'Worker') || undefined,
    // API docs of other companies live in their own folder: ../../swisscom/<p>/OpenApi.html
    apiDocUrl: external ? `../${name.split('-')[0]}/${name}/OpenApi.html` : `${name}/OpenApi.html`,
    external: external || undefined,
    hasDependencies: hasDepPage.has(name),
  };
});

// ── dependencies/<project>.md ─────────────────────────────────────────────────
const dependencies: ProjectDependencies[] = [];
const depDir = join(src, 'dependencies');
if (existsSync(depDir)) for (const f of readdirSync(depDir).filter(f => f.endsWith('.md')).sort()) {
  const md = readFileSync(join(depDir, f), 'utf8');
  const head = md.match(/^## ([\w-]+):([\w.]+)/m);
  if (!head) continue;
  const deps = md.match(/-->\s*\n([\s\S]*?)\n\s*\n/)?.[1] ?? '';
  dependencies.push({
    project: head[1], version: head[2],
    preview: /Preview to the next Release/.test(md) || undefined,
    // the graph block names the project itself too (its own node) - not a dependency
    dependsOn: [...deps.matchAll(/([\w-]+):([\w.]+)/g)].map(m => ({ project: m[1], version: m[2] }))
      .filter((d, i, all) => d.project !== head[1] && all.findIndex(x => x.project === d.project) === i),
  });
  if (!projects.some(p => p.name === head[1])) projects.push({
    name: head[1], group: 'projects', color: 'white', apiDocUrl: `${head[1]}/OpenApi.html`, hasDependencies: true,
  });
  projects.find(p => p.name === head[1])!.hasDependencies = true;
}

// ── release.md: two tables + notes per project ────────────────────────────────
const release = read('release.md');
const releaseTables: ReleaseTable[] = [];
for (const m of release.matchAll(/^## (Camunda|Worker) Dependencies\s*\n([\s\S]*?)(?=\n\(\\\*\))/gm)) {
  const lines = m[2].trim().split('\n').filter(l => l.startsWith('|'));
  const cells = (l: string) => l.slice(1, -1).split('|').map(c => c.trim());
  const header = cells(lines[0]).slice(3);
  const columns = header.map(h => { const c = h.match(/\*\*([\w-]+)\*\*\s*([\w.]*)/); return { project: c?.[1] ?? h, version: c?.[2] ?? '' }; });
  const rows: ReleaseRow[] = lines.slice(2).map(l => {
    const c = cells(l);
    const name = c[0].replace(/[*[\]_]/g, '');
    const stars = (c[0].match(/\*+$/)?.[0].length ?? 0);
    const uses: Record<string, string> = {};
    columns.forEach((col, i) => { if (c[3 + i]) uses[col.project] = c[3 + i]; });
    return {
      project: name, version: c[1].replace(/[*_]/g, ''), previousVersion: c[2].replace(/[*_]/g, ''),
      status: stars >= 4 ? 'patched' : stars >= 3 ? 'new' : 'unchanged', uses,
    };
  });
  releaseTables.push({ kind: m[1] === 'Camunda' ? 'bpmn' : 'worker', title: `${m[1]} Dependencies`, columns, rows });
}
const releaseNotes: ReleaseNotes[] = [];
const notesPart = release.split(/^# Release Notes/m)[1] ?? '';
for (const sec of notesPart.split(/^## /m).slice(1)) {
  const h = sec.match(/^\[([\w-]+)\]\(([^)"]+)/);
  if (!h) continue;
  const groups: ReleaseNotes['groups'] = [];
  for (const g of sec.split(/^### /m).slice(1)) {
    const name = g.split('\n')[0].trim();
    const tickets: ReleaseNotes['groups'][0]['tickets'] = [];
    for (const t of g.split(/\n(?=\*\*)/).slice(1)) {
      const tm = t.match(/^\*\*(?:\[([\w-]+)\]\(([^)]+)\)|([\w-]+))\*\*/);
      const entries = t.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
      if (entries.length) tickets.push({ ticket: tm?.[1] ?? tm?.[3], url: tm?.[2], entries });
    }
    if (tickets.length) groups.push({ name, tickets });
  }
  releaseNotes.push({ project: h[1], apiDocUrl: h[2].replace(/^(\.\.\/)+/, (s) => s.length > 3 ? '../' : ''), groups });
}

// ── catalog.md ────────────────────────────────────────────────────────────────
const catalog: CatalogProject[] = [];
for (const sec of read('catalog.md').split(/^### /m).slice(1)) {
  const [first, ...rest] = sec.split('\n');
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const l of rest) {
    const m = l.match(/^- \[(\w+): ([^\]]+)\]\(([^)]+)\)/);
    if (!m || seen.has(m[3])) continue;
    seen.add(m[3]);
    const kinds: CatalogKind[] = ['Bpmn', 'Worker', 'Message', 'Signal', 'UserTask', 'Dmn', 'Timer'];
    entries.push({ kind: (kinds as string[]).includes(m[1]) ? m[1] as CatalogKind : 'Other', name: m[2].trim(), url: m[3] });
  }
  catalog.push({ title: first.trim(), entries });
}

// ── devStatistics.md ──────────────────────────────────────────────────────────
const devStats: DevStatsSection[] = [];
for (const sec of read('devStatistics.md').split(/^\*{5,}$/m)) {
  const t = sec.match(/count for \*\*([^*]+)\*\* files/);
  if (!t) continue;
  const rows = [...sec.matchAll(/^\s*- ([\w-]+): (\d+) of (\d+) Files/gm)].map(m => ({ project: m[1], lines: +m[2], files: +m[3] }));
  const tot = sec.match(/\*\*Total\*\*[^*]*\*\*(\d+)\*\* of \*\*(\d+)\*\*/);
  devStats.push({ title: t[1], rows, total: { lines: +(tot?.[1] ?? 0), files: +(tot?.[2] ?? 0) } });
}

// ── markdown pages ────────────────────────────────────────────────────────────
const outCompany = join(out, company);
mkdirSync(join(outCompany, 'pages'), { recursive: true });
const pages: Page[] = [];
const stripFrontMatter = (md: string) => md
  .replace(/^\{%[\s\S]*?%\}\s*/m, '')                       // front matter
  .replace(/@:callout\((\w+)\)\s*([\s\S]*?)@:@/g, (_, k, b) => `> **${k}:** ${b.trim()}\n`)
  .replace(/@:image\(([^)]+)\)\s*\{[^}]*\}/g, (_, p) => `![](${p.trim()})`)
  .replace(/\$\{release\.tag\}/g, releaseTag).replace(/\$\{created\.day\}/g, createdDay);
const addPage = (file: string, slug: string, section?: string) => {
  const md = read(file);
  if (!md) return;
  const t = md.match(/^#{1,3} (.+)$/m)?.[1]?.trim() ?? slug;
  const target = `pages/${slug.replace('/', '-')}.md`;
  writeFileSync(join(outCompany, target), stripFrontMatter(md));
  pages.push({ slug, title: t, file: target, section });
};
addPage('pattern.md', 'pattern');
addPage('statistics.md', 'statistics');
addPage('contact.md', 'contact');
addPage('development/instructions.md', 'development/instructions', 'Development');
addPage('development/onboarding.md', 'development/onboarding', 'Development');
// images next to the pages (pattern/*.png)
for (const d of ['pattern', 'development']) {
  const dir = join(src, d);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) if (/\.(png|jpe?g|svg|gif)$/i.test(f)) {
    mkdirSync(join(outCompany, d), { recursive: true });
    copyFileSync(join(dir, f), join(outCompany, d, f));
  }
}

// ── write ─────────────────────────────────────────────────────────────────────
const docs: CompanyDocs = {
  company, title,
  release: {
    tag: releaseTag, released, createdDay, jiraUrl, notes, olderReleases,
    approvedBy: respName ? { name: respName, date: respDate ?? '' } : undefined,
  },
  groups: groupOrder, projects, graph, dependencies, releaseTables, releaseNotes, catalog, devStats, pages,
};
writeFileSync(join(outCompany, 'docs.json'), JSON.stringify(docs, null, 2));

const indexPath = join(out, 'index.json');
const siteIndex: SiteIndex = existsSync(indexPath)
  ? JSON.parse(readFileSync(indexPath, 'utf8'))
  : { title: 'Process & Worker Catalogs', companies: [], orchescalaUrl: 'https://pme123.github.io/orchescala/' };
// company logo: src/docs/logo.(svg|png), else the company's favicon.ico (the classic sites used
// it as such) - always the current file, never a stale index.json entry
const logoFile = ['logo.svg', 'logo.png', 'favicon.ico'].find(f => existsSync(join(src, f)));
if (logoFile) copyFileSync(join(src, logoFile), join(outCompany, logoFile));
const prev = siteIndex.companies.find(c => c.id === company);
const ref: CompanyRef = {
  id: company, name: prev?.name ?? company[0].toUpperCase() + company.slice(1), release: releaseTag,
  logo: logoFile ? `${company}/${logoFile}` : undefined, url: prev?.url,
};
if (spec) siteIndex.specUrl = spec;
siteIndex.companies = [...siteIndex.companies.filter(c => c.id !== company), ref].sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(indexPath, JSON.stringify(siteIndex, null, 2));

const n = (x: { length: number }) => x.length;
console.log(`${company} → ${outCompany}/docs.json: ${n(projects)} projects · ${n(dependencies)} dependency pages · ` +
  `${catalog.reduce((s, c) => s + c.entries.length, 0)} catalog entries · ${n(releaseNotes)} release notes · ${n(pages)} pages`);
if (existsSync(join(docsDir, 'site'))) {
  const st = statSync(join(docsDir, 'site'));
  if (st.isDirectory()) console.log(`note: older releases (classic static sites) stay at <site>/${company}/<tag>/ — copy them unchanged.`);
}
