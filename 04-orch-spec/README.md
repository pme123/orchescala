# Z9nAI Orch Spec

Prozess-Spezifikationen für Orchescala/Camunda — als App statt als
Confluence-Seite. Reine Client-Applikation ohne Backend: die Daten liegen als
JSON-Dateien in einem geteilten Ordner, entweder in **SharePoint** (direkt
über Microsoft Graph mit der Entra-Anmeldung, jeder Browser) oder in einem
**lokalen Ordner** (File System Access API, Chrome/Edge; auch OneDrive-/
Drive-Sync-Ordner).

Gleiche Technologie und gleiches Design wie
[arch-review](https://github.com/z9nai/arch-review) und
[z9nai-hours](https://github.com/z9nai/z9nai-hours):
React 19 · TypeScript · Vite · Tailwind CSS 4 · lucide-react · bpmn-js.

> **Stand: PoC.** Der Kern steht — BPMN-Import, Baumdarstellung mit Gateways,
> Schleifen und Fehlerpfaden, Status je Schritt, Service-Katalog mit
> vorbereitetem Mapping, Klassenbauer für das Datenmodell, BPMN-Editor mit
> Abgleich in beide Richtungen, vier Exporte.
> Was noch fehlt, steht unter [Offene Punkte](#offene-punkte).

## Sofort ansehen

```bash
npm install && npm run dev
```

Dann <http://localhost:3002/orch-spec/?demo> öffnen — die App startet
direkt mit den Beispieldaten aus `sample-data/` (ohne Ordnerauswahl, nur im
Dev-Server; verlangt deren `model.json` eine Anmeldung, dann mit Login). Die Beispieldaten sind **echt**: sie
wurden aus `savings-openSavingsV1.bpmn`, den OpenAPI-Dateien und den Scala-Quellen
der globex-Projekte erzeugt.

Ohne `?demo` startet die App normal und fragt nach dem Ordner; `sample-data/`
lässt sich dabei als lokaler Ordner wählen.

## Was die App kann

### Der Ablauf als Baum, nicht als Tabelle

Der BPMN-Graph wird beim Import in einen **Baum** überführt: ein Gateway trägt
seine Zweige bis zur Zusammenführung (Post-Dominator), ein Subprozess seine
Schritte, ein Rücksprung wird als **Schleife** markiert und ein Zusammenlauf
zweier Pfade als Verweis («weiter bei …») — der Prozess steht damit genau
einmal da, ohne Dubletten. Zweige sind farbig und beschriftet, Details lassen
sich einklappen. Reine Zusammenführungs-Gateways ohne Namen werden entfernt;
bleibt eine als Schleifeneinstieg stehen, heisst sie «Wiederholung ab hier».

Weitere Muster, die der Import auflöst:

- **Retry** (`Fehler → warten ${timer} → Tried ${max} times? → nochmal`) wird
  als Schleife mit Bedingung, Anzahl Versuche und Wartezeit erkannt.
- **Link-Ereignisse**: ein werfendes Zwischenereignis ohne Ausgang wird mit dem
  gleichnamigen fangenden ohne Eingang verbunden (Orchescala-Konvention, ohne
  `eventDefinition`) — sonst brechen Pfade wie «output-mocked» mittendrin ab.
  Das fangende Gegenstück selbst ist reine Verdrahtung und wird nicht gezeigt.
- **Fehler vs. Nebenpfad**: ein Boundary-Event mit Namen oder Fehlerbezug ist
  ein Fehlerfall (orange), eines ohne beides ein Nebenpfad (blau), beschriftet
  durch seinen ersten Schritt.
- **Nicht verbundene Blöcke** (Ereignis-Subprozesse, Link-Ziele ohne erkennbares
  Gegenstück) hängen an keinem Sequenzfluss — sie kommen als eigene Blöcke ans
  Ende, statt zu verschwinden.

Geprüft über alle **72 BPMN-Dateien** der globex-Projekte: kein Element geht
verloren, und ein erneuter Import derselben Datei ändert nichts
(0 neu · 0 geändert · 0 entfallen).

### Was der Baum zeigt

Der Ablauf gewichtet seine Zeilen: **eigene Verträge** — Benutzeraufgaben,
Worker, Signale, Nachrichten mit Interaktion — stehen fett und tragen den
Objektnamen als violetten Chip, der ins Datenmodell springt. **Fremde
Services** zeigen ihre Katalog-Kennung als teal Chip mit Stecker, rot, wenn
ein geladener Katalog sie nicht kennt. Gateways haben eine schwache
Bandfarbe, Ereignisse, Start und Ende sind leise. Zweigköpfe sind Chips in
der Zweigfarbe (Standardzweig gestrichelt) mit «wenn …» als FEEL und der
Schrittzahl; Fehler- und Nebenpfade zählen ebenfalls.

**Befunde** sieht man im Baum, nicht erst im Panel: ein rotes (Fehler) oder
oranges (Warnung) Dreieck mit Zähler an der Zeile, die ersten Meldungen im
Tooltip — FEEL-Fehler in Mappings und Bedingungen, doppelte oder fehlende
Pflichtfelder, eine Interaktion ohne oder mit leerem In/Out, ein unbekannter
Service. Der Status «Umgesetzt» ist gedämpft, damit «Angepasst» und
«Entwurf» herausstechen. Im Kopf filtern die Status-Chips den Ablauf, der
Chip **⚠ n** zeigt nur Schritte mit Befund; die Suche findet auch den
Objektnamen der Interaktion und den Namen des Katalog-Services.

### Spezifikation und Implementation nebeneinander

**«Mit BPMN abgleichen»** liest die BPMN-Datei erneut ein und übernimmt die
Struktur — die fachlichen Texte (Beschreibung, Notiz, offene Frage, Bedeutung
der Mappings) bleiben über die stabile BPMN-Element-ID erhalten, auch in
Fehler- und Nebenpfaden.

Übernommen wird nicht sofort: wie beim Anlegen aus BPMN steht zuerst eine
**Vorschau**, und wie dort sucht die App über die Prozess-ID die **Domain**
(Katalog, gemerkte Projekt-Ordner, sonst Ordner oder ZIP wählen):

```
↻ Mit BPMN abgleichen  openSavings-impl.bpmn                               ✕
ABLAUF                                  DATENMODELL
12 behalten · 1 neu · 1 geändert · …    ☑ mit der Domain abgleichen — OpenSavings aus Katalog
+ Check data                            9 unverändert · 1 neu · 2 geändert · 1 nur in der Spezifikation
~ Open account                          + Language   ~ In   ~ CheckDataUT.In   ? In.oldField
− succeeded                             ☐ was die Domain nicht mehr kennt, entfernen
Status für Neues [Umgesetzt ▾]  für Geändertes [Angepasst ▾]   💬 1 Kommentar an entfallenen Stellen bleibt
                                                                    [Abbrechen] [Übernehmen]
```

- **Status**: neue Schritte, Klassen und Interaktionen bekommen den Status
  «für Neues» (Vorgabe Entwurf), technisch geänderte den Status «für
  Geändertes» (Vorgabe Angepasst). Kommt das BPMN aus der Implementation,
  setzt man beides z. B. auf **Umgesetzt**. Unverändertes behält seinen
  Status — ausser es steht noch von einem früheren Abgleich auf
  **Angepasst**: stimmt es jetzt mit der Implementation überein, bestätigt
  der Abgleich es mit dem Status «für Geändertes» (in der Vorschau
  «✓ Review → Umgesetzt»; mit der Vorgabe Angepasst bleibt alles, wie es
  ist). Das gilt auch für den Prozess selbst. Vorbereitete Interaktionen
  ohne Domain-Objekt bleiben Entwurf.
- **Datenmodell**: die Klassen aus der Domain werden mit den gepflegten
  **zusammengeführt**, nicht ersetzt (`domainMerge.ts`). Die Struktur —
  Felder, Typen, Optional/Seq/Map, Einschränkung, Werte — kommt aus der
  Domain; Beschreibungen, Beispiele und eine Vorgabe, die die Domain nicht
  kennt, bleiben, ebenso die **IDs** von Typen, Feldern und Interaktionen.
  Zugeordnet wird über die Rolle (In, Out, InitIn, InConfig), die In/Out
  einer Interaktion über ihren Schritt, alles andere über den Namen. Was die
  Domain nicht (mehr) kennt, bleibt stehen und wird gemeldet; auf Wunsch
  wird es entfernt — aber nur, was schon umgesetzt war: ein Entwurf ist der
  Domain voraus, nicht veraltet.
- **Interaktionen**: Schritte ohne Interaktion werden wie beim Anlegen als
  Entwurf mit In/Out vorbereitet (abwählbar).
- **Pattern** werden wie beim Anlegen mit den Pattern aus dem Admin erkannt;
  die Vorschau zeigt, welche dazukommen, wegfallen oder andere Parameter
  haben («~ Prozess-Event (Benutzeraufgabe) «Rückbestätigung erfassen
  (KUBE)»: subStatusKey=… → …»).
- **Mappings aus dem BPMN übernehmen** (Option im Dialog): Ein- und
  Ausgaben und Mock aller Schritte so, wie sie im BPMN stehen — auch wo das
  Diagramm sie nicht geändert hat; eine Abwahl in der Spezifikation gilt
  dann nicht. Für eine Spezifikation, deren gespeicherte Mappings veraltet
  sind (aus einer älteren Version importiert): sonst setzen sie sich bei
  jedem Rundlauf Import → Export wieder durch. Die Bedeutung der Zeilen
  bleibt; eigene Änderungen an Mappings in der Orch Spec gehen verloren.
- **Kommentare** gehen nie verloren. Fäden an einer Stelle, die es danach
  nicht mehr gibt, stehen im Kommentar-Panel unter «Ohne Stelle» — mit dem
  Namen, den die Stelle zuletzt hatte («Ende succeeded»).

**«Mit Domain abgleichen»** (Datenbank-Symbol neben dem Abgleich-Knopf)
macht dasselbe ohne neue Datei, mit dem gespeicherten BPMN: der Ablauf
bleibt, abgeglichen werden Klassen und Interaktionen — etwa nachdem die
Domain im Projekt gewachsen ist. Neues aus der Domain steht dort von
vornherein auf **Umgesetzt**.

Auch **beim Anlegen aus BPMN** wählt man den Status (Vorgabe Umgesetzt — das
BPMN kommt aus der Implementation). Er gilt für Prozess, Schritte und das
Datenmodell aus der Domain; Vorbereitetes ohne Domain-Objekt bleibt Entwurf.

Der Bericht danach zeigt, was im Ablauf neu ist, sich geändert hat oder
entfallen ist. Ein bereits gesetzter Status bleibt sonst unangetastet — er
gehört der Spezifikation, nicht dem Import. Änderungen im Modeler, Pattern
und Engine-Wechsel gehen weiterhin direkt hinein, ohne Vorschau.

### Klassenbauer — das Datenmodell des Prozesses

Zweiter Reiter in der Prozessansicht: **Datenmodell**. Links die Typen, in der
Mitte die Felder, rechts der Scala-Code, der daraus entsteht — live beim
Tippen.

- **Prozess-Eingabe «In»** als Wurzel, dazu beliebig viele **Klassen**
  (case class) und **Auswahlen** (enum). Eine verschachtelte Klasse legt man
  direkt aus der Typ-Auswahl heraus an und ist sofort damit verbunden.
- Die **Typ-Auswahl ist suchbar**, in drei Gruppen von nah nach fern:
  **einfache Typen** (String, Int, LocalDate, Iban …), **eigene Typen** des
  Prozesses, **Service-Objekte** aus dem Domain-Katalog (`GetAccount.Out`,
  `DomicileAddress`, `PostDuplicateCheck.In` …). Tippen filtert über Name,
  Paket, Felder und Werte; Enter nimmt den ersten Treffer. Gleichnamige Typen
  aus verschiedenen Projekten unterscheidet das Paket rechts in der Zeile.
- Je Feld: Name, Typ, **optional** (`Option[…]`), **mehrfach** (`Seq[…]`),
  **Einschränkung** (Iron-Refinement wie `ValidEmail`, `MinLength[3]`,
  `FixedLength[2]` — als Vorlage mit Wert, oder frei), **Vorgabe**,
  **Beispiel** und die fachliche Bedeutung (wird zu `@description`).
- **Vorgaben** stehen nie in einer Klasse — einzig im `InConfig`, wo es
  Konfigurationen sind (dort als Default-Parameter). Beim `In` des Prozesses
  hat eine Vorgabe nur bei einem **optionalen** Feld Sinn: das Feld bleibt
  `Option[…]`, das `InitIn` bekommt dasselbe Feld als Pflicht, und der
  Init-Worker setzt es — `fee = in.fee.getOrElse(90)`. Der Export gibt diesen
  `customInit` als Hinweis mit, `./helper.scala processFromSpec` setzt ihn in
  den Worker. Überall sonst wird eine Vorgabe nicht verwendet und gemeldet.
- Die **Vorgabe** ist FEEL, wenn sie mit `=` beginnt — wie überall in der App.
  Der Export wertet sie aus und schreibt sie nach dem Typ des Feldes als Scala:
  `= [90, 110, 140]` → `Seq(90, 110, 140)`, `= "CH"` → `Some("CH")` bei einem
  optionalen Feld, `= 3` → `3L` bei `Long`, `= date("2026-01-01")` →
  `LocalDate.parse("2026-01-01")`, `= "de"` → `Sprache.de`, `= {ort: "Bern"}` →
  `Adresse(ort = "Bern", plz = None)`. Ohne `=` bleibt sie ein Scala-Ausdruck
  und wird wörtlich übernommen. Lässt sie sich nicht übersetzen, steht im Code
  `= ??? /* TODO Vorgabe «= …»: … */` — das Projekt kompiliert, die Stelle ist
  zu finden.
- Das **Beispiel** ebenso: mit `=` FEEL, nach denselben Regeln übersetzt —
  ein einzelner Wert bekommt die Hülle des Feldes (`= "CH"` → `Seq("CH")` bei
  `mehrfach`, `Some("CH")` bei `optional`), eine Liste, ein Kontext oder
  `= null` ist schon der ganze Wert. Ohne `=` ist es bei einem **Text-Feld**
  einfach der Text — ohne Anführungszeichen (`rot` → `"rot"`); Scala bleibt,
  was danach aussieht, so wie es aus der Domain kommt: ein Literal (`"CH"`,
  `s"…"`), ein Wert der Domain (`defaultClientKey`), ein Verweis
  (`Defaults.street`) oder ein Aufruf. Bei anderen Typen ist es ein
  Scala-Ausdruck wie bisher. Lässt es sich nicht übersetzen, nimmt das
  `example` das abgeleitete Beispiel mit einem `/* TODO … */` dahinter, und
  das Feld wird gemeldet.
- Ein **reiner Pfad in FEEL** — `= clientKeyDescr`, `= processLabels.de`,
  `= defaultClientKey` — ist ein Wert, den FEEL nicht kennt, Scala aber
  schon: er bleibt in Vorgabe, Beispiel und Beschreibung ein Verweis
  (`@description(clientKeyDescr)`, `Some(processLabels.de)` bei `optional`).
- Die **Beschreibung** eines Feldes ebenso: Text wird zu
  `@description("…")`, mit `=` ist sie FEEL, das einen Text ergibt
  (`= "Kunde " + "Nummer"`). Ein Verweis bleibt Scala, so wie ihn die Domain
  schreibt: `clientKeyDescr`, `Texte.kunde`, `s"…${X.processName}"` oder ein
  Aufruf. Ein einzelnes Wort ist Text, auch im camelCase (`eBanking`) — als
  Name gilt es nur nach der Konvention der Domain: `…Descr` in der
  Beschreibung, `default…` im Beispiel.
- Feld-IDs sind stabil: Umbenennen bricht keine Verweise.
- **Geprüft wird sofort**: ungültige Scala-Namen, Schlüsselwörter, doppelte
  Felder, verwaiste Typverweise, Einschränkungen auf zusammengesetzten Typen,
  Zyklen über Pflichtfelder und Vorgaben, die sich nicht nach Scala übersetzen
  lassen. Unfertige Felder (ohne Name oder Typ) kommen nicht in den Code.

Erzeugt wird die Orchescala-Domain im Hausstil: `case class` mit
`@description`-Annotationen, Companion mit `given ApiSchema` /
`given InOutCodec`, `example` und ein `exampleMinimal`, das alle optionalen
Felder auf `None` setzt. Das `In` kommt als Einfüge-Block für das
Prozess-Objekt, jeder weitere Typ als eigene Datei unter `schema/`; Iron-Imports
werden gesetzt, wenn eine Einschränkung im Spiel ist.

**Beispielwerte aus der Domain.** Die Projekte schreiben in ihren Beispielen
`clientKey = defaultClientKey` — Werte, die auf oberster Ebene eines Pakets
stehen (`val defaultClientKey: Long = …`, meist in `exports.scala`). Der
Domain-Katalog sammelt sie mit; hat ein Feld kein eigenes Beispiel, nimmt das
`example` den Wert `default` + Feldname — bei `Option` als `Some(…)`, bei `Seq`
als `Seq(…)`. Nur mit **genau passendem Typ**: ein ungetyptes
`val defaultIban = "CH…"` ist ein `String` und kommt nicht in ein `Iban`-Feld.
Gibt es den Namen mehrfach, geht die Firmen-Bibliothek vor (sie steht im
`-Yimports`, braucht keinen Import), dann das eigene Projekt, dann die
Reihenfolge des Katalogs; ein Wert aus einem anderen Projekt bringt seinen
Import mit. Im Klassenbauer steht der gefundene Wert als Platzhalter im
Beispiel-Feld.

**Beispieldaten beim Import.** Die Beispiele der Domain gehen beim Anlegen
aus BPMN, beim Abgleich und beim Übernehmen aus dem Katalog nicht verloren:
der Scanner liest das `lazy val example = In(…)` im Companion (auch
`lazy val example: In.Standard = In.Standard(…)` eines ADT-Falls, benannte
oder positionelle Argumente) und hängt jeden Wert an sein Feld; der Export
schreibt ihn wieder ins `example`. Im Klassenbauer steht der **innere** Wert —
aus `mainCardHolder = Some(CardHolder.example)` wird `CardHolder.example`, aus
`Seq(x)` ein `x`, aus `"abc".refineUnsafe` ein `"abc"`; der Export setzt die
Hülle nach Option/Seq/Map des Feldes wieder darum. Lässt sie sich nicht
abtragen (`None`, `Seq(a, b)`, `Seq.empty`), bleibt der ganze Ausdruck und
wird wörtlich übernommen. Was die App ohnehin ableitet (`CardAccount.example`),
bleibt leer. Nennt das `example` ein Feld nicht, gilt seine Vorgabe; hat eine
Klasse gar kein `example` (`processExample(In(), …)`), sind ihre Vorgaben die
Beispieldaten. Ist das `example` eine Kopie des minimalen
(`In.exampleMinimal.copy(now = …)`), gelten die Werte von `exampleMinimal`,
überschrieben mit denen der Kopie. Beim Abgleich geht ein Beispiel der
Spezifikation vor.

**Typen aus Orchescala.** `Instant` (ein Zeitpunkt mit Zeitzone) ist ein
einfacher Typ wie `LocalDateTime` — Vorgabe `= date and time("2026-01-01T08:00:00Z")`
→ `Instant.parse(…)`. `MockedServiceResponse[GetX.Out]` (der Mock eines
Services im `InConfig`) bleibt als Scala-Typ stehen; gemeldet wird nur, wenn
das Innere unbekannt ist.

**Referenzen in der Beschreibung.** Steht in `@description(…)` kein reiner
Text, sondern eine Referenz (`@description(clientKeyDescr)`), ein Aufruf
(`serviceOrProcessMockDescr(GetContract.Out.example)`) oder ein `s"…${x}"`,
merkt sich das Feld den Ausdruck und der Export schreibt ihn unverändert
zurück — statt `@description("clientKeyDescr")`. Im Klassenbauer steht er in
Monospace, der Tooltip zeigt ihn; wer die Beschreibung ändert, ersetzt ihn
durch Text. Bei einer Auswahl mit Fällen kommen Beschreibung und Beispiel
eines gemeinsamen Feldes (`def clientKey: Long`) aus dem ersten Fall, der
sie hat. Eine mehrzeilige Beschreibung schreibt der Export als
`"""…""".stripMargin` — die erste Zeile nur einmal.

**Prozess-Objekt.** Der Einfüge-Block für das Prozess-Objekt hält die
Reihenfolge der Domain ein: `In`, `InitIn`, `InConfig`, `Out`, danach, was
sonst im Objekt steht (`enum CustomProcessStatus`). Typen aus
`orchescala.domain` (`ProcessStatus`) brauchen keinen Import und gehen einem
gleichnamigen Typ eines anderen Projekts vor — `processStatus:
ProcessStatus.canceled.type` bleibt ein fester Fall. Für ein neues
Prozess-Objekt gibt der Export die Beschreibung als `// descr: …` und die
Bezeichnung je Sprache als `// processLabels: de | fr` mit (aus
`override def processLabels` der Domain, oder am Prozess mit dem Pattern
**«Prozess-Bezeichnung»** erfasst, siehe [Pattern](#pattern)). Der
Init-Worker setzt daraus die Prozessvariablen `callingProcessKeyDE` und
`callingProcessKeyFR` — die Pattern «Benutzer per Mail informieren» und
«Eskalation» lesen sie. In der App gelten sie deshalb als bekannt, sobald die
Bezeichnung steht; Felder im Datenmodell braucht es dafür nicht. Die Imports kommen aus den Dateien
der Domain: ein Feldtyp wird zuerst über sie aufgelöst (`LoadPoas` aus
vollmacht, nicht die gleichnamige des eigenen Projekts), und Beispiele und
Beschreibungen bringen mit, was sie brauchen (`defaultValidUntil`,
`SendProcessEvent.processName`, `Escalation.*`).
`./helper.scala processFromSpec` führt den Block in ein **bestehendes**
Prozess-Objekt zusammen, statt es neu zu schreiben: `descr`,
`processLabels`, die Paket-Klausel, die eigenen Imports und eigene Mocks im
`InConfig` bleiben (siehe die Orchescala-Doku zu `processFromSpec`). Hat das
Objekt noch keine `processLabels`, kommen sie aus der Spezifikation dazu.

### Auswahl mit Fällen — ein enum als ADT

Eine **Auswahl** (enum) hat normalerweise nur Werte (`case de, fr`). Ihre
Werte können aber auch **Felder** tragen — dann ist sie ein ADT wie das `In`
der Depot-Domain:

```scala
enum In:
  case Standard(clientKey: Long, investmentProduct: Int, …)
  case VermoegensVerwaltung(clientKey: Long, investmentAmount: Int, …)
```

Jeder Fall ist eine eigene Klasse, gemeinsam sind sie ein Typ. Ein Scala-3-
enum kennt dabei **gemeinsame Felder** — als `def clientKey: Long` im Rumpf
verlangt und in jedem Fall mitgebracht — und **spezielle Felder** je Fall.
Im Klassenbauer hat ein ADT deshalb oben den Block «Gemeinsame Felder (in
jedem Fall)» und bei jedem Fall seine eigenen; bei jedem Wert steht
**«+ Feld»**, sobald ein Fall Felder hat oder gemeinsame da sind, heisst die
Auswahl «Auswahl mit Fällen (ADT)». Bearbeitet wird mit derselben Zeile wie
in einer Klasse (Typ, optional, mehrfach, Map, Einschränkung …). Auch die
**Prozess-Eingabe `In`** kann ein ADT sein — derselbe Prozess mit
verschiedenen Eingaben: ein Schalter am Kopf wechselt zwischen Klasse und
Auswahl mit Fällen; die Felder der Klasse werden dabei die gemeinsamen, und
zurück.

Der Generator schreibt das ADT wie die Domain: die gemeinsamen Felder als
`def` im Rumpf, die Fälle mit gemeinsamen und speziellen Parametern, das
Companion mit `example` je Fall und einem für den Typ. Ein ADT-Feld ist im
JSON ein Objekt; die FEEL-Vervollständigung zeigt darin die Felder aller
Fälle. Der Import liest `def x: T` und `case X(…)` aus der Domain — das `In`
von `globex-depot-open` kommt so mit drei gemeinsamen Feldern und zwei
Fällen herein, ein Feld, das schon gemeinsam ist, wird im Fall nicht
nochmals geführt (der Klassenbauer meldet das sonst). Was die Domain nicht
als `def` führt, aber in **allen** Fällen gleich steht — gleicher Name, Typ
und Hüllen —, erkennt der Import ebenfalls als gemeinsam und zieht es aus
den Fällen heraus; das Panel vor dem Anlegen nennt diese Felder.

**Eine einzelne Ausprägung als Typ.** Ein Feld kann statt der ganzen Auswahl
einen ihrer Fälle meinen — in Scala `CustomDocContents.\`QI-Deklaration\``.
Im Klassenbauer steht dafür neben dem Typ die Auswahl «alle Fälle» bzw. der
Fall; der Generator schreibt `Enum.Fall` und als Beispiel `Enum.Fall.example`,
der Import erkennt die Schreibweise (auch mit Backticks für Namen wie
`QI-Deklaration`, die der Scanner nun liest). Für FEEL zeigt ein solches Feld
nur die gemeinsamen Felder und die dieses Falls. Die Prüfung meldet einen
Fall, den die Auswahl nicht hat.

### Map — Werte mit beliebigen Schlüsseln

Ein Feld kann eine **Map** sein: `Map[String, T]`, im Klassenbauer das
Häkchen «Map» neben «optional» und «mehrfach»; der gewählte Typ ist dann der
Wert, der Schlüssel ist immer ein Text — so kommt eine Map im JSON an. Der
Generator schreibt `Map[String, T]` und als Beispiel `Map("key" -> …)`, der
Import erkennt `Map[String, …]` in der Domain (`customDocContents`). Für
FEEL ist eine Map ein Objekt mit unbekannten Schlüsseln: Pfade hinein werden
weder vorgeschlagen noch bemängelt, und über den Ergebnistyp eines Ausdrucks,
der durch eine Map führt, fällt kein Urteil.

### Interaktionen — In und Out je Berührungspunkt

Jede Stelle, an der der Prozess mit aussen spricht, hat in der Domain ein
eigenes Objekt mit eigenem `In` und/oder `Out`. Der Klassenbauer führt sie
unter **Interaktionen**; **«N aus dem Ablauf»** holt sie aus dem Ablauf:

| Schritt | wird zu | Schlüssel |
| --- | --- | --- |
| Benutzeraufgabe | `object X extends CompanyBpmnUserTaskDsl` | `val name` = BPMN-Element-ID |
| eigener Worker (Topic beginnt mit dem Prozess) | `CompanyBpmnCustomTaskDsl` | `val topicName` |
| werfendes Signal | `CompanyBpmnSignalEventDsl` | `val messageName` |
| werfende Nachricht | `CompanyBpmnMessageEventDsl` | `val messageName` |
| DMN Decision (Business-Rule-Task, `decisionRef` beginnt mit dem Prozess) | `CompanyBpmnDecisionDsl` | `val decisionId` |

Eine **DMN Decision** folgt Orchescala (`BpmnDecisionDsl`): die Felder von
`In` und `Out` sind einfache Werte (String, Boolean, Int, Long, Double,
LocalDate, LocalDateTime oder eine Auswahl) — sonst steht ein Befund da. Die
**Ergebnisform** steht an der Interaktion (aus dem BPMN bzw. der Domain) und
wählt die Fabrik im `example`: `singleResult(In.example, Out.example)`,
`resultList(…, Seq(Out.example))` — oder für einen einfachen Wert
`singleEntry` / `collectEntries`: dann hat das `Out` genau ein Feld, der
Export schreibt `type Out = Int` und dessen Beispiel (`singleEntry(In.example, 3)`).
Das Ergebnis in der `resultVariable` kennt die App in FEEL in dieser Form.
Eine Entscheidung eines anderen Projekts bleibt ein Verweis in den Katalog.

Am Schritt selbst steht der Abschnitt **Klassen**: «Als Benutzeraufgabe
beschreiben» legt das Objekt an, danach führen zwei Zeilen zu `In` und `Out`.
Kennt der Katalog die Felder — die OpenAPI beschreibt Benutzeraufgaben mit
`UserTask variables` und `UserTask complete` —, steht dort **«1 aus dem
Katalog übernehmen»** und die Felder kommen mitsamt ihren Beschreibungen
herein. Ein Klick auf eine bestehende Klasse springt ins Datenmodell, wo die
Typen gewählt werden. Eine Benutzeraufgabe hat damit dasselbe wie der Prozess:
Mapping **und** beschriebene Klassen.

Fremde Services bleiben aussen vor — deren Domain liegt in ihrem eigenen
Projekt. Der Objektname lässt sich nicht aus dem BPMN ableiten (die Aufgabe
heisst dort `CheckDuplicatesTask`, das Objekt `CheckDuplicatesUT`), wird
deshalb vorgeschlagen und ist danach frei änderbar. Ohne eigenes `In`/`Out`
erzeugt der Generator `type In = NoInput` — so schreibt es die Domain auch.

Am Sparkonto geprüft: aus dem Ablauf entstehen genau `ExtractClientKey`,
`CheckDuplicatesUT` und `CreatePrintDocuments` — dieselben drei Objekte, die
in `globex-savings/01-domain` liegen.

### Der Prozess als Klammer: In · InitIn · Out · InConfig

Ein Prozess hat immer dieselben vier Typen, und der Klassenbauer führt sie als
feste Gruppe:

| | was | woher |
| --- | --- | --- |
| **In** | was hineingeht | von Hand |
| **Out** | was herauskommt | von Hand |
| **InitIn** | die zu Beginn gesetzten Prozessvariablen | Felder aus dem Prozess, Typen von Hand |
| **InConfig** | Stellschrauben des Prozesses | eigene Felder von Hand, Schleifen und Mocks erzeugt |

`InConfig` entsteht zum grössten Teil aus dem Ablauf: je Schleife `max…`,
`counter…` und `timerWait…` mit Vorgaben, je Service und Teilprozess ein
`…Mock: Option[<Objekt>.Out] = None` samt Import. Beim Sparkonto ergibt das
`maxOpenAccount`, `timerWaitOpenAccount`, `counterOpenAccount`,
`maxGetClientAdvisor` … und `duplicateCheckMock: Option[PostDuplicateCheck.Out]`
— dieselben Felder wie in der handgeschriebenen Domain. **Eigene
Stellschrauben** (ein Schwellwert, ein Schalter) legt man wie beim `InitIn`
als Felder an («Eigene Stellschraube»); sie stehen im erzeugten `InConfig`
vorne und gewinnen bei gleichem Namen. Jedes braucht einen Vorgabewert oder
ist optional — der Prozess startet auch ohne `InConfig`.

Der Import aus der Domain übernimmt das **ganze** `InConfig` — auch die
Mocks und die Einstellungen der Schleifen, mit ihren Namen, Typen,
Vorgaben und Beschreibungen (`getVisecaDebitCardsCardKeysDetailsNextDayMock:
Option[GetVisecaDebitCardsCardKeysDetails.Out]`). Erzeugt wird nur, was
dort fehlt. Ein Mock heisst, wie das BPMN ihn nennt
(`_outputMock = #{execution.getVariable('getPoasMock')}` → `getPoasMock`) —
im `InConfig` wie im exportierten BPMN; nur ohne solchen Verweis gilt der
Name aus dem Schritt. Ein Scala-Typ, den die App nicht auflöst
(`MockedServiceResponse[PostOmniaCardsOrdersApprovals.Out]`), steht im
Klassenbauer grau und kommt wörtlich in den Export.

**Der Init-Worker ist Verdrahtung**, keine Fachlichkeit — in Camunda 8 kann
daraus ein Listener werden. Der Import erkennt ihn daran, dass sein Topic der
Prozess selbst ist, und legt seine Ausgaben beim Prozess ab; daraus werden die
Felder des `InitIn`. Im Baum steht er als Schritt (im Diagramm wählbar, meist
mit dem Pattern «Init Process»), wird aber weder Interaktion noch Mock-Feld im
`InConfig` — gemockt wird dort der Prozess selbst. Die **Typen** stehen im
BPMN nicht, deshalb pflegt man sie im Klassenbauer; neue Felder kommen beim
nächsten Abgleich dazu, gepflegte Typen bleiben.

### Kopfzeile

```
[Kundenlogo] Kunde  Orch Spec     [Admin] [Ordner] [☾] │ by z9nai GmbH [◈]
                                                     ↑                    ↑
                                        bündig mit den Panels    Fensterrand
```

Links steht der **Kunde** mit seinem Logo, gesetzt unter
**Admin → Auftritt**; ohne Namen heisst die App dort schlicht «Orch Spec».
Rechts die Werkzeuge — und ganz aussen am Fensterrand «by z9nai GmbH», mit
Link auf z9nai.ch.

Das Logo liegt als Data-URI in der `model.json` (bis 200 KB, PNG/JPEG/SVG/
WebP/GIF). Eine zweite Datei im geteilten Ordner wäre umständlicher
(SharePoint, Rechte, Verweise), und eine Adresse von aussen gäbe es in der
Bankenzone nicht.

Die Knöpfe fluchten mit den Panels darunter: bei 1280 px Fensterbreite enden
Kopfzeile und «Neu»-Knopf beide bei 1128 px — in der Prozessansicht ebenso,
obwohl die randlos ist. Die Herkunft steht davon unberührt am Fensterrand
(1264 px); der Platz dafür ist reserviert. Wird es schmaler als 1280 px,
bleibt von ihr nur das Logo — dann reicht die Breite für den Text nicht mehr,
ohne den Knöpfen in die Quere zu kommen.

### Aus BPMN — die Domain findet die App

Ein Orchescala-Prozess trägt seine ID in beiden Welten: im BPMN als
Prozess-ID, in der Domain als `val processName`. Wer ein BPMN wählt, muss die
Domain deshalb nicht suchen — die App tut es, in dieser Reihenfolge:

1. im **Domain-Katalog** (model.json bzw. `catalog.generated.json`) — sofern
   er vom heutigen Scanner stammt; ein älterer Katalog kennt weder die Fälle
   und gemeinsamen Felder der enums noch die Schlüssel der Objekte und wird
   nur als letzte Wahl genommen, mit Hinweis («Katalog neu aufbauen»),
2. in den **gemerkten Projekt-Ordnern** (Admin → Katalog → Projekt-Ordner;
   der Browser fragt je Ordner einmal nach dem Leserecht — Ordner, deren
   Name zur Prozess-ID passt, kommen zuerst),
3. sonst fragt sie nach dem **Projekt-Ordner** (Chrome/Edge) oder einem
   **ZIP** — oder legt den Prozess ohne Domain an.

Vor dem Anlegen steht, was entsteht — auch die **erkannten Pattern** (mit
den Definitionen aus Admin → Pattern), je Pattern mit Anzahl, die Stellen im
Tooltip; sind keine definiert, steht das da:

```
Aus BPMN  Kartenbestellung  globex-ordercard
74 Schritte · Domain OrderCard aus Ordner globex-ordercard
· 15 Typen · 6 Interaktionen (ReconfirmationUT, AdjustProcessVariables, …)
⚠ Typen weder im Projekt noch im Katalog: CrmConsultant, ProcessCallOrigin
                                                              [Anlegen]
```

Was dabei entsteht, ohne Raten:

- Aus `In`, `InitIn` und `Out` des Prozess-Objekts werden die Prozess-Klassen
  des Datenmodells; `InConfig` bleibt draussen (Implementations-Detail), auch
  als Feld im `In`.
- **Eigene Typen** des Projekts (`NewCard`, enums) werden eigene Typen der
  Spezifikation — mit `Option`/`Seq`, Einschränkung, Vorgabe und
  `@description`. Ein Alias wie `type AddressType = Int :| any.In[(11, 15)]`
  wird zum Grundtyp mit Einschränkung. Typen aus **anderen Projekten**
  (`CrmConsultant`) zeigen in den Domain-Katalog, wenn er sie kennt;
  sonst bleibt der Name stehen und wird gemeldet.
- Ein Feld vom Typ `MergeContractsForCAM.In` — das In/Out eines Objekts —
  bleibt **derselbe Typ** wie bei der Interaktion, unter vollem Namen; gehört
  das Objekt nicht zum Prozess (DMN, fremder Service), zeigt es in den Katalog.
- **Interaktionen** kommen aus den Objekten mit `CompanyBpmn…Dsl`: eine
  Benutzeraufgabe über `val name` (= Element-ID), ein Worker über
  `val topicName` (auch wenn es nicht mit der Prozess-ID beginnt), Signal und
  Nachricht über den Namen im BPMN (`<bpmn:signal name>`, bis zum dynamischen
  Teil `${…}`) — auch gefangene Signale —, sonst über die Namenskonvention.
  Jede bekommt ihre `In`/`Out` als eigene Klassen; `type In = AdjustOrderUT.In`
  wird eine Kopie mit dem Hinweis `= AdjustOrderUT.In`, `NoInput` bleibt
  leer. `val descr` wird die Beschreibung. Objekte des Pakets ohne Schritt
  werden gemeldet. Ein älterer Katalog ohne DSL-Angabe wird über Topic und
  Namensendung (`…UT`, `…SE`, `…ME`) gelesen — Benutzeraufgaben, deren
  Objektname nicht der Konvention folgt (`ApproveOrderUT` für
  `KartenbestellungPrufenBackofficeTask`), findet erst ein neu erzeugter Katalog oder
  der Projekt-Ordner, denn nur dort steht `val name`.
- **Schritte ohne Domain-Objekt** — Benutzeraufgaben, eigene Worker, Signale,
  Nachrichten, die die Domain nicht kennt — werden **vorbereitet**: eine
  Interaktion im Entwurf mit `In` und `Out` als Klassen, die Felder aus dem
  Katalog (Benutzeraufgaben stehen in der OpenAPI), sonst aus den Mappings
  des Schritts, sonst ein leeres Feld. Das Panel warnt und nennt sie; die
  Klassen tragen die Beschreibung «Vorbereitet beim Import». So kann die
  Domain aus der Spezifikation entstehen statt umgekehrt — auch beim Anlegen
  ganz ohne Domain.
- Die Engine wird am BPMN erkannt (zeebe-Namensraum → Camunda 8).

### Neue Prozesse starten mit einer Vorlage

«Neu» fängt nicht mit einem leeren Blatt an, sondern mit dem BPMN, das im
Haus üblich ist — Pool, Startereignis, die eigenen Fehlerdefinitionen.

Die Vorlagen liegen als Dateien in **`public/templates/`** und sind Teil der
App; beim Anlegen wird eine davon gewählt. **Eine je Engine**, weil ein C7-
und ein C8-Diagramm nicht dasselbe brauchen: dort External Tasks mit Topic und
`camunda:`-Erweiterungen, hier `zeebe:taskDefinition`. Der Prozess merkt sich
seine Engine (`engine` in der Spezifikation), und der Orchescala-Export nennt
sie.

```
[Fachlicher Titel]                                        [Anlegen]
[globex] [depot] [openDepot]                          V  [2]
┌──────────────────────────┐ ┌──────────────────────────┐
│ Camunda 7                │ │ Camunda 8                │
│ External Tasks mit Topic │ │ zeebe:taskDefinition     │
└──────────────────────────┘ └──────────────────────────┘
Prozess-ID: globex-depot-openDepotV2 · Vorlage templates/c8.bpmn
```

Die Prozess-ID entsteht aus **`company-project-processVversion`** und ist
schon beim Tippen zu sehen; Firma und Projekt sind mit denen des zuletzt
angelegten Prozesses vorbelegt.

In den Vorlagen steht `COMPANY-PROJECT-PROCESSVERSION`, wo die ID hingehört.
Ersetzt wird sie **überall, wo sie steht** — als Attribut ganz oder als Teil
davon, Element-IDs eingeschlossen (`COMPANY-PROJECT-PROCESSVERSION-participant`).
Das trifft genau die Stellen, die sie meinen: `processRef` des Pools, dessen
Name und die Topics der eigenen Worker (`<prozess>.ExtractClientKey` wandert
mit). Weil in allen Attributen dasselbe ersetzt wird, bleiben die Verweise
untereinander stimmig; eine Liste bekannter Stellen wäre kürzer, würde aber
bei der nächsten Vorlage etwas übersehen. Gross-/Kleinschreibung zählt nicht.

Bliebe die ID stehen, hiessen alle Prozesse gleich, und daran hängt mehr als
es aussieht: Topics, die Zuordnung zur Domain und der Dateiname.

**Pool und Prozess heissen gleich.** Massgeblich ist der Name des Pools:

```
Pool      name = globex-depot-openDepotV2    id = globex-depot-openDepotV2-participant
Prozess   name = globex-depot-openDepotV2    id = globex-depot-openDepotV2
```

Ohne Pool — so legt der Camunda Modeler einen C8-Prozess an — gilt der Name
des Prozesses.

Im Kopf der Prozessansicht stehen zwei Felder: gross der **fachliche Titel**
(«Mietkautionskonto eröffnen (MKK)», frei), darunter die **Prozess-ID**. Die
wird geprüft — `company-projekt-prozessVersion`, Firma und Projekt klein, der
Prozess in camelCase mit Version (`globex-savings-openSavingsV1`) — und erst
beim Verlassen des Feldes übernommen, wenn sie passt; dann folgen Prozess-Name
und Pool im Diagramm. Firma und Projekt werden mit den bekannten verglichen
(Projekt-Ordner, Prozesse im Katalog, die anderen Spezifikationen): eine
unbekannte Firma ist ein Fehler (rot, «meinten Sie globex?»), ein unbekanntes
Projekt einer bekannten Firma nur eine Warnung (gelb, übernommen) — ein neues
Projekt muss möglich bleiben. Wer den Pool (bzw. Prozess) im Diagramm umbenennt, bekommt
Prozess-ID und -Name gleich mit. Trägt ein Prozess noch die ID des Modelers
(`Process_0jx2w61`), wird er beim Einlesen («Aus BPMN») und beim Öffnen
angeglichen. Eine **gewählte** Prozess-ID dagegen ist ein Vertrag
(Deployment, Worker, Aufrufer): sie folgt nur einer Umbenennung im Diagramm,
nie dem blossen Öffnen — sonst würde ein Prozess, dessen Pool etwas anders
heisst, still umbenannt. Umbenannt wird überall, wo die alte ID als ganzer
Wert steht (`processRef`, Diagramm, Nachrichtenflüsse, der Init-Worker mit der
Prozess-ID als Topic). Ein Name mit Leerzeichen oder Umlauten taugt nicht als
ID — dann bleibt alles, wie es ist (`src/poolIds.ts`).

Aus dem Ergebnis entstehen in einem Zug das `.bpmn` und der Ablaufbaum; jeder
Schritt beginnt als **Entwurf** — auch in Zweigen und Fehlerpfaden. Eine
Vorlage dazunehmen heisst: Datei in `public/templates/` ablegen und eine Zeile
in `ENGINES` ergänzen (`src/template.ts`).

### Spezifikationen löschen

In der Liste hat jede Spezifikation rechts einen Papierkorb. Vorher wird
gefragt, denn weg ist weg: entfernt werden
die Dateien `processes/<slug>.json`, `processes/<slug>.bpmn` und das
Änderungsprotokoll `processes/<slug>.audit.jsonl` — lokal endgültig, in
SharePoint in den Papierkorb der Site. Archivierte Teile des Protokolls
(`<slug>.audit-<Zeitstempel>.jsonl`) bleiben liegen.

Löschen darf nur, wer **Admin** ist — oder alle, wenn keine Anmeldung
verlangt ist (dann gilt ohnehin «alles erlaubt»). Editor und Viewer sehen den
Knopf nicht. Bewusst nur in der Liste, nicht in der Prozessansicht: dort
speichert die App automatisch, und ein Autosave nach dem Löschen legte die
Datei gleich wieder an.

### Der Admin-Bereich

Fünf Bereiche, in der Reihenfolge, in der sie gebraucht werden:

1. **Auftritt** — Kunde und Logo für die Kopfzeile.
2. **Katalog** — importieren, exportieren, nachschlagen. Das zählt in jeder
   Umgebung; in der Bankenzone ist es der einzige Bereich, der etwas tut.
   Das lokale Erzeugen (Projekt-Ordner, OpenAPI, Doku-Site) steckt darin
   zugeklappt: dazu müssen die Quellen erreichbar sein.
3. **Pattern** — wiederkehrende BPMN-Bausteine, siehe [Pattern](#pattern).
4. **Anmeldung** — Entra ID (Tenant, Client, Rollen, Einrichtungs-Link).
5. **Benachrichtigungen (Teams)** — Teams-Nachricht bei @-Erwähnungen und
   Antworten in Kommentaren: ein/aus, Wartezeit, Vorlage.

Bewusst **keine** Liste zum Durchblättern: die Klassen eines Prozesses stehen
in seiner Spezifikation unter «Datenmodell», dort wo sie gebraucht werden.
Hier bleibt eine Suche über Services **und** Domain-Typen zugleich — für die
eine Frage, die sich im Admin stellt: steht das drin?

### Pattern

Vieles im BPMN ist Hauskonvention, die an jedem Prozess gleich aussieht:
eine Benutzeraufgabe meldet ihren Status über Task-Listener und einen Timer
an ein Portal, eine Eskalation hängt als Timer an der Aufgabe und startet
über einen Link den Eskalationsprozess, am Ende steht ein `processStatus`. Solche Bausteine
legt der Admin als **Pattern** an; in der Spezifikation wählt man sie am
Element, statt sie Stück für Stück zu zeichnen.

**Pattern von Orchescala** sind fest dabei, stehen im Admin nur zur Ansicht
und nicht im BPMN — ihre Werte stehen in der Spezifikation:

- **Prozess-Bezeichnung** (`process-labels`, am Prozess): Deutsch und
  Französisch → `override def processLabels: ProcessLabels =
  ProcessLabels("…", "…")` im Prozess-Objekt. Der Init-Worker setzt daraus
  `callingProcessKeyDE/FR`; die App kennt sie danach als Prozessvariablen.
  Das Pattern bringt die beiden Felder ins **`Out`** (Beispiel
  `processLabels.de` bzw. `.fr`; im Datenmodell tragen sie den Pattern-Chip, auch wenn sie aus der Domain kommen) —
  das `Out` entsteht, wenn es fehlt; ein Feld, das es schon gibt, bleibt.
  Entfernt man das Pattern, gehen die Felder mit. `processFromSpec` setzt die
  `processLabels` in ein Prozess-Objekt, das noch keine hat.

**Ein Pattern ist ein kleines BPMN** — gezeichnet im selben Modeler wie der
Prozess (Admin → Pattern → «Im Editor bearbeiten»):

```
  ┌──────────────────────┐
  │ PatternTarget        │  der Anker: sein Typ (Benutzeraufgabe, Call Activity …)
  │  · Listener, Eingaben│  ist der Typ, an den das Pattern passt. Was an ihm
  └──◯───────────────────┘  hängt, kommt an jedes Element, das es wählt
     ↓ Timer ${timerEscalation}
     ◉ Link «escalate»

  ◉ Link «escalate» → [Start Escalation Process] → ○
                              losgelöster Block: braucht der Prozess einmal
```

- Der **Anker** ist das Element mit der ID `PatternTarget`. Seine Attribute,
  Erweiterungen (Listener, Ein-/Ausgaben, Properties) und Ereignisdefinitionen
  kommen ans gewählte Element, seine **Boundary-Ereignisse samt Pfad** daran —
  relativ zur Lage im Pattern, an Elemente anderer Grösse angepasst, und auf
  dem Rand verschoben, wo schon ein Ereignis sitzt.
- **Losgelöste Blöcke** (Link-Ziel → Aufruf → Ende, ein Ereignis-Subprozess)
  braucht der Prozess **einmal**: fehlt der Block, kommt er unter das Diagramm
  (der Pool wächst mit, was darunter liegt, rückt nach), sonst nicht.
  Signale, Nachrichten und Fehler werden über ihren Namen wiederverwendet.
- Ein Pattern **ohne Anker** gehört an den Prozess selbst (z. B. ein
  Ereignis-Subprozess für den Abbruch).
- **Parameter** stehen als `{{name}}` im BPMN — in Attributen, Texten,
  Skripten. Im Admin bekommen sie Beschriftung, Vorgabe und Bedeutung.
  Eingebaut sind `{{targetId}}`, `{{targetName}}`, `{{processId}}` und
  `{{startMessage}}` (Nachricht des Nachrichten-Startereignisses — fehlt es,
  wird das leere Startereignis beim Einfügen dazu, mit der Prozess-ID als
  Nachricht); eine Vorgabe darf sie nennen (`{{processId}}-inform`).
- **Je Engine ein BPMN** (Camunda 7 / 8): angeboten wird ein Pattern nur, wo
  es für die Engine der Spezifikation eines gibt.

**Wählen heisst einfügen.** Das Pattern steht sofort im Diagramm — nicht erst
beim Export. Danach liest der Abgleich das Diagramm neu; ein offener Modeler
lädt es nach. Die Werte der Parameter lassen sich am Schritt ändern (das
Pattern wird herausgenommen und mit den neuen Werten an derselben Stelle
wieder eingefügt), entfernen nimmt es samt Pfad heraus — und den gemeinsamen
Block, wenn ihn kein anderes Element mehr braucht. Ein Parameter, der nur im
gemeinsamen Block steht, gilt beim ersten Einfügen; danach gehört der Block
dem Prozess.

**Der Import erkennt Pattern** — aus demselben BPMN: ein Element trägt ein
Pattern, wenn alles, was am Anker hängt, auch an ihm hängt; die Werte der
Parameter werden dabei zurückgelesen. Verglichen wird tolerant: Reihenfolge,
IDs, Namen der Flussknoten, Leerraum und Gross-/Kleinschreibung zählen nicht,
`#{…}` gilt wie `${…}`, und was ein Element darüber hinaus trägt, stört nicht.
Den gemeinsamen Block erkennt der Import an seinem **Einstieg** (Link-Ziel
gleichen Namens, Ereignis-Subprozess mit gleichem Start). Bestimmtere Pattern
gehen vor: was eines für sich beansprucht, kann kein anderes haben; dasselbe
Pattern darf mehrmals am Element hängen (zwei Mail-Timer). Drücken ältere
Prozesse dasselbe anders aus, trägt die Pattern-Datei weitere
**Schreibweisen** (`variants`, je Engine eine Liste von Pattern-BPMN): die
Erkennung nimmt sie auch an, entfernen nimmt heraus, was erkannt wurde —
eingefügt wird immer das Pattern-BPMN selbst (so bringt «Werte ändern» ein
altes Element auf die aktuelle Schreibweise).

Im **Baum** steht ein Pattern als Chip am Schritt; was es ins Diagramm bringt
— Timer, Link, gemeinsamer Block — ist Verdrahtung und steht als **eine**
Zeile in der Pattern-Farbe, die Schritte darunter erst auf Klick. Ein- und
Ausgaben, die ein Pattern am Element beisteuert (beim Prozess-Event:
Definition und Instanz des Prozesses, die Rückgaben), sind Implementation
und je BPMN verschieden — die Schrittansicht blendet sie aus und prüft sie
nicht (fehlende Pflichtfelder eingeschlossen; nur ein doppelter Name bleibt
ein Fehler); was fachlich zählt, steht als Parameter am Pattern. Der
fachliche Export nennt die Pattern am Schritt und lässt die Verdrahtung weg;
der Orchescala-Export nennt sie samt Werten und beschreibt am Ende jedes
verwendete Pattern mit Doku-Link.

Pattern reisen als Datei (Admin → Pattern → Exportieren / Importieren; der
Import ergänzt, gleiche ID wird ersetzt). Geprüft über **74 BPMN-Dateien**
aus Kundenprojekten mit 12 Pattern: 504 Stellen erkannt, jede lässt sich
entfernen und wieder einfügen und wird danach mit denselben Werten erkannt;
1187-mal an Elemente ohne das Pattern eingefügt und wiedererkannt; der Ablauf
bleibt mit und ohne Pattern derselbe.

### Wo ein Prozess in der Domain liegt

Aus `globex-savings-openSavingsV1` lässt sich `globex.savings.domain.openSavings.v1` ·
`OpenSavings` ableiten — die Version steht im Package, nicht im Objektnamen
(so heissen 68 von 71 Prozess-Objekten der Kundenprojekte). Bei
`globex-ordercard` steht in der ID nichts, woraus sich `orderCard`
gewinnen liesse; die Ableitung ergäbe `ordercard`, und der Bindestrich in
`globex-ordercard` wäre in einem Package-Namen nicht einmal erlaubt.

Deshalb steht die Zuordnung nicht im Namen, sondern im Katalog: der Scan
merkt sich `val processName` und `val topicName` der Domain-Objekte. Ein
Prozess findet damit sein Objekt genau, ein Service-Task seines über das
Topic. Über 72 BPMN-Dateien lösen sich so 32 Prozesse und 24 Interaktionen
**exakt** statt abgeleitet — darunter Fälle, die die Ableitung falsch rät:
das Topic `…createPensionProductV1.CreatePensionProduct` gehört zum Objekt
`ComposePensionProduct`, `CreatePensionProduct` ist der Prozess selbst.

Dasselbe gilt für die Objekte, die ein Prozess **ruft** — ein Teilprozess
im Mock des `InConfig` (`valiant-vollmacht-loadPoasV1` → `LoadPoas` aus
`valiant.vollmacht.domain.loadPoas.v1`), ein Service-Objekt über seinen
Namen (`valiant-services-tadv2.GetProfileCompletionCustomerId` liegt in
`valiant.services.domain.tad.v2`, abgeleitet wäre `…tadv2.domain.tadv2.v1`).
Der Import kommt dann ohne «Pfad prüfen».

Ohne Katalog-Eintrag bleibt die Ableitung — sie schreibt Umlaute um
(`Rückbestätigung` → `Rueckbestaetigung`) und lässt keine Bindestriche in
Package- oder Objektnamen zu.

### Domain-Katalog — die Typen der Service-Projekte

Damit die Typ-Auswahl echte Objekte anbietet, liest der Admin die
Orchescala-Domain der Projekte ein. Das geht nur, **wo die Quellen liegen** —
in der Bankenzone gibt es sie nicht; darum steht das Ganze unter
**Admin → Katalog → Katalog lokal erzeugen**, zugeklappt und optional. Welche
Projekte eingelesen werden, steht in einer **Liste, die man sieht und
sortiert**:

```
PROJEKT-ORDNER   oben steht, was bei gleichem Paket gewinnt
 1  initech-core-banking         ~/dev-initech/projects/initech-core-banking   117 Typen  ↑ ↓ ×
 2  globex-ordercard   ~/dev-globex/projects/…                   32 Typen  ↑ ↓ ×
 …
 8  globex-core-banking          ~/dev-globex/projects/globex-core-banking     696 Typen  ↑ ↓ ×
```

**Projekte wählen** nimmt den Ordner *über* den Projekten
(`~/dev-globex/projects`) — seine Unterordner mit einem `01-domain` kommen
alphabetisch in die Liste. Ist der gewählte Ordner selbst ein Projekt, kommt
eben dieses. Mehrere Wurzeln lassen sich nacheinander hinzufügen, etwa
`~/dev-initech/projects` und `~/dev-globex/projects`.

**Neu aufbauen** liest die Liste von oben nach unten frisch ein — rekursiv
nach `.scala`, Tests und Build-Ordner bleiben draussen. Neu **aufbauen**, nicht
ergänzen: nur so wirkt sich ein Umsortieren überhaupt aus.

Der Ordner-Zugriff wird gemerkt (IndexedDB), die Erlaubnis dazu verlangt der
Browser nach einem Neustart neu — und zwar **einmal für den Ordner über den
Projekten**, nicht je Projekt: gemerkt wird der gewählte Ordner (`root`), die
Projektordner darunter erben seinen Zugriff. Bei «Neu aufbauen» kommt darum
ein Dialog, nicht siebzehn (der Browser gibt die Erlaubnis nur auf einen
Klick hin; mehrere Dialoge nacheinander liesse er gar nicht zu). Fehlt sie
trotzdem, bleibt der Katalog unverändert stehen — ein halber Aufbau, der
stillschweigend Typen verliert, wäre schlimmer als gar keiner — und die
Meldung sagt, welcher Ordner zu bestätigen ist. Projekte aus einem älteren
Stand, die noch einzeln gemerkt sind, hängen sich beim nächsten **Projekte
wählen** an ihren Ordner darüber.

Gesammelt wird alles, was sich als Feldtyp verwenden lässt — die Objekte im
`schema/`-Ordner ebenso wie die `In` / `Out` der Services. Der Parser kennt
dabei drei Eigenheiten der Domain:

- **geteilte Paketangaben** (`package globex.crm.domain` +
  `package account.v1`) werden zusammengesetzt,
- **`In` als ADT** (`enum In: case Iban(…) case Generic(…)`) wird als
  Auswahl mit ihren Fällen erkannt,
- **`Out` steht oft gar nicht in der Datei** — es kommt aus dem Service-Trait;
  deshalb bekommt jedes Service-Objekt `In` und `Out`, auch ohne
  ausgeschriebene Definition.

**Die Reihenfolge der Liste ist der Vorrang.** Dieselbe Schnittstelle liegt
in mehreren Projekten — `client` gibt es unter `initech.core.banking.domain` und
unter `globex.core.banking.domain`. Beide zu führen hiesse zwei gleich heissende
Objekte in der Auswahl und einen Import auf gut Glück. Darum gewinnt das
weiter oben stehende Projekt: kommt später ein Paket mit demselben Schlüssel
(Paket ohne das Firmen-Segment, Version bleibt Teil davon — `client.v1` und
`client.v4` sind zwei APIs), wird es verworfen und gemeldet:

```
verworfen: globex.core.banking.domain.client.v1.schema (19 Typen)
           — Vorrang hat initech.core.banking.domain.client.v1.schema
```

Eingelesen werden nicht nur die Service-Projekte, sondern auch die
**Prozess-Projekte** — deren `In`/`Out` sind das, was ein Subprozess-Aufruf
braucht. Über 18 Projekte (`initech-core-banking` zuoberst) sind das **2095 Typen
aus 2625 Dateien**. Die Beispieldaten enthalten diesen Katalog bereits.

`InConfig` und `InitIn` fremder Projekte werden dabei übersprungen: das sind
Implementations-Details und stehen deshalb auch nicht zur Auswahl.

Wird ein Typ aus dem Katalog gewählt, setzt der Generator den passenden
`import` — bei `In`/`Out` das Service-Objekt, sonst den Typ selbst.

**Prozesse von der Doku-Site.** Wer die Quellen nicht lokal hat, holt die
Prozesse über **Von URL laden**: die Orchescala-Doku-Site führt je Firma eine
`catalog.html`, in der jeder Eintrag vollständig im Link steckt —
`.../site/globex/globex-savings/OpenApi.html#operation/Bpmn:%20openSavingsV1`. Daraus
entstehen die **Prozesse mit ihren `In`/`Out`** — also das, was sich als
Subprozess rufen lässt. Über den Globex-Katalog sind das **81 Prozesse aus 16
Projekten**.

Das Paket wird dabei aus Projekt und Prozessname abgeleitet
(`globex-savings` + `openSavingsV1` → `globex.savings.domain.openSavings.v1`). Sicher ist das
nur, wenn der Name die Version trägt; sonst ist der Katalogname die
BPMN-Prozess-ID und nicht der Scala-Name (`globex-ordercard` heisst dort
`OrderCard`) — solche Einträge sind als «Import prüfen» markiert. Deshalb
**füllt der Site-Import nur Lücken**: was aus den Quellen schon exakt bekannt
ist, bleibt stehen.

Worker kommen bewusst nicht von der Site: dort fehlt die API-Ebene
(`personV1` in `globex-crm-personV1.GetCustomer`), der Import wäre
geraten. Die stehen in der OpenAPI — mitsamt Mapping und Beschreibungen.

Aus dem Browser greift dabei **CORS** — und bei einem internen Doku-Server
tut es das oft: der Server ist erreichbar (ein Versuch mit `no-cors` liefert
eine Antwort), sendet aber kein `Access-Control-Allow-Origin`. Der
Browserweg funktioniert dort also erst, wenn der Server diesen Header setzt.

Weil `Failed to fetch` zwei ganz verschiedene Ursachen hat, unterscheidet die
App sie: schlägt der Abruf fehl, probiert sie es mit `no-cors` und meldet
entweder «erreichbar, aber keine CORS-Freigabe» oder «nicht erreichbar —
Netzwerk oder VPN prüfen». Beide Male mit dem Weg daran vorbei:
`node tools/site2catalog.ts <url>` im Terminal, dann die Katalog-Datei
einlesen. In Node gibt es kein CORS.

**In die Bankenzone:** **Exportieren** legt Services, Typen und die
Projekt-Reihenfolge in eine Datei (`orch-spec-katalog.json`); die lokalen
Pfade bleiben zurück. Draussen erzeugen, Datei mitnehmen, drinnen
**Importieren** — dort, wo die Quellen nicht liegen.

Der Import **ersetzt** den Katalog. Ergänzen würde alte Einträge stehen
lassen, die es längst nicht mehr gibt — und genau davor soll die OpenAPI ja
schützen. Ersetzen kann aber wegnehmen, worauf Spezifikationen zeigen; darum
wird vorher verglichen und **nur dann gefragt, wenn wirklich etwas fehlt**:

```
Der neue Katalog kennt weniger
3 Service(s) werden in Spezifikationen verwendet, stehen aber nicht im
neuen Katalog. Die Spezifikationen bleiben, wie sie sind — die Verweise
darin zeigen danach ins Leere und werden rot angezeigt.

  globex-crm-person.GetConsultant
  globex-crm-personV1.GetCustomer
  …
                              [Abbrechen]  [Trotzdem ersetzen]
```

Verglichen wird, worauf die Schritte zeigen (Service-ID, Topic, gerufener
Prozess) und welche Katalog-Typen in Feldern stehen. Ein Service, dessen ID
sich ändert, dessen Topic aber gleich bleibt, gilt als vorhanden — sonst
gäbe es Fehlalarm bei jedem Umbenennen.

**Mitgelieferter Katalog.** Liegt neben der App eine
`catalog.generated.json`, dann ist **sie** der Katalog. Die Doku-Site der
Firma bringt sie mit: der Helper erzeugt sie bei `publishDocs` mit denselben
Werkzeugen aus OpenAPI, Domain-Quellen und Site-Katalog — zuerst aus dem
Firmenprojekt selbst (dessen `01-domain` hält die geteilten Typen wie
`ProcessCallOrigin`), dann aus allen Projekt-Checkouts; so gewinnen bei
gleichem Namen die Firmentypen. Wer ohne Site arbeitet, liest dieselbe Datei
über «Katalog-Datei einlesen» ein. Für den Katalog gilt: bei
gleicher Kennung (Service-ID, Topic, gerufener Prozess, Typ-ID) gewinnt sie,
Einträge aus der `model.json` bleiben nur als Altbestand daneben sichtbar und
werden beim Speichern nie mit ihr vermischt — der Katalog ist nicht vom
Benutzer pflegbar, die `model.json` gehört den Spezifikationen. Fehlt die
Datei, läuft alles wie bisher — nur ohne Service- und Firmentypen; die
Typ-Auswahl sagt dann «Kein Katalog geladen».

Im **Dev-Server** liegt keine Site daneben. Er nimmt
`public/catalog.generated.json` oder, was `ORCH_SPEC_CATALOG` nennt — die
Datei selbst oder den Site-Ordner, in dem `publishDocs` sie erzeugt; am
einfachsten in einer `.env.local` (nicht versioniert):

```bash
ORCH_SPEC_CATALOG=~/dev-mycompany/mycompany-orchescala/00-docs/site
```

Der Dev-Server nennt beim Start, welchen Katalog er ausliefert, und liest ihn
bei jedem Abruf neu — nach einem `publishDocs` genügt ein Reload.

Derselbe Weg hilft, solange der Doku-Server keine CORS-Freigabe hat:

```bash
node tools/site2catalog.ts https://docs.example.com/site/ --out katalog.json
```

Die Datei dann im Admin über **Importieren** einlesen. Durchgespielt: 162
Prozess-Typen übernommen, der Service-Katalog blieb dabei unberührt. Kennt
der Katalog einen Service nicht, springt eine aus dem Servicenamen abgeleitete
Vermutung ein; die ist in der Auswahl als «abgeleitet» markiert und der Import
trägt ein «Pfad prüfen».

### Aufteilung der Prozessansicht

Eine **Werkzeugzeile** oben: zurück zur Liste, Ansicht (Ablauf / Datenmodell),
die Werkzeuge des Ablaufs (Diagramm, alles auf-/zuklappen, mit BPMN
abgleichen) und rechts Speicherstand, Export und der Status der Spezifikation.

Darunter zwei Spalten: links das **Diagramm über dem Ablauf**, rechts —
in der Breite der Eigenschaften — **Titel, Suche und die Status-Chips als
Filter**, darunter die Eigenschaften des gewählten Schritts. Der Kopf der
rechten Spalte bleibt stehen, die Eigenschaften scrollen.

Im Datenmodell nimmt der Klassenbauer die volle Breite.

### Diagramm und Ablauf nebeneinander

Liegt zur Spezifikation ein BPMN, lässt es sich über dem Ablauf direkt
bearbeiten (Schalter **Diagramm**; Höhe ziehbar, Einstellung bleibt). Der
Modeler ist das vollständige bpmn-js — mit der Camunda-Erweiterung, ohne die
beim Speichern alle `camunda:`-Elemente verloren gingen. Er wird erst geladen,
wenn das Diagramm aufgeklappt wird (eigener Chunk, ~170 kB gzip).

**Projektfarben:** Sie kommen aus der Orchescala-Konfiguration —
`prepareDocs` schreibt `ProjectConfig.color` aller `ProjectsPerGitRepoConfig`
als `projectColors` in den Spec-Katalog (`catalog.generated.json`; `#fff`
gilt als keine Farbe). Im Admin (→ Katalog → Projekt-Ordner) lässt sich die
Farbe je Projekt überschreiben. Wird an einem Schritt ein
Worker oder Teilprozess gewählt, bekommt das Element die Farbe des Projekts,
mit dessen Namen Topic bzw. gerufener Prozess beginnt — das eigene Projekt
nicht (wie `colorForId`). Geschrieben wird `color:background-color` (und
`bioc:fill`), wie im Camunda Modeler.

Was synchron läuft:

- **Diagramm → Ablauf**: jede Änderung wird kurz danach neu eingelesen; die
  fachlichen Texte bleiben über die Element-ID erhalten. Das BPMN wird dabei
  als `processes/<slug>.bpmn` neben der Spezifikation gespeichert.
  **Service-Einstellungen gehen dabei nicht verloren**: Service, Topic,
  gerufener Prozess, Mappings und Mock stellt man in der Spezifikation ein,
  ins BPMN kommen sie erst beim Export. Der Abgleich vergleicht darum das neue
  Diagramm mit dem vorigen und ersetzt nur, was **das Diagramm** geändert hat
  — bis auf die Schreibweise der Engine (`${x}` wie `=x`), damit auch ein
  Wechsel C7 ⇄ C8 nichts überschreibt. Das gilt für jeden Abgleich: Änderung
  im Modeler, «BPMN wählen», Pattern, Prozess-ID, Engine-Wechsel.
- **Ablauf → Diagramm**: ein angeklickter Schritt wird im Diagramm ausgewählt
  und ins Bild geholt; ein umbenannter Schritt wird im Diagramm umbenannt —
  und der Weg zurück speichert die Datei.

Was **nicht** synchron läuft: Schritte anlegen oder löschen geht nur im
Diagramm. Der Ablauf ist eine abgeleitete Sicht; aus ihm einen BPMN-Graphen
samt Layout zu erzeugen, ist der noch offene Punkt unten.

Ein **Umbenennen zählt nicht mehr als technische Änderung**: der Abgleich
meldet es getrennt («✎ alt → neu») und lässt den Status stehen. Auf
«Angepasst» springt ein Schritt nur, wenn sich sein Vertrag ändert — Art,
Service, Topic, gerufener Prozess oder die Mappings.

### Kopieren und Einfügen — über Prozesse und Tabs hinweg

**Im Diagramm** wie in jedem Modeler: Elemente wählen, **Ctrl+C** (Mac ⌘C),
im selben oder einem anderen Prozess ins Diagramm klicken, **Ctrl+V** und
ablegen. Mit kommt nicht nur die Form, sondern alles, was die Spezifikation
zum Schritt führt:

- Beschreibung, Service bzw. Topic, gerufener Prozess, Ein- und Ausgaben samt
  Bedeutung und Abwahl, Mock, Zuständigkeit, Zweig-Bezeichnungen und
  -Bedingungen, behandelte Fehler,
- die **Interaktion** des Schritts (Benutzeraufgabe, eigener Worker, Signal …)
  mit ihren In/Out-Klassen und den eigenen Klassen, auf die diese verweisen.

**Im Datenmodell** über die Knöpfe: ⧉ im Kopf einer Klasse/Auswahl bzw. an
einer Feldzeile kopiert. Eingefügt wird eine Klasse links unten
(«‹Name› einfügen»), ein Feld unter den Feldern der gewählten Klasse — bei
einer Auswahl in die gemeinsamen Felder oder in einen Fall.

Was gilt:

- Alles Eingefügte ist **Entwurf** — im Ziel ist es noch nicht umgesetzt.
- **Klassen kommen immer als Kopie**, auch die, auf die ein Feld verweist;
  ist der Name vergeben, mit Zähler (`Address2`). Verweise in den Katalog
  bleiben Verweise. Ein Feldname wird in seiner Klasse eindeutig (`street2`),
  ebenso der Name einer Interaktion (`ReviewUT2`).
- **IDs**: ein eingefügter Schritt behält die ID aus der Quelle, wenn sie im
  Ziel frei ist — sonst die nach Konvention mit Zähler (`ReviewTask1`).
  Klassen, Felder und Interaktionen bekommen neue IDs; Kommentare der Quelle
  kommen nicht mit.
- **Zwischen Camunda 7 und 8**: das Diagramm verliert beim Einfügen die
  Angaben der anderen Engine; Zuständigkeit, behandelte Fehler und
  Bedingungen schreibt die App in der Form des Ziels hinein, Mappings und
  Topic wie immer der Export.
- Die Zwischenablage liegt im Browser (`localStorage`) und gilt für **alle
  Tabs und Fenster** derselben App in diesem Browser, auch nach einem Reload —
  nicht zwischen verschiedenen Browsern. Was darin liegt, zeigt der Chip in
  der Werkzeugleiste des Ablaufs («3 Schritte aus «Kartenbestellung»», ✕ leert).
- Im Verlauf steht das Einfügen als «Eingefügt aus «‹Prozess›»: n Elemente».

### Markdown-Felder formatieren

Die Markdown-Felder — **Ausgangslage / Ziel**, die **fachliche Beschreibung**
eines Schritts und die Beschreibung eines **Pattern** — stehen ausserhalb der
Bearbeitung formatiert da; ein Klick bearbeitet sie (die frühere Schaltfläche
«Vorschau» entfällt). Wer Text markiert, bekommt darüber eine kleine Leiste:
**fett**, *kursiv*, `Code` (Variablen, Topics …), Link, Aufzählung und
«Formatierung entfernen»; dazu Cmd/Ctrl+B, +I und +K (Link — danach ist die
Adresse markiert und wird überschrieben). Gespeichert wird Standard-Markdown,
so wie es in die Exporte geht; Textfarben gibt es bewusst nicht (der
Markdown-Export und die Scala-Kommentare könnten sie nicht darstellen).
Eingegebenes HTML wird in der Anzeige nie ausgeführt, Links nur mit
http(s)/mailto.

### Kommentare

Wie im arch-review: eine **Sprechblase** an jeder Stelle, an der etwas zu
klären sein kann, und ein **Panel** rechts mit dem Faden dieser Stelle — ein
Beitrag, Antworten darunter, irgendwann als **erledigt** abgehakt. Erledigte
bleiben stehen (ausgeblendet, «Erledigte einblenden» zeigt sie): wer später
dazukommt, soll sehen, was besprochen wurde.

Das Panel ist eine **schwebende Karte** (abgerundet, mit Schatten), nur so
hoch wie ihr Inhalt — das Eingabefeld steht direkt unter dem Faden. Neben der
Eigenschaften-Spalte, bei schmalem Fenster darüber; die Breite lässt sich am
linken Rand ziehen. Beiträge stehen ohne Rahmen untereinander, Antworten
eingerückt mit Pfeil; die Aktionen (reagieren, antworten, erledigt, löschen)
sind immer sichtbar. Der Kopf nennt die Stelle als Text: Bereich klein
darüber, Element · Teil fett. Der Verlauf steht in einer gleichen Karte.

Sprechblasen gibt es an:

| wo | Stellen |
| --- | --- |
| **Prozess** | Titel, Ausgangslage / Ziel, jede Prozessvariable |
| **Ablauf** | jeder Schritt und jeder Zweig im Baum |
| **Schritt** | Kopf, Beschreibung, Zuständigkeit, Service, jede Ein- und Ausgabe, jeder Zweig, jeder behandelte Fehler |
| **Datenmodell** | jede Interaktion, jeder Typ (auch in der Liste), jedes Feld, jeder Wert bzw. Fall |

Leer ist die Blase blass (in Zeilen erst beim Überfahren), mit offenen
Kommentaren blau mit Zahl, mit nur erledigten ein grünes Häkchen. Im Baum und
in der Typliste zählt sie das ganze Element samt seinen Teilen.

Das **Panel** öffnet der Klick auf eine Blase oder `💬` in der
Werkzeugleiste (mit der Zahl offener Kommentare). Ohne gewählte Stelle zeigt
es die **Übersicht** aller Stellen mit Kommentaren, nach Prozess, Ablauf,
Interaktionen und Datenmodell; **Weiter / Zurück** geht sie der Reihe nach
durch, in der Reihenfolge des Ablaufs, und läuft rund. Der Sprung wechselt
bei Bedarf in den Klassenbauer, klappt den Baum auf, wählt den Schritt und
holt die Stelle ins Bild. Das Element des offenen Kommentars bekommt einen
**blauen Rahmen** — die Stelle selbst und ihre Zeile im Baum bzw. in der
Typliste.

**Reaktionen:** Das Smiley-Icon an jedem Beitrag öffnet dasselbe Raster mit 40 Emojis wie im Eingabefeld (siehe unten).
Reaktionen stehen als Chips mit Anzahl unter dem Text; die eigene ist
hervorgehoben, der Tooltip nennt, wer so reagiert hat. Ein Klick auf einen
Chip reagiert ebenso bzw. nimmt die eigene Reaktion zurück. Gespeichert wird
am Beitrag (`reactions`: Emoji → Personen); wie Kommentare stehen Reaktionen
nicht im Verlauf und lösen keine Teams-Nachricht aus.

**Emojis im Text:** Das Smiley oben rechts im Eingabefeld (neuer Kommentar
und Antwort) öffnet ein Raster mit 40 gängigen Emojis — Stimmung (😀 🤔 😬 …),
Zustimmung (👍 👏 🙏 …) und Hinweise (✅ ❌ ⚠️ 💡 …). Das gewählte Emoji
landet an der Cursor-Position bzw. ersetzt die Markierung; das Feld behält
den Fokus. Emojis sind gewöhnliche Zeichen im Kommentartext.

**@-Erwähnungen:** «@» im Kommentar schlägt Personen vor — zuerst die, die im
Ordner schon gearbeitet oder kommentiert haben (`users.json`), dann Treffer
aus dem Entra-Verzeichnis. **Teams-Benachrichtigung** (Admin →
Benachrichtigungen): Erwähnte und — bei Antworten — wer den Faden angefangen
hat, bekommen nach einer Wartezeit eine persönliche Teams-Nachricht, gesammelt
je Person, mit einem Link direkt zum Kommentar
(`?spec=<slug>&comment=<id>`). Am Beitrag zeigt eine Uhr «ausstehend», ein
grüner Pfeil «gesendet». Einrichtung und Berechtigungen:
[docs/ENTRA-SETUP.md](docs/ENTRA-SETUP.md).

Gespeichert werden die Fäden in der Spezifikation (`comments`); die Stelle
steht als Schlüssel daran, z. B. `step:<id>#in:<name>` oder
`type:<id>#field:<id>` (siehe `src/comments.ts`). Beim Umbenennen eines
Schritts wandern die Fäden mit. Zeigt ein Faden auf eine Stelle, die es nicht
mehr gibt, steht er in der Übersicht unter **«Ohne Stelle»** — weggeworfen
wird er nicht. Kommentieren können Admins und Editoren; Viewer lesen mit.

Beide Text-Exporte tragen die **offenen** Kommentare mit, samt denen an den
Teilen eines Schritts oder Typs: der fachliche unter dem jeweiligen Schritt,
der Orchescala-Export zusätzlich als Zeile in der Schritt-Tabelle. Erledigte
bleiben in der Datei, aber aus den Exporten heraus.

### Verlauf — wer hat wann was geändert

Seit der Abgleich mit BPMN und Domain Werte der Spezifikation überschreibt
(eine Vorgabe kommt immer aus der Domain, eine Vorgabe der Spezifikation
fällt weg, wenn die Domain keine hat …), protokolliert die App **jede
Änderung**. Der Knopf mit der Uhr in der Werkzeugleiste öffnet den
**Verlauf** rechts, wo sonst die Kommentare stehen — ist ein Schritt gewählt,
gleich gefiltert auf ihn:

```
Verlauf  3 Einträge                                              ✕
[🔍 Suchen — Stelle, Feld, Wert, Notiz …                         ]
[Check data         ▾] [Alle Personen       ▾] [Letzte 7 Tage     ▾]
Von Hand  Abgleich BPMN  Abgleich Domain  Umwandlung  Beim Laden
┌ 09:14 Pascal Mengelt                                   Von Hand ┐
│ ~ Check data · Eingabe kind · Ausdruck                          │
│   =a → =b                                                       │
└─────────────────────────────────────────────────────────────────┘
┌ 08:50 Pascal Mengelt                              Abgleich BPMN ┐
│ Mit BPMN abgleichen: openSavings-impl.bpmn                      │
│ ~ Service Check data · Status   Entwurf → Angepasst             │
└─────────────────────────────────────────────────────────────────┘
```

- **Jeder Eintrag**: Zeitpunkt, wer (die Anmeldung, wie bei Kommentaren),
  **Herkunft** — von Hand, Abgleich BPMN, Abgleich Domain, Umwandlung
  (Engine, JUEL → FEEL), beim Laden (ausgemusterte Felder, Pool angeglichen,
  Typnamen mit dem Katalog verknüpft) —, beim Abgleich dessen Bericht
  (neu, entfallen, geändert, umbenannt, nur in der Spezifikation …), und je
  Änderung die Stelle mit Feld und **vorher → nachher**.
- **Die Stellen** sind dieselben wie bei den Kommentaren (`step:<id>#in:<name>`,
  `type:<id>#field:<id>` …) samt ihrem Namen zum Zeitpunkt der Änderung —
  ein Klick springt hin; was es nicht mehr gibt, steht mit «(entfallen)» in
  der Auswahl.
- **Filtern** nach Element (Schritt, Typ …), nach **Person**, nach
  **Zeitraum** (heute, letzte 7 oder 30 Tage, von–bis), nach Herkunft
  und mit einer **Textsuche** über Stelle, Feld, vorher/nachher, Notiz und
  Bericht — alle Wörter müssen vorkommen; passt nur eine Änderung, bleibt
  vom Eintrag nur sie stehen.
- **Erfasst** wird alles, weil die App zwei Stände vergleicht (`src/audit.ts`,
  `diffSpecs`) statt an jeder Stelle einzeln zu protokollieren: von Hand ist,
  was sich zwischen zwei Speicherläufen ändert; eine Änderung mit Herkunft
  (Abgleich, Pattern, Umwandlung …) wird ein eigener Eintrag mit ihrem Grund.
  Kommentare stehen nicht drin — sie sind selbst ein Verlauf.
- **Tippen** erzeugt je Autosave eine Zeile; die Anzeige fasst aufeinander
  folgende Einträge derselben Person innerhalb von zehn Minuten zusammen
  (erstes «vorher», letztes «nachher» je Feld).

Das Protokoll liegt **neben** der Spezifikation, nie in ihr — in keinem
Export, nicht in der JSON (siehe [Datenablage](#datenablage-im-geteilten-ordner)).

### Status je Schritt

**Entwurf · In Prüfung · Final · Umgesetzt · Abgenommen · Angepasst** — am
ganzen Prozess und an jedem einzelnen Schritt. «Abgenommen» ist der
Endzustand und deshalb als einziger Chip gefüllt statt getönt. Die Verteilung
steht im Kopf und ist zugleich Filter; ein Klick auf den Chip im Baum schaltet
weiter.

### Was der Requirements Engineer festlegt

Die Spezifikation entsteht am BPMN. Fünf Dinge beschreibt sie darüber hinaus,
und jedes davon steht in einem Feld direkt am gewählten Element:

| am Element | Feld | landet im BPMN als |
| --- | --- | --- |
| Prozess | **Time to Live** (Tage) | `camunda:historyTimeToLive` |
| Benutzeraufgabe | **Zuständigkeit** — Gruppen und direkte Zuteilung | `camunda:candidateGroups` · `camunda:assignee` |
| Verzweigung | **Zweige** — Beschriftung und Bedingung | Name und `conditionExpression` des Sequenzflusses |
| Service-Task | **Behandelte Fehler** und reguläre Ausdrücke für Fehlercodes (jeder wird geprüft); ein Eintrag mit `=` ist ein FEEL-Ausdruck (Text oder Liste von Texten), sonst ein fester Text | `_handledErrors` · `_regexHandledErrors` — Camunda 8 eine Liste (`=["404"]`, mit Ausdrücken `=flatten(["404", codes.x])`), Camunda 7 ein Text mit Kommas (`404, ${codes.x}`) |

Diese Angaben gehen nicht nur in die Spezifikation, sondern **zurück ins
Diagramm**. Das ist kein Komfort, sondern Notwendigkeit: der Abgleich mit der
BPMN-Datei baut den Baum jedes Mal neu auf, und was nur in der Spezifikation
stünde, wäre danach weg.

Fehler, die von einem **Boundary-Event** kommen, lassen sich hier nicht
umbenennen oder löschen — Code und Pfad stehen im Diagramm, dort gehören sie
auch geändert. Bearbeitbar sind die aus `_handledErrors` / `_regexHandledErrors` und die hier neu
erfassten. Nebenpfade (Boundary-Events ohne Fehler) zählen nicht als behandelter Fehler.

**Klassen** beschreibt der Requirements Engineer an drei Stellen: am Prozess
(`In` · `Out`), an jeder Benutzeraufgabe (`In` · `Out`) und an jeder
empfangenen Nachricht (`In`). Das Nachrichten-Startereignis des Prozesses ist
davon ausgenommen — dessen Felder sind das `In` des Prozesses.

**Mappings** beschreibt er an den Service-Tasks und den Call Activities.

### Services und Teilprozesse mit vorbereitetem Mapping

Der Katalog kommt aus der **OpenAPI** der Projekte — eine Quelle für alles:
Worker, Prozesse, Benutzeraufgaben und Signale, jeweils mit ihren Ein- und
Ausgaben. Sie beschreibt, was **tatsächlich deployed** ist.

**Admin → Katalog → Katalog lokal erzeugen → OpenAPI einlesen** nimmt einen Ordner und sammelt
alle `OpenApi.yml` darunter ein; «Dateien» wählt stattdessen einzelne. Beides
läuft im Browser, ohne Netzwerk. Für Skripte und CI dasselbe im Terminal:

```bash
node tools/openapi2catalog.ts <datei|ordner|url …> [--out model.json]
```

Aus der `OpenApi.yml` jedes Projekts liest die App:

| Operation | wird zu |
| --- | --- |
| `POST /process/<id>/async` — «Process start» | Teilprozess, Eingaben aus dem Request-Schema |
| `GET /process/…/variables` — «Process variables» | dessen Ausgaben |
| `POST /worker/<topic>` — «Worker: X» | Service; **das Topic ist der Pfad** |
| «UserTask variables / complete: X» | Benutzeraufgabe mit Ein- und Ausgaben |
| «Signal: X» / «Message: X» | Signal |

Das bringt drei Dinge, die die element-templates nicht haben: **Feld­beschreibungen**
aus den Schemas (in den Beispieldaten 1106 Felder), **`required`**, und
**Benutzeraufgaben und Signale** überhaupt. ADT-Eingaben (`enum In: case …`,
in der OpenAPI ein `oneOf`) werden zur Vereinigung ihrer Varianten
zusammengezogen. Der Vorgabe-Ausdruck ist `= name` — die Hauskonvention,
in FEEL, der Sprache der Spezifikation; in den Templates steht dafür JUEL,
mal `#{name}`, mal `#{execution.getVariable('name')}`, beides dasselbe.
Ältere Kataloge mit `#{name}` übersetzt die App beim Laden.

**JUEL wird FEEL, wo immer es geht.** Beim Öffnen einer Spezifikation werden
Mappings und Zweigbedingungen aus einem älteren Stand übersetzt, soweit es
ein FEEL-Gegenstück gibt; gespeichert wird das mit dem nächsten Autosave. Nur
was sich nicht übersetzen lässt (Bean-Aufrufe, Setter …), bleibt JUEL und
wird am Feld gemeldet.

Nicht in der OpenAPI stehen die konkreten `_handledErrors` — die liest der
Import aus dem BPMN, wo sie ohnehin gepflegt sind. `Init Worker` und das Feld
`inConfig` überspringt der Leser: Implementations-Details.

Zuvor kam der Katalog aus den Camunda **element-templates**. Die sind
inzwischen entfernt: sie enthielten auch Einträge, die es längst nicht mehr
gibt — beim Abgleich über 62 lokale OpenAPI-Dateien standen 115 Einträge nur
in den Templates, ohne Entsprechung in irgendeiner OpenAPI. Umgekehrt stimmten
von 274 gemeinsamen Einträgen 250 exakt überein, 21 unterschieden sich nur in
der Feldreihenfolge, und 3 hatten in der OpenAPI **mehr** Felder (dort fehlten
im Template die ADT-Varianten) — keiner hatte weniger.

Ein aus dem BPMN gelesener Schritt trägt oft kein Template, aber ein **Topic**
— und in der OpenAPI *ist* das Topic der Pfad und damit die Kennung. Die App
sucht deshalb über Kennung, Topic und gerufenen Prozess; so findet auch ein
importierter Schritt seinen Eintrag. Fehlen ihm Felder, die der Katalog kennt,
steht dort **«+ 16 aus Katalog»** — ein Klick übernimmt sie mit Ausdruck und
Bedeutung. Und wo ein Feld keine eigene Bedeutung hat, steht die aus dem
Katalog als Vorschlag im Eingabefeld, ohne mitgespeichert zu werden.

Die Mappings sind **bearbeitbar** — Ausdruck und fachliche Bedeutung je Zeile —
und jede Zeile hat ein **Häkchen**: Was möglich wäre, dieser Prozess aber nicht
braucht, wird **abgewählt** — so bleibt sichtbar, was es gäbe. Löschen geht
daneben ebenfalls, je Zeile über den Papierkorb.
Der Kopf zeigt dann «5 von 6», der Export listet die abgewählten getrennt als
«Nicht verwendet», und ein erneuter BPMN-Abgleich stellt sie nicht wieder her:
die Abwahl gehört der Spezifikation, wie die fachliche Bedeutung.

**Das Mapping misst sich am Datenmodell.** Hat der Schritt eine Interaktion mit
`In`/`Out`, sind deren Felder der Massstab; sonst der Katalog-Eintrag. Der Kopf
bietet dann «+ 1 aus Modell» bzw. «+ 1 aus Katalog» für das, was fehlt.
Löschen geht bei jeder Zeile — ein Feld des Massstabs steht danach wieder
unter «+ aus Modell» bereit; wer es sichtbar behalten will, wählt es ab.

**Pflichtfelder** tragen ein Sternchen: ein Feld, das im `In` der Interaktion
nicht optional ist — oder laut Katalog `required` —, muss der Service
bekommen. Die Zeile lässt sich deshalb weder abwählen noch entfernen; das
Sternchen und das Häkchen erklären das beim Überfahren. Fehlt ein
Pflichtfeld ganz oder ist es aus einem alten Stand abgewählt, steht das rot
über der Tabelle.

**Erweiterungen** sind trotzdem möglich: «+ Feld» gibt es immer, auch mit
Massstab — etwa für ein Feld, das der Service demnächst bekommt. Eine Zeile,
die das Modell noch nicht kennt, wird **gelb markiert** (Warnung, kein
Fehler), mit Zähler darüber («1 Zeile noch nicht im Modell — Erweiterung,
dort nachziehen»). Sobald das Feld im Datenmodell bzw. Katalog steht, ist
die Zeile ohne weiteres Zutun in Ordnung; bis dahin lässt sie sich auch
wieder entfernen. **Rot** bleibt dem Fehler vorbehalten: derselbe Name
zweimal in den aktiven Zeilen («Doppelt: «clientKey»»), denn die zweite
Zeile überschriebe die erste.

### FEEL-Ausdrücke — die Sprache der Spezifikation

Ein Mapping-Wert oder eine Zweigbedingung, die mit `=` beginnt, ist ein
FEEL-Ausdruck — **unabhängig von der Engine**. Die Spezifikation spricht
FEEL; was die Engine braucht, entsteht beim Export (siehe unten). Die App
prüft jeden Ausdruck **beim Tippen** und zeigt den Befund über dem Feld:

- **Syntax** — `= amount +` ist kein gültiges FEEL («Fehler an Position 9,
  Ausdruck unvollständig»).
- **Pfade** — `= client.addr.x` zeigt ins Leere («client hat kein Feld
  addr»); eine unbekannte Variable oder Funktion ebenso.
- **Typ** — `= client.address.zip` in ein `String`-Feld: «Ergebnis ist Zahl,
  das Feld erwartet Text». Der erwartete Typ kommt aus der In-Klasse der
  Interaktion — oder, wo der Schritt keine eigene hat, aus dem
  **Domain-Katalog**: das `<Objekt>.In` bzw. `.Out` des Service-Objekts
  (gefunden über Topic, gerufenen Prozess oder Interaktionsnamen) trägt die
  echten Scala-Typen. So werden auch importierte Prozesse geprüft. Ein
  optionales Feld nimmt auch `null`, ein `LocalDate` sowohl ein Datum als
  auch dessen Text. Ist ein Feld dort nicht `Option[…]` und hat keine
  Vorgabe, gilt es als Pflichtfeld.
- **Optional auf Pflicht** — `= accountTypes` in ein Pflichtfeld, wo
  `accountTypes` ein `Option[…]` ohne Vorgabe ist: Warnung, der Wert kann
  fehlen. Ein Feld **mit Vorgabewert** ist dagegen garantiert da, auch als
  `Option[…]` — als Quelle wie als Ziel.

Gerechnet wird mit **Beispielwerten**: aus dem Datenmodell entsteht ein
Kontext, in dem jede bekannte Variable einen zum Typ passenden Wert hat;
[feelin](https://github.com/nikku/feelin) wertet den Ausdruck darin aus. Die
Variablen sind das `In` des Prozesses, das `InitIn`, das `InConfig` (eigene
Stellschrauben und die der Schleifen), die Prozessvariablen der Spezifikation
und die Ausgaben aller Schritte — bei Letzteren ist der Typ
meist unbekannt, dort bleibt die Prüfung stumm statt falsch zu warnen. Rot
heisst Fehler. Der Tooltip des Feldes nennt bei gültigem FEEL den
Ergebnistyp. **Zweigbedingungen** werden genauso geprüft, mit erwartetem
Ergebnis Ja/Nein.

In einem **Camunda-7-Prozess** kommt eine gelbe Warnung dazu, wenn ein
Ausdruck kein JUEL-Gegenstück hat (`count(items)`, Filter, Listen,
Datumswerte) — man erfährt es beim Tippen, nicht erst beim Export.

**Vervollständigung:** `= cli` schlägt `client` vor, `client.` dessen Felder
(`name`, `address ›`), `client.addr` filtert. Je Vorschlag stehen Scala-Typ,
FEEL-Typ und Herkunft; Pfeiltasten wählen, Enter oder Tab übernimmt, Escape
schliesst. Vorgeschlagen werden nur Variablen und Pfade, keine Funktionen.

**Ausgaben** sehen zuerst das **Ergebnis des Services**: der Worker gibt
sein `Out` zurück, und dessen Felder werden zu Variablen des Jobs — die
Quelle heisst also `= accountId`, nicht `= out.accountId`. Woher das `Out`
kommt: die Out-Klasse der Interaktion, sonst das `<Objekt>.Out` aus dem
Domain-Katalog (über Topic bzw. gerufenen Prozess), sonst die
Ausgabe-Parameter des Katalog-Eintrags (ohne Typ). Dahinter stehen die
Prozessvariablen, wie in Camunda 8 auch. Der erwartete Typ ist der des
Out-Felds mit dem Namen der Zeile.

### Export: die App übersetzt in die Engine

Die Mappings leben in der Spezifikation; ins Diagramm kommen sie beim
**Export → BPMN**. Dort schreibt die App sie in die Form der Engine:

| | Camunda 8 | Camunda 7 |
| --- | --- | --- |
| Mapping | `<zeebe:ioMapping>` mit `source="=client.name"` | `<camunda:inputOutput>` mit `${client.name}` |
| Teilprozess | ebenfalls `zeebe:ioMapping` | `<camunda:in source="client">` bzw. `sourceExpression="${client.name}"` |
| Service (in der Spezifikation angelegt) | `_manualOutMapping` = `=true`, `_outputVariables` = Text `="a, b"` der Variablen, die die Ausgaben lesen (auch in FEEL-Ausdrücken; ohne: `NONE`, dann entfällt `_manualOutMapping`) | `_manualOutMapping` = `#{true}`, `_outputVariables` = `a, b` |
| Service (aus dem BPMN) | wie er war: `_manualOutMapping` bleibt; `_outputVariables` nur geändert, wenn Ausgaben an- oder abgewählt wurden; fehlte es (= alles), bleibt es weg | ebenso |
| Init-Worker | nie `_outputVariables` oder `_manualOutMapping` — er gibt das `InitIn` zurück | ebenso |
| Mock-Steuerung (nur am Teilprozess) | `_servicesMocked`, `_mockedWorkers`, `_identityCorrelation` = `=_servicesMocked` … — nur mit `propagateAllParentVariables="false"`, sonst sieht der Teilprozess sie ohnehin | `<camunda:in source="_servicesMocked" target="_servicesMocked"/>` … — immer; dazu `impersonateUserId` (der alte Weg zur Identität — BPF/MAP starten noch ohne `_identityCorrelation`, ohne ihn riefe der Teilprozess die Services mit dem technischen Benutzer) |
| Mock am Schritt (gewählt) | zusätzlich `_outputMock` bzw. `_outputServiceMock` = `=createContractMock`, Feld im `InConfig` | dasselbe als `#{execution.getVariable('createContractMock')}` (am Teilprozess `source="createContractMock"`) |
| Service-Task | keine Mock-Steuerung — der Worker liest `_servicesMocked` selbst aus den Prozessvariablen; eine blosse Weitergabe im Diagramm fällt weg, ein fester Wert (`= true`) bleibt | ebenso |
| Steuerparameter (`_…`) | immer am Schluss der Eingaben bzw. Ausgaben | ebenso |
| Business Key am Teilprozess | Eingabe `businessKey` = `=businessKey` (immer) | `<camunda:in businessKey="#{execution.processBusinessKey}"/>` (immer) |
| Zweigbedingung | `=amount > 3` | `${amount > 3}` |

FEEL → JUEL wird **strukturell** übersetzt, über den Parsebaum — nicht mit
Textersetzung, sonst würde aus `a = b` in einer Zeichenkette ein `==`. Die
Teilmenge mit JUEL-Gegenstück: Pfade, Literale, Rechnen (`Text + Text` wird
`concat`), Vergleiche (`=` → `==`, `between`, `in [...]`), `and`/`or`/`not`,
`if … then … else` (→ `? :`) und ein fester Listenindex (`items[1]` →
`items[0]`, FEEL zählt ab 1). Alles andere bleibt als FEEL im BPMN stehen und
wird im Export-Dialog als **«Stelle zum Prüfen»** gemeldet — lieber sichtbar
falsch als still verloren. Der Orchescala-Export (Markdown) zeigt die
Ausdrücke ebenfalls in Engine-Form, Nichtübersetzbares markiert.

Eine Ausgabe des Services unter ihrem eigenen Namen (`address = address`,
aus `_outputVariables` oder dem Katalog) ist beim Service aus dem BPMN **kein
Output-Parameter**: ohne manuelles Mapping setzt der Worker sie selbst —
ein zweiter Schreibvorgang wäre überflüssig und kann in parallelen Zweigen
zu Konflikten führen (`ENGINE-03005 … updated by another transaction
concurrently`); mit manuellem Mapping bleibt sie lokal wie bisher, ausser sie
wird neu angehakt. Angehakt oder abgewählt ändert sie `_outputVariables`.

Eine **ältere Spezifikation** (vor diesen Angaben importiert) weiss weder die
Art des Services noch seine Mock-Variable. Dann gilt, was das Diagramm sagt:
ohne `_manualOutMapping` nicht manuell, `_outputVariables` und
`_outputMock = getPoasMock` wie dort, und `x = x` mit x in `_outputVariables`
ohne Output-Parameter im Diagramm wird keiner — in `valiant-product` legten
sonst `Get Details ClientKey` und `Get Details clientKeyCardholder` in den
zwei Zweigen eines Parallel-Gateways beide `master` und `person` an.
Ein Skript, das eine ältere Version als FEEL-Text eingepackt hat
(`= "«Groovy» …"`), bleibt im Diagramm stehen.

Angefasst werden nur Schritte, die in der Spezifikation Mapping-Zeilen haben;
abgewählte Zeilen kommen nicht ins BPMN, Steuerparameter (`_handledErrors`,
`_outputMock` …) bleiben, wie sie im Diagramm stehen. Alte JUEL-Werte aus
einem Import (`${x}`) werden unverändert übernommen — in einem
Camunda-8-Export mit Hinweis, denn dort wäre das ein fester Text.

**Import** kann beides lesen: `camunda:inputOutput` / `camunda:in` wie bisher
und für Camunda 8 `zeebe:ioMapping` (samt `_handledErrors` und `_outputMock`),
`zeebe:taskDefinition` (Topic), `zeebe:calledElement` (gerufener Prozess),
`zeebe:calledDecision` (Entscheidung) und `zeebe:assignmentDefinition`
(Gruppen, Zuständige). Eine FEEL-Quelle `=x` kommt als
`= x` in die Spezifikation — und **JUEL wird zu FEEL**: `${client.name}` wird
`= client.name`, `${a == b ? 'x' : 'y'}` wird `= if a = b then "x" else "y"`,
eine Vorlage wie `Hallo ${name}` wird `= "Hallo " + name`. Übersetzt wird
mit einem kleinen JUEL-Parser: Pfade, Literale, Rechnen (`%`/`mod` →
`modulo()`), Vergleiche (auch `eq`/`ne`/`lt`…), `&&`/`||`/`!`, `? :`,
`empty x`, Index `[0]` → `[1]` und die üblichen String-Methoden (`concat`,
`equals`, `contains`, `startsWith`, `toUpperCase`, `size`, `isEmpty` …).
Dazu die Camunda-7-Eigenheiten, die in FEEL schlicht Pfade oder Variablen
sind: Spin (`S(x)`, `JSON(x)`, `.elements()`, `.prop("k")`, `.value()`,
`.hasProp`, `.jsonPath("$.a")`), `execution.getVariable("x")` → `x`,
`execution.getProcessInstanceId()` → `processInstanceKey`,
`getBusinessKey()` → `businessKey`, `getProcessDefinition().getKey()` →
`processDefinitionKey` (so heissen sie in den Camunda-8-Prozessen),
`result.get("k")` → `result.k` und Zeitketten wie
`dateTime().toLocalDate().plusYears(1)` → `today() + duration("P1Y")`. Über
alle globex-Prozesse bleiben von gut 4000 Ausdrücken ein Dutzend übrig —
Setter, `append`, dynamische Variablennamen, `jsonPath`-Filter.
Was kein Gegenstück hat (fremde Methoden, Java-Aufrufe), bleibt als JUEL
stehen und wird am Feld gelb gemeldet — der Export übernimmt es für Camunda 7
unverändert. Ein fester Text ohne `${}` bleibt ein fester Text.

Die Beispieldaten enthalten **301 Einträge** (220 Services, 54 Teilprozesse,
19 Benutzeraufgaben, 8 Signale) aus 62 OpenAPI-Dateien.

### Camunda 7 ⇄ Camunda 8

Ein Klick auf die Engine im Kopf («· Camunda 7») wandelt das Diagramm in die
andere Engine um — und zurück. Der Dialog wandelt erst zur Probe und zeigt,
was danach von Hand zu prüfen ist; umgestellt wird erst auf «Umwandeln».
Layout, IDs, Topics und Namen bleiben, nur die Erweiterungen wechseln die Form
(`src/engineConvert.ts`, Regeln wie im Migrationsleitfaden `bpmn-c7-to-c8`):

| Camunda 7 | Camunda 8 |
| --- | --- |
| `camunda:type="external"` `camunda:topic` | `zeebe:taskDefinition type` |
| `camunda:inputOutput` | `zeebe:ioMapping` (fester Text wird `="…"`) |
| `calledElement` + `camunda:in`/`out` (`variables="all"`) | `zeebe:calledElement` (`propagateAll…`) + `zeebe:ioMapping` |
| `camunda:decisionRef` / `resultVariable` | `zeebe:calledDecision` |
| `camunda:assignee` / `candidateGroups` / `formKey` | `zeebe:userTask` + `assignmentDefinition` / `formDefinition` |
| `camunda:collection` / `elementVariable` | `zeebe:loopCharacteristics` |
| `camunda:modelerTemplate` | `zeebe:modelerTemplate` (der Service-Verweis bleibt) |
| Listener `execution.setVariable("x", v)` am End-Event | Output-Mapping `x` |
| `${…}` in Bedingungen, Timern, Mappings | `=…` |

Ohne Gegenstück fallen still weg: `async…`, `exclusive`, Job-Prioritäten,
Retry-Zyklen, `historyTimeToLive` (zurück nach Camunda 7 kommt sie aus der
Spezifikation). **Gemeldet** wird, was Handarbeit braucht: andere Listener,
Skripte (Groovy), nicht übersetzbare Ausdrücke, die Ergebnisform einer
Entscheidung und der Korrelationsschlüssel wartender Nachrichten
(vorgeschlagen: `=businessKey`).

**On the fly** geht es auch ohne Umstellen: **Export → BPMN** hat die Wahl
«für Camunda 7 | Camunda 8». Die andere Engine wird beim Export umgewandelt
(`…-bpmn-c8.bpmn`), Spezifikation und Diagramm bleiben, wie sie sind.

### Exporte

| Export | für wen | Inhalt |
| --- | --- | --- |
| **Fachlich** | Fachbereich, Review, Abnahme | Ablauf in Prosa, Beschreibungen, offene Punkte — ohne technische Ausdrücke |
| **Orchescala** | Umsetzung und KI | Überblick als Baum, danach je Schritt ein Abschnitt mit stabiler ID: Topic, Service, Mappings, Fehler, Mocks, Zweige |
| **Scala** | Umsetzung | das Datenmodell als Orchescala-Domain, dateiweise |
| **BPMN** | Umsetzung, Import | das Diagramm im Stand des Editors — für Camunda 7 oder 8 |
| **JSON** | Sicherung / Weiterverarbeitung | die Spezifikation selbst |

Der Orchescala-Export ist bewusst flach und explizit, damit daraus ohne
Navigieren im Baum Domain, Worker und Simulation abgeleitet werden können.

## Datenablage im geteilten Ordner

```
<geteilter Ordner>/
├── config/
│   └── model.json            Service-Katalog, Domain-Typen, Anmeldung, Benachrichtigungen
├── users.json                wer hier arbeitet — Vorschläge bei «@» in Kommentaren
└── processes/
    ├── <slug>.json           die Spezifikation
    ├── <slug>.bpmn           das Diagramm dazu (im Editor bearbeitbar)
    └── <slug>.audit.jsonl    ihr Änderungsprotokoll (Verlauf), eine Zeile je Eintrag
```

Fehlen `config/model.json` oder `processes/`, legt die App sie an. Eine
vorhandene, aber defekte `model.json` wird nie überschrieben. Auch eine
defekte `users.json` nicht: sie wird vor dem nächsten Eintrag unverändert
als `users.broken-<Zeitstempel>.json` gesichert, dann beginnt die Liste neu
(klappt die Sicherung nicht, bleibt alles, wie es ist). Die Stammdaten
liegen in `config/`, damit dort in SharePoint nur Admins schreiben
([docs/SHAREPOINT-SETUP.md, Teil 3b](docs/SHAREPOINT-SETUP.md#teil-3b--stammdaten-schützen-config)). Ältere
Ordner mit der `model.json` im Hauptordner laufen weiter; der Admin-Bereich
weist darauf hin, sie von Hand nach `config/` zu verschieben. Änderungen werden ca. eine
Sekunde nach der letzten Eingabe automatisch gespeichert; Konflikte werden
über lastModified bzw. ETag erkannt.

Das **Änderungsprotokoll** wird nur angehängt, und erst, wenn die
Spezifikation gespeichert ist — schlägt das fehl, geht es mit dem nächsten
Speichern nochmals. Wer gleichzeitig anhängt, bekommt einen Konflikt
(lastModified bzw. ETag) und liest neu. Über 2000 Einträge wandert der ältere
Teil in ein Archiv `<slug>.audit-<Zeitstempel>.jsonl`; die laufende Datei
behält die letzten 1000. Eine kaputte Zeile kostet nur sich selbst. Die
Liste der Spezifikationen liest nur `.json` und sieht die Protokolle nicht.

## Anmeldung (Microsoft Entra ID)

Wie im arch-review: MSAL im Browser, Authorization Code Flow + PKCE, kein
eigener Server. Konfiguriert wird unter **Admin → Anmeldung** (Tenant-ID,
Client-ID, Rollen, aktiv); die Einstellung liegt als `auth` in der
`config/model.json`. Drei Stufen über Entra-App-Rollen: **Admin** (alles, auch
Spezifikationen löschen), **Editor** (Spezifikationen bearbeiten), **Viewer**
(nur lesen). Für den
SharePoint-Modus erzeugt der Admin einen **Einrichtungs-Link**, der Anmeldung
und Ordner in einem Schritt setzt.

Die Anmeldung lässt sich per URL nicht umgehen, auch im Dev-Server nicht;
wer sich ausgesperrt hat, setzt in der `config/model.json` `auth.enabled` auf
`false`. Im Dev-Server schreibt `?teamsmock` Teams-Nachrichten in die
Konsole statt sie zu senden, `&teamsdelay=<Sekunden>` verkürzt die
Wartezeit.

Anleitungen:

- [docs/ENTRA-SETUP.md](docs/ENTRA-SETUP.md) — App-Registrierung,
  Umleitungs-URIs, Berechtigungen (Dateien, Verzeichnissuche, Teams),
  App-Rollen, Einrichtung in der App, Fehlermeldungen
- [docs/ENTRA-ADMIN-ANLEITUNG.md](docs/ENTRA-ADMIN-ANLEITUNG.md) — die
  kompakte Fassung für die Entra-Administration
- [docs/SHAREPOINT-SETUP.md](docs/SHAREPOINT-SETUP.md) — Site und Ordner,
  Berechtigungen je Rolle, `config/` schützen, verbinden und
  Einrichtungs-Link verteilen

## Werkzeuge (CLI)

Dieselbe Logik wie in der App, für Skripte und CI:

```bash
node tools/bpmn2spec.ts <datei.bpmn> [ziel.json]
```

Erzeugt bzw. aktualisiert eine Spezifikation aus einer BPMN-Datei. Existiert
die Zieldatei, bleiben die fachlichen Texte erhalten und es wird ein
Änderungsbericht ausgegeben.

```bash
node tools/site2catalog.ts <url-oder-datei> [--out model.json]
```

Holt die Prozesse von der Doku-Site (Startseite oder eine `catalog.html`) in
den Domain-Katalog. In Node greift kein CORS — wo der Browser scheitert, kommt
man hier immer an den Katalog und exportiert ihn anschliessend als Datei.

```bash
node tools/domain2catalog.ts <ordner…> [--out model.json]
node tools/domain2catalog.ts --from model.json
```

Liest die Orchescala-Domain ein und schreibt den Domain-Katalog in die
`model.json` — dieselbe Logik wie in der App, aber mit Pfaden statt
Ordnerauswahl. Ein Ordner darf ein Projekt sein oder ein Ordner darüber; dann
kommen alle Projekte darunter, alphabetisch. **Die Reihenfolge ist der
Vorrang**; verworfene Pakete stehen am Ende der Ausgabe.

Jeder Lauf schreibt die **Projektliste samt Pfaden** in die `model.json` —
dieselbe Liste, die der Admin-Bereich zeigt und sortiert. `--from` nimmt sie
von dort und liest in genau dieser Reihenfolge, ohne weitere Argumente. Beim
Exportieren des Katalogs bleiben die Pfade zurück; die Reihenfolge reist mit.

So sind die Beispieldaten entstanden:

```bash
node tools/bpmn2spec.ts ~/dev-globex/projects/globex-savings/src/main/resources/camunda/savings-openSavingsV1.bpmn sample-data/processes/globex-savings-opensavingsv1.json
node tools/openapi2catalog.ts ~/git-temp ~/dev-globex/projects --out sample-data/model.json
node tools/domain2catalog.ts ~/dev-initech/projects ~/dev-globex/projects --out sample-data/model.json
```

Die Ausgabe zeigt, was jedes Projekt beigetragen hat, und was die
Vorrang-Regel verworfen hat:

```
  117  initech-core-banking
  696  globex-core-banking
  …
verworfen: globex.core.banking.domain.client.v1 (13 Typen) — Vorrang hat initech.core.banking.domain.client.v1
```

## Aufbau

| Datei | Zweck |
| --- | --- |
| `src/types.ts` | Datenmodell: `ProcessSpec`, `Step`, `Branch`, `LoopSpec`, `ServiceDef` |
| `src/bpmn.ts` | BPMN → Baum (Post-Dominator, Schleifen, Link-Ereignisse, Fehler-/Nebenpfade) und `mergeSpec` |
| `tools/fixtures/edge-cases.bpmn` | Prüffall: paralleles Gateway, leere Namen, Nebenpfad |
| `src/scala.ts` | Datenmodell → Orchescala-Domain, plus die Prüfungen |
| `src/domainScan.ts` | Scala-Quellen → Domain-Katalog (case class, enum, In/Out) |
| `src/openApi.ts` | OpenAPI → Services, Prozesse, Benutzeraufgaben, Signale |
| `src/siteCatalog.ts` | Doku-Site → Prozesse mit `In`/`Out` |
| `src/serviceTypes.ts` | Verweise auf Katalog-Typen, plus Ableitung aus dem Servicenamen |
| `src/exporters.ts` | die drei Exporte |
| `src/patterns.ts` | Pattern: Pattern-BPMN lesen, einfügen, erkennen, entfernen |
| `src/xmlFormat.ts` | Einrückung beim Schreiben ins BPMN (Mappings, Pattern) |
| `src/components/PatternAdmin.tsx` | Pattern im Admin: Liste, Editor, Datei |
| `src/store.tsx` | Ordner, Laden/Speichern, Konflikte |
| `src/audit.ts`, `src/components/AuditPanel.tsx` | Änderungsprotokoll: Vergleich zweier Stände, Ablage, Verlauf |
| `src/backend.ts`, `src/graph.ts` | lokaler Ordner bzw. SharePoint über Graph |
| `src/auth.tsx` | Entra-Anmeldung (MSAL) |
| `src/components/BpmnEditor.tsx` | bpmn-js im Editor, Abgleich in beide Richtungen |
| `src/clipboard.ts`, `src/copyPaste.ts`, `src/bpmnClipboard.ts` | Kopieren und Einfügen: Zwischenablage über Tabs, was mitwandert, der Baum von bpmn-js als JSON |
| `src/components/` | Liste, Prozessansicht, Detailspalte, Klassenbauer, Export, Admin |

## Offene Punkte

- **Pattern im Ablauf.** Ein Pattern hängt sich heute an ein Element an
  (Erweiterungen, Boundary-Ereignisse) oder bringt eigene Blöcke mit. Was sich
  **in den Sequenzfluss einfügt** — der Signal-Wurf «stop escalation» nach der
  Aufgabe, der Init-Worker nach dem Start —, fehlt noch; dafür müsste die App
  den Fluss auftrennen und das Layout dahinter verschieben.
- **Pattern aus dem Diagramm übernehmen.** Ein Pattern entsteht im Admin von
  Hand; schneller wäre: ein Element im Prozess wählen und «als Pattern
  speichern» — samt dem, was an ihm hängt.

- **Confluence-Import.** Die bestehende Spezifikation liegt als Confluence-HTML
  vor; ein Importer, der Überschriften, Tabellen und Diagramm-Verweise in
  `description`/`open` je Schritt überträgt, fehlt noch. Damit würde aus einer
  vorhandenen Spez. auf einen Schlag eine App-Spezifikation.
- **DMN.** Entscheidungen stehen inzwischen im Katalog (kind `rule`, aus den
  `Dmn:`-Operationen der OpenAPI) und ein Business-Rule-Task bietet **nur** sie
  zur Auswahl an — die Auflösung läuft über die `camunda:decisionRef`. Was
  weiter fehlt: die Entscheidungstabelle selbst darstellen und exportieren.
- **Schritte aus dem Ablauf heraus anlegen.** Der Weg BPMN → Spezifikation
  läuft, und das Diagramm lässt sich in der App bearbeiten. Was fehlt: aus dem
  Baum heraus einen Schritt anlegen oder löschen — dafür müsste die App einen
  BPMN-Graphen samt Layout erzeugen (Position der Elemente, Verläufe der
  Kanten). Erst damit liesse sich ein Prozess rein in der Spezifikation
  entwerfen.
- **Rückweg Scala → Datenmodell.** Der Domain-Katalog liest die Typen der
  Service-Projekte ein; ein bestehendes `In` eines eigenen Prozesses in den
  Klassenbauer zu übernehmen (mit Feldern, Vorgaben und Einschränkungen) fehlt
  noch — der Scanner erfasst heute Namen und Feldnamen, nicht die vollen
  Typausdrücke.
- **Schritte von Hand ergänzen.** Aktuell entsteht der Ablauf aus der BPMN;
  ein rein fachlicher Entwurf ohne BPMN lässt sich noch nicht bearbeiten.
- **Diagramm.** Eine kleine Übersichtsgrafik (Mermaid) neben dem Baum wäre der
  nächste sinnvolle Schritt.
