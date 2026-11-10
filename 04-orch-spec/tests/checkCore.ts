// The boundary of src/core (E28, step 2) - orch-spec's logic without UI, which the studio runs in Node.
// Bundled with esbuild as the studio would take it, it must reach
//   - no React and no component (.tsx),
//   - no package besides PACKAGES,
//   - nothing that only the browser has (BROWSER) - esbuild replaces a reference to such a global
//     with a marker (`define`: only real references, not a property, a text or a local of that name),
//     and the marker must not be in the bundle,
// and the bundle must load in Node without a DOM. Exit 1 with what crossed it.
//
//   node tests/checkCore.ts        (npm run check:core, on CI)
import { build, type Metafile } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ENTRY = 'src/core/index.ts';
const OUT = 'dist-core/core.mjs';
/** the packages the core may use - plain JavaScript, the same in Node: FEEL, and zip (projectImport.ts,
  * which the catalog collections of a service orchestration use) */
const PACKAGES = ['feelin', 'fflate'];
/** what only the browser has - XML (DOMParser, XMLSerializer) comes from the host, see src/core/index.ts */
const BROWSER = ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location', 'history', 'alert', 'confirm', 'import.meta.env'];
const MARK = '__browser_only__';

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  packages: 'external',
  metafile: true,
  write: false,
  logLevel: 'error',
  define: Object.fromEntries(BROWSER.map((name) => [name, `${MARK}${name.replaceAll('.', '_')}`])),
});
const code = result.outputFiles[0].text;
const meta: Metafile = result.metafile;

const inputs = Object.keys(meta.inputs);
const ui = inputs.filter((i) => i.endsWith('.tsx') || i.startsWith('src/components/'));
const packages = [...new Set(Object.values(meta.inputs).flatMap((i) => i.imports.filter((x) => x.external).map((x) => x.path)))];
const foreign = packages.filter((p) => !PACKAGES.some((ok) => p === ok || p.startsWith(`${ok}/`)));

// the module a line belongs to - esbuild writes `// src/….ts` before the code of each one
const lines = code.split('\n');
const moduleAt = (line: number) => lines.slice(0, line + 1).reverse().find((l) => /^\/\/ src\/.*\.ts$/.test(l))?.slice(3) ?? '?';
const browser = lines.flatMap((l, n) =>
  [...l.matchAll(new RegExp(`${MARK}(\\w+)`, 'g'))].map((m) => `${m[1].replace('import_meta_env', 'import.meta.env')} in ${moduleAt(n)}`));

const problems = [
  ...ui.map((i) => `a component: ${i}`),
  ...foreign.map((p) => `a package that is not allowed (${PACKAGES.join(', ')}): ${p}`),
  ...[...new Set(browser)].map((b) => `the browser: ${b}`),
];

// it loads in Node - nothing of the browser at the top level either
const loaded = problems.length ? null : await (async () => {
  mkdirSync('dist-core', { recursive: true });
  writeFileSync(OUT, code);
  try {
    const core = (await import(pathToFileURL(OUT).href)) as Record<string, unknown>;
    return Object.keys(core).length;
  } catch (e) {
    return `it does not load in Node: ${e instanceof Error ? e.message : String(e)}`;
  }
})();

const all = typeof loaded === 'string' ? [...problems, loaded] : problems;
if (all.length) {
  console.error(`${ENTRY} crosses its boundary:\n${all.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`${ENTRY}: ${inputs.length} modules, ${loaded} exports, packages: ${packages.join(', ') || '-'} - no UI, no browser, loads in Node`);
