# Camunda 8 lokal – Setup & C7→C8-Migrationsprüfung

Stand: 20.08.2026 · Zielumgebung: macOS (Apple Silicon)

---

## 1. Camunda 8 Run aufsetzen

```bash
chmod +x c8run-setup.sh
./c8run-setup.sh                  # prüft JDK, lädt passendes Release, entpackt (Port 8181)
./c8run-setup.sh --port 9090      # anderer HTTP-Port
./c8run-setup.sh --start          # zusätzlich direkt starten
./c8run-setup.sh --version 8.8.6  # bestimmte Version festnageln
./c8run-setup.sh --list           # nur anzeigen, welche c8run-Assets es gibt
./c8run-setup.sh --url <URL>      # Download-URL manuell vorgeben (Fallback)
```

Bei GitHub-Rate-Limit: `export GITHUB_TOKEN=…` setzen, dann erneut starten.

Danach:

| | |
|---|---|
| Start | `cd ~/camunda/<tag>/… && ./start-8181.sh` |
| Stop | `./shutdown.sh` |
| Operate | http://localhost:8181/operate |
| Tasklist | http://localhost:8181/tasklist |
| Login | `demo` / `demo` |
| Zeebe gRPC | `localhost:26500` |

### Port

Default im Skript ist **8181**, weil 8080 lokal von Camunda 7 belegt ist. Das Skript setzt den Port doppelt:

1. `--port 8181` beim Start (über den erzeugten Wrapper `start-8181.sh`)
2. `server.port: 8181` in `configuration/application.yaml` (Original wird als `.orig` gesichert)

Beides, weil es zu `--port` einen gemeldeten Bug gab ([camunda/camunda#26232](https://github.com/camunda/camunda/issues/26232)): das Flag stellte nicht alle Webapps/APIs um. Ob das in 8.9 behoben ist, habe ich nicht verifiziert — deshalb nach dem ersten Start prüfen:

```bash
lsof -nP -iTCP:8181 -sTCP:LISTEN   # Camunda 8
lsof -nP -iTCP:8080 -sTCP:LISTEN   # sollte nur Camunda 7 zeigen
```

**Nicht betroffen:** Zeebe gRPC bleibt auf **26500**. Wenn Zeebe-Clients konfiguriert werden, ist das der relevante Port, nicht 8181. Die REST-API läuft dagegen unter dem HTTP-Port mit.

**Voraussetzung:** OpenJDK 21–25. Falls mehrere JDKs installiert sind:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
```

**Enthalten:** Orchestration Cluster (Zeebe, Operate, Tasklist, Identity), Connectors, Document Storage.
**Nicht enthalten:** Web Modeler, Optimize, Keycloak/OIDC. → Desktop Modeler separat (`brew install --cask camunda-modeler`).

Ab **8.9 (GA seit 14.04.2026)** ist **H2** die Default-Secondary-Storage – deutlich weniger RAM als Elasticsearch. Alternativ PostgreSQL/MariaDB/MySQL/Oracle/SQL Server, wenn du prod-nah testen willst.

### Versionswahl – wichtiger als „neueste"

Nimm lokal die Version, die beim Kunden läuft. 8.8 und 8.9 unterscheiden sich strukturell (Orchestration Cluster, Identity, Secondary Storage). Mit `--version 8.8.x` lässt sich das Skript darauf festnageln.

**Achtung bei Versionen < 8.9:** dort startet C8 Run ein gebündeltes **Elasticsearch** statt H2 — deutlich mehr RAM, längerer Start und die häufigste Startfehlerquelle auf dem Mac. Das Skript warnt, wenn es eine solche Version auflöst.

### `Error: Elasticsearch did not start!` — Ursache und Fix

Im Log (`log/elasticsearch.log`) steht der eigentliche Grund:

```
Error occurred during initialization of VM
java.lang.Error: A command line option has attempted to allow or enable
the Security Manager. Enabling a Security Manager is not supported.
```

**Das ist ein Java-Problem, kein Elasticsearch-Problem.** Elasticsearch 8.13 aktiviert beim Start den Security Manager. Seit **JDK 24** ist das nicht mehr erlaubt (JEP 486, der Security Manager wurde endgültig abgeschaltet). Mit Java 25 kann ES 8.13 also grundsätzlich nicht starten.

Die Distribution bringt ein passendes JDK 21 mit (`elasticsearch-8.13.4/jdk.app/Contents/Home`), aber C8 Run reicht das System-Java an ES durch statt das gebündelte zu nehmen. Deshalb setzt der erzeugte `start-<port>.sh` jetzt:

```bash
export ES_JAVA_HOME="$PWD/elasticsearch-*/jdk.app/Contents/Home"
```

Falls danach Camunda selbst mit Java 25 zickt (8.7 ist dafür nicht spezifiziert), die ganze Distribution auf JDK 21 fahren:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
```

**Sauberste Lösung bleibt 8.9** — dort ist H2 der Default, Elasticsearch entfällt lokal komplett und das Problem existiert nicht.

Weitere Kandidaten, falls es anders klemmt: Port 9200 belegt (`lsof -nP -iTCP:9200 -sTCP:LISTEN`), oder das ältere ARM-Problem [camunda/camunda#27132](https://github.com/camunda/camunda/issues/27132) (`could not find java in ES_JAVA_HOME at /usr/bin/java/bin/java` — dann zeigt `JAVA_HOME` auf ein `bin/` statt auf die JDK-Wurzel).

---

## 2. Was C8 Run für die Migrationsprüfung *nicht* abdeckt

Bewusst mitdenken, sonst validierst du gegen eine Umgebung, die nicht deiner Zielarchitektur entspricht:

- **Kein OIDC/Keycloak** – nur Basic Auth. Auth-Integration deiner Worker/Clients testest du hier nicht.
- **APIs standardmässig ungesichert** – lokal bequem, aber kein Abbild der Prod-Absicherung.
- **Kein Multi-Broker/Partitionierung** – Verhalten unter Last, Rebalancing, Backpressure fehlen.
- **Kein Optimize** – falls Reporting Teil der Migration ist, separat betrachten.
- **Nicht produktionssupported** – reine Dev-Umgebung.

Für Auth-/Cluster-Themen später Docker Compose (Full Stack) oder Helm auf KIND/k3d.

---

## 3. C7 → C8: Was zu prüfen ist

**Grundsatz aus der Camunda-Doku:** *„Camunda 8 ist kein Drop-in-Replacement für Camunda 7."* Es ist kein Bibliothekstausch, sondern BPMN-Anpassung + Code-Refactoring + teilweise Re-Architektur.

### 3.1 Offizielles Tooling

| Tool | Zweck | Status |
|---|---|---|
| **Migration Analyzer** | Erste Aufwandsschätzung: analysiert C7-BPMNs, listet Migrationsaufgaben | lokal (Java) oder als kostenloses SaaS |
| **Diagram Converter** | C7-BPMN → C8-BPMN, CLI, erzeugt CSV-Report | Teil des Analyzers |
| **Data Migrator** | überträgt laufende Instanzen + History C7 → C8 | seit 8.8, iterativ ausgebaut |
| **Camunda 7 Adapter** | erlaubt Ausführung von bestehendem C7-Delegate-Code unter C8 | verfügbar |
| **Code Converter** | Refactoring-Rezepte für C7-Code | Reifegrad unklar → selbst evaluieren |

Repos: `camunda/camunda-7-to-8-migration-tooling`, `camunda-community-hub/camunda-7-to-8-migration-analyzer`

**Empfohlener erster Schritt:** Migration Analyzer über die bestehenden BPMNs laufen lassen. Das ergibt in ein paar Stunden eine faktenbasierte Aufwandsindikation statt einer Schätzung aus dem Bauch.

### 3.2 Konzeptionelle Bruchstellen (Checkliste)

Diese Punkte konkret gegen den bestehenden Code halten:

- **Java Delegates / Expressions** → gibt es in C8 nicht. Alles wird Job Worker (oder Connector). Der C7-Adapter ist eine Brücke, keine Zielarchitektur.
- **Prozessvariablen** → in C8 JSON, kein Java-Objekt-Serialisierung (Spin). Deine Circe-Codecs und der ZonedDateTime-Umgang sind hier direkt betroffen.
- **JUEL/Groovy/Script Tasks** → C8 nutzt FEEL. Groovy-Scripting (z.B. deine `codeById`-Helper) muss neu gedacht werden.
- **Transaktionen** → keine gemeinsame DB-Transaktion mehr zwischen Engine und Business-Code. Idempotenz und Kompensation werden zum Thema.
- **OptimisticLockingException / async continuations** → das C7-Modell entfällt; Zeebe hat Job-Retries und Backoff. Multi-Instance-Join-Probleme aus C7 lösen sich anders, nicht automatisch.
- **DMN** → C8 nutzt FEEL-only (kein JUEL, keine Script-Expressions in DMN). Bestehende DMNs prüfen.
- **Query-API / History** → Operate/Tasklist-APIs statt C7 History Service. Eigene Reports/Queries müssen neu gebaut werden.
- **External Task Retry-Konfiguration** → in C8 anders modelliert (Job-Retries, `retryBackoff`).
- **Message Correlation / Timer-Semantik** → Detailunterschiede, im Analyzer-Report beachten.

### 3.3 Vorschlag Vorgehen

1. C8 Run lokal starten (dieses Skript), Version = Zielversion.
2. Migration Analyzer über alle C7-BPMNs → Report.
3. Ein repräsentativer Prozess als Spike: BPMN konvertieren, deployen, einen Worker anbinden, Happy Path in Operate durchspielen.
4. Ergebnisse aus dem Spike gegen die Checkliste 3.2 halten → Aufwand hochrechnen.
5. Erst danach Entscheidung über Data Migrator / Big Bang vs. paralleler Betrieb.

---

## 4. Unsicher / selbst verifizieren

Ehrlich markiert – das konnte ich hier nicht testen:

- **Der GitHub-Download ist ungetestet.** Getestet sind: JDK-Erkennung, Plattform-Erkennung, Release-Parser (inkl. Paginierung und Kein-Treffer-Fall), Download + Entpacken + Idempotenz (gegen ein lokales Archiv via `--url file://…`) und der Fehlerpfad bei nicht erreichbarer API. Nicht getestet: der reale Abruf von api.github.com — mein Sandbox-Container hat keinen GitHub-Zugriff. Die Asset-Namen ermittelt das Skript dynamisch statt hartkodiert; bei geänderter Konvention bricht es mit Auflistung der gefundenen Assets ab, statt eine falsche Datei zu laden.
- **Apple-Silicon-Support von C8 Run** gilt als gegeben, ich habe es nicht verifiziert. In der 8.7-alpha-Phase gab es ARM-Probleme.
- **Reifegrad von Data Migrator und Code Converter** kenne ich nur aus der Doku, nicht aus Praxis. Vor einer Kundenzusage selbst evaluieren.
- **Ob Orchescala / camunda-dmn-tester** gegen C8 8.9 laufen, ist offen.

---

## Quellen

- [Camunda 8 Run – Developer Quickstart](https://docs.camunda.io/docs/self-managed/quickstart/developer-quickstart/c8run/)
- [Install and start Camunda 8 Run](https://docs.camunda.io/docs/self-managed/quickstart/developer-quickstart/c8run/install-start/)
- [8.9 Release notes](https://docs.camunda.io/docs/reference/announcements-release-notes/890/890-release-notes/)
- [Migrating from Camunda 7](https://docs.camunda.io/docs/guides/migrating-from-camunda-7/)
- [Migration tooling](https://docs.camunda.io/docs/guides/migrating-from-camunda-7/migration-tooling/)
- [camunda/camunda-7-to-8-migration-tooling](https://github.com/camunda/camunda-7-to-8-migration-tooling)
- [camunda-community-hub/camunda-7-to-8-migration-analyzer](https://github.com/camunda-community-hub/camunda-7-to-8-migration-analyzer)
