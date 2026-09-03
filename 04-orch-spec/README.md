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

Dann <http://localhost:3002/orch-spec/?demo&noauth> öffnen — die App startet
direkt mit den Beispieldaten aus `sample-data/` (ohne Ordnerauswahl und ohne
Anmeldung; beides nur im Dev-Server). Die Beispieldaten sind **echt**: sie
wurden aus `mkk-openMkkV1.bpmn`, den OpenAPI-Dateien und den Scala-Quellen
der valiant-Projekte erzeugt.

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

Geprüft über alle **72 BPMN-Dateien** der valiant-Projekte: kein Element geht
verloren, und ein erneuter Import derselben Datei ändert nichts
(0 neu · 0 geändert · 0 entfallen).

### Spezifikation und Implementation nebeneinander

**«Mit BPMN abgleichen»** liest die BPMN-Datei erneut ein und übernimmt die
Struktur — die fachlichen Texte (Beschreibung, Notiz, offene Frage, Bedeutung
der Mappings) bleiben über die stabile BPMN-Element-ID erhalten, auch in
Fehler- und Nebenpfaden. Der Bericht danach zeigt, was neu ist, was sich
geändert hat und was entfallen ist; neue Schritte stehen auf **Entwurf**,
technisch geänderte auf **Angepasst**. Ein bereits gesetzter Status bleibt
sonst unangetastet — er gehört der Spezifikation, nicht dem Import.

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
- Feld-IDs sind stabil: Umbenennen bricht keine Verweise.
- **Geprüft wird sofort**: ungültige Scala-Namen, Schlüsselwörter, doppelte
  Felder, verwaiste Typverweise, Einschränkungen auf zusammengesetzten Typen
  und Zyklen über Pflichtfelder.

Erzeugt wird die Orchescala-Domain im Hausstil: `case class` mit
`@description`-Annotationen, Companion mit `given ApiSchema` /
`given InOutCodec`, `example` und ein `exampleMinimal`, das alle optionalen
Felder auf `None` setzt. Das `In` kommt als Einfüge-Block für das
Prozess-Objekt, jeder weitere Typ als eigene Datei unter `schema/`; Iron-Imports
werden gesetzt, wenn eine Einschränkung im Spiel ist.

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

Am MKK geprüft: aus dem Ablauf entstehen genau `ExtractClientKey`,
`CheckDuplicatesUT` und `CreatePrintDocuments` — dieselben drei Objekte, die
in `valiant-mkk/01-domain` liegen.

### Der Prozess als Klammer: In · InitIn · Out · InConfig

Ein Prozess hat immer dieselben vier Typen, und der Klassenbauer führt sie als
feste Gruppe:

| | was | woher |
| --- | --- | --- |
| **In** | was hineingeht | von Hand |
| **Out** | was herauskommt | von Hand |
| **InitIn** | die zu Beginn gesetzten Prozessvariablen | Felder aus dem Prozess, Typen von Hand |
| **InConfig** | Stellschrauben für Tests | **vollständig erzeugt** |

`InConfig` entsteht aus dem Ablauf und wird nur angezeigt: je Schleife `max…`,
`counter…` und `timerWait…` mit Vorgaben, je Service und Teilprozess ein
`…Mock: Option[<Objekt>.Out] = None` samt Import. Beim MKK ergibt das
`maxOpenAccount`, `timerWaitOpenAccount`, `counterOpenAccount`,
`maxGetClientAdvisor` … und `duplicateCheckMock: Option[PostDuplicateCheck.Out]`
— dieselben Felder wie in der handgeschriebenen Domain.

**Der Init-Worker steht nicht im Ablauf.** Er ist Verdrahtung, keine
Fachlichkeit — in Camunda 8 kann daraus ein Listener werden. Der Import
erkennt ihn daran, dass sein Topic der Prozess selbst ist, lässt ihn aus dem
Baum weg und legt nur seine Ausgaben beim Prozess ab; daraus werden die Felder
des `InitIn`. Die **Typen** stehen im BPMN nicht, deshalb pflegt man sie im
Klassenbauer; neue Felder kommen beim nächsten Abgleich dazu, gepflegte Typen
bleiben.

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
[valiant] [depot] [openDepot]                          V  [2]
┌──────────────────────────┐ ┌──────────────────────────┐
│ Camunda 7                │ │ Camunda 8                │
│ External Tasks mit Topic │ │ zeebe:taskDefinition     │
└──────────────────────────┘ └──────────────────────────┘
Prozess-ID: valiant-depot-openDepotV2 · Vorlage templates/c8.bpmn
```

Die Prozess-ID entsteht aus **`company-project-processVversion`** und ist
schon beim Tippen zu sehen; Firma und Projekt sind mit denen des zuletzt
angelegten Prozesses vorbelegt.

In den Vorlagen steht `COMPANY-PROJECT-PROCESSVERSION`, wo die ID hingehört.
Ersetzt wird sie **überall, wo sie steht** — als Attribut ganz oder als Teil
davon, Element-IDs eingeschlossen (`COMPANY-PROJECT-PROCESSVERSIONParticipant`).
Das trifft genau die Stellen, die sie meinen: `processRef` des Pools, dessen
Name und die Topics der eigenen Worker (`<prozess>.ExtractClientKey` wandert
mit). Weil in allen Attributen dasselbe ersetzt wird, bleiben die Verweise
untereinander stimmig; eine Liste bekannter Stellen wäre kürzer, würde aber
bei der nächsten Vorlage etwas übersehen. Gross-/Kleinschreibung zählt nicht.

Bliebe die ID stehen, hiessen alle Prozesse gleich, und daran hängt mehr als
es aussieht: Topics, die Zuordnung zur Domain und der Dateiname.

Aus dem Ergebnis entstehen in einem Zug das `.bpmn` und der Ablaufbaum; jeder
Schritt beginnt als **Entwurf** — auch in Zweigen und Fehlerpfaden. Eine
Vorlage dazunehmen heisst: Datei in `public/templates/` ablegen und eine Zeile
in `ENGINES` ergänzen (`src/template.ts`).

### Der Admin-Bereich

Drei Bereiche, in der Reihenfolge, in der sie gebraucht werden:

1. **Auftritt** — Kunde und Logo für die Kopfzeile.
2. **Katalog** — importieren, exportieren, nachschlagen. Das zählt in jeder
   Umgebung; in der Bankenzone ist es der einzige Bereich, der etwas tut.
   Das lokale Erzeugen (Projekt-Ordner, OpenAPI, Doku-Site) steckt darin
   zugeklappt: dazu müssen die Quellen erreichbar sein.
3. **Anmeldung** — Entra ID (Tenant, Client, Rollen, Einrichtungs-Link).

Bewusst **keine** Liste zum Durchblättern: die Klassen eines Prozesses stehen
in seiner Spezifikation unter «Datenmodell», dort wo sie gebraucht werden.
Hier bleibt eine Suche über Services **und** Domain-Typen zugleich — für die
eine Frage, die sich im Admin stellt: steht das drin?

### Wo ein Prozess in der Domain liegt

Aus `valiant-mkk-openMkkV1` lässt sich `valiant.mkk.domain.openMkk.v1` ·
`OpenMkkV1` ableiten — der Name trägt die Version. Bei
`valiant-addresschange` steht in der ID nichts, woraus sich `addressChange`
gewinnen liesse; die Ableitung ergäbe `addresschange`, und der Bindestrich in
`valiant-addresschange` wäre in einem Package-Namen nicht einmal erlaubt.

Deshalb steht die Zuordnung nicht im Namen, sondern im Katalog: der Scan
merkt sich `val processName` und `val topicName` der Domain-Objekte. Ein
Prozess findet damit sein Objekt genau, ein Service-Task seines über das
Topic. Über 72 BPMN-Dateien lösen sich so 32 Prozesse und 24 Interaktionen
**exakt** statt abgeleitet — darunter Fälle, die die Ableitung falsch rät:
das Topic `…createPensionProductV1.CreatePensionProduct` gehört zum Objekt
`ComposePensionProduct`, `CreatePensionProduct` ist der Prozess selbst.

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
 1  swisscom-fil-is         ~/dev-swisscom/projects/swisscom-fil-is   117 Typen  ↑ ↓ ×
 2  valiant-addresschange   ~/dev-valiant/projects/…                   32 Typen  ↑ ↓ ×
 …
 8  valiant-fil-is          ~/dev-valiant/projects/valiant-fil-is     696 Typen  ↑ ↓ ×
```

**Projekte wählen** nimmt den Ordner *über* den Projekten
(`~/dev-valiant/projects`) — seine Unterordner mit einem `01-domain` kommen
alphabetisch in die Liste. Ist der gewählte Ordner selbst ein Projekt, kommt
eben dieses. Mehrere Wurzeln lassen sich nacheinander hinzufügen, etwa
`~/dev-swisscom/projects` und `~/dev-valiant/projects`.

**Neu aufbauen** liest die Liste von oben nach unten frisch ein — rekursiv
nach `.scala`, Tests und Build-Ordner bleiben draussen. Neu **aufbauen**, nicht
ergänzen: nur so wirkt sich ein Umsortieren überhaupt aus.

Der Ordner-Zugriff wird gemerkt (IndexedDB), die Erlaubnis dazu verlangt der
Browser nach einem Neustart neu. Fehlt sie für auch nur ein Projekt, bleibt
der Katalog unverändert stehen — ein halber Aufbau, der stillschweigend Typen
verliert, wäre schlimmer als gar keiner. **Projekte wählen** mit demselben
Ordner stellt den Zugriff wieder her.

Gesammelt wird alles, was sich als Feldtyp verwenden lässt — die Objekte im
`schema/`-Ordner ebenso wie die `In` / `Out` der Services. Der Parser kennt
dabei drei Eigenheiten der Domain:

- **geteilte Paketangaben** (`package valiant.graviton.domain` +
  `package account.v1`) werden zusammengesetzt,
- **`In` als ADT** (`enum In: case Iban(…) case Generic(…)`) wird als
  Auswahl mit ihren Fällen erkannt,
- **`Out` steht oft gar nicht in der Datei** — es kommt aus dem Service-Trait;
  deshalb bekommt jedes Service-Objekt `In` und `Out`, auch ohne
  ausgeschriebene Definition.

**Die Reihenfolge der Liste ist der Vorrang.** Dieselbe Schnittstelle liegt
in mehreren Projekten — `client` gibt es unter `swisscom.fil.is.domain` und
unter `valiant.fil.is.domain`. Beide zu führen hiesse zwei gleich heissende
Objekte in der Auswahl und einen Import auf gut Glück. Darum gewinnt das
weiter oben stehende Projekt: kommt später ein Paket mit demselben Schlüssel
(Paket ohne das Firmen-Segment, Version bleibt Teil davon — `client.v1` und
`client.v4` sind zwei APIs), wird es verworfen und gemeldet:

```
verworfen: valiant.fil.is.domain.client.v1.schema (19 Typen)
           — Vorrang hat swisscom.fil.is.domain.client.v1.schema
```

Eingelesen werden nicht nur die Service-Projekte, sondern auch die
**Prozess-Projekte** — deren `In`/`Out` sind das, was ein Subprozess-Aufruf
braucht. Über 18 Projekte (`swisscom-fil-is` zuoberst) sind das **2095 Typen
aus 2625 Dateien**. Die Beispieldaten enthalten diesen Katalog bereits.

`InConfig` und `InitIn` fremder Projekte werden dabei übersprungen: das sind
Implementations-Details und stehen deshalb auch nicht zur Auswahl.

Wird ein Typ aus dem Katalog gewählt, setzt der Generator den passenden
`import` — bei `In`/`Out` das Service-Objekt, sonst den Typ selbst.

**Prozesse von der Doku-Site.** Wer die Quellen nicht lokal hat, holt die
Prozesse über **Von URL laden**: die Orchescala-Doku-Site führt je Firma eine
`catalog.html`, in der jeder Eintrag vollständig im Link steckt —
`.../site/valiant/valiant-mkk/OpenApi.html#operation/Bpmn:%20openMkkV1`. Daraus
entstehen die **Prozesse mit ihren `In`/`Out`** — also das, was sich als
Subprozess rufen lässt. Über den Valiant-Katalog sind das **81 Prozesse aus 16
Projekten**.

Das Paket wird dabei aus Projekt und Prozessname abgeleitet
(`valiant-mkk` + `openMkkV1` → `valiant.mkk.domain.openMkk.v1`). Sicher ist das
nur, wenn der Name die Version trägt; sonst ist der Katalogname die
BPMN-Prozess-ID und nicht der Scala-Name (`valiant-addresschange` heisst dort
`AddressChange`) — solche Einträge sind als «Import prüfen» markiert. Deshalb
**füllt der Site-Import nur Lücken**: was aus den Quellen schon exakt bekannt
ist, bleibt stehen.

Worker kommen bewusst nicht von der Site: dort fehlt die API-Ebene
(`personV1` in `valiant-graviton-personV1.GetCustomer`), der Import wäre
geraten. Die stehen in der OpenAPI — mitsamt Mapping und Beschreibungen.

Aus dem Browser greift dabei **CORS** — und beim Valiant-Server tut es das
tatsächlich: `bpf.apps.grv.scbs.ch` ist erreichbar (ein Versuch mit `no-cors`
liefert eine Antwort), sendet aber kein `Access-Control-Allow-Origin`. Der
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

  valiant-graviton-person.GetConsultant
  valiant-graviton-personV1.GetCustomer
  …
                              [Abbrechen]  [Trotzdem ersetzen]
```

Verglichen wird, worauf die Schritte zeigen (Service-ID, Topic, gerufener
Prozess) und welche Katalog-Typen in Feldern stehen. Ein Service, dessen ID
sich ändert, dessen Topic aber gleich bleibt, gilt als vorhanden — sonst
gäbe es Fehlalarm bei jedem Umbenennen.

**Mitgelieferter Katalog.** Liegt neben der App eine
`catalog.generated.json` (orchescala erzeugt sie bei jedem Release aus OpenAPI
und Site-Katalog und legt sie in `public/`), dann ist **sie** der Katalog: bei
gleicher Kennung (Service-ID, Topic, gerufener Prozess, Typ-ID) gewinnt sie,
Einträge aus der `model.json` bleiben nur als Altbestand daneben sichtbar und
werden beim Speichern nie mit ihr vermischt — der Katalog ist nicht vom
Benutzer pflegbar, die `model.json` gehört den Spezifikationen. Fehlt die
Datei (frischer Checkout, Dev-Server), läuft alles wie bisher.

Derselbe Weg hilft, solange der Doku-Server keine CORS-Freigabe hat:

```bash
node tools/site2catalog.ts https://bpf.apps.grv.scbs.ch/site/ --out katalog.json
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

Was synchron läuft:

- **Diagramm → Ablauf**: jede Änderung wird kurz danach neu eingelesen; die
  fachlichen Texte bleiben über die Element-ID erhalten. Das BPMN wird dabei
  als `processes/<slug>.bpmn` neben der Spezifikation gespeichert.
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

### Kommentare

Wie in Confluence, nur am richtigen Ort: ein Faden, Antworten darunter, und
irgendwann als **erledigt** abgehakt. Erledigte verschwinden nicht, sie
rutschen nach unten und werden zugeklappt — wer später dazukommt, soll sehen,
was besprochen wurde.

Kommentiert wird dort, wo etwas zu klären ist:

| wo | |
| --- | --- |
| **Prozess** | im Panel, wenn kein Schritt gewählt ist |
| **Benutzeraufgabe · Nachricht · Signal · Teilprozess** | am gewählten Schritt |
| **Datentypen** | im Klassenbauer, unter der Scala-Vorschau |

Bewusst **nicht** an jedem Service-Task: dessen Vertrag steht im Katalog und
ist keine Fachfrage.

Offene Fäden sind sichtbar, ohne dass man sie sucht — als Zahl am Schritt im
Ablaufbaum und am Typ in der Liste des Klassenbauers. In der Werkzeugleiste
steht `💬 2/7` mit Pfeilen: **einer nach dem anderen durchgehen**, in der
Reihenfolge des Ablaufs — erst der Prozess, dann die Schritte, zuletzt die
Datentypen. Der Sprung klappt den Baum auf, wählt den Schritt, holt die Zeile
ins Bild und schaltet für einen Datentyp in den Klassenbauer. Der Faden selbst
wird **leicht hervorgehoben** — kräftigerer Rand, ein Hauch Fläche — und in
die Sicht geholt; genug, um ihn unter mehreren zu finden, zu wenig, um zu
schreien. Am Ende geht es wieder von vorne los. Beide Text-Exporte tragen die **offenen** Kommentare mit: der
fachliche unter dem jeweiligen Schritt, der Orchescala-Export zusätzlich als
Zeile in der Schritt-Tabelle. Erledigte bleiben in der Datei, aber aus den
Exporten heraus.

Zeigt ein Faden auf ein Element, das es nicht mehr gibt — der Schritt wurde
aus dem BPMN entfernt, der Typ gelöscht —, dann steht er beim Prozess unter
**«Kommentare ohne Element»** und bleibt aus der Navigation heraus. Weggeworfen
wird er nicht: was besprochen wurde, gehört gelesen und abgehakt. Ohne diese
Trennung sprang die Navigation auf ein Ziel, das es nicht gab, und zeigte
stattdessen den Prozess.

Und wo ein Faden liegt, wird er gezeigt — auch an einem Element, an dem sich
neue Kommentare gar nicht anlegen lassen. Sonst zählte ihn die Navigation mit,
ohne dass man ihn je zu Gesicht bekäme.

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
| Service-Task | **Behandelte Fehler** | `_handledErrors` |

Diese Angaben gehen nicht nur in die Spezifikation, sondern **zurück ins
Diagramm**. Das ist kein Komfort, sondern Notwendigkeit: der Abgleich mit der
BPMN-Datei baut den Baum jedes Mal neu auf, und was nur in der Spezifikation
stünde, wäre danach weg.

Fehler, die von einem **Boundary-Event** kommen, lassen sich hier nicht
umbenennen oder löschen — Code und Pfad stehen im Diagramm, dort gehören sie
auch geändert. Bearbeitbar sind die aus `_handledErrors` und die hier neu
erfassten.

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
zusammengezogen. Der Vorgabe-Ausdruck ist `#{name}` — die Hauskonvention;
in den Templates steht dafür mal `#{name}`, mal
`#{execution.getVariable('name')}`, beides dasselbe.

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
braucht, wird **abgewählt statt gelöscht**. So bleibt sichtbar, was es gäbe.
Der Kopf zeigt dann «5 von 6», der Export listet die abgewählten getrennt als
«Nicht verwendet», und ein erneuter BPMN-Abgleich stellt sie nicht wieder her:
die Abwahl gehört der Spezifikation, wie die fachliche Bedeutung.

**Das Mapping misst sich am Datenmodell.** Hat der Schritt eine Interaktion mit
`In`/`Out`, sind deren Felder der Massstab; sonst der Katalog-Eintrag. Der Kopf
bietet dann «+ 1 aus Modell» bzw. «+ 1 aus Katalog» für das, was fehlt. Zeilen
lassen sich in diesem Fall **nicht mehr löschen**, nur abwählen — und eine
Zeile ohne Entsprechung im Modell wird **rot markiert**, mit Zähler darüber
(«1 Zeile ohne Entsprechung im Modell»). Die Abweichung gehört im Datenmodell
behoben, nicht im Mapping weggeräumt. Nur wo es keinen Massstab gibt, bleibt
das Mapping frei — dort gibt es «+ Feld» und das Entfernen weiter.

Die Beispieldaten enthalten **301 Einträge** (220 Services, 54 Teilprozesse,
19 Benutzeraufgaben, 8 Signale) aus 62 OpenAPI-Dateien.
### Exporte

| Export | für wen | Inhalt |
| --- | --- | --- |
| **Fachlich** | Fachbereich, Review, Abnahme | Ablauf in Prosa, Beschreibungen, offene Punkte — ohne technische Ausdrücke |
| **Orchescala** | Umsetzung und KI | Überblick als Baum, danach je Schritt ein Abschnitt mit stabiler ID: Topic, Service, Mappings, Fehler, Mocks, Zweige |
| **Scala** | Umsetzung | das Datenmodell als Orchescala-Domain, dateiweise |
| **BPMN** | Umsetzung, Import | das Diagramm im Stand des Editors |
| **JSON** | Sicherung / Weiterverarbeitung | die Spezifikation selbst |

Der Orchescala-Export ist bewusst flach und explizit, damit daraus ohne
Navigieren im Baum Domain, Worker und Simulation abgeleitet werden können.

## Datenablage im geteilten Ordner

```
<geteilter Ordner>/
├── model.json                Service-Katalog, Domain-Typen, Anmeldung
└── processes/
    ├── <slug>.json           die Spezifikation
    └── <slug>.bpmn           das Diagramm dazu (im Editor bearbeitbar)
```

Fehlen `model.json` oder `processes/`, legt die App sie an. Eine vorhandene,
aber defekte `model.json` wird nie überschrieben. Änderungen werden ca. eine
Sekunde nach der letzten Eingabe automatisch gespeichert; Konflikte werden
über lastModified bzw. ETag erkannt.

## Anmeldung (Microsoft Entra ID)

Wie im arch-review: MSAL im Browser, Authorization Code Flow + PKCE, kein
eigener Server. Konfiguriert wird unter **Admin → Anmeldung** (Tenant-ID,
Client-ID, Rollen, aktiv); die Einstellung liegt als `auth` in der
`model.json`. Drei Stufen über Entra-App-Rollen: **Admin** (alles),
**Editor** (Spezifikationen bearbeiten), **Viewer** (nur lesen). Für den
SharePoint-Modus erzeugt der Admin einen **Einrichtungs-Link**, der Anmeldung
und Ordner in einem Schritt setzt.

Entwicklung ohne Login: `?noauth`, Stufen simulieren mit `&as=viewer` /
`&as=reviewer`.

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
node tools/bpmn2spec.ts ~/dev-valiant/projects/valiant-mkk/src/main/resources/camunda/mkk-openMkkV1.bpmn sample-data/processes/valiant-mkk-openmkkv1.json
node tools/openapi2catalog.ts ~/git-temp ~/dev-valiant/projects --out sample-data/model.json
node tools/domain2catalog.ts ~/dev-swisscom/projects ~/dev-valiant/projects --out sample-data/model.json
```

Die Ausgabe zeigt, was jedes Projekt beigetragen hat, und was die
Vorrang-Regel verworfen hat:

```
  117  swisscom-fil-is
  696  valiant-fil-is
  …
verworfen: valiant.fil.is.domain.client.v1 (13 Typen) — Vorrang hat swisscom.fil.is.domain.client.v1
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
| `src/store.tsx` | Ordner, Laden/Speichern, Konflikte |
| `src/backend.ts`, `src/graph.ts` | lokaler Ordner bzw. SharePoint über Graph |
| `src/auth.tsx` | Entra-Anmeldung (MSAL) |
| `src/components/BpmnEditor.tsx` | bpmn-js im Editor, Abgleich in beide Richtungen |
| `src/components/` | Liste, Prozessansicht, Detailspalte, Klassenbauer, Export, Admin |

## Offene Punkte

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
