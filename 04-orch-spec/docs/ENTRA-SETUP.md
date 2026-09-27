# Anmeldung über Microsoft Entra ID — Einrichtung Schritt für Schritt

Orch Spec meldet Benutzer über **Microsoft Entra ID** (ehemals Azure AD) an —
mit MSAL im Browser (Authorization Code Flow + PKCE), ohne eigenen Server.
Dieselbe Mechanik wie im arch-review.

**Was die Anmeldung leistet — und was nicht:**

- ✅ Nur Personen aus dem eigenen Tenant (optional: nur zugewiesene Personen)
  können die App öffnen.
- ✅ Die angemeldete Person ist bekannt: Name oben rechts, Autor/in und
  Kürzel an Kommentaren, Vorschlag bei @-Erwähnungen.
- ✅ Drei Zugriffsstufen über App-Rollen: **Admin** (alles, inkl.
  Admin-Bereich und Spezifikationen löschen), **Editor** (Spezifikationen
  anlegen und bearbeiten, kommentieren), **Viewer** (alles lesen,
  exportieren).
- ✅ Mit den Zusatzberechtigungen: **@-Erwähnungen** mit Suche im
  Verzeichnis und **Teams-Benachrichtigungen** bei Erwähnungen und Antworten.
- ❌ Die Anmeldung schützt **nicht die Daten**: `model.json` und
  `processes/` liegen im geteilten Ordner — dessen Berechtigung (SharePoint,
  Netzlaufwerk) entscheidet, wer lesen und schreiben darf. Die App hat kein
  Backend, das Zugriffe prüfen könnte. Weil die Rollennamen in der
  `model.json` stehen, dürfen nur Admins sie ändern können —
  [SHAREPOINT-SETUP.md, Teil 3b](SHAREPOINT-SETUP.md#teil-3b--stammdaten-schützen-modeljson).

Benötigt werden am Ende genau **zwei IDs** (keine Geheimnisse): die
**Verzeichnis-ID (Tenant)** und die **Anwendungs-ID (Client)**. Sie werden in
der App unter **Admin → Anmeldung (Microsoft Entra ID)** eingetragen und
landen in der `model.json` des geteilten Ordners — sie gelten damit für alle,
die diesen Ordner verwenden.

Für die Entra-Administration gibt es eine kompakte Fassung zum Weitergeben:
[ENTRA-ADMIN-ANLEITUNG.md](ENTRA-ADMIN-ANLEITUNG.md).

---

## Teil A — App-Registrierung im Entra-Tenant

> Dafür braucht es im Tenant die Rolle **Anwendungsentwickler** (oder
> Cloudanwendungsadministrator / globaler Administrator). Wer die Rolle nicht
> hat, gibt [ENTRA-ADMIN-ANLEITUNG.md](ENTRA-ADMIN-ANLEITUNG.md) an die IT
> weiter — Teil A dauert ca. 10–15 Minuten.

### A1 · Registrierung anlegen

1. <https://entra.microsoft.com> öffnen → **Identität → Anwendungen →
   App-Registrierungen** → **Neue Registrierung**.
2. Ausfüllen:
   - **Name:** `Z9nAI Orch Spec`
   - **Unterstützte Kontotypen:** *Nur Konten in diesem
     Organisationsverzeichnis (einzelner Mandant)*
   - **Umleitungs-URI:** Plattform **Single-Page-Webanwendung (SPA)**, URI =
     die Adresse, unter der Orch Spec ausgeliefert wird (siehe A2).
3. **Registrieren**.
4. Auf der Übersichtsseite notieren:
   - **Anwendungs-ID (Client)** → `clientId`
   - **Verzeichnis-ID (Mandant)** → `tenantId`

### A2 · Umleitungs-URIs

Die Umleitungs-URI ist **die Adresse der App selbst**, mit Schrägstrich am
Ende und ohne Parameter. Orch Spec wird mit der Firmen-Dokumentation
ausgeliefert (`./helper.scala publishDocs` legt sie unter `/site/spec/` ab):

| Umgebung | Umleitungs-URI (Beispiel) |
|---|---|
| Produktion (Doku-Site) | `https://docs.firma.ch/site/spec/` — `<documentationUrl>/site/spec/` |
| Lokale Vorschau der Doku-Site (`prepareDocs`) | `http://localhost:3004/spec/` |
| Entwicklung (`npm run dev`) | `http://localhost:3002/orch-spec/` |

**Authentifizierung** → unter *Single-Page-Webanwendung* **URI hinzufügen**
für jede Umgebung, die angemeldet genutzt wird → **Speichern**.

Wichtig: Alle URIs unter der Plattform **SPA** (nicht «Web») und exakt mit
Schrägstrich am Ende — sonst lehnt Entra den Login mit `AADSTS50011`
(Redirect-URI stimmt nicht überein) ab. Die Adresse, die die App verwendet,
zeigt der Browser nach dem Öffnen der App in der Adresszeile (ohne `?…`).
Implizite Gewährung («Zugriffstoken»/«ID-Token»-Häkchen) bleibt **aus** —
PKCE braucht sie nicht. Die localhost-URIs können nach der Einführung wieder
entfernt werden.

### A3 · Berechtigungen (API-Berechtigungen)

Alle Berechtigungen sind **delegiert** (Microsoft Graph): Die App handelt
immer im Namen der angemeldeten Person und kann nie mehr als diese Person
selbst. Anwendungsberechtigungen (App-only), Client-Secrets oder Zertifikate
braucht sie nicht.

| Berechtigung | Wofür | Funktion in der App | Admin-Zustimmung | Wenn sie fehlt |
|---|---|---|---|---|
| `openid`, `profile`, `email` (in *User.Read* enthalten, Standard) | Anmeldung; Name, E-Mail, Objekt-ID und App-Rollen aus dem ID-Token | Login-Gate, Zugriffsstufe, Name oben rechts, Autor/in und Kürzel an Kommentaren | nein | keine Anmeldung möglich |
| `Files.ReadWrite.All` | Dateien lesen/schreiben, die die Person in SharePoint ohnehin sieht | **SharePoint-Modus**: `model.json`, `users.json`, `processes/*.json` und `*.bpmn` | empfohlen (laut Graph nicht zwingend; viele Tenants verbieten aber die Benutzerzustimmung → `AADSTS65001`) | nur lokaler Ordner möglich |
| `User.ReadBasic.All` | Anzeigename und E-Mail der Personen im Tenant lesen — mehr nicht | **@-Erwähnungen**: Suche im Verzeichnis beim Tippen von «@» in einem Kommentar; beim Teams-Versand die Empfänger auflösen | nein — jede Person stimmt beim ersten «@» selbst zu (Hinweis mit «Zustimmung erteilen») | «@» schlägt nur Personen vor, die im Ordner schon gearbeitet oder kommentiert haben (`users.json`); einmal pro Sitzung ein Hinweis |
| `Chat.Create`, `ChatMessage.Send` | 1:1-Chat mit einer Person anlegen (ein bestehender wird wiederverwendet), Nachricht darin senden — im Namen der Person | **Teams-Benachrichtigung** bei @-Erwähnung und bei Antworten auf einen Faden, den jemand angefangen hat (einschalten unter Admin → Benachrichtigungen) | nein — Zustimmung beim ersten Versand (Hinweis mit «Zustimmung erteilen») | Kommentar bleibt gespeichert, die Benachrichtigung bleibt «ausstehend» (Uhr am Beitrag) und geht raus, sobald die Berechtigung da ist |

Minimalausbau: nur *User.Read* (lokaler Ordner, keine Verzeichnissuche, kein
Teams). Vollausbau: alle fünf. Hinzufügen unter **API-Berechtigungen →
Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen**;
danach **Administratorzustimmung für ‹Tenant› erteilen** — dann sieht keine
Person mehr eine Zustimmungsabfrage.

### A4 · App-Rollen (empfohlen)

**App-Rollen** → **App-Rolle erstellen**, dreimal (zulässige Mitgliedstypen
jeweils *Benutzer/Gruppen*, aktiviert):

| Anzeigename | Wert | Kurz |
|---|---|---|
| `Orch Spec Admin` | `OrchSpec.Admin` | alles, inkl. Admin-Bereich (Auftritt, Katalog, Anmeldung, Benachrichtigungen) und Spezifikationen löschen |
| `Orch Spec Editor` | `OrchSpec.Editor` | Spezifikationen anlegen, aus BPMN übernehmen, bearbeiten; Diagramm bearbeiten; kommentieren |
| `Orch Spec Viewer` | `OrchSpec.Viewer` | alles lesen, Kommentare lesen, exportieren — keine Änderungen |

Die **Werte** müssen exakt den Rollenfeldern im Admin-Abschnitt der App
entsprechen (vorbelegt mit genau diesen Werten, wenn die App die
`model.json` anlegt). Die höchste passende Rolle gewinnt. Regeln:

- Sind alle drei Felder leer, ist jede angemeldete Person Admin.
- Ist eine Editor-Rolle gesetzt, erhalten Personen ohne passende Rolle
  **keinen Zugriff** («Keine Berechtigung für diese App»).
- Ist keine Editor-Rolle gesetzt, gilt «angemeldet = Editor».

#### Was darf welche Rolle?

| Funktion | Admin | Editor | Viewer |
|---|:-:|:-:|:-:|
| Prozessliste, Suche, Spezifikation öffnen, Diagramm ansehen | ✓ | ✓ | ✓ |
| Exporte (fachlich, Orchescala, BPMN, …) | ✓ | ✓ | ✓ |
| Spezifikation anlegen, aus BPMN übernehmen, bearbeiten, Status setzen | ✓ | ✓ | – |
| Datenmodell (Klassenbauer) bearbeiten | ✓ | ✓ | – |
| Kommentare lesen, Übersicht, Schrittfolge | ✓ | ✓ | ✓ |
| Kommentieren, antworten, erledigen / wieder öffnen, löschen | ✓ | ✓ | – ¹ |
| @-Erwähnungen mit Verzeichnissuche, Teams-Benachrichtigung auslösen | ✓ | ✓ | – ¹ |
| Spezifikation löschen | ✓ | – | – |
| Admin-Bereich: Auftritt, Katalog, Anmeldung, Benachrichtigungen | ✓ | – | – |
| **SharePoint-Berechtigung auf dem Ordner** ([SHAREPOINT-SETUP.md](SHAREPOINT-SETUP.md), Teil 3) | Bearbeiten | Bearbeiten | Lesen |
| **SharePoint-Berechtigung auf `model.json`** (Teil 3b) | Bearbeiten | **Lesen** | Lesen |

¹ Kommentare liegen in der Spezifikation selbst (`processes/<slug>.json`) —
wer kommentiert, ändert die Datei. Deshalb kommentieren nur Admins und
Editoren; Viewer lesen mit.

Welche Dateien die App im Namen welcher Rolle schreibt:

| Datei | Wer schreibt |
|---|---|
| `model.json` | Admin (Admin-Bereich); beim allerersten Verbinden legt die App sie an, falls sie fehlt |
| `processes/<slug>.json`, `processes/<slug>.bpmn` | Admin, Editor (inkl. Kommentare und Teams-Versandstatus) |
| `users.json` | jede angemeldete Person beim Öffnen des Ordners — für die Vorschläge bei «@» (ohne Schreibrecht still übersprungen) |

### A5 · Wer darf die App benutzen?

**Identität → Anwendungen → Unternehmensanwendungen** → `Z9nAI Orch Spec`:

1. **Eigenschaften** → **Zuweisung erforderlich?** auf **Ja** → Speichern.
   Damit kommen nur explizit zugewiesene Personen/Gruppen rein; auf **Nein**
   darf jede Person des Tenants.
2. **Benutzer und Gruppen** → **Benutzer/Gruppe hinzufügen** und je eine der
   drei Rollen wählen (Admin / Editor / Viewer).

   Tipp: Drei Sicherheitsgruppen anlegen (z. B. `OrchSpec-Admins`,
   `OrchSpec-Editors`, `OrchSpec-Viewers`) und die Gruppen zuweisen — dann
   läuft die Pflege über die Gruppenmitgliedschaft. Die **Gruppenzuweisung
   braucht Entra ID P1** (in M365 Business Premium/E3 enthalten); sonst
   einzelne Benutzer zuweisen, funktional identisch.

### A6 · Testbenutzer (optional)

Zum Durchspielen der Stufen: **Identität → Benutzer → Neuer Benutzer** (z. B.
`viewer.test@<domäne>`, Kennwort generieren — keine Lizenz nötig, ausser für
SharePoint und Teams), dann in A5 mit der jeweiligen Rolle zuweisen. Anmelden
im **Inkognito-Fenster**, sonst greift das SSO des eigenen Kontos. Für den
Test der Teams-Benachrichtigung brauchen Absender und Empfänger eine Lizenz
mit Teams.

---

## Teil B — App konfigurieren

### B1 · Im Admin eintragen

App öffnen → geteilten Ordner wählen → **Admin** → Abschnitt
**Anmeldung (Microsoft Entra ID)**:

- **Verzeichnis-ID (Tenant)** und **Anwendungs-ID (Client)** einfügen.
- **Admin / Bearbeiten / Lesen**: die **Werte** der App-Rollen aus A4.
- **Anmeldung aktiv** anhaken → **Speichern**.

Die Einstellung liegt als `auth` in der `model.json`; sie gilt sofort und für
alle, die diesen Ordner verwenden. Mit «aktiv» braucht auch ein lokaler
Ordner eine Anmeldung; für SharePoint ist sie immer nötig.

**Einrichtungs-Link kopieren** (im selben Abschnitt, sobald beide IDs gültig
sind) erzeugt einen Link mit Tenant, Client und — im SharePoint-Modus — dem
Ordner. Wer ihn öffnet, ist nach dem Microsoft-Login fertig eingerichtet;
niemand muss IDs kennen. Siehe
[SHAREPOINT-SETUP.md, Teil 5](SHAREPOINT-SETUP.md#teil-5--in-der-app-verbinden).

### B2 · Benachrichtigungen (Teams) einschalten

**Admin → Benachrichtigungen (Teams)**:

- **Teams-Benachrichtigungen aktiv** anhaken.
- **Wartezeit** nach dem letzten Kommentar (Standard 5 Minuten): so lange
  wird gesammelt, dann geht je Empfänger/in **eine** Nachricht mit allen
  Kommentaren raus. Beim Verlassen des Prozesses wird sofort gesendet.
- **Vorlage** (optional): Platzhalter `{{empfaenger}}` (wird zum echten
  @-Mention in Teams), `{{von}}`, `{{prozess}}`, `{{anzahl}}`,
  `{{kommentare}}` (je Kommentar: Stelle, Text, «Kommentar öffnen»-Link),
  `{{link}}` (Prozess öffnen). Leer = Standardtext.
- **Speichern**.

Wer bekommt eine Nachricht? Alle per «@» Erwähnten und — bei einer Antwort —
die Person, die den Faden angefangen hat; nie die schreibende Person selbst.
Gesendet wird aus dem Browser der schreibenden Person, in ihrem Namen. Der
Link in der Nachricht öffnet die App direkt beim Kommentar
(`?spec=<slug>&comment=<id>` — überlebt auch den Microsoft-Login).

Am Beitrag zeigt eine **Uhr**, dass die Nachricht noch aussteht, ein
**grüner Pfeil**, dass sie zugestellt ist (Tooltip: an wen).

### B3 · Testen

App öffnen → Login-Seite → **Mit Microsoft anmelden** → zurück in der App:
Name oben rechts mit der Stufe. Dann:

1. In einem Prozess eine Sprechblase anklicken, im Kommentar «@» und zwei
   Buchstaben tippen → die Auswahl zeigt bekannte Personen, darunter
   «Entra durchsuchen …». Beim ersten Mal erscheint ggf. ein Hinweis mit
   **Zustimmung erteilen** (`User.ReadBasic.All`).
2. Eine andere Person erwähnen und kommentieren → Uhr am Beitrag. Nach der
   Wartezeit (oder beim Zurück zur Prozessliste) geht die Teams-Nachricht
   raus → grüner Pfeil, Hinweis «Teams-Nachricht an … gesendet». Beim ersten
   Versand ggf. **Zustimmung erteilen** (`Chat.Create`, `ChatMessage.Send`).
3. In Teams den Link «Kommentar öffnen» anklicken → die App öffnet den
   Prozess mit dem Kommentar-Panel an dieser Stelle.

Ohne Entra ausprobieren (nur Dev-Server, `npm run dev`):

| Parameter | Wirkung |
|---|---|
| `?noauth` | ohne Anmeldung (Stufe Admin) |
| `&as=viewer` / `&as=reviewer` | Stufe Viewer bzw. Editor simulieren |
| `&me=vorname.nachname@firma.ch` | eine angemeldete Person simulieren (Name aus der E-Mail) — für Kommentare, `users.json`, Teams |
| `&teamsmock` | Teams-Versand simulieren: die Nachricht erscheint in der Browser-Konsole |
| `&teamsdelay=3` | Wartezeit für Teams auf 3 Sekunden |
| `&teamsfail=consent` / `forbidden` | fehlende Zustimmung bzw. fehlende Berechtigung simulieren |
| `&dirfail=consent` / `forbidden` | dasselbe für die Verzeichnissuche |

Beispiel: `http://localhost:3002/orch-spec/?demo&noauth&me=pascal.mengelt@firma.ch&teamsmock&teamsdelay=3`

### B4 · Ausgesperrt? (falsche IDs, Rolle fehlt)

- Entwicklung: `http://localhost:3002/orch-spec/?noauth` (nur im Dev-Server)
  → Admin → Anmeldung deaktivieren oder IDs korrigieren.
- Produktion: in der `model.json` des geteilten Ordners
  `"auth": { "enabled": false, … }` setzen — als Besitzer/in der Site ist die
  Datei direkt zugänglich.

## Portal auf Englisch — die Stationen

Das Entra Admin Center (<https://entra.microsoft.com>) hat ein flaches Menü:
links **Entra ID**, darunter **Enterprise apps** und **App registrations**.

| Deutsch (diese Anleitung) | Englisch (Entra Admin Center) |
|---|---|
| Identität → Anwendungen → App-Registrierungen | **Entra ID → App registrations** (Reiter **All applications**, falls nicht unter *Owned applications*) |
| Übersicht: Anwendungs-ID (Client), Verzeichnis-ID (Mandant) | **Overview**: **Application (client) ID**, **Directory (tenant) ID** |
| Authentifizierung → Umleitungs-URI (Plattform SPA) | **Authentication → Add a platform → Single-page application** → Redirect URIs |
| API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen | **API permissions → Add a permission → Microsoft Graph → Delegated permissions** |
| Administratorzustimmung für ‹Tenant› erteilen | **Grant admin consent for ‹tenant›** |
| App-Rollen → App-Rolle erstellen | **App roles → Create app role** |
| Identität → Anwendungen → Unternehmensanwendungen | **Entra ID → Enterprise apps** — Filter **Application type = All applications** setzen; am sichersten über App registrations → Overview → **«Managed application in local directory»**. Dort gibt es **kein** «API permissions» — Berechtigungen nur in der App registration |
| Eigenschaften → Zuweisung erforderlich? | **Properties → Assignment required?** |
| Benutzer und Gruppen → Benutzer/Gruppe hinzufügen → Rolle auswählen | **Users and groups → Add user/group → Select a role** |

## Typische Fehlermeldungen

| Meldung | Ursache / Lösung |
|---|---|
| `AADSTS50011` redirect URI mismatch | URI in A2 stimmt nicht exakt (Schrägstrich, http/https, `/site/spec/` vs. `/orch-spec/`, Plattform SPA statt Web). |
| `AADSTS90002` Tenant not found | `tenantId` falsch (Verzeichnis-ID, nicht Anwendungs-ID). |
| `AADSTS700016` Application not found | `clientId` falsch oder Registrierung in anderem Tenant. |
| `AADSTS50105` not assigned to a role | «Zuweisung erforderlich» ist an, Person ist nicht zugewiesen (A5). |
| `AADSTS65001` consent required | Eine Berechtigung aus A3 ist im Tenant nur mit Admin-Zustimmung erlaubt — *API-Berechtigungen → Administratorzustimmung erteilen*. |
| Hinweis «Für die Suche im Verzeichnis fehlt noch deine Zustimmung …» beim «@» | Person hat `User.ReadBasic.All` noch nicht zugestimmt → **Zustimmung erteilen**. Erwähnen geht trotzdem, nur ohne Verzeichnissuche. |
| Hinweis «Microsoft Graph verweigert die Benutzersuche …» | `User.ReadBasic.All` fehlt in der App-Registrierung (A3). |
| Hinweis «Teams-Benachrichtigung nicht möglich …» | `Chat.Create` / `ChatMessage.Send` fehlen (A3) oder die Zustimmung fehlt (**Zustimmung erteilen**). Der Kommentar ist gespeichert, die Nachricht bleibt «ausstehend» und geht später raus. |
| «Teams-Benachrichtigung nicht zugestellt — … wurde im Verzeichnis nicht gefunden» | Die erwähnte E-Mail gibt es im Tenant nicht (Gast, Tippfehler, anderer Tenant). |
| Keine Teams-Nachricht, keine Uhr am Beitrag | Benachrichtigungen im Admin nicht aktiv (B2), die Person ist nicht angemeldet (ohne E-Mail kein Versand) oder sie hat nur sich selbst erwähnt. |
| Admin-Button fehlt trotz Rolle / falsche Stufe | Rolle in A5 zugewiesen? Rollenfeld im Admin = **Wert** der Rolle (A4)? Einmal ab- und wieder anmelden (Rollen stehen im ID-Token). |
| «Keine Berechtigung für diese App» | Angemeldet, aber keine der drei Rollen zugewiesen (A5). |

## Technische Notizen

- Bibliothek: `@azure/msal-browser`. Flow: `loginRedirect` → Entra → zurück
  auf die App-Adresse → `handleRedirectPromise`. Sitzung im `localStorage`
  des Browsers.
- Die Umleitungs-URI ist die Adresse der App, gegen die Dokument-URL
  aufgelöst — in der Doku-Site (relative Basis `./`) also `…/site/spec/`,
  im Dev-Server `…/orch-spec/`.
- Aus dem ID-Token werden `name`, `preferred_username`, `roles` und die
  Objekt-ID (`localAccountId`, für den Teams-Chat) gelesen. Tokens gehen
  ausschliesslich an Microsoft Graph, nie an Dritte.
- Graph-Aufrufe (alle delegiert, nur wenn die Funktion genutzt wird):
  Dateien im SharePoint-Ordner (`/shares/…`, `/drives/…`), Benutzersuche
  (`/users?$search=…`, `/users/{mail}`), Teams-Chat (`POST /chats`,
  `POST /chats/{id}/messages`). Die Zusatzberechtigungen holt die App
  **still** (`acquireTokenSilent`); fehlt die Zustimmung, erscheint ein
  Hinweis mit «Zustimmung erteilen» statt eines überraschenden Redirects.
- Netzwerk: Die App spricht zur Laufzeit mit `login.microsoftonline.com`
  (Anmeldung) und `graph.microsoft.com` (SharePoint, Verzeichnis, Teams) —
  sonst mit niemandem.
