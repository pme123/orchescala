# Orch Studio

The app with which the business side describes an app and brings it to a test environment - the
«Entwicklung» side of [Orch Platform](https://github.com/z9nai/orch-platform). Like the gateway,
this module is the library; the company builds its studio from it in `<company>-orchescala`.

| Path | What | From |
|---|---|---|
| `/site/` | orch-doc, the company's documentation | the app of `orchescala-orch-doc`, the company's data (`index.json`, `<company>/…`) |
| `/site/spec/` | orch-spec | the jar; `catalog.generated.json` from the company's documentation |
| `/site/ops/` | orch-ops | the jar |
| `/`, `/spec`, `/ops` | redirect there | – |
| `POST /spec/pages/diff` | differences of two pages: `{before, after}` → `PageChange[]` | `orchescala-orch-spec-core` - the same code as orch-spec in the browser (Scala.js) |

Later: the AI proxy (a skill per task and provider), the buttons of orch-spec and the runner.

- **Who wins:** first files in memory (the folders of orch-spec and orch-ops, `spec/folder.json`,
  `ops/folder.json`), then the apps from the jar - the version the studio is built with, also when
  the company's documentation still has an older copy -, then the company's documentation.
- **The company's documentation:** from the classpath (`site/`) or from a folder (`STUDIO_SITE_DIR`,
  e.g. `00-docs/site` right after `prepareDocs`).
- **Login:** none in the PoC - the server listens on `localhost` only. Later Entra.
- **License:** Business Source License 1.1, like orch-doc (see `LICENSE`).

## In `<company>-orchescala`

The module `studio` (`04-studio`) builds the company's app and brings the documentation along:

```scala
// build.sbt
lazy val studio = project
  .in(file("./04-studio"))
  .settings(scalaVersion := scalaV, name := s"$projectName-studio")
  .settings(libraryDependencies += "io.github.pme123" %% "orchescala-orch-studio" % orchescalaV)
  .settings(studioSiteSettings(docs)) // 00-docs/site -> site/ on the classpath
  .enablePlugins(JavaAppPackaging)
```

```scala
object StudioServerApp extends StudioServer:
  lazy val config = StudioConfig(
    specDir = Some(os.pwd / "00-docs" / "testdata" / "spec"),
    opsDir = Some(os.pwd / "00-docs" / "testdata" / "ops")
  ).withEnv()
```

```bash
sbt studio/run      # http://localhost:8880/site/
```

| Variable | Default | |
|---|---|---|
| `STUDIO_PORT` | `8880` | next to the gateways of the demo (8889) and the preview (8890); the stack `studio/` of orch-platform maps it to 8881 |
| `STUDIO_HOST` | `localhost` | |
| `STUDIO_SITE_DIR` | – (classpath `site/`) | the company's documentation from a folder |
| `STUDIO_SPEC_DIR`, `STUDIO_OPS_DIR` | as in the code | the folders orch-spec and orch-ops show at the start |

## Without a company

```bash
STUDIO_SITE_DIR=<company>/00-docs/site sbt orchStudio/run
```
