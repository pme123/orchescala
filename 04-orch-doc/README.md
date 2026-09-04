# Orch Doc

The process documentation that Orchescala generates for a company — as a
modern client app. Same technology and design as orch-spec (`../04-orch-spec`):
React 19 · TypeScript · Vite · Tailwind CSS 4 · lucide-react.

Pure static site: the app reads JSON and markdown files next to it. No server,
no build step on the doc server — deploy to WebDAV.

## Part of orchescala

This is orchescala's `04-orch-doc`. The sbt build bundles it (and orch-spec) with vite —
`sbt orchDocClient/bundleDocClient`, run automatically before packaging — into `bundle/`, which
is published as the `orchescala-orch-doc` jar:

- `OrchDocApi.html` — the standalone API page (`npm run build:single`, everything inlined).
  The helper writes it into every project as `03-api/OpenApi.html` / `PostmanOpenApi.html`
  (`./helper.scala update`), the gateway serves it at `/docs`.
- `orch-doc-site/` — the site app incl. orch-spec (`npm run build:all`).

## License

Business Source License 1.1 (see [LICENSE](LICENSE)) — unlike the rest of orchescala (MIT).
Non-production use is free; production use needs a license from z9nai GmbH. Four years after a
version is published it becomes MIT.

## See it now

```bash
npm install && ORCH_DOCS=path/to/company-orchescala/00-docs npm run sample && npm run dev
```

Then open <http://localhost:3003/>. `npm run sample` converts a company's
`00-docs` into `sample-data/site/` (served only by the dev server). `ORCH_DOCS`
takes one or more `00-docs` folders (space separated); the same applies to `npm run site`.

## One run: the whole site, locally

```bash
npm run site
```

assembles everything `./helper.scala prepareDocs` produces — plus the pieces
that on the server come from other pipelines — into `dist-site/` and serves it
at <http://localhost:3004/>:

1. **Docs data** for Valiant *and* Swisscom (`docs2json` over both `00-docs`).
2. **The referenced APIs**: per project `OpenApi.yml` **at the version defined
   in `VERSIONS.conf`** — rendered in-app by the API view, taken from the checkouts in `~/git-temp` via
   `git show v<version>:…` — the working trees stay untouched. Plus the Redoc
   shell (`CompanyOpenApi.html`) and the `diagrams/*.bpmn|dmn`, exactly the
   layout each project's release uploads to WebDAV. Old-style projects
   (`openApi.yml` in the root) are handled; a missing tag falls back to HEAD
   with a warning.
3. **Older releases** (classic static sites) for the version switcher.
4. **This app** and **orch-spec** (`spec/`), both built.

Run `./helper.scala prepareDocs` first when the release data changed, or let
the script do it with `--prepare`. All options:

```bash
node tools/assemble.ts <00-docs> [more 00-docs …] \
  [--prepare] [--git-temp <dir>] [--out <dir>] \
  [--old-releases] [--no-spec] [--no-build] [--serve [port]]
```

`dist-site/` is exactly what would be uploaded to the WebDAV `site/` folder.

## What the app shows

| Page | Content | Replaces |
| --- | --- | --- |
| **Catalogs** (root) | one card per company | `site/index.html` |
| **Overview** | release header, key figures, project dependency graph (native SVG, hover/click), projects by group with versions and links | `index.md` (mermaid from a CDN) |
| **Release** | Camunda and Worker dependency matrices (new/patched marked, older versions highlighted, "only changed" filter), release notes per project with Jira and commit links | `release.md` |
| **Dependencies** | graph with focus, *depends on* and *used by* per project, or the full table | `dependencies/*.md` (one mermaid per project) |
| **Catalog** | full-text search over all processes, workers, messages, signals, user tasks; filter by kind; grouped by project | `catalog.md` (a flat link list) |
| **API** (`#/<company>/api/<project>`) | the project's `OpenApi.yml` rendered in the app's own design — operation list with search and kind chips, schema tree, collapsible examples, and the referenced BPMN/DMN diagrams rendered inline (bpmn-js/dmn-js, lazy-loaded, with SVG export); links from the generated descriptions (Package Configuration, dependency trees) are rewritten to the app's own routes; a project panel on top shows description, versions, release status and the dependencies (depends on / used by) as chips; the version chip shows the released version from git-temp | Redoc (`OpenApi.html`, stays as external link) |
| **Development Statistics** | bar charts per kind | `devStatistics.md` |
| Pattern, Statistics, Contact, Onboarding, Instructions | the hand-written markdown pages, rendered with images, callouts and tables | Laika pages |

Plus: dark mode, a version switcher to older releases, and a top bar with the
customer's name and logo on the left (`logo`/`url` in `index.json`; the
converter takes `src/docs/logo.svg|png`, else the favicon), **Catalogs · Spec
(experimental) · Orchescala** aligned with the content, and *by z9nai GmbH* on
the right. Older releases keep their classic static site
at `<company>/<tag>/` — the app only links there. The `OpenApi.html` per
project is untouched.

## Data — the contract with Orchescala

Everything is defined in [`src/types.ts`](src/types.ts):

```
site/
  index.html + assets/        ← this app (npm run build → dist/)
  index.json                  ← SiteIndex: companies (name, logo, url), specUrl, orchescalaUrl
  valiant/
    docs.json                 ← CompanyDocs: release, projects, graph, dependencies,
                                releaseTables, releaseNotes, catalog, devStats, pages
    pages/*.md                ← hand-written pages (pattern, onboarding, …)
    pattern/*.png             ← their images
    valiant-mkk/OpenApi.html  ← per project, deployed by the project (unchanged)
    2026-06/ …                ← older releases, classic static sites (unchanged)
  swisscom/…
  spec/                       ← orch-spec (optional, see below)
```

### Today: convert the markdown sources

```bash
node tools/docs2json.ts <path/to/00-docs> --out site [--spec spec/]
```

reads `CONFIG.conf`, `VERSIONS.conf` and `src/docs/*.md` and writes
`site/index.json` (merged — run once per company), `site/<company>/docs.json`
and the pages. It is also the executable specification of `docs.json`.

### Next: Orchescala writes `docs.json` directly

`DocCreator.prepareDocs()` already has everything in hand (`DocProjectConfig`,
`ReleaseConfig`, the dependency graph, change logs, catalogs). Instead of
rendering markdown + mermaid and running `laikaSite`, it writes the JSON from
`src/types.ts` and copies the app. `publishDocs()` then becomes:

1. write `site/<company>/docs.json` + `pages/`
2. copy the orch-doc build (`dist/`) into `site/` — same for every company
3. upload `site/` via WebDAV as today

Until then the converter bridges the gap: run it after `prepareDocs()` instead
of `laikaSite`.

## Standalone API page per project

`dist/api.html` is a second entry: the API view alone, without company data.
Deployed as a project's `OpenApi.html` (next to its `OpenApi.yml` and
`diagrams/`, plus the `assets/` folder) it replaces the Redoc shell:

```
<project>/
  OpenApi.html    ← dist/api.html, renamed
  assets/         ← dist/assets/ (shared with the full app)
  favicon.png
  OpenApi.yml
  diagrams/*.bpmn|dmn
```

Deep links: `#op=<operationId>` — and the Redoc-style `#operation/<id>`
anchors used by existing catalog/site links keep working. In standalone mode
the app hides everything that needs `docs.json` (sidebar, dependency chips,
link rewriting) and keeps the project panel, schema trees, examples and the
inline BPMN/DMN viewers with SVG export.

## Deploying orch-spec with it

```bash
npm run build:all
```

builds this app into `dist/` and orch-spec into `dist/spec/` (the sibling
repo `../orch-spec`, built with a relative base). With `--spec spec/` in
`index.json` the top bar shows a **Spec** button; the Spec app finds the
catalog of this site at `../` (see *Prozesse von der Doku-Site* in orch-spec).
Note: for SharePoint login, orch-spec's redirect URI must include the new
location (`https://<host>/site/spec/`).

## Scripts

| | |
| --- | --- |
| `npm run site` | assemble the complete site (docs + APIs + spec) and serve on :3004 |
| `npm run dev` | dev server on :3003 with `sample-data/site/` |
| `npm run sample` | regenerate the sample data from `valiant-orchescala/00-docs` |
| `npm run build` | type-check + production build → `dist/` |
| `npm run build:spec` | build `../orch-spec` into `dist/spec/` |
| `npm run build:all` | both |

## Layout of the code

```
src/
  types.ts         data contract (generator ↔ app)
  data.ts          loading + derived lookups (used by, catalog → project)
  router.ts        hash routes (#/valiant/catalog?q=…)
  ui.tsx           cls(), chips, cards, section headers
  markdown.tsx     marked with relative images/links
  App.tsx          top bar, sidebar, home, route switch
  components/
    DepGraph.tsx   SVG dependency graph (bands per group, ranked, barycenter order)
    Overview.tsx · Release.tsx · Dependencies.tsx · Catalog.tsx · DevStats.tsx · MdPage.tsx
tools/docs2json.ts 00-docs → site data
tools/assemble.ts  one run: docs + versioned APIs + old releases + spec, served locally
```
