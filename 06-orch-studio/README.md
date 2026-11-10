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
| `POST /ai/<task>/v1/messages` | a request of orch-spec's agent for `<task>` (e.g. `uiCreator`), with the skill applied and sent on to the Claude API with the studio's key and workspace; a task without a skill is refused (403), a tool that is not in the skill too (400) | `STUDIO_AI_*`, the skills |

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
| `request.max_tokens`, `thinking`, `effort`, `fallbacks` | the same settings - those of the browser do not count; `max_tokens` at most 32000 |
| `tools` | the only tools a request may offer - another one is refused (400) |

The log has one line per request: skill, model, status, time and tokens - no content. At most 8
requests go to the API at the same time; one waits at most 10 minutes (a request with thinking can
take that long), including its wait for a turn.

Later: the agent on the server with the limits of the skill (`limits`: steps, corrections, costs),
with the logic of orch-spec from `04-orch-spec/src/core`, the buttons of orch-spec and the runner.

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

A wrong setting ends the start with one line that names it.

## Without an image

```bash
npm ci
STUDIO_APPS_DIR=../04-orch-doc/bundle/orch-doc-site STUDIO_SITE_DIR=<company>/00-docs/site npm start
```

`npm run lint` checks the types, `npm test` runs the tests (`node --test`, without a port of the
studio - the Claude API is a fake on a free port). Node runs the TypeScript as it is (type
stripping, Node 22.18 or later) - there is no build.
