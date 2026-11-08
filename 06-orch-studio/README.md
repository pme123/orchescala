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
| `GET /ai/config` | is the AI on - `{enabled, provider, model, tasks}`, never the key; orch-spec shows the AI of a task only if it is in `tasks` | `STUDIO_AI_*`, the skills |
| `POST /ai/anthropic/v1/messages` | a request of orch-spec's agent for the task in `x-orch-task`, sent on to the Claude API with the studio's key, workspace and model; a task without a skill is refused (403) | `STUDIO_AI_*`, the skills |

**Skills:** a task of the AI (`uiCreator`, `processCreator`, `serviceRegistration`, `serviceCreator`)
is offered only with a skill for it and its provider: `ai/skills/<task>/<provider>/SKILL.md` on the
classpath - its constraints, steps and the instructions for the model, written to be reviewed by a
bank. The studio brings `uiCreator/anthropic`; a company adds or replaces one with the same path in
the resources of its module `studio`.

Later: a service per AI task that runs its skill on the server (`POST /ai/uiCreator` …) instead of
the agent in the browser, the buttons of orch-spec and the runner.

- **Who wins:** first files in memory (the folders of orch-spec and orch-ops, `spec/folder.json`,
  `ops/folder.json`), then the apps from the jar - the version the studio is built with, also when
  the company's documentation still has an older copy -, then the company's documentation.
- **The company's documentation:** from the classpath (`site/`) or from a folder (`STUDIO_SITE_DIR`,
  e.g. `00-docs/site` right after `prepareDocs`).
- **Login:** none in the PoC - the server listens on `localhost` only, and whoever reaches it uses
  its AI key. Later Entra, and the AI per person (`GET /ai/tasks`).
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
| `STUDIO_AI_ANTHROPIC_API_KEY` | – (AI off) | the key of the Claude API - the switch of the AI in orch-spec; it stays on the server |
| `STUDIO_AI_ANTHROPIC_WORKSPACE_ID` | – | only if the API asks for it (a key without a workspace) |
| `STUDIO_AI_MODEL` | `claude-opus-5-5` | the studio decides the model, whatever orch-spec sends |
| `STUDIO_AI_ANTHROPIC_URL` | `https://api.anthropic.com` | e.g. a gateway of the company |

## Without a company

```bash
STUDIO_SITE_DIR=<company>/00-docs/site sbt orchStudio/run
```
