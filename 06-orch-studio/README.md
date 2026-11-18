# Orch Studio

The app with which the business side describes an app and brings it to a test environment - the
«Entwicklung» side of [Orch Platform](https://github.com/z9nai/orch-platform). A TypeScript server
on Node 22 (E28): one image for every company, which the company configures - its documentation,
the folders of orch-spec and orch-ops, its skills and the key of the AI. It builds nothing of its own.

| Path | What | From |
|---|---|---|
| `/site/` | orch-doc, the company's documentation | the apps (`STUDIO_APPS_DIR`), the company's data (`STUDIO_SITE_DIR`: `index.json`, `<company>/…`) |
| `/site/spec/` | orch-spec | the apps; `catalog.generated.json` from the company's documentation |
| `/site/ops/` | orch-ops | the apps |
| `/`, `/spec`, `/ops` | redirect there | – |
| `GET /ai/config` | is the AI on - `{enabled, provider, model, tasks, skills}`, never the key; orch-spec shows the AI of a task only if it is in `tasks` | `STUDIO_AI_*`, the skills |
| `POST /ai/<task>/turn` | a whole turn of the agent on the studio, for `uiCreator`, `processCreator` and `serviceOrchestrator`: orch-spec sends the request of the RE, the draft and the context of the tools; the studio runs the loop of orch-spec's core with the tools of the task and the `limits` of the skill; each request goes to the Claude API with the skill applied and the studio's key and workspace. A task without a skill is refused (403), a tool that is not in the skill too (400). The answer: one JSON per line (`application/x-ndjson`) - the events as they come, then the result | `STUDIO_AI_*`, the skills, orch-spec's core |
| `/platform/…` | the runs behind the buttons of orch-spec (see [below](#auf-testumgebung---the-runs-srcrun)): `GET /platform/config` (the projects - orch-spec shows its buttons only for one of them), `GET /platform/<project>/status`, `POST …/preview` (the spec of orch-spec; answers with the plan of the merge and the spec on the branch), `POST …/test`, `…/continue`, `…/cancel`, `…/hand-over`. What is refused answers `{"error": <text for the RE>}` | `STUDIO_PROJECTS`, `STUDIO_WORKSPACE`, `STUDIO_GIT_*` |

**Skills:** a task of the AI (`uiCreator`, `processCreator`, `serviceOrchestrator`, `serviceRegistration`, `serviceCreator`)
is offered only with a skill for it and its provider: `<skills>/<task>/<provider>/SKILL.md` - its
constraints, steps and the instructions for the model, written to be reviewed by a bank. The studio
brings `uiCreator`, `processCreator` and `serviceOrchestrator` for `anthropic` (`skills/`); a company
adds or replaces one with the same path in its folder `STUDIO_SKILLS_DIR`, which comes first. A
skill that cannot be read ends the start with a line that names it.

What the studio applies of a skill, per request:

| From the skill | In the request to the Claude API |
|---|---|
| `## Instructions` | the first block of the system - orch-spec sends only the context (catalog, data model) |
| `model` | the model - without one, `STUDIO_AI_MODEL` |
| `request.max_tokens`, `thinking`, `effort`, `fallbacks` | the same settings - those of the loop do not count; `max_tokens` at most 32000 |
| `tools` | the only tools a request may offer - another one is refused (400) |

And per turn on the studio (`POST /ai/<task>/turn`):

| From the skill | In the turn |
|---|---|
| `limits.steps_per_turn` | the most requests to the model per request of the RE - without it 24 |
| `limits.corrections_per_turn` | how often the draft goes back to the model with its errors - without it 2 |
| `limits.usd_per_turn` | the most a turn may cost (prices of Claude Opus 5.5) - checked before each request; without it no limit |
| `limits.usd_per_person_day` | read, applied with the login |

The log has one line per request: skill, model, status, time and tokens - no content - and one per
turn on the studio: how it stopped, time, requests and costs. At most 8 requests go to the API at the
same time; one waits at most 10 minutes (a request with thinking can take that long), including its
wait for a turn. The browser goes away (or the RE stops): the turn ends, and its request to the API.

**orch-spec's core:** the loop of the agent and its tools come from `04-orch-spec/src/core`, the logic
orch-spec shares with the studio - bundled for the studio with `npm run core` (to
`core/orch-spec-core.mjs`, not in Git; `core/orch-spec-core.d.mts` holds the types the studio uses).
`npm run lint`, `npm test` and the image need it.

Later: the AI per person (`usd_per_person_day`) and the buttons of orch-spec.

## «Auf Testumgebung» - the runs (`src/run`)

The run that brings a spec of orch-spec to the test environment (E25, P1 of the
[plan](https://github.com/z9nai/orch-platform/blob/develop/docs/export-pipeline.md)) - a library with a
command line, without an engine. The studio offers it under `/platform/…`: a run goes on in the
background, orch-spec asks for its status; a run the studio does not know any more (it was restarted)
shows as waiting and can go on.

| Step | What | The command |
|---|---|---|
| Preview | before a run (P12): the plan of the merge - what would be created, merged, in conflict - and the spec as it is on the branch; nothing is built or written to the branch. A file whose code differed from the spec before the change carries `drift` (`only`: it changes because of that alone, `also`: and because of the change): the merge brings the spec's side into a generated class whatever the change was, so orch-spec says what is not from the RE's change - and writes it into the commit for development | `commands.check`: `./helper.scala processFromSpec --check --from "$ORCH_SPEC_DIR" --json "$ORCH_PLAN_FILE"` |
| 1 Projekt | the spec of the run is one | – |
| 2 Auschecken | a clone of the repo in the workspace of the studio (never the checkout of a developer), fetched; a worktree for the project | git |
| 3 Branch | the first run of a work creates `orch-spec/<project>/<work>` from develop and pushes it, every later one goes on with it; develop is merged in | git |
| 4 Merge | the spec merged into the code - the RE is the author, the studio commits and pushes; conflicts go along with their markers | `commands.merge`: `./helper.scala processFromSpec --merge --from "$ORCH_SPEC_DIR" --markers --yes --json "$ORCH_PLAN_FILE"` |
| 5 Kompilieren und testen | the tests counted from `test-reports/*.xml` (those of a module «simulation» are the simulations) | `commands.test`: `sbt --server -batch "compile; worker/test"` |
| 6 Release | the version `x.y.z-<runId>` (`x.y.z` from `project/ProjectDef.scala`) - not committed | `commands.release`: `./helper.scala publish "$ORCH_VERSION"` |
| 7 Deploy auf Test | that version on the test environment | `commands.deploy` - the company's |
| 8 Simulationen, Import prüfen | the simulations counted; does the engine have the BPMN/DMN | `commands.simulate`: `sbt --server -batch simulation/testFull` (`test` would take unchanged simulations from sbt's cache), `commands.checkImport` (optional) |

- **A step that fails makes the run wait** (`waiting`, with the last 200 lines of its log): development
  fixes it on the work branch, then the run goes on. A failed step 1-3, or a merge that itself failed,
  runs again; after conflicts of the merge and after any later error the run fetches the branch and
  goes on at step 5. A run whose process is gone (`running`, but interrupted) goes on at its step.
  While a run is running or waiting, the project takes no second one - `cancel` gives it up, the
  work branch stays.
- **The commands** run with `sh -c` in the folder of the project, at most `timeoutMinutes` (30), with
  `ORCH_RUN_ID`, `ORCH_VERSION`, `ORCH_PROJECT`, `ORCH_WORK`, `ORCH_BRANCH`, `ORCH_SPEC_DIR`,
  `ORCH_PLAN_FILE` and `ORCH_PROJECT_DIR` in their environment.
- **«Übergeben»** (`hand-over`): the pull request of the work branch into develop - one per work,
  with its rounds; merged by the studio for a project with `autoMerge`. GitHub for now.
- **The projects** are configuration (`STUDIO_PROJECTS`, a JSON file):

  ```json
  { "projects": [ {
      "name": "democompany-customer",
      "repo": "git@github.com:pme123/orchescala-democompany.git",
      "path": "projects/democompany-customer",
      "gitHost": { "kind": "github", "repo": "pme123/orchescala-democompany" },
      "testUrl": "http://localhost:8889/app/democompany-customer/",
      "commands": { "deploy": "<how $ORCH_VERSION gets to the test environment>" }
  } ] }
  ```

  `develop`, `master`, `autoMerge`, `timeoutMinutes` and the other `commands` have defaults.

```bash
npm run platform -- test --project democompany-customer --spec <folder of orch-spec> --work termin-filiale \
  --summary "Feld Filiale" --author "Rita RE <re@democompany.ch>"
npm run platform -- continue  --project democompany-customer   # after the fix on the work branch
npm run platform -- cancel    --project democompany-customer
npm run platform -- status    --project democompany-customer   # the status.json orch-spec will read
npm run platform -- hand-over --project democompany-customer
```

Exit 0: ok, 2: the run waits, 1: it did not start. It needs `git` and what the commands need (`sbt`,
`scala-cli`, `node`, Docker) - so it runs on the host, not in the image.

| Setting | Default | |
|---|---|---|
| `STUDIO_PROJECTS` | – (the runs are off) | the projects of the company (or `--projects <file>`) - the switch of the buttons in orch-spec; a file that is wrong ends the start |
| `STUDIO_WORKSPACE` | `~/.orch-platform/workspaces` | the clones, worktrees and runs: `<repo>/repo`, `<repo>/work/<project>`, `<repo>/runs/<project>/status.json`, `…/<runId>/<step>.log` |
| `STUDIO_GIT_NAME`, `STUDIO_GIT_EMAIL` | `Orch Studio`, `orch-studio@localhost` | who commits for the studio |
| `STUDIO_GIT_TOKEN` | – | the token of the Git platform for «Übergeben» - pull requests of this repo only; never in orch-spec, never logged |

- **Who wins:** first files in memory (the folders of orch-spec and orch-ops, `spec/folder.json`,
  `ops/folder.json`), then the apps - the version the studio is built with, also when the company's
  documentation still has an older copy -, then the company's documentation. The apps never bring
  data of the company (`*.generated.json`, `folder.json`), and with their index `files.txt` only
  the files listed there.
- **Login:** none in the PoC - the server listens on `localhost` only, and whoever reaches it uses
  its AI key. Later Entra, and the AI per person.
- **License:** Business Source License 1.1, like orch-doc (see `LICENSE`).

## The image

From the root of Orchescala, after the apps are built:

```bash
sbt orchDocClient/bundleDocClient                                  # 04-orch-doc/bundle/orch-doc-site
npm --prefix 06-orch-studio run core                               # 06-orch-studio/core/orch-spec-core.mjs
docker build -f 06-orch-studio/Dockerfile -t orch-studio:local .
```

The company runs it with its folders mounted (the stack `studio/` of orch-platform does it for the
democompany):

```bash
docker run -p 127.0.0.1:8881:8880 \
  -v <company>/00-docs/site:/company/site:ro -e STUDIO_SITE_DIR=/company/site \
  -e STUDIO_AI_ANTHROPIC_API_KEY \
  orch-studio:local
```

| Variable | Default | |
|---|---|---|
| `STUDIO_PORT` | `8880` | next to the gateways of the demo (8889) and the preview (8890); the stack `studio/` of orch-platform maps it to 8881 |
| `STUDIO_HOST` | `localhost` (in the image `0.0.0.0`) | |
| `STUDIO_APPS_DIR` | `apps/` next to `src/` (in the image) | orch-doc, orch-spec and orch-ops as Orchescala builds them |
| `STUDIO_SITE_DIR` | – | the company's documentation, e.g. `00-docs/site` after `prepareDocs` |
| `STUDIO_SPEC_DIR`, `STUDIO_OPS_DIR` | – | the folders orch-spec and orch-ops show at the start - the path as the person sees it |
| `STUDIO_SKILLS_DIR` | – | the company's skills, `<task>/<provider>/SKILL.md` |
| `STUDIO_AI_ANTHROPIC_API_KEY` | – (AI off) | the key of the Claude API - the switch of the AI in orch-spec; it stays on the server |
| `STUDIO_AI_ANTHROPIC_WORKSPACE_ID` | – | only if the API asks for it (a key without a workspace) |
| `STUDIO_AI_MODEL` | `claude-opus-5-5` | the model of a skill that names none - whatever orch-spec sends |
| `STUDIO_AI_ANTHROPIC_URL` | `https://api.anthropic.com` | e.g. a gateway of the company |

A wrong setting - also a folder of the company that is set but not there, or a port that is taken -
ends the start with one line that names it. `docker stop` ends the studio at once (SIGTERM).

## Without an image

```bash
npm ci
STUDIO_APPS_DIR=../04-orch-doc/bundle/orch-doc-site STUDIO_SITE_DIR=<company>/00-docs/site npm start
```

`npm run lint` checks the types, `npm test` runs the tests (`node --test`, without a port of the
studio - the Claude API is a fake on a free port). Node runs the TypeScript as it is (type
stripping, Node 22.18 or later) - there is no build.
