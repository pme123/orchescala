# KI-Modus — Seiten und Prozesse im Gespräch mit Claude

Ein Requirements Engineer (RE) beschreibt im Designer, was er will, z.B.
«Nimm im Formular ein Feld für die bevorzugte Filiale auf». Claude (Anthropic,
Modell Claude Opus 5.5) ändert daraufhin einen **Entwurf** der Spezifikation.
Den Code ändert Claude nie. Der Entwurf wird mit denselben Befunden wie im
Designer geprüft, und Claude korrigiert ihn selbst. Der RE sieht den Entwurf und
die Unterschiede und entscheidet **Übernehmen** oder **Verwerfen**
(Entscheide E19, E20 im Konzept).

| Stufe | Wo | Was Claude ändert | Geprüft mit |
|---|---|---|---|
| **A – Seiten** | Seiten → eine Seite → **Claude** | Bausteine, Bindungen, Aktionen, Texte, Rollen, Eigenschaften der Seite | den Befunden des Seiten-Designers |
| **B – Prozesse** | Prozess → **Claude** (Werkzeugleiste) | Schritte, Benutzer-Tasks, Entscheide mit Zweigen, Fehlerpfade (im Diagramm); Beschreibung und Zuweisung eines Schritts (in der Spez) | den Befunden der Spezifikation |

## Der API-Key ist der Schalter

- **Ohne Key ist von KI nichts zu sehen:** keine Panels und keine Buttons, und
  der KI-Code (samt SDK von Anthropic) wird gar nicht geladen. Einzige Spur ist
  das Symbol ✦ oben rechts. Es öffnet den Dialog **KI-Modus** mit dem Feld für
  den Key. orch-spec bleibt ohne Key vollständig nutzbar.
- **Mit Key ist der KI-Modus an.** Das Symbol ist dann violett, und im
  Seiten-Designer und in der Prozessansicht erscheint der Button **Claude**.
- **Key löschen heisst KI aus, sofort:** in allen offenen Ansichten und Tabs
  dieses Browsers. Ein offener Entwurf wird verworfen.
- Der Key ist ein Key der **Claude API** aus der Anthropic Console
  (platform.claude.com). Er wird **nur in diesem Browser** gespeichert
  (`localStorage`, `orch-spec.anthropicKey`): nie im Ordner der
  Spezifikationen, nie in SharePoint. Arbeiten zwei REs am selben Ordner, sieht
  nur der mit Key die KI.
- **Workspace-ID** (optional): Ist der Key keinem Workspace zugeordnet,
  verlangt die API zusätzlich die ID eines Workspace. Dann die ID aus der
  Console (Settings → Workspaces) eintragen. Sie wird wie der Key nur im
  Browser gespeichert.
- **Schutz des Keys:** Jedes Skript, das in der Seite läuft, kann den Key aus
  `localStorage` lesen. orch-spec zeigt Inhalte der Spez deshalb nie als
  ausführbares HTML: Markdown-Felder geben eingegebenes HTML als Text aus, Links
  nur mit `http(s)`/`mailto` (`src/markdownEdit.ts`), alles andere rendert React
  escaped. Wer orch-spec selbst hostet, sollte zusätzlich eine
  Content-Security-Policy setzen, die Skripte nur vom eigenen Origin und
  Verbindungen nur zu `api.anthropic.com` (plus Login und SharePoint) zulässt.
- **Wer den Key eingibt, bezahlt.** Ein Claude-Abo (Pro, Max) deckt die API
  nicht ab. Als Grenze dient das Guthaben in der Console mit ausgeschaltetem
  Auto-Reload.

## Bedienung

**Seiten (Stufe A).** Eine Seite öffnen und auf **Claude** klicken. Rechts
öffnet sich der Chat. Wunsch eingeben und mit Enter senden.
- Claude liest die Seite, ändert den Entwurf und prüft ihn. Bringt der Entwurf
  neue Fehler, wird Claude zurückgeschickt, höchstens zweimal.
- Die **Vorschau** zeigt den Entwurf mit demselben Renderer. Die Gliederung
  markiert neue und geänderte Bausteine violett. Unter dem Chat stehen die
  **Unterschiede**; ein Klick wählt den Baustein.
- **Übernehmen** schreibt den Entwurf wie eine Änderung von Hand: ein Schritt im
  Rückgängig (⌘Z), automatisch gespeichert. **Verwerfen** lässt die Seite wie
  vorher.
- Solange ein Entwurf offen ist, ist die Seite schreibgeschützt.
- Wurde Claude nicht fertig (Schrittgrenze, Antwort abgeschnitten, angehalten,
  Fehler), steht ein Hinweis über dem Entwurf und der Button heisst **Trotzdem
  übernehmen**: Der Entwurf kann halb fertig sein.
- Hat sich die Seite oder der Prozess seit Beginn des Entwurfs geändert (neu
  geladen, abgeglichen), wird **Übernehmen** abgelehnt: Der Entwurf würde diese
  Änderung überschreiben. Verwerfen und Claude nochmals fragen.
- Im selben Gespräch lässt sich weiter am Entwurf arbeiten («noch etwas
  kürzer»). **Neues Gespräch** (Symbol oben im Chat) beginnt von vorn.
- **Neue Seite:** Mit Key hat der Dialog «Neu» ein Feld **Beschreibung für
  Claude**. Claude entwirft die Seite dann gleich nach dem Anlegen.

**Prozesse (Stufe B).** Einen Prozess öffnen und in der Werkzeugleiste auf
**Claude** klicken.
- Der Entwurf erscheint im **Diagramm** und im **Ablauf**, beide
  schreibgeschützt, bis du übernimmst oder verwirfst.
- Die Struktur ändert Claude im BPMN, denn der Ablauf wird aus dem Diagramm
  abgeleitet. Neue Elemente kommen an ihren Platz, was danach kommt, rückt nach
  rechts. Die Details (Beschreibung, wer einen Benutzer-Task sieht) ändert
  Claude in der Spezifikation.
- **Übernehmen** geht den Weg einer Änderung im Diagramm. Der **Verlauf**
  verzeichnet sie mit der eigenen Quelle **KI (Claude)**, die Wünsche des RE
  stehen als Notiz dabei. Die letzte übernommene Änderung lässt sich mit
  **Rückgängig** im Chat zurücknehmen, solange danach nichts anderes geändert
  wurde.

**Was Claude nicht tut:**
- Services oder Worker erfinden. Fehlt einer, meldet Claude ihn als **offenen
  Punkt für die Entwicklung** und baut, was ohne ihn geht, z.B. ein freies
  Textfeld statt einer Auswahl. Ebenso ein Feld, das dem `In` eines Services
  noch fehlt: Claude nimmt die Eingabe auf und meldet das Feld.
- Klassen und Interaktionen im Datenmodell eines Prozesses anlegen. Ein neuer
  Benutzer-Task braucht eine Interaktion mit `In`/`Out`, diese legt der RE an
  (Datenmodell → aus dem Ablauf). Die Warnung «Noch keine Interaktion» ist dann
  erwartet.
- Auf Umgebungen, Daten oder Code zugreifen. Claude hat nur Werkzeuge auf dem
  Entwurf.

## Welche Daten an Anthropic gehen

Nur die **Spezifikation** und der **Chat**:

- **Seiten:** die Seite im Entwurf und auf Anfrage die anderen Seiten der App
  (JSON), dazu die Liste der Seiten (Pfad, Titel, Zugang) und die Namen der
  Werte-Texte.
- **Prozesse:** der Ablauf (Schritte, Zweige, Fehlerpfade mit IDs und Namen,
  Beschreibungen gekürzt), die Interaktionen und Klassen des Prozesses.
  Kommentare und Personen gehen nicht mit.
- **Datenmodell:** die Worker und Services der Domain mit den Feldern von
  `In`/`Out`, die Prozesse, Messages und Benutzer-Tasks.
- **Der Katalog der Bausteine:** der Quelltext der Seiten-Spezifikation
  (`src/pages/runtime/spec.ts`).

**Keine Kundendaten:** Die Vorschau arbeitet mit Beispieldaten, die aus den
Typen erzeugt werden, und nichts davon geht an Anthropic. Für echte Projekte ist
mit der Bank zu klären, ob ihre Spezifikationen an Anthropic gehen dürfen
(Konzept, Offene Punkte).

## Technik

- **Ablauf ohne Backend:** Der Browser ruft die Claude API direkt auf, mit dem
  TypeScript-SDK von Anthropic und `dangerouslyAllowBrowser`. Das ist mit einem
  persönlichen Key vertretbar, weil der Key der Person vor dem Browser gehört.
  Ein Proxy (Gateway, Bedrock, Vertex) würde nur `send` in `src/ai/client.ts`
  ersetzen.
- **Anfrage:** Modell `claude-opus-5-5`, adaptives Denken, `effort: medium`.
  Lehnt ein Sicherheitsfilter ab, wiederholt die API die Anfrage selbst auf
  einem passenden Modell (`fallbacks: "default"`).
- **Prompt Caching:** Die festen Teile werden gecacht: Anweisungen und Katalog
  der Bausteine (Breakpoint 1), das Datenmodell zu Beginn des Gesprächs
  (Breakpoint 2) und das wachsende Gespräch (automatisch).
- **Agent-Schleife** (`src/ai/agent.ts`):
  - Claude ruft Werkzeuge auf, bis es fertig ist, höchstens 24 Anfragen pro
    Wunsch.
  - Danach prüft die App den Entwurf. Fehler, die erst der Entwurf gebracht hat,
    gehen als neue Nachricht an Claude zurück, höchstens zweimal.
  - Das Gespräch wird nur verlängert, nie umgeschrieben.

| Datei | Zweck |
|---|---|
| `src/ai/key.ts` | der Schalter: Key und Workspace im Browser, `useAiKey` |
| `src/ai/agent.ts` | die Schleife mit Claude, Selbstkorrektur; `send` wird übergeben (in den Tests gemockt) |
| `src/ai/client.ts` | `send` mit dem SDK, Fehlertexte |
| `src/ai/context.ts` | Anweisungen, Datenmodell als Text, Systemprompt mit Cache-Breakpoints |
| `src/ai/pageTools.ts` | Werkzeuge auf dem Seiten-Entwurf (über `insertBlock`, `updateBlock`, `relocateBlock`, `removeBlock`, `pageFindings`) |
| `src/ai/bpmnEdit.ts` | Schritt, Entscheid, Fehlerpfad im BPMN einfügen, entfernen, umbenennen – samt Layout |
| `src/ai/processTools.ts` | Werkzeuge auf dem Prozess-Entwurf; die Spez folgt dem Diagramm (`importBpmn` + `mergeSpec`), Befunde aus `collectFindings` |
| `src/ai/diff.ts` | Unterschiede Seite ↔ Entwurf, Prozess ↔ Entwurf |
| `src/ai/cost.ts` | Tokens und Kosten je Änderung |
| `src/ai/AiChat.tsx`, `AiPanel.tsx`, `ProcessAiPanel.tsx` | der Chat, für Seiten und Prozesse |

Tests: `tests/aiPages.test.ts` und `tests/aiProcess.test.ts`. Sie laufen ohne
Netz, Claude ist darin gemockt. Geprüft werden die Werkzeuge, Übernehmen und
Verwerfen, die Selbstkorrektur, der Schalter über den Key, die Kosten und die
Unterschiede.

## Kosten — gemessen

Gemessen an der Demo «Kundentermine», Preise Claude Opus 5.5 (Oktober 2026).
Der Chat zeigt die Kosten nach jeder Änderung an, dieselbe Zeile steht als
`[orch-spec KI]` in der Konsole des Browsers.

| Änderung | Anfragen | Tokens ein (davon Cache) / aus | Kosten |
|---|---|---|---|
| A: Feld «Bevorzugte Filiale», 2 offene Punkte | 4 | 40k (27k) / 0.9k | 0.09 USD |
| A: Button umbenennen, Datenschutz-Hinweis | 3 | 52k (42k) / 0.9k | 0.07 USD |
| A: Dankestext auf «Termin bestätigen» | 3 | 23k (19k) / 0.3k | 0.03 USD |
| A: Link zurück zur Buchung (nicht übernommen) | 4 | 32k (23k) / 0.8k | 0.07 USD |
| A: Feld «Filiale», ohne geladenen Katalog: nur offener Punkt | 3 | 23k (13k) / 0.7k | 0.06 USD |
| B: Fehlerpfad «slot-taken» mit Benutzer-Task und Ende | 5 | 43k (30k) / 1.2k | 0.09 USD |

Eine Seitenänderung kostet damit **0.03–0.09 USD** und liegt unter der Schätzung
im Konzept (0.10–0.50 USD). Die Prozessänderung lag mit 0.09 USD ebenfalls weit
unter den geschätzten 1–3 USD, war aber auch klein; ein ganzer neuer Prozess ist
noch nicht gemessen. Eine Änderung dauert etwa 15–40 Sekunden.

Den grössten Teil der Kosten machen die **Schreibvorgänge in den Cache** aus
(1.25 × Input-Preis), nicht die Ausgabe. Gelesen wird aus dem Cache für 0.20 USD
pro Million Tokens: Ein zweiter Wunsch im selben Gespräch ist deshalb günstiger
als ein neues Gespräch.

## Offene Punkte

- **Stufe C light** (Service-Spez aus einer OpenAPI) ist nicht umgesetzt. Den
  deterministischen Import aus OpenAPI gibt es schon (Admin → Katalog,
  `tools/openapi2catalog`).
- **Seiten haben kein Änderungsprotokoll.** Bei Prozessen hält der Verlauf eine
  KI-Änderung mit eigener Quelle fest, bei Seiten gibt es noch gar keinen
  Verlauf.
- **Prozess neu anlegen:** Stufe B ändert bestehende Prozesse. Ein neuer Prozess
  entsteht wie bisher mit der Vorlage, danach kann Claude ihn ausbauen.
- **Datenmodell des Prozesses:** Interaktionen und Klassen für neue Schritte
  legt der RE an.
- **Zentraler Key:** Ein Proxy mit einem Key der Bank wäre der nächste Schritt.
  Für ihn wäre Workload Identity Federation statt eines festen Keys gut.
