// The tools (tools/*.ts) run in Node directly - `node tools/openapi2catalog.ts …` - not bundled. Node
// strips the types but resolves every other import as written: a relative import of a value needs
// its `.ts`. Vite and the bundled tests do not care, so a missing one broke only the tools (#49:
// `import { ORCHESCALA_TYPES } from './orchescalaTypes'`). `import type` is removed - it may stay
// without. (`import { type A }` is not: Node keeps the empty import and loads the module.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const importPattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?'(\.{1,2}\/[^']+)'/g;

/** The relative imports of a file: the target and whether Node needs to load it. */
function imports(file: string): { target: string; loaded: boolean }[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(importPattern)].map(m => ({ target: m[2], loaded: !m[1] }));
}

/** Every source file the tools reach - and the value imports among them without `.ts`. */
function missingExtensions(): string[] {
  const tools = readdirSync(join(root, 'tools')).filter(f => f.endsWith('.ts')).map(f => join(root, 'tools', f));
  const seen = new Set<string>();
  const missing: string[] = [];
  const queue = [...tools];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { target, loaded } of imports(file)) {
      if (!loaded) continue;
      const path = resolve(dirname(file), target);
      if (!/\.(ts|tsx|js|mjs|json)$/.test(target)) {
        missing.push(`${relative(root, file)}: '${target}'`);
        if (existsSync(`${path}.ts`)) queue.push(`${path}.ts`);
      } else if (existsSync(path) && path.endsWith('.ts')) queue.push(path);
    }
  }
  return missing;
}

test('the tools run in Node: every value import they reach carries its .ts', () => {
  assert.deepEqual(missingExtensions(), []);
});
