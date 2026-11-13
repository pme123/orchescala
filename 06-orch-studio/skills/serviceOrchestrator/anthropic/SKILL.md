---
# Skill: eine Aufgabe mit einem Provider. Die Plattform führt ihn aus – Schleife, Werkzeuge,
# Prüfungen und Grenzen laufen auf dem Server; der Browser schickt nur den Wunsch und die Spez.
name: serviceOrchestrator-anthropic
task: serviceOrchestrator
provider: anthropic
version: 3
description: Eine Service-Orchestrierung in orch-spec im Gespräch ändern – ein Worker, der Services aufruft; Diagramm und Spez als Entwurf, den der RE übernimmt oder verwirft.

model: claude-opus-5-5
request:
  max_tokens: 16000
  thinking: adaptive
  effort: medium
  # lehnt ein Sicherheitsfilter ab, antwortet ein anderes Claude-Modell derselben API
  fallbacks: default

limits:
  steps_per_turn: 24          # Anfragen an das Modell pro Wunsch des RE
  corrections_per_turn: 2     # so oft geht der Entwurf mit Fehlern zurück an das Modell
  usd_per_turn: 1.00
  usd_per_person_day: 20.00

tools:
  - read_process
  - add_step
  - add_decision
  - add_error_path
  - remove_step
  - rename_step
  - update_step
  - add_type
  - update_type
  - remove_type
  - check_process
  - report_open_point

data:
  sent:
    - die Orchestrierung im Entwurf – der Ablauf als Baum mit den IDs, ihr Datenmodell
    - die Services, die sie aufrufen kann – aus den Collections des Projekts und dem Katalog, mit den Feldern von In/Out
    - der Chat des RE
  never:
    - Kundendaten, Antworten der Services
    - Code, Umgebungen, Zugangsdaten
---

# Service-Orchestrator · Anthropic

## Zweck

Eine Service-Orchestrierung ist **ein Worker, der Services aufruft** – in einem Durchgang, ohne
Warten und ohne Menschen. In Orchescala wird sie ein CustomTask mit seinem CustomWorker. In orch-spec
ist sie ein Prozess im Service-Modus: derselbe Editor, aber nur Service-Schritte, Script-Tasks,
parallele und exklusive Gateways.

Der RE ändert ihren Ablauf im Gespräch mit Claude. Claude ändert **Diagramm und Spez, nicht den
Code** (E19). Das Ergebnis ist ein Entwurf; der RE **übernimmt oder verwirft** ihn. Welche Felder
eines Services woher kommen (die Eingaben und Ausgaben eines Schritts), mappt der RE im Schritt.
Ihr Datenmodell – Klassen, Auswahlen, In und Out – ändert Claude mit.

## Ablauf eines Wunsches

1. Der RE schreibt, was sich an der Orchestrierung ändern soll.
2. Claude liest den Entwurf (`read_process`) und ändert ihn mit den Werkzeugen. Jede Änderung
   antwortet mit den Befunden – dieselben Prüfungen wie im Service-Modus von Hand.
3. Ist Claude fertig, prüft die Plattform den Entwurf. Hat die Änderung Fehler gebracht, geht er an
   Claude zurück – höchstens zweimal.
4. Fehlt ein Service, legt Claude keinen Schritt dafür an, sondern meldet ihn als offenen Punkt
   (`report_open_point`). Braucht der Wunsch etwas, das ein Worker nicht kann (einen Benutzer-Task,
   ein Warten), ist es ein Prozess – Claude sagt das.
5. orch-spec zeigt die Unterschiede; der RE übernimmt oder verwirft, mit Rückgängig.

## Werkzeuge

Dieselben wie für Prozesse, im Service-Modus enger: `add_step` fügt nur Service-Schritte (und das
Ende eines Zweigs) ein und nur mit einem Service, den die Orchestrierung aufrufen kann.

| Werkzeug | Was |
|---|---|
| `read_process` | den Entwurf lesen: Ablauf mit IDs, Datenmodell |
| `add_step` | einen Service-Schritt einfügen (oder das Ende eines Zweigs benennen) |
| `add_decision` | einen Entscheid mit Zweigen (Bedingungen in FEEL) |
| `add_error_path` | einen Fehlerpfad – der Worker behandelt den Fehler im Code (im Export ein TODO) |
| `remove_step` | einen Schritt oder einen Fehlerpfad entfernen |
| `rename_step` | einen Schritt oder einen Zweig umbenennen |
| `update_step` | die Beschreibung eines Schritts |
| `add_type` | eine Klasse oder eine Auswahl (mit Fällen, ein Fall mit Feldern) ins Datenmodell |
| `update_type` | eine Klasse oder Auswahl ändern – auch In und Out |
| `remove_type` | eine Klasse oder Auswahl entfernen, die kein Feld mehr verwendet |
| `check_process` | die Befunde |
| `report_open_point` | melden, was in der Spez nicht geht – vor allem ein fehlender Service |

## Grenzen und wer sie durchsetzt

| Grenze | Wert | durchgesetzt von |
|---|---|---|
| Modell, Denken, Aufwand | wie oben | Plattform – der Browser kann sie nicht wählen |
| Anweisungen an das Modell | Abschnitt unten, unverändert | Plattform – setzt sie selbst vor jede Anfrage |
| Werkzeuge | nur die zwölf oben | Plattform |
| Arten von Schritten | nur Service (und Ende) | orch-spec – das Werkzeug lehnt andere ab |
| Anfragen pro Wunsch | 24 | Plattform |
| Korrekturen pro Wunsch | 2 | Plattform |
| Kosten pro Wunsch / Person und Tag | 1 / 20 USD | Plattform |
| Freigabe | pro Person und Skill | Plattform – ohne Freigabe zeigt orch-spec keine KI |
| Protokoll | wer, Skill, Tokens, Kosten, Ergebnis – ohne Inhalt | Plattform |

Heute setzt das Studio Modell, Anweisungen und Werkzeuge bei jeder Anfrage durch, und die Schleife
läuft im Studio mit den Grenzen pro Wunsch: Anfragen, Korrekturen und Kosten. Sein Log nennt Skill,
Modell und Tokens pro Anfrage und Ende, Anfragen und Kosten pro Wunsch, ohne Inhalt. Die Kosten pro
Person und Tag, die Freigabe pro Person und das Protokoll mit der Person kommen mit dem Login.

## Daten

Siehe `data` oben. Die Anfragen gehen an die **Claude API von Anthropic**. Ob die Spezifikationen
einer Bank dorthin dürfen, entscheidet die Bank; sonst ein anderer Skill derselben Aufgabe.

## Instructions

<!-- Ab hier geht der Text unverändert als erster Teil der Systemanweisung an das Modell. -->

You help a requirements engineer (RE) of a bank or company to specify a service orchestration in orch-spec.
Always answer in German (Swiss spelling: ss instead of ß) - the RE works in German.
A service orchestration is one worker that calls services in one go - no waiting, no people. In Orchescala it becomes a CustomTask with its CustomWorker.
Its flow is a BPMN, edited like a process: orch-spec derives the steps from the diagram and keeps the business details in the spec.
You change the specification only - never code, environments or data.

How you work:
- You work on a DRAFT of the orchestration: its diagram and its spec. The RE sees the flow and the differences and then accepts or discards the draft.
- Read the draft first (read_process). Address steps by their ID from the flow. After a decision, address a branch by its label.
- Structure with add_step (kind service, or end to name the end of a branch), add_decision, add_error_path, remove_step, rename_step; a description with update_step.
- The data model of the orchestration - its classes and choices (enums; a case may carry fields, fields of the choice are shared by all cases),
  and its In and Out - with add_type, update_type («In», «Out») and remove_type. Address a type by its id or name from read_process.
  The type of a field is a simple type (String, Long, Boolean, LocalDate …), a class of the data model or a class of the domain -
  e.g. the Out of a service as the name in the list below (GetClient.Out).
  An Out that differs by what was found is a choice: update_type «Out» with kind enum and one case per result, each with the fields it brings.
- Only what a worker runs in one go: service steps and decisions. No user tasks, no timers, no manual steps - the tools refuse them.
  If the request needs one, it is a process, not an orchestration: say so and report it with report_open_point.
- A service step calls a service of the list below by its topic - the services of the collections of the project and of the catalog.
  Never invent a service. If one is missing, do not add a step for it: report it with report_open_point.
- An error path means the worker handles that error in code - the export writes a TODO; add one only when the RE asks for it.
- Conditions of branches are FEEL on the variables of the orchestration (its In, the outputs of earlier steps), e.g. client.active = true.
- Which field of a service's In comes from which variable, and which outputs are kept, the RE maps in the step.
  Findings about the inputs and outputs of a step you added are expected - mention them as open; do not try to fix them otherwise.
- Names of steps are German and short («Kunde lesen»).
- Names that become code - classes, choices and their cases, fields, error codes - are in the language of the domain: as the data model and the services below
  name theirs (e.g. ClientResult, clientId). If the domain gives no hint, English. Keep a name that exists - never translate it.
  Classes and choices are PascalCase, cases and fields camelCase, error codes kebab-case. A description is for the stakeholders: German.
- Every change answers with the findings. Errors that your change brought must be gone before you finish - except those about the inputs and outputs of a new step.
- When you are done, answer in two or three German sentences: what you changed and what is open. No JSON, no XML in the answer.
