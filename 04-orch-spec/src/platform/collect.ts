// The whole folder of the spec for a run of the studio - every file, not only those orch-spec writes:
// the studio takes the spec as it is into the repo, and what is missing there is removed.
// Left out: hidden files and folders, and the people of the folder (`users.json` - no part of the spec).
import type { StorageBackend } from '../backend';
import type { SpecFolder } from '../specExport';
import type { SpecFile } from './config';

/** Text files of a spec - what else lies in the folder is not sent, and named. */
const TEXT = /\.(json|jsonl|bpmn|dmn|ya?ml|md|txt|xml|svg|csv|feel)$/i;
const left = (name: string) => name.startsWith('.') || /^users(\.|$)/.test(name);
/** The folders orch-spec knows - for a backend that cannot list folders. */
const KNOWN_DIRS = ['config', 'processes', 'pages', 'services', 'services/openapi', 'catalog', 'themes'];

export type Collected = { files: SpecFile[]; skipped: string[] };

/** Every file of the folder behind `be`, with its text. */
export async function collectSpec(be: StorageBackend): Promise<Collected> {
  const walk = async (dir: string): Promise<string[]> => {
    const sub = be.dirs ? (await be.dirs(dir)).filter(n => !left(n)).map(n => (dir ? `${dir}/${n}` : n)) : [];
    return [dir, ...(await Promise.all(sub.map(walk))).flat()];
  };
  const dirs = be.dirs
    ? await walk('')
    // without folders: the known ones, and the folder of each process (its DMNs)
    : ['', ...KNOWN_DIRS, ...(await be.list('processes')).filter(f => f.name.endsWith('.json')).map(f => `processes/${f.name.slice(0, -'.json'.length)}`)];
  const paths = (await Promise.all(dirs.map(async dir => (await be.list(dir)).filter(f => !left(f.name)).map(f => (dir ? `${dir}/${f.name}` : f.name))))).flat().sort();
  const read = await Promise.all(paths.filter(p => TEXT.test(p)).map(async (path): Promise<SpecFile[]> => {
    const r = await be.read(path);
    return r ? [{ path, text: r.text }] : [];
  }));
  return { files: read.flat(), skipped: paths.filter(p => !TEXT.test(p)) };
}

/** The files as a folder for the comparison of two specs (specDiff.ts). */
export function memoryFolder(files: SpecFile[]): SpecFolder {
  const texts = new Map(files.flatMap((f): [string, string][] => (typeof f.text === 'string' ? [[f.path, f.text]] : [])));
  const under = (dir: string) => [...texts.keys()].filter(p => (dir ? p.startsWith(`${dir}/`) : true)).map(p => (dir ? p.slice(dir.length + 1) : p));
  return {
    read: path => texts.get(path) ?? null,
    list: dir => under(dir).filter(rest => !rest.includes('/')).sort(),
    dirs: dir => [...new Set(under(dir).filter(rest => rest.includes('/')).map(rest => rest.split('/')[0]))].sort(),
  };
}
