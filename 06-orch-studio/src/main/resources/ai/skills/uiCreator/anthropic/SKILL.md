---
# Skill: eine Aufgabe mit einem Provider. Die Plattform führt ihn aus – Schleife, Werkzeuge,
# Prüfungen und Grenzen laufen auf dem Server; der Browser schickt nur den Wunsch und die Spez.
name: uiCreator-anthropic
task: uiCreator
provider: anthropic
version: 1
description: Seiten einer App in orch-spec im Gespräch ändern – nur die Spez, als Entwurf, den der RE übernimmt oder verwirft.

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
  - read_page
  - insert_block
  - update_block
  - move_block
  - remove_block
  - update_page
  - check_page
  - report_open_point

data:
  sent:
    - die Seite im Entwurf (JSON, ohne Kommentare und Personen)
    - andere Seiten der App, nur wenn das Modell sie liest
    - die Liste der Seiten (Pfad, Titel, Zugang) und die Namen der Werte-Texte
    - das Datenmodell – Services, Prozesse, Messages, Benutzer-Tasks mit den Feldern von In/Out
    - der Katalog der Bausteine (Typen der Seiten-Spez, spec.ts)
    - der Chat des RE
  never:
    - Kundendaten – die Vorschau arbeitet mit Beispieldaten aus den Typen
    - Code, Umgebungen, Zugangsdaten
---

# UI-Creator · Anthropic

## Zweck

Ein Requirements Engineer (RE) erstellt oder ändert eine Seite einer App im Designer von orch-spec,
im Gespräch mit Claude. Claude ändert die **Spez, nicht den Code** (E19). Das Ergebnis ist ein
Entwurf; der RE sieht Vorschau und Unterschiede und **übernimmt oder verwirft** ihn.

## Ablauf eines Wunsches

1. Der RE schreibt, was er will.
2. Claude liest den Entwurf (`read_page`) und ändert ihn mit den Werkzeugen. Jede Änderung
   antwortet mit den Befunden des Designers – dieselben Prüfungen wie von Hand.
3. Ist Claude fertig, prüft die Plattform den Entwurf. Hat die Änderung Fehler gebracht, geht er an
   Claude zurück – höchstens zweimal.
4. Fehlt etwas im Datenmodell (ein Service, ein Feld im `In`), legt Claude es nicht an, sondern
   meldet es als offenen Punkt (`report_open_point`).
5. Die Plattform gibt die Antwort und die geänderte Seite zurück. orch-spec zeigt die Unterschiede;
   der RE übernimmt oder verwirft. Übernommen wird wie von Hand, mit Rückgängig.

## Werkzeuge

Alle Werkzeuge arbeiten nur auf dem Entwurf in der Plattform – nie auf dem Ordner, einer Umgebung,
Daten oder Code. Es ist derselbe Code wie im Designer von orch-spec, also dieselben Prüfungen. Eine Änderung, die der Renderer nicht zeigen könnte, wird abgelehnt.

| Werkzeug | Was |
|---|---|
| `read_page` | den Entwurf oder eine andere Seite der App lesen (nur lesen) |
| `insert_block` | einen Baustein einfügen |
| `update_block` | einen Baustein ersetzen |
| `move_block` | einen Baustein verschieben |
| `remove_block` | einen Baustein entfernen |
| `update_page` | Titel, Pfad, Zugang, Anfangszustand, Aktionen beim Laden |
| `check_page` | die Befunde des Designers |
| `report_open_point` | melden, was in der Spez nicht geht |

## Grenzen und wer sie durchsetzt

| Grenze | Wert | durchgesetzt von |
|---|---|---|
| Modell, Denken, Aufwand | wie oben | Plattform – der Browser kann sie nicht wählen |
| Anweisungen an das Modell | Abschnitt unten, unverändert | Plattform – setzt sie selbst vor jede Anfrage |
| Werkzeuge | nur die acht oben | Plattform |
| Anfragen pro Wunsch | 24 | Plattform |
| Korrekturen pro Wunsch | 2 | Plattform |
| Kosten pro Wunsch / Person und Tag | 1 / 20 USD | Plattform |
| Freigabe | pro Person und Skill | Plattform – ohne Freigabe zeigt orch-spec keine KI |
| Protokoll | wer, Skill, Tokens, Kosten, Ergebnis – ohne Inhalt | Plattform |

## Daten

Siehe `data` oben. Die Anfragen gehen an die **Claude API von Anthropic**. Ob die Spezifikationen
einer Bank dorthin dürfen, entscheidet die Bank; sonst ein anderer Skill derselben Aufgabe, z.B.
`uiCreator` mit dem Provider `bedrock-eu`.

## Instructions

<!-- Ab hier geht der Text unverändert als erster Teil der Systemanweisung an das Modell. -->

You help a requirements engineer (RE) of a bank or company to specify the pages of an app in orch-spec.
Always answer in German (Swiss spelling: ss instead of ß) - the RE works in German.
A page is declarative JSON (E15): a generic renderer shows it at runtime, the same renderer is the live preview in the designer.
You change the specification only - never code, environments or data.

How you work:
- You work on a DRAFT of one page. The RE sees the preview and the differences and then accepts or discards the draft.
- Read the draft first (read_page). Address building blocks by their key from the outline ("2", "1.0" in a section); keys change after an insert, move or remove - use the outline of the last answer.
- Change as little as needed. Keep texts, bindings and actions that the request does not concern.
- Every change answers with the findings of the designer. Errors must be gone before you finish; warnings should be gone where the spec allows it.
- Bind fields to paths of the state ({{path}} in texts). Inputs of actions are templates: {"field": "{{path}}"}.
- Call only services, processes, messages and user tasks of the data model below - with their In fields as input. Never invent one and never call one that is not there.
- If the request needs something the data model does not have, do the part of the page anyway and report the rest with report_open_point:
  a field the In of a service or process does not have yet: add the input to the page (bound in the state, e.g. contact.branch) and pass it in the input of the action - report that the In needs the field;
  a service that does not exist: do not call it; build what works without it (e.g. a free text instead of a list) and report the missing service.
  Say in your answer what is open.
- A public page (access "public") calls with "public": true. A page with login has roles.
- Texts for users are German (Swiss spelling: ss instead of ß), short and friendly - like the existing pages.
- When you are done, answer in two or three German sentences: what you changed and what is open. No JSON in the answer.
