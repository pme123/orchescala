# Z9nAI Orch Ops

Betrieb von Camunda/Orchescala — die wiederkehrenden Fehler und ihre
Workarounds als App statt als Confluence-Seite. Reine Client-Applikation ohne
Backend: die Daten liegen als JSON-Dateien in einem geteilten Ordner, entweder
in **SharePoint** (direkt über Microsoft Graph mit der Entra-Anmeldung, jeder
Browser) oder in einem **lokalen Ordner** (File System Access API,
Chrome/Edge; auch OneDrive-/Drive-Sync-Ordner).

Gleiche Technologie, gleiches Design und gleiche Speicher-/Anmelde-Mechanik wie
orch-spec (`../04-orch-spec`):
React 19 · TypeScript · Vite · Tailwind CSS 4 · lucide-react · MSAL.

## Teil von orchescala

Das ist orchescalas `04-orch-ops`. Der sbt-Build baut die App zusammen mit
orch-doc und orch-spec (`sbt orchDocClient/bundleDocClient`, läuft vor dem
Packen automatisch) — `npm test` inklusive, also auch auf CI. Sie landet im
Jar `orchescala-orch-doc` und von dort auf der Doku-Site der Firma unter
**`ops/`**; die Kopfzeile der Doku-App zeigt dafür den Knopf **Ops**
(`opsUrl` in `index.json`). Die Daten liegen **nicht** auf der Site, sondern in
einem eigenen geteilten Ordner (lokal oder SharePoint), den man in der App wählt.

Lizenz: Business Source License 1.1 (siehe [LICENSE](LICENSE)) — wie orch-doc
und orch-spec, anders als der Rest von orchescala (MIT).

## Sofort ansehen

```bash
npm install && npm run dev
```

Tests: `npm test` (`node:test`, die Fälle unter `tests/`).

Dann <http://localhost:3005/orch-ops/?noauth> öffnen und einen lokalen Ordner
wählen (leer genügt — `model.json` und `errors/` legt die App an). Mit `?demo`
startet sie direkt mit `sample-data/` — die liegen nicht im Repo (öffentlich),
sondern entstehen lokal aus einer eigenen Confluence-Seite, siehe
[Demo-Daten](#demo-daten).

## Was die App kann

**Fehlerliste** — alle wiederkehrenden Fehler, Standard: letztes Update
zuoberst. Ein Update ist **Erstellen, Bearbeiten oder Zählen**.

- **Zähler** links an jedem Fehler (Strichliste-Symbol): ein Klick = «ist
  wieder aufgetreten», +1. Der aktuelle Count steht im Knopf; der Fehler
  rückt nach oben. Jeder Klick wird mit Zeit und Name festgehalten (die
  letzten 200).
- **Suche über alle Felder** — Prozess, Kurzbeschrieb, Aktivität, Status,
  Ticket, Erfasser, Workaround, Details. Mehrere Begriffe = alle müssen
  vorkommen; Umlaute egal. Treffer werden markiert; steckt der Treffer in
  Workaround oder Details, zeigt die Zeile die Fundstelle. `/` springt ins
  Suchfeld, `Esc` leert es.
- **Status als Tags** — zum Filtern anklicken (mehrere möglich), mit Anzahl
  passend zur Suche. Dazu Filter nach Prozess.
- **Sortierung** — «Letztes Update» oder «Grösster Count».
- Suche, Filter, Sortierung und der offene Fehler stehen in der Adresse
  (`#/e/<id>?q=…&s=OFFEN&sort=count`) — ein kopierter Link zeigt dasselbe.
- **CSV-Export** der angezeigten Fehler (Semikolon, Excel-tauglich).
- Liste liest jede Minute und beim Zurückkehren ins Fenster neu ein — was
  andere zählen oder ändern, erscheint ohne Neuladen.

**Fehler im Detail** — Schublade rechts: Count, Status, Aktivität, Erfasser,
Ticket, Workaround und Details (Markdown, Fehlermeldungen als Codeblock),
Verlauf mit den Zähl-Zeitpunkten. Bearbeiten, Archivieren (statt Löschen —
das Archiv ist über die Liste erreichbar).

**Screenshots in Details und Workaround** — beim Bearbeiten ins Feld
einfügen (⌘V / Strg+V), hineinziehen oder über «Bild» wählen. Das Bild
landet als eigene Datei im Ordner (`attachments/<jjjj-mm>/…`), im Text steht
an der Cursor-Stelle nur der Verweis `![Screenshot](attachments/…)` — so
bleiben die Fehler-Dateien klein und die Bilder haben dieselben
Berechtigungen wie alles andere. Grosse Bilder werden auf 2000 px Breite
verkleinert (PNG bleibt PNG, über 5 MB wird JPEG). In der Ansicht steht das
Bild im Text, ein Klick zeigt es gross. Bilder von fremden Adressen lädt die
App bewusst nicht (sie bleiben ein Link). Wird ein Bild aus dem Text
gelöscht, bleibt die Datei im Ordner liegen.

**Neuer Fehler** — mit Vorschlägen aus den vorhandenen Prozessen und
Aktivitäten. Die App schaut beim Tippen, ob es den Fehler schon gibt
(«ab dem 2. Vorkommnis» dokumentieren): dann ist **+1 zählen statt doppelt
erfassen** einen Klick entfernt.

**How-to** — der Abschnitt «Wiki mit How-to Infos» der Confluence-Seite,
als Markdown bearbeitbar.

**Admin** — Auftritt (Kunde, Logo), Status-Werte (Name, Farbe, «erledigt»,
Reihenfolge), Import aus Confluence, Anmeldung (Entra ID, Rollen,
Einrichtungs-Link).

### Gleichzeitiges Arbeiten

Eine Datei je Fehler. Gespeichert wird mit Versionsprüfung (SharePoint:
ETag/If-Match, lokal: Änderungszeit):

- **Zählen** liest frisch, zählt hoch und schreibt; hat inzwischen jemand
  anders gezählt, wird automatisch neu gelesen und nochmals versucht. Klicks
  auf denselben Fehler laufen im Browser nacheinander. Gelingt es nach
  mehreren Versuchen nicht, steht «nicht gezählt» am Knopf.
- **Bearbeiten**: hat jemand anders inzwischen geändert, bleibt die eigene
  Änderung im Formular und die App fragt: neuen Stand laden oder überschreiben.
- **`model.json`** (Admin, How-to) genauso: wer zu spät speichert, bekommt den
  neuen Stand geladen statt den des anderen zu überschreiben.

**Wo das hält:** In **SharePoint** prüft der Server (ETag) — dort geht bei
mehreren Personen kein Zähler und keine Änderung verloren. Im **lokalen
Ordner** schützt die App mehrere Tabs desselben Browsers (Sperre pro Datei,
Version = Änderungszeit + Prüfsumme). Bei einem **Sync-Ordner** (OneDrive,
Drive), in den mehrere Rechner schreiben, sieht sie die Änderung eines
anderen erst, wenn der Sync sie geliefert hat — zählen zwei fast gleichzeitig,
kann einer verloren gehen. Für ein Team deshalb SharePoint nehmen.

## Datenordner

```
model.json              Auftritt, Status-Werte, How-to, Anmeldung
errors/<id>.json        ein Fehler
attachments/<jjjj-mm>/  Bilder aus Details und Workaround
```

```jsonc
// errors/acme-order-card--karte-kann-nicht-bestellt-werden.json
{
  "id": "acme-order-card--karte-kann-nicht-bestellt-werden",
  "process": "acme-order-card",
  "title": "Karte kann nicht bestellt werden",
  "details": "```\n500: Non-2xx response with code 500: …\n```",
  "activity": "Post Card Order",
  "reporter": "Muster Anna",
  "status": ["OFFEN"],
  "ticket": "[OPS-123](https://jira.example.com/browse/OPS-123)",
  "workaround": "Sonderzeichen in der Prägezeile ersetzen → Retry",
  "count": 2,
  "occurrences": [{ "at": "2026-10-23T20:22:48+02:00", "by": "…" }],
  "createdAt": "…", "createdBy": "…",
  "updatedAt": "…", "updatedBy": "…",
  "lastAction": "counted"
}
```

Ohne Microsoft-Anmeldung trägt man seinen Namen oben rechts selbst ein
(«Name setzen», pro Browser gemerkt) — er steht dann bei Erfassen, Bearbeiten
und Zählen.

## Import aus Confluence

Die Confluence-Seite mit der Fehlertabelle im Browser speichern — «Seite speichern unter»
oder «Quelltext anzeigen» → speichern, beides geht. Dann:

- **in der App**: Admin → Import aus Confluence → HTML-Datei wählen, oder
- **auf der Kommandozeile**: `node tools/confluence2errors.ts <seite.html> [zielordner]`

Gelesen werden die Tabelle «Dokumentation wiederkehrender Fehler» (Spalten
werden am Titel erkannt) und der How-to-Abschnitt. Zellinhalt wird zu
Markdown: Codeblöcke, Listen, Links, Erwähnungen und Status-Lozenges bleiben
erhalten; was neben einem Status steht (z. B. ein ❓), landet als Notiz beim
Workaround. Der Import ist wiederholbar — vorhandene Fehler (gleiche ID)
bleiben unangetastet, neue Status-Werte kommen dazu.

Die Seite dokumentiert Fehler **ab dem 2. Vorkommnis** — importierte Fehler
starten deshalb mit **Count 2**. Datum je Zeile gibt es in Confluence nicht;
alle importierten Fehler haben die Importzeit, die Reihenfolge der Seite
bleibt als Gleichstand-Brecher erhalten.

## Demo-Daten

Echte Daten bleiben ausserhalb des Repos (`real-data/`, `sample-data/`,
Confluence-HTML und `anonymize.local.json` stehen in `.gitignore`). Die Demo
entsteht in zwei Schritten:

```bash
node tools/confluence2errors.ts seite.html real-data   # Seite → Datenordner
node tools/anonymize.ts real-data sample-data          # anonymisieren (npm run anonymize)
```

`tools/anonymize.ts` ersetzt ohne Konfiguration Personen (Erfasser und
@-Erwähnungen, überall im Text), Zahlen ab 8 Stellen, UUIDs, ETags,
Token-Fragmente, technische Benutzer und Hostnamen. Kundenspezifisches —
Firmenname, Bank-Nr., Kürzel — kommt aus der lokalen `anonymize.local.json`:

```json
{ "replace": { "firma": "acme", "Firma": "Acme", "1234": "9999" } }
```

Am Ende sucht das Tool im Ergebnis nach allen ersetzten Originalwerten (auch
Vor- und Nachnamen einzeln) und bricht ab, wenn noch einer drin ist.
Produkt- und Systemnamen sowie Ticket-Schlüssel bleiben stehen — die gehören
bei Bedarf in die `anonymize.local.json`.

## Anmeldung und SharePoint

Wie in orch-spec: App-Registrierung in Entra (SPA, delegierte Berechtigung
`Files.ReadWrite.All`). Redirect-URI = die Adresse der App: auf der Doku-Site
`https://<host>/site/ops/`, im Dev-Server `http://localhost:3005/orch-ops/`.
Tenant-/Client-ID im Admin eintragen und den **Einrichtungs-Link** an die
Benutzer geben — er richtet Anmeldung und SharePoint-Ordner in einem Schritt
ein.

**Rollen** (App-Rollen im ID-Token) — Standard: `OrchOps.Admin` (alles),
`OrchOps.Editor` (erfassen, bearbeiten, zählen), `OrchOps.Viewer` (lesen).
Sie stehen beim Einrichten der Microsoft-Anmeldung als Liste und lassen sich
dort überschreiben (sie gehen in die `model.json` eines neuen Ordners);
später unter **Admin → Anmeldung**. Der Knopf **«wie orch-spec»** setzt
`OrchSpec.Admin`, `OrchSpec.Editor`, `OrchSpec.Viewer` ein — dann genügt eine
Rollenzuweisung in Entra für beide Apps (dieselbe App-Registrierung wie
orch-spec mit zusätzlicher Redirect-URI von Orch Ops, oder eine eigene mit
denselben Rollenwerten). Leeres Feld = Stufe nicht verwendet, alle leer =
jede angemeldete Person ist Admin.

## Entwicklung

```bash
npm run dev      # http://localhost:3005/orch-ops/
npm run lint     # tsc
npm test         # node:test (tests/)
npm run build    # dist/
```

- `?demo` — mit `sample-data/` starten (nur Dev)
- `?noauth` — Anmeldung überspringen (nur Dev); `&as=viewer` simuliert Rollen
- `?opfs` — «Lokalen Ordner wählen» nimmt den privaten Browser-Speicher statt
  eines echten Ordners (zum Testen ohne Dateidialog)
