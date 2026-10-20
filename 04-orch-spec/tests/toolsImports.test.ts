// The tools (tools/*.ts) run in Node directly - `node tools/openapi2catalog.ts …` - not bundled. Node
// strips the types but resolves every other import as written: a relative import of a value needs
// its `.ts`. Vite and the bundled tests do not care, so a missing one broke only the tools (#49:
// `import { ORCHESCALA_TYPES } from './orchescalaTypes'`). `import type` is removed - it may stay
// without. (`import { type A }` is not: Node keeps the empty import and loads the module.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

// the folder of orch-spec - the test runs bundled from dist-tests/, its source is in tests/
const root = resolve(import.meta.dirname, '..');
// a static import or export of a relative module - one statement (no `;` or quote before the
// module), so a type import cannot swallow the value import after it
const staticImport = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?(['"])(\.{1,2}\/[^'"]+)\2/g;
const dynamicImport = /\bimport\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g;

/** The relative imports of a file: the target and whether Node needs to load it. */
function imports(file: string): { target: string; loaded: boolean }[] {
  const text = readFileSync(file, 'utf8');
  return [
    ...[...text.matchAll(staticImport)].map(m => ({ target: m[3], loaded: !m[1] })),
    ...[...text.matchAll(dynamicImport)].map(m => ({ target: m[2], loaded: true })),
  ];
}

/** Every source file the tools reach - and the value imports among them Node cannot load. Node
 * strips the types of `.ts` only (not `.tsx`), and loads no directory and no path without its
 * extension. */
function unloadable(): string[] {
  const tools = readdirSync(join(root, 'tools')).filter(f => f.endsWith('.ts')).map(f => join(root, 'tools', f));
  const seen = new Set<string>();
  const problems: string[] = [];
  const stack = [...tools];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { target, loaded } of imports(file)) {
      if (!loaded) continue;
      const path = resolve(dirname(file), target);
      const at = `${relative(root, file)}: '${target}'`;
      if (!target.endsWith('.ts')) {
        problems.push(`${at} - without .ts`);
        if (existsSync(`${path}.ts`)) stack.push(`${path}.ts`);
      } else if (!existsSync(path)) problems.push(`${at} - no such file`);
      else stack.push(path);
    }
  }
  return problems;
}

test('the tools run in Node: every value import they reach carries its .ts', () => {
  assert.deepEqual(unloadable(), []);
});

test('the imports of a file: one per statement, both quotes, export from and import()', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tools-imports-'));
  const file = join(dir, 'a.ts');
  writeFileSync(file, [
    "import type { A } from 'pkg';",
    "import { b } from './b';",
    'import type { C } from "./c";',
    "export * from './d.ts';",
    "import './e.ts';",
    "const f = () => import('./f');",
  ].join('\n'));
  try {
    assert.deepEqual(imports(file), [
      { target: './b', loaded: true },
      { target: './c', loaded: false },
      { target: './d.ts', loaded: true },
      { target: './e.ts', loaded: true },
      { target: './f', loaded: true },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
