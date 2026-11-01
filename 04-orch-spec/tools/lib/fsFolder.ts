// A spec folder on disk for the tools - read access as `SpecFolder` (src/specExport.ts).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SpecFolder } from '../../src/specExport.ts';

export function fsFolder(root: string): SpecFolder {
  return {
    read(path) {
      const p = join(root, path);
      return existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null;
    },
    list(dir) {
      const p = join(root, dir);
      if (!existsSync(p) || !statSync(p).isDirectory()) return [];
      return readdirSync(p).filter(n => !n.startsWith('.') && statSync(join(p, n)).isFile()).sort();
    },
    dirs(dir) {
      const p = join(root, dir);
      if (!existsSync(p) || !statSync(p).isDirectory()) return [];
      return readdirSync(p).filter(n => !n.startsWith('.') && statSync(join(p, n)).isDirectory()).sort();
    },
  };
}
