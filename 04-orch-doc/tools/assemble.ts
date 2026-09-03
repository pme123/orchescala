// CLI: assemble the complete documentation site in one run — locally viewable.
// (Orchescala's helper does the same in Scala - `SiteAssembler`, used by prepareDocs /
// publishDocs; this tool stays for the app's own development.)
//
//   node tools/assemble.ts <path/to/00-docs> [more 00-docs …] [options]
//
//   --prepare            run `./helper.scala prepareDocs` in the company repo first
//                        (checks out the projects into git-temp and regenerates the docs)
//   --git-temp <dir>     checked-out project repos (default: <00-docs>/../../../git-temp)
//   --out <dir>          target folder (default: dist-site)
//   --old-releases       also copy the classic static sites of older releases (<00-docs>/site/<company>/<tag>)
//   --no-spec            skip building orch-spec into <out>/spec
//   --no-build           skip the vite builds (reuse what is already in <out>)
//   --serve [port]       serve <out> locally (default 3004) and keep running
//
// What lands in <out> — the same layout the WebDAV server has:
//   index.html + assets/          this app
//   index.json, <company>/docs.json + pages/   from docs2json
//   <company>/<project>/OpenApi.html|yml + diagrams/   the referenced APIs,
//        taken from git-temp at the version defined in VERSIONS.conf
//        (`git show v<version>:…` — the working trees stay untouched)
//   spec/                         orch-spec
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { CompanyDocs, SiteIndex } from '../src/types.ts';

const rootDir = resolve(dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const opt = (name: string, dflt?: string) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1] && !args[i + 1].startsWith('--') ? args.splice(i, 2)[1] : (args.splice(i, 1), dflt);
  return v;
};
const prepare = flag('--prepare');
const oldReleases = flag('--old-releases');
const noSpec = flag('--no-spec');
const noBuild = flag('--no-build');
const serveIdx = args.indexOf('--serve');
const servePort = serveIdx >= 0 ? Number(opt('--serve', '3004')) : undefined;
const out = resolve(opt('--out', join(rootDir, 'dist-site'))!);
const gitTempOpt = opt('--git-temp');
const docsDirs = args.filter(a => !a.startsWith('--')).map(d => resolve(d));
if (!docsDirs.length || !docsDirs.every(d => existsSync(join(d, 'src/docs')))) {
  console.error('Usage: node tools/assemble.ts <path/to/00-docs> [more …] [--prepare] [--git-temp <dir>] [--out <dir>] [--old-releases] [--no-spec] [--no-build] [--serve [port]]');
  process.exit(1);
}
const gitTemp = resolve(gitTempOpt ?? join(docsDirs[0], '../../../git-temp'));

const run = (cmd: string, cmdArgs: string[], cwd: string) => {
  console.log(`\n▶ ${cmd} ${cmdArgs.join(' ')}  (${cwd})`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`${cmd} failed (${r.status})`); process.exit(r.status ?? 1); }
};
const git = (repo: string, ...a: string[]): Buffer | null => {
  const r = spawnSync('git', ['-C', repo, ...a], { maxBuffer: 512 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};

// ── 1. prepareDocs (optional) ─────────────────────────────────────────────────
if (prepare) for (const d of docsDirs) {
  const companyRepo = dirname(d);
  if (!existsSync(join(companyRepo, 'helper.scala'))) { console.warn(`  ! no helper.scala in ${companyRepo} — prepareDocs skipped`); continue; }
  run('./helper.scala', ['prepareDocs'], companyRepo);
}

// ── 2. markdown sources → site data ──────────────────────────────────────────────
mkdirSync(out, { recursive: true });
for (const d of docsDirs)
  run('node', [join(rootDir, 'tools/docs2json.ts'), d, '--out', out, ...(noSpec ? [] : ['--spec', 'spec/'])], rootDir);

const siteIndex: SiteIndex = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));

// ── 3. referenced APIs at the defined versions ────────────────────────────────
// The server layout per project is OpenApi.html (the standalone API page, always the CURRENT
// build - not whatever the project shipped at that tag) + OpenApi.yml (from the project at
// its released version) + PostmanOpenApi.html|yml if the project has one + diagrams/*.bpmn|dmn.
const singlePage = join(rootDir, 'dist-single/api.html');
if (!noBuild || !existsSync(singlePage)) run('npx', ['vite', 'build', '-c', 'vite.single.config.ts'], rootDir);
const apiPage = readFileSync(singlePage, 'utf8');

let apiOk = 0, apiHead = 0, apiMissing = 0;
for (const co of siteIndex.companies) {
  const docs: CompanyDocs = JSON.parse(readFileSync(join(out, co.id, 'docs.json'), 'utf8'));
  for (const p of docs.projects) {
    const repo = join(gitTemp, p.name);
    const targetCo = p.apiDocUrl.match(/^\.\.\/([\w-]+)\//)?.[1] ?? co.id;
    const target = join(out, targetCo, p.name);
    if (!existsSync(repo)) {
      console.warn(`  ✗ ${p.name}: no checkout in ${gitTemp} — API skipped`);
      apiMissing++;
      continue;
    }
    // bpmn and worker are released separately — the API doc is the NEWEST of the two, not the
    // bpmn's (worker-only patches would otherwise never show up)
    const cmpVersion = (a: string, b: string) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d) return d;
      }
      return 0;
    };
    const version = [p.version, p.workerVersion].filter((v): v is string => !!v).sort(cmpVersion).pop();
    let ref = version ? `v${version}` : 'HEAD';
    if (ref !== 'HEAD' && !git(repo, 'rev-parse', '-q', '--verify', `${ref}^{commit}`)) {
      console.warn(`  ! ${p.name}: tag ${ref} not found — using HEAD`);
      ref = 'HEAD';
    }
    // old-style projects (pre 03-api) keep openApi.yml in the repo root
    const ymlPath = ['03-api/OpenApi.yml', 'openApi.yml', 'OpenApi.yml'].find(f => git(repo, 'cat-file', '-e', `${ref}:${f}`) !== null);
    const yml = ymlPath && git(repo, 'show', `${ref}:${ymlPath}`);
    if (!yml) { console.warn(`  ✗ ${p.name}: no OpenApi.yml at ${ref}`); apiMissing++; continue; }
    mkdirSync(join(target, 'diagrams'), { recursive: true });
    writeFileSync(join(target, 'OpenApi.yml'), yml);
    writeFileSync(join(target, 'OpenApi.html'), apiPage);
    // the company gateway's Postman variant (only projects generated with that config have it)
    const postmanYml = git(repo, 'show', `${ref}:03-api/PostmanOpenApi.yml`);
    if (postmanYml) {
      writeFileSync(join(target, 'PostmanOpenApi.yml'), postmanYml);
      writeFileSync(join(target, 'PostmanOpenApi.html'), apiPage);
    }
    for (const dia of ['src/main/resources/camunda', 'src/main/resources/camunda8']) {
      const ls = git(repo, 'ls-tree', '-r', '--name-only', ref, '--', dia)?.toString().trim();
      if (!ls) continue;
      for (const f of ls.split('\n').filter(f => /\.(bpmn|dmn)$/.test(f))) {
        const b = git(repo, 'show', `${ref}:${f}`);
        if (b) writeFileSync(join(target, 'diagrams', basename(f)), b);
      }
    }
    console.log(`  ✓ ${p.name} @ ${ref}`);
    ref === 'HEAD' && version ? apiHead++ : apiOk++;
  }
}

// ── 4. older releases (classic static sites) ───────────────────────────────────
if (oldReleases) for (const co of siteIndex.companies) {
  const docs: CompanyDocs = JSON.parse(readFileSync(join(out, co.id, 'docs.json'), 'utf8'));
  for (const tag of docs.release.olderReleases) {
    const src = docsDirs.map(d => join(d, 'site', co.id, tag)).find(p => existsSync(p));
    const dest = join(out, co.id, tag);
    // <out> may BE a company's 00-docs/site (publishDocs builds in place) - then it is already there
    if (src && resolve(src) === resolve(dest)) { console.log(`  ✓ classic site ${co.id}/${tag} (in place)`); continue; }
    if (src) { cpSync(src, dest, { recursive: true }); console.log(`  ✓ classic site ${co.id}/${tag}`); }
  }
}

// ── 5. build the apps ─────────────────────────────────────────────────────────
if (!noBuild) {
  run('npx', ['vite', 'build'], rootDir);
  cpSync(join(rootDir, 'dist'), out, { recursive: true });
  // orch-spec: the sibling module in orchescala (04-orch-spec) - or a plain sibling checkout
  const specDir = ['../04-orch-spec', '../orch-spec'].map(d => resolve(rootDir, d)).find(existsSync) ?? resolve(rootDir, '../04-orch-spec');
  if (!noSpec && existsSync(specDir))
    run('npx', ['vite', 'build', '--base=./', '--outDir', join(out, 'spec'), '--emptyOutDir'], specDir);
  else if (!noSpec) console.warn(`  ! orch-spec not found at ${specDir} — Spec skipped`);
}

console.log(`\nSite assembled in ${out}`);
console.log(`  APIs: ${apiOk} at their defined version · ${apiHead} on HEAD (tag missing) · ${apiMissing} skipped`);

// ── 6. serve ──────────────────────────────────────────────────────────────────
if (servePort) {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.yml': 'text/yaml', '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/png',
    '.bpmn': 'application/xml', '.dmn': 'application/xml',
  };
  http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = join(out, rel);
    if (!file.startsWith(out) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  }).listen(servePort, () => console.log(`\nServing → http://localhost:${servePort}/  (Ctrl-C to stop)`));
}
