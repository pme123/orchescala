# SharePoint als gemeinsamer Ordner — Einrichtung

Orch Spec kann ihre Daten direkt in einer SharePoint-Dokumentbibliothek
lesen und schreiben — über Microsoft Graph, mit dem Token der
Entra-Anmeldung. Kein Sync-Client, keine Konfliktkopien; Berechtigungen setzt
SharePoint pro Person durch. Voraussetzung ist die Anmeldung aus
[ENTRA-SETUP.md](ENTRA-SETUP.md).

Was im Ordner liegt:

```
<SharePoint-Ordner>/
├── config/
│   └── model.json            Service-Katalog, Domain-Typen, Anmeldung, Benachrichtigungen
├── users.json                wer hier arbeitet — Vorschläge bei «@»
└── processes/
    ├── <slug>.json           die Spezifikation, samt Kommentaren
    └── <slug>.bpmn           das Diagramm dazu
```

Fehlen `config/model.json` oder `processes/`, legt die App sie beim ersten Verbinden
an; `users.json` entsteht, sobald sich die erste Person anmeldet.

## Teil 1 · Voraussetzung prüfen: Gibt es SharePoint im Tenant?

SharePoint ist Teil von Microsoft 365 (Business Basic/Standard/Premium,
E3/E5), **nicht** von Entra ID allein. Prüfen:

1. <https://admin.microsoft.com> → **Abrechnung → Ihre Produkte**: Steht dort
   ein Microsoft-365-Plan mit SharePoint?
2. Oder direkt `https://<tenantname>.sharepoint.com` aufrufen — öffnet sich
   eine Startseite, ist SharePoint da.

Für die **Teams-Benachrichtigungen** brauchen Absender und Empfänger
zusätzlich eine Lizenz mit Teams.

Für einen Test ohne Plan reicht die kostenlose Testversion **Microsoft 365
Business Basic** (1 Monat, bis 25 Benutzer): admin.microsoft.com →
**Abrechnung → Dienste kaufen** → *Microsoft 365 Business Basic* →
**Kostenlose Testversion starten**, danach Lizenzen zuweisen (**Benutzer →
Aktive Benutzer → Lizenzen und Apps**). SharePoint steht ca. 15–30 Minuten
später bereit.

## Teil 2 · Site und Ordner anlegen

Am einfachsten über **Teams** (erzeugt automatisch eine SharePoint-Site mit
Dokumentbibliothek und sauberen Berechtigungen):

1. Teams → **Teams → Team erstellen → Von Grund auf neu → Privat**, Name
   z. B. `Prozess-Spezifikationen`.
2. Im Kanal «Allgemein» → Reiter **Dateien** → **Neu → Ordner** →
   `orch-spec`.
3. Ordner öffnen → **Link kopieren** (oder die Adresse aus der Browserzeile) —
   das ist der Link, den die App beim Verbinden braucht, z. B.
   `https://firma.sharepoint.com/:f:/s/Prozess-Spezifikationen/…` oder
   `https://firma.sharepoint.com/sites/Prozess-Spezifikationen/Freigegebene%20Dokumente/orch-spec`.

Ohne Teams: `https://<tenant>.sharepoint.com` → **Website erstellen →
Teamwebsite**, dann in **Dokumente** den Ordner `orch-spec` anlegen und den
Link kopieren.

**Bestehende Daten übernehmen** (z. B. aus einem lokalen Ordner): die Ordner
`config/` und `processes/` in den SharePoint-Ordner hochladen — die App
arbeitet mit denselben Dateien.

## Teil 3 · Berechtigungen = Zugriffsstufen

SharePoint prüft serverseitig, wer lesen und schreiben darf — unabhängig von
den App-Rollen. Beides sollte zusammenpassen:

| App-Rolle (Entra) | SharePoint-Berechtigung auf dem Ordner |
|---|---|
| Admin | **Bearbeiten** (Besitzer) |
| Editor | **Bearbeiten** (Mitglied) |
| Viewer | **Lesen** (Besucher) |

Kommentare, Erwähnungen und der Teams-Versandstatus liegen in der
Spezifikation selbst — wer kommentiert, braucht deshalb **Bearbeiten**. In der
App kommentieren nur Admins und Editoren; Viewer lesen mit. Die vollständige
Rechte-Matrix steht in [ENTRA-SETUP.md, A4](ENTRA-SETUP.md#a4--app-rollen-empfohlen).

Bei einem Teams-Team: Mitglieder haben automatisch «Bearbeiten». Viewer
**nicht** als Teammitglied aufnehmen, sondern der SharePoint-Site als
**Besucher** hinzufügen: Site → **Einstellungen (Zahnrad) →
Websiteberechtigungen → Mitglieder hinzufügen → Websitebesucher**.

Wer in SharePoint nur lesen darf, kann in der App nichts speichern — auch
wenn die App-Rolle etwas anderes sagt. Wer gar keinen Zugriff hat, kann den
Ordner nicht öffnen. Viewer mit «Lesen» tragen sich nicht in `users.json`
ein (die App überspringt das still); über die Verzeichnissuche lassen sie
sich trotzdem erwähnen.

## Teil 3b · Stammdaten schützen (`config/`)

**Warum:** Die App prüft die Rollen nur im Browser — und welche Entra-Rolle
als Admin gilt, steht in der `model.json` selbst (`auth.adminRole` usw.),
ebenso die Teams-Einstellungen. Wer die Datei ändern kann, kann die
Rollennamen leeren (dann ist jede angemeldete Person Admin) oder den
Katalog verändern — direkt in SharePoint, an der App vorbei. Editoren
brauchen aber «Bearbeiten» im Datenordner (Spezifikationen, `users.json`).
Deshalb liegen die Stammdaten im Unterordner `config/` mit eigenen
Berechtigungen:

| Ordner | Admins | Editoren | Viewer |
|---|---|---|---|
| `orch-spec/` (inkl. `processes/`, `users.json`) | Bearbeiten | Bearbeiten | Lesen |
| `orch-spec/config/` (`model.json`) | **Bearbeiten** / Vollzugriff | **Lesen** | **Lesen** |

Alle brauchen mindestens «Lesen» auf `config/` — ohne die `model.json`
startet die App nicht. Die App schreibt die Datei nur aus dem Admin-Bereich
(und einmal beim Anlegen, falls sie fehlt).

**Alte Ordner** mit der `model.json` im Hauptordner funktionieren weiter: die
App liest sie dort und zeigt im Admin einen Hinweis. Verschoben wird von Hand
(Schritt 1) — so bleibt in SharePoint der Versionsverlauf erhalten. Liegen
beide Dateien da, gilt `config/model.json`, und der Admin weist auf die alte
Kopie hin. Während des Verschiebens sollte niemand im Admin-Bereich arbeiten.

**Einrichten** (neuer Ordner: `config/` hat die App schon angelegt, weiter
bei 2):

1. Alter Ordner: im Datenordner **Neu → Ordner** → `config`, dann
   `model.json` markieren → **Verschieben nach** → `config`. Im Hauptordner
   darf keine `model.json` mehr liegen. App neu laden — der Hinweis im Admin
   verschwindet.
2. Ordner `config` → **… → Zugriff verwalten → Erweitert** (öffnet die
   klassische Berechtigungsseite) → **Vererbung von Berechtigungen beenden**.
3. Gruppe **Mitglieder** anhaken → **Berechtigungen bearbeiten** → nur
   **Lesen**. **Besucher** bleiben bei **Lesen**, **Besitzer** bei
   **Vollzugriff**. Bei einem Teams-Team heisst das: Admins sind
   **Besitzer** des Teams, Editoren **Mitglieder**. Admins, die keine
   Besitzer sein sollen, einzeln mit **Bearbeiten** hinzufügen.
4. Unter **Zugriff verwalten → Links** prüfen, dass es auf `config/` bzw. der
   `model.json` keinen Freigabelink mit «Bearbeiten» gibt.
5. Gegenprobe mit einem Editor-Konto: `config/model.json` in SharePoint
   bearbeiten → muss scheitern; in der App eine Spezifikation ändern → muss
   gehen.

Anders als im arch-review prüft Orch Spec diese Einstellung nicht selbst —
die Gegenprobe in Schritt 5 ist der Test.

**Echte Geheimnisse** (Passwörter, API-Keys, Client-Secrets) gehören weder in
die `model.json` noch in den Ordner: Die App ist eine reine Browser-App,
alles, was sie lädt, sieht die angemeldete Person in den Entwicklertools.
Tenant- und Client-ID sind keine Geheimnisse.

## Teil 4 · Entra: Graph-Berechtigungen für die App

In der App-Registrierung **Z9nAI Orch Spec** → **API-Berechtigungen →
Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen**:

| Berechtigung | Nötig für |
|---|---|
| `Files.ReadWrite.All` | den SharePoint-Ordner überhaupt — **Pflicht** |
| `User.ReadBasic.All` | Verzeichnissuche bei «@» in Kommentaren; Empfänger für Teams auflösen |
| `Chat.Create`, `ChatMessage.Send` | Teams-Benachrichtigung bei Erwähnungen und Antworten |

Dann **Administratorzustimmung für ‹Tenant› erteilen** → Ja. Delegiert heisst:
Die App kann nur auf Dateien zugreifen, die *die angemeldete Person selbst*
sehen darf, und Nachrichten nur in deren Namen senden — nie mehr. Ohne
Zustimmung für `Files.ReadWrite.All` scheitert der erste Zugriff mit
`AADSTS65001`. Die drei optionalen Berechtigungen kann auch jede Person beim
ersten Gebrauch selbst erteilen (Hinweis «Zustimmung erteilen» in der App).
Details und was ohne sie passiert: [ENTRA-SETUP.md, A3](ENTRA-SETUP.md#a3--berechtigungen-api-berechtigungen).

## Teil 5 · In der App verbinden

**Admin, einmalig:**

1. App öffnen → **SharePoint-Ordner verbinden**. Beim allerersten Mal in
   diesem Browser fragt die App nach **Verzeichnis-ID (Tenant)** und
   **Anwendungs-ID (Client)** (aus der App-Registrierung) → **Speichern und
   anmelden** → Microsoft-Login.
2. Den **Ordner-Link** aus Teil 2 einfügen → **Verbinden**. Die App legt
   `config/model.json` und `processes/` an, falls sie fehlen.
3. **Admin → Anmeldung**: Rollen prüfen, **Anmeldung aktiv** → Speichern.
4. **Admin → Benachrichtigungen (Teams)**: aktivieren, Wartezeit wählen →
   Speichern (siehe [ENTRA-SETUP.md, B2](ENTRA-SETUP.md#b2--benachrichtigungen-teams-einschalten)).
5. Teil 3b erledigen (`config/` schützen).
6. **Admin → Anmeldung → Einrichtungs-Link kopieren** — der Link enthält
   Tenant, Client und den verbundenen Ordner.

**Alle anderen:** den **Einrichtungs-Link** öffnen (per Teams oder Mail
verteilt) → Microsoft-Login → fertig, der Ordner ist verbunden. Die
Einstellungen bleiben im Browser gespeichert; beim nächsten Start steht
**Wieder verbinden: <Ordner>** bereit. Zugriff bekommt trotzdem nur, wer in
Entra zugewiesen (Teil A5) und in SharePoint berechtigt ist (Teil 3).

Links aus Teams-Benachrichtigungen («Kommentar öffnen») funktionieren
ebenfalls, sobald der Browser einmal eingerichtet ist: Sie öffnen den
Prozess direkt beim Kommentar, auch wenn zuerst die Microsoft-Anmeldung
dazwischenkommt.

Der lokale Ordner bleibt als Alternative bestehen (z. B. für Tests).

## Typische Probleme

| Symptom | Ursache / Lösung |
|---|---|
| `AADSTS65001` beim Verbinden | Teil 4: `Files.ReadWrite.All` fehlt oder keine Administratorzustimmung |
| `AADSTS50011` beim Login | Umleitungs-URI passt nicht zur Adresse der App — [ENTRA-SETUP.md, A2](ENTRA-SETUP.md#a2--umleitungs-uris) |
| «Link konnte nicht aufgelöst werden» | Link zeigt nicht auf einen Ordner, oder die Person hat keinen Zugriff auf die Site |
| Speichern schlägt fehl (403) | Person hat in SharePoint nur «Lesen» (Teil 3) |
| Admin: «config/model.json konnte nicht geschrieben werden» | Admin hat auf `config/` nicht «Bearbeiten» (Teil 3b, Schritt 3) |
| App startet nicht: «config/model.json konnte nicht gelesen werden» | Person hat auf `config/` gar keinen Zugriff — mindestens «Lesen» geben (Teil 3b) |
| Admin zeigt «Die Stammdaten liegen noch im Hauptordner» | Alter Ordner — `model.json` von Hand nach `config/` verschieben (Teil 3b, Schritt 1) |
| Hinweis zur Verzeichnissuche beim «@» | Teil 4: `User.ReadBasic.All` fehlt (Admin) oder die Person hat noch nicht zugestimmt («Zustimmung erteilen») |
| Hinweis «Teams-Benachrichtigung nicht möglich» | Teil 4: `Chat.Create` / `ChatMessage.Send` fehlen oder die Zustimmung fehlt; der Kommentar ist gespeichert, die Nachricht geht später raus |
| «Die Datei wurde inzwischen geändert — Seite neu laden» | Jemand anderes hat dieselbe Spezifikation gleichzeitig gespeichert (ETag-Prüfung) — neu laden |
