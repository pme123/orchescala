# App-Registrierung «Z9nAI Orch Spec» in Microsoft Entra ID

Anleitung für die Entra-Administration. Aufwand ca. 10–15 Minuten.
Benötigte Rolle im Tenant: **Anwendungsentwickler** oder
**Cloudanwendungsadministrator** (für Schritt 5 zusätzlich
**Benutzeradministrator** oder die Berechtigung, Benutzer der
Unternehmensanwendung zuzuweisen). Die ausführliche Fassung mit
Hintergründen steht in [ENTRA-SETUP.md](ENTRA-SETUP.md).

## Worum es geht

«Z9nAI Orch Spec» ist eine reine Browser-Anwendung (Single-Page-App) für
Prozess-Spezifikationen (Orchescala/Camunda). Sie wird mit der
Firmen-Dokumentation ausgeliefert, meldet Benutzer über Microsoft Entra ID an
und unterscheidet über **App-Rollen** drei Zugriffsstufen. Die Daten liegen in
einem SharePoint-Ordner.

Sicherheitsrelevante Eckdaten für die Beurteilung:

| Aspekt | Wert |
|---|---|
| Anwendungstyp | Single-Page-App (öffentlicher Client), Authorization Code Flow mit PKCE |
| Client-Secret / Zertifikat | **keines** (nicht erforderlich, nicht vorgesehen) |
| Benötigte Berechtigungen | Anmeldung: `openid`, `profile`, `email`; Dateizugriff: `Files.ReadWrite.All`; optional `User.ReadBasic.All` (Personensuche für @-Erwähnungen) und `Chat.Create` + `ChatMessage.Send` (Teams-Benachrichtigung) — alle **delegiert**, Microsoft Graph |
| Zugriff auf Unternehmensdaten | nur SharePoint-Dateien, auf die **die angemeldete Person selbst** Zugriff hat (delegiert); die App greift ausschliesslich auf den für sie eingerichteten Ordner zu. Die Personensuche liest nur Anzeigename und E-Mail. Teams-Nachrichten werden im Namen der angemeldeten Person in deren 1:1-Chats gesendet |
| Verwendete Token-Inhalte | Anzeigename, E-Mail (UPN), Objekt-ID, App-Rollen |
| Kontotypen | nur dieser Tenant (einzelner Mandant) |
| Hosting | statische Dateien in der Firmen-Dokumentation (`<documentationUrl>/site/spec/`), kein eigener Server/Backend |
| Netzwerk | nur `login.microsoftonline.com` und `graph.microsoft.com` |

## Schritt 1 · App-Registrierung anlegen

**Microsoft Entra Admin Center** (<https://entra.microsoft.com>) →
**Identität → Anwendungen → App-Registrierungen → Neue Registrierung**

| Feld | Wert |
|---|---|
| Name | `Z9nAI Orch Spec` |
| Unterstützte Kontotypen | **Nur Konten in diesem Organisationsverzeichnis (einzelner Mandant)** |
| Umleitungs-URI — Plattform | **Single-Page-Webanwendung (SPA)** |
| Umleitungs-URI — URI | `https://<documentationUrl>/site/spec/` (z. B. `https://docs.firma.ch/site/spec/`) |

→ **Registrieren**

## Schritt 2 · Weitere Umleitungs-URIs (Entwicklung, optional)

In der Registrierung: **Authentifizierung** → Abschnitt
*Single-Page-Webanwendung* → **URI hinzufügen**:

```
http://localhost:3002/orch-spec/
http://localhost:3004/spec/
```

→ **Speichern**

Hinweise:
- Alle URIs **exakt** so, inklusive Schrägstrich am Ende, und alle unter der
  Plattform **SPA** (nicht unter «Web»).
- Die Häkchen unter *Implizite Genehmigung und Hybridflows* (Zugriffstoken /
  ID-Token) bleiben **deaktiviert** — PKCE benötigt sie nicht.
- Die localhost-URIs dienen der Entwicklung (Dev-Server bzw. lokale Vorschau
  der Dokumentation); sie können nach der Einführung entfernt werden.

## Schritt 3 · API-Berechtigungen

**API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph →
Delegierte Berechtigungen** → `Files.ReadWrite.All` anhaken →
**Berechtigungen hinzufügen**.

Die Standardberechtigung *User.Read* kann bleiben (deckt `openid`, `profile`,
`email` ab). `Files.ReadWrite.All` ist **delegiert**: Die App kann nur
Dateien lesen/schreiben, die die angemeldete Person in SharePoint ohnehin
sehen bzw. bearbeiten darf. Anwendungsberechtigungen (App-only) werden nicht
benötigt und sollen nicht erteilt werden.

Für Kommentare mit Erwähnungen und Teams-Benachrichtigung im selben Schritt
zusätzlich (ebenfalls delegiert, Microsoft Graph):

| Berechtigung | Zweck | Umfang |
|---|---|---|
| `User.ReadBasic.All` | Personensuche beim Erwähnen («@») in Kommentaren; Empfänger der Teams-Nachricht auflösen | liest nur Anzeigename und E-Mail (UPN) der Personen im Tenant |
| `Chat.Create` | Teams-Benachrichtigung: 1:1-Chat zwischen der kommentierenden und der erwähnten Person anlegen (ein bestehender wird wiederverwendet) | nur Chats, an denen die angemeldete Person selbst beteiligt ist |
| `ChatMessage.Send` | Teams-Benachrichtigung: Nachricht in diesem Chat senden | im Namen der angemeldeten Person, wie eine selbst getippte Nachricht |

Anschliessend **Administratorzustimmung für ‹Tenant› erteilen** → Ja. Die
drei zusätzlichen Berechtigungen verlangen laut Microsoft Graph keine
Administratorzustimmung; ist die Benutzerzustimmung im Tenant gesperrt, bitte
sie mit erteilen. Ohne sie funktioniert die App weiterhin, nur ohne
Verzeichnissuche bzw. Teams-Nachrichten.

## Schritt 4 · App-Rollen anlegen

In der Registrierung: **App-Rollen → App-Rolle erstellen** — dreimal:

| Anzeigename | Zulässige Mitgliedstypen | Wert | Beschreibung |
|---|---|---|---|
| `Orch Spec Admin` | Benutzer/Gruppen | `OrchSpec.Admin` | Pflegt Auftritt, Service-Katalog, Anmelde- und Benachrichtigungseinstellungen; darf Spezifikationen löschen; alle Rechte |
| `Orch Spec Editor` | Benutzer/Gruppen | `OrchSpec.Editor` | Legt Spezifikationen an, bearbeitet sie und das Diagramm, kommentiert |
| `Orch Spec Viewer` | Benutzer/Gruppen | `OrchSpec.Viewer` | Liest alles, exportiert; keine Änderungen |

Jeweils **«Möchten Sie diese App-Rolle aktivieren?» = Ja**.
Die Spalte **Wert** muss buchstabengetreu übernommen werden — die Anwendung
wertet genau diese Zeichenfolgen aus.

## Schritt 5 · Zugriff zuweisen

**Identität → Anwendungen → Unternehmensanwendungen → Z9nAI Orch Spec**

1. **Eigenschaften** → **Zuweisung erforderlich?** = **Ja** → Speichern.
   Damit können nur zugewiesene Personen die App verwenden.
2. **Benutzer und Gruppen → Benutzer/Gruppe hinzufügen** → Personen bzw.
   Gruppen auswählen → **Rolle auswählen** (Admin / Editor / Viewer) →
   **Zuweisen**.

Empfehlung: drei Sicherheitsgruppen (z. B. `OrchSpec-Admins`,
`OrchSpec-Editors`, `OrchSpec-Viewers`) mit je einer Rolle zuweisen; die
Pflege erfolgt dann über die Gruppenmitgliedschaft. (Gruppenzuweisung setzt
Entra ID P1 voraus; andernfalls einzelne Benutzer zuweisen.)

Eine Person kann mehrere Rollen haben — die höchste gilt.

## Schritt 6 · SharePoint-Ordner

Ein Ordner in einer SharePoint-Dokumentbibliothek (z. B. Teams-Team
«Prozess-Spezifikationen» → Dateien → Ordner `orch-spec`). Berechtigungen:
Admins und Editoren **Bearbeiten**, Viewer **Lesen**.

Die Datei `model.json` im Ordner (Stammdaten inkl. Rollenkonfiguration)
braucht **eigene Berechtigungen**: Vererbung beenden, nur Admins
**Bearbeiten**, Editoren und Viewer **Lesen**. Sonst könnte jede Person mit
Schreibrecht im Ordner sich über die Datei selbst zum Admin machen.
Anleitung: [SHAREPOINT-SETUP.md, Teil 3b](SHAREPOINT-SETUP.md#teil-3b--stammdaten-schützen-modeljson).

Den Link zum Ordner bitte ebenfalls zurückmelden.

## Schritt 7 · Rückmeldung

Bitte aus der **Übersicht** der App-Registrierung zurückmelden:

- **Anwendungs-ID (Client):** `________-____-____-____-____________`
- **Verzeichnis-ID (Mandant):** `________-____-____-____-____________`

Beide IDs sind öffentliche Kennungen (sie erscheinen in jeder Anmelde-URL)
und keine Geheimnisse. Sie werden in der Anwendung hinterlegt; danach ist die
Anmeldung aktiv. Benutzer erhalten anschliessend einen **Einrichtungs-Link**,
der Anmeldung und SharePoint-Ordner in einem Schritt einrichtet — sie müssen
keine IDs kennen.

## Optional · Richtlinien

Die Anwendung erzwingt selbst keine Anmeldehäufigkeit oder MFA — das
geschieht zentral über die Tenant-Richtlinien (Sicherheitsstandards bzw.
Conditional Access) und gilt automatisch auch für diese App.

## Bei Problemen

| Meldung beim Anmelden | Ursache |
|---|---|
| `AADSTS50011` (redirect URI mismatch) | Umleitungs-URI weicht ab (Schrägstrich, http/https, Pfad) oder steht unter «Web» statt «SPA» |
| `AADSTS50105` (not assigned to a role) | Zuweisung erforderlich ist aktiv, Person/Gruppe nicht zugewiesen (Schritt 5) |
| `AADSTS65001` (consent required) | Administratorzustimmung fehlt (Schritt 3) |
| Person hat in der App die falsche Stufe | Rolle in Schritt 5 prüfen; Rollen stehen im Token, daher einmal ab- und wieder anmelden |
