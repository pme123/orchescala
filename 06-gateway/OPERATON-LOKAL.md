# Operaton lokal – Setup & Einordnung gegenüber der C7→C8-Migration

Stand: 09.09.2026 · Zielumgebung: macOS (Apple Silicon)

---

## 1. Setup

```bash
chmod +x operaton-setup.sh
./operaton-setup.sh                  # neuestes stabiles Release, Port 8282
./operaton-setup.sh --version 2.1.4  # bestimmte Version
./operaton-setup.sh --start          # direkt starten
./operaton-setup.sh --list           # zeigen, welche Assets es gibt
./operaton-setup.sh --url <URL>      # Download-URL manuell vorgeben
```

**Asset-Namen:** Die Distribution heisst `operaton-bpm-<version>.zip` bzw. `.tar.gz` — kein `run` im Namen, anders als bei Camunda. Nebenartefakte desselben Releases (`operaton-sql-scripts-*`, `rest-api.zip`, `project-reports.zip`, `clirr-reports.zip`) werden aussortiert; `.tar.gz` wird `.zip` vorgezogen, weil dabei die Dateirechte erhalten bleiben.

Am Rand bemerkenswert: das SQL-Skript-Artefakt heisst `operaton-sql-scripts-7.24.0` — die Camunda-7.24-Abstammung ist also auch im Schema-Versioning sichtbar. Das stützt die Aussage der API-Kompatibilität.

Gleicher Aufbau wie `c8run-setup.sh`, drei Unterschiede:

- **Kein OS/Arch-Matching** — Operaton Run ist plattformunabhängig (reines Java).
- **Java ≥ 17** statt 21–25. Operaton 2.0 unterstützt 17, 21 und 25.
- **Port über die Konfiguration**, nicht über ein CLI-Flag: das Skript patcht `server.port` in *allen* `configuration/*.yml` (also auch `production.yml`) und setzt zusätzlich `SERVER_PORT` im erzeugten `start-8282.sh`. Originale bleiben als `*.orig` liegen.

| | |
|---|---|
| Start | `cd ~/operaton/<tag>/… && ./start-8282.sh` |
| Cockpit | http://localhost:8282/operaton/app/cockpit/ |
| Tasklist | http://localhost:8282/operaton/app/tasklist/ |
| Admin | http://localhost:8282/operaton/app/admin/ |
| REST | http://localhost:8282/engine-rest/ |

### Alternative: Docker

Für einen schnellen Blick ist Docker sauberer als der Download — bei dir via Colima:

```bash
docker run -d --name operaton -p 8282:8080 operaton/operaton:latest
```

Das umgeht die Port-Patcherei komplett (Port-Mapping statt Konfiguration) und lässt sich rückstandsfrei entfernen. Nachteil: du kommst nicht so leicht an die Konfigurationsdateien und an eigene Prozess-Deployments im Dateisystem.

---

## 2. Was Operaton für deine Migrationsfrage bedeutet

Das ist der eigentlich wichtige Punkt: **Operaton ist keine Ergänzung zu C8, sondern die Alternative dazu, überhaupt zu migrieren.**

Operaton ist der Community-Fork von Camunda 7. Version 2.0 (20.03.2026) ist laut Projekt „feature-complete und API-kompatibel" mit **Camunda 7.24**, ohne Änderungen an DB-Schema und REST-API. Aktuell ist inzwischen **2.1.x** — was 2.1 gegenüber 2.0 bringt, habe ich nicht recherchiert.

### Was das für die Entscheidung heisst

| | Camunda 7 → Operaton | Camunda 7 → Camunda 8 |
|---|---|---|
| Migrationsaufwand | sehr gering (API-kompatibel, kein Schema-Change) | hoch: BPMN-Anpassung, Delegates → Job Worker, FEEL statt Groovy/JUEL, keine gemeinsame Transaktion |
| Delegates, Groovy, Spin, JUEL | bleiben | entfallen |
| Deine Circe-Codecs / Scala-Integration | bleiben | betroffen |
| Support / Haftung | Community, kein kommerzieller Vertrag | Camunda AG, Enterprise-Support kaufbar |
| Zukunftsfähigkeit | hängt an der Community | Herstellerprodukt mit Roadmap |
| Skalierung / Zeebe-Architektur | nein | ja |

**Meine Einschätzung, ausdrücklich als Einschätzung:** Für einen FINMA-regulierten Kunden ist der Support- und Longevity-Aspekt oft das ausschlaggebende Kriterium, nicht der technische Aufwand. Ein Community-Fork ohne kommerziellen Supportvertrag ist dort erfahrungsgemäss schwer durchzubringen — es gibt aber inzwischen Dienstleister, die Support für Operaton anbieten; das müsstest du für den konkreten Fall prüfen. Umgekehrt: wenn der Treiber der Migration nur „Camunda 7 läuft aus" ist und nicht „wir brauchen Zeebe-Skalierung", dann ist Operaton die deutlich günstigere Antwort und gehört sauber in die Evaluation, statt sie zu überspringen.

**Konkreter Vorschlag:** Beide lokal aufsetzen (das ist jetzt je ein Skript-Aufruf) und denselben repräsentativen Prozess gegen beide fahren. Der Aufwandsunterschied wird dann nicht behauptet, sondern gemessen — und genau das ist es, was du dem Kunden vorlegen kannst.

### Breaking Changes bei Operaton 2.0 (relevant für eine C7-Codebasis)

- **Spring Boot 4 / Spring Framework 7 zwingend** — Support für Spring Boot 3 / Spring 6 wurde gestrichen. Das ist bei einem bestehenden Projekt der grösste Brocken.
- **JavaScript-Engine Nashorn → GraalVM** — bestehende JS-Skripte können anpassungsbedürftig sein. Groovy ist davon nicht betroffen.
- Tomcat 11, Wildfly 38, Quarkus 3.32.
- Kein DB-Schema-Change, keine REST-API-Änderung.

Falls Spring Boot 4 zu früh kommt: Operaton 1.x als Zwischenschritt prüfen.

---

## 3. Unsicher / selbst verifizieren

- **Der GitHub-Download ist ungetestet** (mein Sandbox-Container hat keinen GitHub-Zugriff). Getestet: Java-/Python-Preflight, Asset-Parser gegen die *echten* Asset-Namen aus einem realen `--list`-Lauf, Versionssortierung (Semver statt Listenreihenfolge), Download + Entpacken + Idempotenz gegen lokale Archive, Port-Patch über mehrere YAMLs, sowie die Warnpfade ohne `start.sh` und ohne YAML.
- **Der innere Aufbau des Archivs ist unbekannt.** Ob `operaton-bpm-<version>.zip` direkt eine Run-artige Distribution ist oder mehrere Server-Varianten enthält, konnte ich nicht prüfen. Das Skript sucht `start.sh` bis Tiefe 5 und bevorzugt einen Pfad mit `/run/`; findet es keins, sagt es das und listet die oberste Ebene auf. Falls die Struktur anders ist, schick mir die Ausgabe von `ls -R` auf dem entpackten Ordner.
- **Die Kontextpfade** (`/operaton/app/cockpit/`) sind aus der Camunda-7-Konvention abgeleitet, nicht in der Operaton-Doku verifiziert. Wenn 404, probier `/camunda/app/cockpit/`.
- **Admin-User beim ersten Start**: bei Camunda 7 Run legt man ihn beim ersten Cockpit-Aufruf selbst an oder bekommt `demo/demo` über die Beispiel-Anwendung. Wie Operaton Run das handhabt, habe ich nicht geprüft.
- **Ob `SERVER_PORT` als Umgebungsvariable greift**, ist Spring-Boot-Standardverhalten, aber vom Start-Skript abhängig. Der YAML-Patch ist der verlässlichere der beiden Wege.
- **Supportangebote für Operaton** habe ich nicht recherchiert — vor einer Kundenempfehlung nötig.

Prüfen nach dem ersten Start:

```bash
lsof -nP -iTCP:8282 -sTCP:LISTEN   # Operaton
lsof -nP -iTCP:8181 -sTCP:LISTEN   # Camunda 8 Run
lsof -nP -iTCP:8080 -sTCP:LISTEN   # Camunda 7
```

**Portbelegung lokal:** 8080 Camunda 7 · 8181 Camunda 8 Run · 8282 Operaton. So laufen alle drei parallel — was für den Vergleich in Abschnitt 2 der eigentliche Punkt ist.

---

## Quellen

- [Operaton – Open Source BPM Engine](https://operaton.org/)
- [Operaton 2.0 Released (20.03.2026)](https://operaton.org/2026/03/20/operaton-2-0-released/)
- [Download and Installation](https://docs.operaton.org/docs/get-started/quick-start/install/)
- [operaton/operaton Releases](https://github.com/operaton/operaton/releases)
- [operaton/operaton auf Docker Hub](https://hub.docker.com/r/operaton/operaton/)
