# KI-Modus — Seiten und Prozesse im Gespräch mit Claude

Ein Requirements Engineer (RE) beschreibt im Designer, was er will, z.B.
«Nimm im Formular ein Feld für die bevorzugte Filiale auf». Claude (Anthropic,
Modell Claude Opus 5.5) ändert daraufhin einen **Entwurf** der Spezifikation.
Den Code ändert Claude nie. Der Entwurf wird mit denselben Befunden wie im
Designer geprüft, und Claude korrigiert ihn selbst. Der RE sieht den Entwurf und
die Unterschiede und entscheidet **Übernehmen** oder **Verwerfen**
(Entscheide E19, E23 im Konzept).

| Stufe | Wo | Was Claude ändert | Geprüft mit |
|---|---|---|---|
| **A – Seiten** | Seiten → eine Seite → **Claude** | Bausteine, Bindungen, Aktionen, Texte, Rollen, Eigenschaften der Seite | den Befunden des Seiten-Designers |
| **B – Prozesse** | Prozess → **Claude** (Werkzeugleiste) | Schritte, Benutzer-Tasks, Entscheide mit Zweigen, Fehlerpfade (im Diagramm); Beschreibung und Zuweisung eines Schritts (in der Spez) | den Befunden der Spezifikation |

## Das Studio ist der Schalter

- **Die KI schaltet das Studio ein,** nicht der Browser: Hat das Studio einen
  Key (`STUDIO_AI_ANTHROPIC_API_KEY`), antwortet `GET /ai/config` mit
  `enabled: true` samt Anbieter und Modell, nie mit dem Key. orch-spec fragt das
  einmal beim Laden.
- **Pro Aufgabe ein Skill:** Das Studio bietet nur die Aufgaben an, für die es einen Skill hat
  (`ai/skills/<Aufgabe>/<Provider>/SKILL.md` in seinen Ressourcen) – mit Einschränkungen,
  Schritten und Anweisungen, die eine Bank prüfen kann. `GET /ai/config` nennt sie in `tasks`,
  und jede Stelle zeigt ihre KI nur, wenn ihre Aufgabe dabei ist:

  | Aufgabe | Stelle in orch-spec | Skill heute |
  |---|---|---|
  | `uiCreator` | Seiten-Designer, «Neue Seite» | ✓ `anthropic` |
  | `processCreator` | Prozessansicht | ✓ `anthropic` |
  | `serviceOrchestrator` | Prozessansicht im Service-Modus (Service-Orchestrierung) | ✓ `anthropic` |
  | `serviceRegistration`, `serviceCreator` | Katalog, Services | – (noch keine Stelle) |

  Eine Service-Orchestrierung ist ein Worker, der Services aufruft: Im Service-Modus fügt Claude
  nur Service-Schritte (mit einem Service, den auch ein Schritt aufrufen kann – Collections und
  Katalog) und Entscheide ein, keine Benutzer-Tasks, Timer oder manuellen Schritte. Die Eingaben
  und Ausgaben eines neuen Schritts mappt der RE im Schritt; Claude nennt sie als offen.

  In Prozessen und Orchestrierungen ändert Claude auch das **Datenmodell**: Klassen und Auswahlen
  (Enums, ein Fall mit Feldern) anlegen, ändern und entfernen, In und Out setzen – z.B. ein Out als
  Auswahl mit einem Fall pro Ergebnis. Ein Feld hat einen einfachen Typ, eine Klasse des
  Datenmodells oder eine der Domain (etwa das Out eines Services). Das In und Out einer Interaktion
  (Benutzer-Task, Worker) bleibt beim RE.

  Jede Aufgabe hat ihre eigene Adresse im Studio (`/ai/uiCreator/turn`); eine Aufgabe
  ohne Skill lehnt das Studio ab (403).
- **Der Skill bestimmt, nicht der Browser:** Das Studio setzt die Anweisungen des Skills
  (Abschnitt «Instructions») an den Anfang jeder Anfrage; orch-spec schickt nur den Kontext
  (Katalog, Datenmodell, Seiten). Modell, Denken, Aufwand und Fallback nimmt das Studio aus dem
  Skill, und es lässt nur die Werkzeuge des Skills zu. Es hält auch die Grenzen pro Wunsch ein
  (`limits`); die Grenze pro Person kommt mit dem Login.
- **Ohne Freigabe ist von KI nichts zu sehen:** kein Symbol, keine Panels, keine
  Buttons, und der KI-Code (samt SDK von Anthropic) wird gar nicht geladen. So
  ist es auch ohne Studio, etwa für die Doku als Ordner oder auf GitHub Pages.
  orch-spec bleibt ohne KI vollständig nutzbar.
- **Mit Freigabe ist der KI-Modus an.** Oben rechts erscheint das violette
  Symbol ✦ (Dialog **KI-Modus**: Anbieter, Modell und die Aufgaben mit Skill),
  und an den Stellen dieser Aufgaben der Button **Claude**.
- **Im Browser liegt kein Key.** Ein Wunsch geht an das Studio
  (`/ai/<Aufgabe>/turn`), und das Studio schickt jede Anfrage mit seinem Key
  an die Claude API. Das Modell bestimmt der Skill, `max_tokens` ist begrenzt. Ein Key,
  den eine frühere Version im Browser gespeichert hat
  (`orch-spec.anthropicKey`), wird beim Laden gelöscht.
- **Die Kosten trägt, wem der Key des Studios gehört:** die Firma, nicht die
  Person. Am besten ein Key aus einem eigenen Workspace mit Ausgabenlimit.
- **Login:** Das Studio hat im PoC keinen und hört nur auf `localhost`. Wer es
  erreicht, nutzt seinen Key. Im Ziel gibt das Studio die KI pro Person frei
  (Entra, `GET /ai/tasks`).

| Variable des Studios | |
|---|---|
| `STUDIO_AI_ANTHROPIC_API_KEY` | der Key der Claude API – der Schalter |
| `STUDIO_AI_ANTHROPIC_WORKSPACE_ID` | nur wenn die API sie verlangt (Key ohne Workspace) |
| `STUDIO_AI_MODEL` | Standard `claude-opus-5-5` – für einen Skill, der kein Modell nennt |
| `STUDIO_AI_ANTHROPIC_URL` | Standard `https://api.anthropic.com` – z.B. ein Gateway der Firma |

**Im Dev-Server** (`npm run dev`) gibt es die KI nur mit einem laufenden Studio:
`ORCH_SPEC_STUDIO=http://localhost:8880` in `.env.local`, dann leitet Vite
`/ai/…` dorthin weiter.

## Bedienung

**Seiten (Stufe A).** Eine Seite öffnen und auf **Claude** klicken. Rechts
öffnet sich der Chat. Wunsch eingeben und mit Enter senden.
- Claude liest die Seite, ändert den Entwurf und prüft ihn. Bringt der Entwurf
  neue Fehler, wird Claude zurückgeschickt, höchstens zweimal.
- Die **Vorschau** zeigt den Entwurf mit demselben Renderer. Die Gliederung
  markiert neue und geänderte Bausteine violett. Unter dem Chat stehen die
  **Unterschiede**; ein Klick wählt den Baustein.
- **Übernehmen** schreibt den Entwurf wie eine Änderung von Hand: ein Schritt im
  Rückgängig (⌘Z), automatisch gespeichert. Der **Verlauf** der Seite verzeichnet
  ihn mit der eigenen Quelle **KI (Claude)**, die Wünsche des RE stehen als Notiz
  dabei. **Verwerfen** lässt die Seite wie vorher.
- Solange Claude arbeitet und solange ein Entwurf offen ist, ist die Seite
  schreibgeschützt.
- Wurde Claude nicht fertig (Schrittgrenze, Antwort abgeschnitten, angehalten,
  Fehler), steht ein Hinweis über dem Entwurf und der Button heisst **Trotzdem
  übernehmen**: Der Entwurf kann halb fertig sein.
- Hat sich die Seite oder der Prozess trotzdem seit Beginn des Entwurfs geändert
  (neu geladen, abgeglichen), wird **Übernehmen** abgelehnt: Der Entwurf würde diese
  Änderung überschreiben. Verwerfen und Claude nochmals fragen.
- Im selben Gespräch lässt sich weiter am Entwurf arbeiten («noch etwas
  kürzer»). **Neues Gespräch** (Symbol oben im Chat) beginnt von vorn.
- **Neue Seite:** Mit Key hat der Dialog «Neu» ein Feld **Beschreibung für
  Claude**. Claude entwirft die Seite dann gleich nach dem Anlegen.

**Prozesse (Stufe B).** Einen Prozess öffnen und in der Werkzeugleiste auf
**Claude** klicken.
- Der Entwurf erscheint im **Diagramm** und im **Ablauf**, beide
  schreibgeschützt, bis du übernimmst oder verwirfst. Schon während Claude
  arbeitet, bleibt der Prozess so, wie er ist.
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

- **Die Schleife läuft im Studio** (E28 Schritt 5): orch-spec schickt Wunsch,
  Entwurf und Kontext an `POST /ai/<Aufgabe>/turn`. Das Studio führt die
  Schleife aus (`src/ai/turn.ts` im Kern, mit den Werkzeugen der Aufgabe), wendet
  bei jeder Anfrage den Skill an, setzt Key und Workspace und hält die Grenzen des
  Skills ein (`limits`: Anfragen, Korrekturen, Kosten pro Wunsch). Die Ereignisse
  kommen laufend, eine JSON-Zeile je Ereignis, am Ende der Entwurf. Fehler der API
  kommen in der Form der API zurück; orch-spec liest sie mit dem SDK von Anthropic.
  Hält der RE an, endet der Zug auch im Studio; was dort schon geschah, fällt
  weg, und der Entwurf bleibt, wie er war. Die frühere Schleife im Browser
  (`/ai/<Aufgabe>/v1/messages`, `STUDIO_AI_AGENT`) gibt es nicht mehr.
- **Anfrage:** wie im Skill – heute bei allen drei `claude-opus-5-5`, adaptives Denken, `effort: medium`.
  Lehnt ein Sicherheitsfilter ab, wiederholt die API die Anfrage selbst auf
  einem passenden Modell (`fallbacks: "default"`). Hat ein anderes Modell geantwortet,
  nennt die Kostenzeile es, und der Betrag ist eine Schätzung (gerechnet mit
  den Preisen von Opus 5.5).
- **Prompt Caching:** Die festen Teile werden gecacht: Anweisungen des Skills und Katalog
  der Bausteine (Breakpoint 1), das Datenmodell zu Beginn des Gesprächs
  (Breakpoint 2) und das wachsende Gespräch (automatisch).
- **Agent-Schleife** (`src/ai/agent.ts`):
  - Claude ruft Werkzeuge auf, bis es fertig ist, höchstens 24 Anfragen pro
    Wunsch (im Studio: `limits.steps_per_turn` des Skills; dazu
    `limits.usd_per_turn` – erreicht ein Wunsch die Kosten, hält die Schleife
    vor der nächsten Anfrage an).
  - Danach prüft die App den Entwurf. Fehler, die erst der Entwurf gebracht hat,
    gehen als neue Nachricht an Claude zurück, höchstens zweimal.
  - Das Gespräch wird nur verlängert, nie umgeschrieben.

| Datei | Zweck |
|---|---|
| `src/ai/config.ts` | der Schalter: `GET /ai/config` des Studios, die Aufgaben mit Skill, `useAiFor` |
| `src/ai/agent.ts` | die Schleife mit Claude, Selbstkorrektur; `send` wird übergeben (in den Tests gemockt) |
| `src/ai/client.ts` | der Zug im Studio (`turnOnStudio`), Fehlertexte |
| `src/ai/turn.ts` | der Zug im Studio: die Aufgaben mit Zug, ihre Werkzeuge, die Anfrage, die Zeilen der Antwort (im Kern – dasselbe für orch-spec und Studio) |
| `src/ai/context.ts` | Kontext: Katalog, Datenmodell als Text, Systemprompt mit Cache-Breakpoints (die Anweisungen sind in den Skills des Studios) |
| `src/ai/pageTools.ts` | Werkzeuge auf dem Seiten-Entwurf (über `insertBlock`, `updateBlock`, `relocateBlock`, `removeBlock`, `pageFindings`) |
| `src/ai/bpmnEdit.ts` | Schritt, Entscheid, Fehlerpfad im BPMN einfügen, entfernen, umbenennen – samt Layout |
| `src/ai/processTools.ts` | Werkzeuge auf dem Prozess-Entwurf; die Spez folgt dem Diagramm (`importBpmn` + `mergeSpec`), Befunde aus `collectFindings` und `checkTypes`; das Datenmodell (`add_type`, `update_type`, `remove_type`); im Service-Modus nur Service-Schritte |
| `src/ai/diff.ts` | Unterschiede Seite ↔ Entwurf, Prozess ↔ Entwurf |
| `src/ai/cost.ts` | Tokens und Kosten je Änderung |
| `src/ai/AiChat.tsx`, `AiPanel.tsx`, `ProcessAiPanel.tsx` | der Chat, für Seiten und Prozesse |

Tests: `tests/aiPages.test.ts`, `tests/aiProcess.test.ts` und `tests/aiTurn.test.ts`
(der Zug im Studio: derselbe Entwurf wie mit der Schleife allein, die Grenzen, der Client). Sie
laufen ohne Netz, Claude ist darin gemockt. Geprüft werden die Werkzeuge, Übernehmen und
Verwerfen, die Selbstkorrektur, der Schalter über das Studio, die Kosten und die
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
- **Prozess neu anlegen:** Stufe B ändert bestehende Prozesse. Ein neuer Prozess
  entsteht wie bisher mit der Vorlage, danach kann Claude ihn ausbauen.
- **Datenmodell des Prozesses:** Interaktionen und Klassen für neue Schritte
  legt der RE an.
- **Freigabe pro Person:** Im PoC gibt das Studio die KI allen frei, die es
  erreichen. Im Ziel mit Entra und `GET /ai/tasks` (welche Aufgaben eine Person
  nutzen darf); für den Key Workload Identity Federation statt eines festen Keys.
