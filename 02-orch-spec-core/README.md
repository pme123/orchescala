# orch-spec-core

The logic of orch-spec that the platform server needs too - written once in Scala, built twice:

| Build | Used by |
|---|---|
| JVM: `orchescala-orch-spec-core` | the platform (orch-platform), e.g. the AI proxy and the spec services |
| Scala.js: `04-orch-spec/src/core/orchSpecCore.js` | orch-spec in the browser - it keeps working without a server |

JSON is the only contract (`OrchSpecCore`), the same as over HTTP. Pages stay JSON: what the
functions do not know (ids, comments, newer properties) and the order of the keys are kept.

Today: the differences of a page (`PageDiff`). Next: the tools on a page and the findings of the designer.

## Develop

```bash
sbt "orchSpecCoreJVM/test; orchSpecCoreJS/test"   # the same tests on both
sbt orchSpecCoreJS/linkToOrchSpec                  # after a change: the JS for orch-spec (gitignored)
```

orch-spec imports it through `src/core/core.ts` (types in `src/core/orchSpecCore.d.ts`); its own tests
(`npm test`) then run against the Scala code. The sbt build of the documentation apps
(`orchDocClient/bundleDocClient`) links it before vite.

License: Business Source License 1.1, like orch-doc (see `LICENSE`).
