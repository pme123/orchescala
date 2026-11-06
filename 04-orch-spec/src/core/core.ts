// The logic orch-spec shares with the platform server - written once in Scala (02-orch-spec-core):
// the JVM build runs on the server, the Scala.js build here in the browser, so orch-spec keeps
// working without a server and both compute the same. JSON is the contract, as over HTTP.
//
// orchSpecCore.js is built, not checked in: `sbt orchSpecCoreJS/linkToOrchSpec` (the sbt build of
// the documentation apps does it before vite).
import { pageDiffJson } from './orchSpecCore.js';
import type { BlockKey } from '../pages/pageActions';
import type { Page } from '../pages/runtime/spec';

export type PageChange = {
  kind: 'added' | 'removed' | 'changed' | 'moved' | 'page';
  /** the key in the draft - for removed ones the key in the page before */
  key?: BlockKey;
  /** «Eingabefelder «Kontakt»», «Titel» */
  label: string;
  /** what changed in detail: «Filiale» neu */
  detail?: string;
};

/** The differences between a page and its draft - building blocks new, changed, moved, removed, and
  * the properties of the page (PageDiff.scala). */
export const pageDiff = (before: Page, after: Page): PageChange[] =>
  JSON.parse(pageDiffJson(JSON.stringify(before), JSON.stringify(after))) as PageChange[];
