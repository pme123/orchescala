# 00-docs
This provides a template or starting point for the documentation of your company project.

The documentation is plain markdown in `00-docs/src/docs`, rendered by the documentation app
(orch-doc, orchescala's `04-orch-doc`, shipped in the orchescala jars) - no static-site
generator, no front matter.

The following files you need to adjust:

```bash
00-docs/src/docs
    | - contact.md
    | - development/instructions.md
    | - development/onboarding.md
    | - pattern.md
    | - statistics.md
```

The following files will be created by `./helper.scala prepareDocs`:

```bash
00-docs/src/docs
    | - dependencies
    | - catalog.md
    | - devStatistics.md
    | - directory.conf
    | - index.md
    | - overviewDependencies.md
    | - release.md
```
So do **not adjust** them manually.

`prepareDocs` also creates the company's data folders for the two apps of the site - they are
never overwritten, the apps write into them:

```bash
00-docs
    | - spec    # orch-spec: process specifications (config/model.json, processes/, pages/)
    | - ops     # orch-ops: recurring errors in operation (model.json, errors/)
```

The local preview names them on the apps' start screen; a company can use other folders
(`docsSpecDir`, `docsOpsDir`) - see [Development](development.md#preparedocs).

`00-docs/site` is the built site (`publishDocs`) - the company gateway serves it, older releases
keep their classic sites there (`site/<company>/<tag>/`).

