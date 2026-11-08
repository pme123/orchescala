---
# Skill: eine Aufgabe mit einem Provider. Die Plattform führt ihn aus – Schleife, Werkzeuge,
# Prüfungen und Grenzen laufen auf dem Server; der Browser schickt nur den Wunsch und die Spez.
name: processCreator-anthropic
task: processCreator
provider: anthropic
version: 1
description: Den Ablauf eines Prozesses in orch-spec im Gespräch ändern – Diagramm und Spez, als Entwurf, den der RE übernimmt oder verwirft.

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
  - check_process
  - report_open_point

data:
  sent:
    - der Prozess im Entwurf – der Ablauf als Baum mit den IDs, sein Datenmodell (Interaktionen, Klassen)
    - die Worker der Domain mit den Feldern von In/Out und die Prozesse der App
    - der Chat des RE
  never:
    - Kundendaten, Prozessinstanzen, Variablen zur Laufzeit
    - Code, Umgebungen, Zugangsdaten
---

# Process-Creator · Anthropic

## Zweck

Ein Requirements Engineer (RE) ändert den Ablauf eines Prozesses in der Prozessansicht von
orch-spec, im Gespräch mit Claude: Schritte, Benutzer-Tasks, Entscheide, Fehlerpfade. Claude ändert
**Diagramm und Spez, nicht den Code** (E19). Das Ergebnis ist ein Entwurf; der RE sieht ihn im
Diagramm und im Ablauf und **übernimmt oder verwirft** ihn.

Eine Service-Orchestrierung (ein Prozess im Service-Modus) hat ihren eigenen Skill:
`serviceOrchestrator`.

## Ablauf eines Wunsches

1. Der RE schreibt, was sich am Ablauf ändern soll.
2. Claude liest den Entwurf (`read_process`) und ändert ihn mit den Werkzeugen. Jede Änderung am
   Diagramm geht durch denselben Import wie eine von Hand; die Spez folgt dem Diagramm, und die
   Antwort nennt die Befunde – dieselben Prüfungen wie in der Prozessansicht.
3. Ist Claude fertig, prüft die Plattform den Entwurf. Hat die Änderung Fehler gebracht, geht er an
   Claude zurück – höchstens zweimal.
4. Fehlt ein Worker im Datenmodell, legt Claude ihn nicht an, sondern meldet ihn als offenen Punkt
   (`report_open_point`); auf Wunsch steht ein manueller Schritt als Platzhalter im Ablauf.
5. orch-spec zeigt die Unterschiede; der RE übernimmt oder verwirft. Übernommen wird wie eine
   Änderung im Diagramm, mit der Quelle «KI» im Verlauf und mit Rückgängig.

## Werkzeuge

Alle Werkzeuge arbeiten nur auf dem Entwurf – nie auf dem Ordner, einer Umgebung, Daten oder Code.
Es ist derselbe Code wie in der Prozessansicht, also dieselben Prüfungen.

| Werkzeug | Was |
|---|---|
| `read_process` | den Entwurf lesen: Ablauf mit IDs, Datenmodell |
| `add_step` | einen Schritt einfügen – Benutzer-Task, Service (Worker), manuell, Timer, Ende |
| `add_decision` | einen Entscheid mit Zweigen (Bedingungen in FEEL) |
| `add_error_path` | einen Fehlerpfad an einem Schritt |
| `remove_step` | einen Schritt oder einen Fehlerpfad entfernen |
| `rename_step` | einen Schritt, ein Ereignis oder einen Zweig umbenennen |
| `update_step` | Beschreibung, und bei einem Benutzer-Task, wer ihn sieht |
| `check_process` | die Befunde der Spez |
| `report_open_point` | melden, was in der Spez nicht geht – vor allem ein fehlender Worker |

## Grenzen und wer sie durchsetzt

| Grenze | Wert | durchgesetzt von |
|---|---|---|
| Modell, Denken, Aufwand | wie oben | Plattform – der Browser kann sie nicht wählen |
| Anweisungen an das Modell | Abschnitt unten, unverändert | Plattform – setzt sie selbst vor jede Anfrage |
| Werkzeuge | nur die neun oben | Plattform |
| Anfragen pro Wunsch | 24 | Plattform |
| Korrekturen pro Wunsch | 2 | Plattform |
| Kosten pro Wunsch / Person und Tag | 1 / 20 USD | Plattform |
| Freigabe | pro Person und Skill | Plattform – ohne Freigabe zeigt orch-spec keine KI |
| Protokoll | wer, Skill, Tokens, Kosten, Ergebnis – ohne Inhalt | Plattform |

Heute setzt das Studio die ersten drei Zeilen bei jeder Anfrage durch, und sein Log nennt Skill,
Modell und Tokens ohne Inhalt. Die Schleife läuft noch im Browser; Anfragen, Korrekturen und Kosten
pro Wunsch, die Freigabe pro Person und das Protokoll mit der Person kommen mit dem Agent auf dem
Server und dem Login.

## Daten

Siehe `data` oben. Die Anfragen gehen an die **Claude API von Anthropic**. Ob die Spezifikationen
einer Bank dorthin dürfen, entscheidet die Bank; sonst ein anderer Skill derselben Aufgabe.

## Instructions

<!-- Ab hier geht der Text unverändert als erster Teil der Systemanweisung an das Modell. -->

You help a requirements engineer (RE) of a bank or company to specify a process of an app in orch-spec.
Always answer in German (Swiss spelling: ss instead of ß) - the RE works in German.
The process runs on Camunda (BPMN); orch-spec derives the flow (steps, user tasks, decisions, error paths) from the diagram and keeps the business details in the spec.
You change the specification only - never code, environments or data.

How you work:
- You work on a DRAFT of one process: its diagram and its spec. The RE sees the flow and the differences and then accepts or discards the draft.
- Read the draft first (read_process). Address steps by their ID from the flow. After a decision, address a branch by its label.
- Structure with add_step, add_decision, add_error_path, remove_step, rename_step; details (description, who sees a user task) with update_step.
- Names of steps are German and short, as in the existing process («Adresse prüfen»). Error codes are kebab-case («address-invalid»).
- A service step calls a worker of the data model below by its topic. Never invent a worker. If one is missing, do not add it: report it with report_open_point
  and, if the RE wants the step in the flow now, insert a manual step with the same name as a placeholder and say so.
- Conditions of branches are FEEL on the process variables (the In of the process, the outputs of earlier steps), e.g. address.valid = true.
- A new user task or worker needs an interaction with In/Out in the data model of the process - the RE creates it (Datenmodell → aus dem Ablauf);
  the warning «Noch keine Interaktion» is expected, mention it as open.
- Every change answers with the findings. Errors that your change brought must be gone before you finish.
- When you are done, answer in two or three German sentences: what you changed and what is open. No JSON, no XML in the answer.
