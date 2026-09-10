// Data model of the documentation site.
//
// The app is a pure client: it reads `index.json` at its root and one
// `<company>/docs.json` per company. These files are generated — today by
// `tools/docs2json.ts` from an Orchescala `00-docs` folder, later directly by
// Orchescala's DocCreator. Everything here is therefore the contract between
// the generator and the app.

/** `index.json` at the site root */
export interface SiteIndex {
  title: string;
  companies: CompanyRef[];
  /** Link to the Spec app (orch-spec), relative to the site root — e.g. `spec/` */
  specUrl?: string;
  /** Link to the Orchescala documentation */
  orchescalaUrl?: string;
}

export interface CompanyRef {
  /** folder name and URL segment, e.g. `valiant` */
  id: string;
  /** display name, e.g. `Valiant` */
  name: string;
  /** current release tag, e.g. `2026-08` */
  release?: string;
  /** customer logo, relative to the site root — e.g. `valiant/logo.png` */
  logo?: string;
  /** customer website, linked from the logo */
  url?: string;
}

/** `<company>/docs.json` */
export interface CompanyDocs {
  company: string;
  title: string;
  release: Release;
  /** project groups in display order — the layers of the dependency graph */
  groups: ProjectGroup[];
  projects: Project[];
  /** direct dependencies between projects — the edges of the overview graph */
  graph: { from: string; to: string }[];
  /** per project: all dependencies with versions (from the dependency pages, transitive) */
  dependencies: ProjectDependencies[];
  releaseTables: ReleaseTable[];
  releaseNotes: ReleaseNotes[];
  catalog: CatalogProject[];
  devStats: DevStatsSection[];
  /** markdown pages in navigation order */
  pages: Page[];
}

export interface Release {
  tag: string;
  /** false while the docs are a preview of the next release */
  released: boolean;
  createdDay: string;
  approvedBy?: { name: string; date: string };
  jiraUrl?: string;
  /** markdown */
  notes: string;
  /** older release tags; their classic static sites stay at `<company>/<tag>/index.html` */
  olderReleases: string[];
}

export interface ProjectGroup {
  name: string;
  /** CSS color of the group frame in the classic graph */
  color: string;
}

export interface Project {
  name: string;
  group: string;
  /** pastel fill used in all graphs and chips (from the Orchescala config) */
  color: string;
  /** BPMN project version for this release (empty: no processes) */
  version?: string;
  /** worker version for this release (empty: no workers) */
  workerVersion?: string;
  /** OpenApi.html, relative to the company folder */
  apiDocUrl: string;
  /** project belongs to another company (e.g. swisscom-fil-is in the valiant docs) */
  external?: boolean;
  /** there is a dependency page for this project */
  hasDependencies: boolean;
}

export interface ProjectDependencies {
  project: string;
  version: string;
  /** `true` when the page says "Preview to the next Release" */
  preview?: boolean;
  dependsOn: { project: string; version: string }[];
}

export interface ReleaseTable {
  kind: 'bpmn' | 'worker';
  title: string;
  /** dependency columns: the packages that others depend on, with their release version */
  columns: { project: string; version: string }[];
  rows: ReleaseRow[];
}

export interface ReleaseRow {
  project: string;
  version: string;
  previousVersion: string;
  status: 'new' | 'patched' | 'unchanged';
  /** column project → version used */
  uses: Record<string, string>;
}

export interface ReleaseNotes {
  project: string;
  apiDocUrl: string;
  groups: { name: string; tickets: { ticket?: string; url?: string; entries: string[] }[] }[];
}

export interface CatalogProject {
  title: string;
  entries: CatalogEntry[];
}

export type CatalogKind = 'Bpmn' | 'Worker' | 'Message' | 'Signal' | 'UserTask' | 'Dmn' | 'Timer' | 'Other';

export interface CatalogEntry {
  kind: CatalogKind;
  name: string;
  url: string;
}

export interface DevStatsSection {
  title: string;
  rows: { project: string; lines: number; files: number }[];
  total: { lines: number; files: number };
}

export interface Page {
  /** URL segment, e.g. `pattern` or `development/onboarding` */
  slug: string;
  title: string;
  /** markdown file, relative to the company folder */
  file: string;
  /** navigation section, e.g. `Development`; top level when missing */
  section?: string;
}

/** `<company>/search.json` - every operation of every project API, for the search in the top
 *  bar (written by the site assembly from the projects' OpenApi.yml) */
export interface SearchEntry {
  company: string;
  project: string;
  /** what the API view selects (`?op=`): the operationId, qualified with its tag if the id repeats within the project */
  id: string;
  operationId: string;
  /** the process / group the operation belongs to */
  tag: string;
  /** the OpenAPI path - for workers `/worker/<topic>`, the topic being unique across all projects */
  path: string;
  /** the worker topic (last segment of a `/worker/` path) */
  topic?: string;
  summary?: string;
}
