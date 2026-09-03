# 00-docs
This provides a template or starting point for the documentation of your company project.

The documentation is plain markdown in `00-docs/src/docs`, rendered by the documentation app
([orch-doc](https://github.com/z9nai/orch-doc), see `PublishConfig.apiDocPath`) - no static-site
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

`00-docs/site` is the built site (`publishDocs`) - the company gateway serves it, older releases
keep their classic sites there (`site/<company>/<tag>/`).

