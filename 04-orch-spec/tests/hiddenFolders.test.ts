// Hidden folders of a project stay out of the domain scan — a Claude worktree
// (`.claude/worktrees/…`) holds a second, older copy of the domain; read with
// it, every sync brought its classes in again as duplicates.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { readSources } from '../src/projects';
import { readProjectZip } from '../src/projectImport';
import { isSkippedDir } from '../src/domainScan';

type Tree = { [name: string]: Tree | string };

/** a folder in memory — subfolders as objects, files as text */
function dir(name: string, tree: Tree): unknown {
  return {
    kind: 'directory', name,
    entries: async function* () {
      for (const [n, v] of Object.entries(tree)) {
        yield [n, typeof v === 'string' ? { kind: 'file', name: n, getFile: async () => ({ text: async () => v }) } : dir(n, v)];
      }
    },
  };
}

const DOMAIN = '01-domain/src/main/scala/acme/demo/domain/send/v1';
const project: Tree = {
  '01-domain': { src: { main: { scala: { acme: { demo: { domain: { send: { v1: { schema: { 'IdentityLink.scala': 'case class IdentityLink(userId: String)' } } } } } } } } } },
  target: { 'Stale.scala': 'case class Stale(x: String)' },
  '.claude': { worktrees: { old: { '01-domain': { src: { main: { scala: { acme: { demo: { domain: { send: { v1: { 'domain.scala': 'case class IdentityLink(userId: String)' } } } } } } } } } } } },
};

test('the folder scan skips hidden folders like .claude/worktrees', async () => {
  const out: Array<{ path: string; text: string }> = [];
  await readSources(dir('acme-demo', project) as FileSystemDirectoryHandle, 'acme-demo', out, () => {});
  assert.deepEqual(out.map(f => f.path), [`acme-demo/${DOMAIN}/schema/IdentityLink.scala`]);
});

test('the ZIP import skips hidden folders like .claude/worktrees', () => {
  const zip = zipSync({
    [`acme-demo/${DOMAIN}/schema/IdentityLink.scala`]: strToU8('case class IdentityLink(userId: String)'),
    [`acme-demo/.claude/worktrees/old/${DOMAIN}/domain.scala`]: strToU8('case class IdentityLink(userId: String)'),
    [`acme-demo/target/${DOMAIN}/Stale.scala`]: strToU8('case class Stale(x: String)'),
  });
  assert.deepEqual(readProjectZip(zip).map(f => f.path), [`acme-demo/${DOMAIN}/schema/IdentityLink.scala`]);
});

test('a ZIP packed inside the project (no root folder) skips a hidden folder at its top', () => {
  const zip = zipSync({
    [`${DOMAIN}/schema/IdentityLink.scala`]: strToU8('case class IdentityLink(userId: String)'),
    [`.claude/worktrees/old/${DOMAIN}/domain.scala`]: strToU8('case class IdentityLink(userId: String)'),
  });
  assert.deepEqual(readProjectZip(zip).map(f => f.path), [`${DOMAIN}/schema/IdentityLink.scala`]);
});

// the CLI (tools/domain2catalog.ts) uses the same rule
test('isSkippedDir: build output and hidden folders, nothing else', () => {
  for (const name of ['target', 'node_modules', 'dist', '__MACOSX', '.claude', '.git', '.bsp', '.idea']) assert.equal(isSkippedDir(name), true, name);
  for (const name of ['01-domain', 'src', 'main', 'scala', 'targets', 'my.domain']) assert.equal(isSkippedDir(name), false, name);
});
