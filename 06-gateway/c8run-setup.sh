#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Camunda 8 Run - lokales Setup (macOS / Linux)
#
#   1. prueft JDK (21-25)
#   2. ermittelt das passende c8run-Release ueber die GitHub-API
#      (kein hartkodierter Dateiname -> ueberlebt Namensaenderungen)
#   3. laedt das Archiv nach ~/camunda/dist und entpackt es
#   4. gibt die Start-/Stop-Befehle aus (startet nur mit --start)
#
# Nutzung:
#   ./c8run-setup.sh                  # neuestes stabiles Release, Port 8181
#   ./c8run-setup.sh --port 8181      # HTTP-Port (Default 8181, da 8080 = C7)
#   ./c8run-setup.sh --version 8.8.6  # bestimmte Version
#   ./c8run-setup.sh --start          # nach dem Entpacken direkt starten
#   ./c8run-setup.sh --dir ~/dev/c8   # anderes Zielverzeichnis
#   ./c8run-setup.sh --list           # nur zeigen, welche Assets es gibt
#   ./c8run-setup.sh --url <URL>      # Download-URL manuell vorgeben
#
# Kompatibel mit Bash 3.2 (macOS-Default).
# ---------------------------------------------------------------------------
set -euo pipefail

BASE_DIR="${HOME}/camunda"
WANT_VERSION=""
MANUAL_URL=""
PORT="8181"          # 8080 ist auf diesem Rechner von Camunda 7 belegt
DO_START=false
DO_LIST=false
INCLUDE_PRERELEASE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)     WANT_VERSION="${2:?--version braucht einen Wert}"; shift 2 ;;
    --dir)         BASE_DIR="${2:?--dir braucht einen Wert}"; shift 2 ;;
    --url)         MANUAL_URL="${2:?--url braucht einen Wert}"; shift 2 ;;
    --port)        PORT="${2:?--port braucht einen Wert}"; shift 2 ;;
    --start)       DO_START=true; shift ;;
    --list)        DO_LIST=true; shift ;;
    --prerelease)  INCLUDE_PRERELEASE=true; shift ;;
    -h|--help)     sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
done

[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "--port braucht eine Zahl, nicht '$PORT'" >&2; exit 2; }

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

TMPDIR_LOCAL="$(mktemp -d "${TMPDIR:-/tmp}/c8run-setup.XXXXXX")"
cleanup() { rm -rf "$TMPDIR_LOCAL"; }
trap cleanup EXIT

# --- 1. JDK -----------------------------------------------------------------
check_java() {
  local java_bin="java"
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
    java_bin="${JAVA_HOME}/bin/java"
  fi
  command -v "$java_bin" >/dev/null 2>&1 || die \
"Kein java gefunden. Installiere ein OpenJDK 21-25, z.B.:
     brew install openjdk@21"

  local raw major
  # nicht head -1: JAVA_TOOL_OPTIONS/_JAVA_OPTIONS schieben eine "Picked up ..."-Zeile davor
  raw="$("$java_bin" -version 2>&1 | grep -E '(openjdk|java|jdk) version "' | head -1 || true)"
  [[ -n "$raw" ]] || die "Java-Version nicht ermittelbar ($java_bin -version lieferte keine version-Zeile)."
  major="$(printf '%s' "$raw" | sed -E 's/.*version "([0-9]+).*/\1/')"
  [[ "$major" =~ ^[0-9]+$ ]] || die "Java-Version nicht lesbar: $raw"

  if [ "$major" -lt 21 ] || [ "$major" -gt 25 ]; then
    die "Java $major gefunden, Camunda 8 Run braucht 21-25.
     Umschalten: export JAVA_HOME=\$(/usr/libexec/java_home -v 21)"
  fi
  log "Java $major ok ($raw)"
}

check_python() {
  command -v python3 >/dev/null 2>&1 || die \
"python3 fehlt (wird zum Auswerten der Release-Liste und der YAML gebraucht).
     Auf dem Mac: xcode-select --install   oder   brew install python"
}

# --- 2. Plattform -----------------------------------------------------------
OS=""; ARCH=""
detect_platform() {
  case "$(uname -s)" in
    Darwin) OS="darwin" ;;
    Linux)  OS="linux"  ;;
    *) die "Nicht unterstuetztes OS: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) ARCH="arm" ;;
    x86_64|amd64)  ARCH="x86" ;;
    *) die "Nicht unterstuetzte Architektur: $(uname -m)" ;;
  esac
}

# --- 3. Release ermitteln ---------------------------------------------------
# JSON und Python-Skript laufen ueber Dateien, nicht ueber argv
# (die Release-Liste ist zu gross fuer ARG_MAX).
fetch_releases() {
  local out="$1" page url http
  : > "$out.pages"
  for page in 1 2 3; do
    url="https://api.github.com/repos/camunda/camunda/releases?per_page=100&page=${page}"
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
      http="$(curl -sS -w '%{http_code}' -o "$out.page" \
                -H "Authorization: Bearer ${GITHUB_TOKEN}" \
                -H 'Accept: application/vnd.github+json' "$url")" || http="000"
    else
      http="$(curl -sS -w '%{http_code}' -o "$out.page" \
                -H 'Accept: application/vnd.github+json' "$url")" || http="000"
    fi
    case "$http" in
      200) cat "$out.page" >> "$out.pages" ;;
      403) die "GitHub-API antwortet 403 (Rate-Limit?). Setze GITHUB_TOKEN oder nutze --url <direkte URL>." ;;
      000) die "GitHub-API nicht erreichbar (Netzwerk/Proxy). Alternativ: --url <direkte URL>." ;;
      *)   die "GitHub-API antwortet HTTP $http." ;;
    esac
    # letzte Seite erreicht?
    if ! grep -q '"tag_name"' "$out.page"; then break; fi
  done
  mv "$out.pages" "$out"
}

write_parser() {
  cat > "$1" <<'PY'
import json, os, re, sys

# Datei enthaelt ggf. mehrere aneinandergehaengte JSON-Arrays (Paginierung)
raw = open(sys.argv[1], encoding="utf-8").read()
dec = json.JSONDecoder()
releases, idx = [], 0
while idx < len(raw):
    while idx < len(raw) and raw[idx] in " \t\r\n":
        idx += 1
    if idx >= len(raw):
        break
    obj, idx = dec.raw_decode(raw, idx)
    releases.extend(obj if isinstance(obj, list) else [obj])

os_name   = os.environ["OS"]
arch      = os.environ["ARCH"]
want      = os.environ["WANT"].strip()
allow_pre = os.environ["PRE"] == "true"
list_only = os.environ["LIST"] == "true"

os_pat   = r"darwin|mac|osx" if os_name == "darwin" else r"linux"
arch_pat = r"arm64|aarch64"  if arch == "arm"       else r"x86_64|amd64|x86-64"
# Nach Asset-Namen filtern, nicht nach Tag (Tag-Konvention kann sich aendern)
name_pat = r"c8run|camunda8?-?run"

def version_key(*texts):
    """Hoechste x.y.z aus Tag/Dateiname. Die GitHub-Liste ist nach
    Veroeffentlichungsdatum sortiert - ein Patch-Release eines alten
    Zweigs (8.7.39) steht dort VOR 8.9.x. Deshalb nach Version sortieren,
    nicht nach Reihenfolge."""
    for t in texts:
        m = re.search(r"(\d+)\.(\d+)\.(\d+)", t or "")
        if m:
            return tuple(int(x) for x in m.groups())
    return (0, 0, 0)

candidates = []   # alle c8run-Assets, fuer --list und Fehlermeldung
matches = []      # passende Assets fuer diese Plattform

for r in releases:
    tag = r.get("tag_name", "")
    if r.get("draft"):
        continue
    if r.get("prerelease") and not allow_pre:
        continue
    for a in r.get("assets", []):
        n = a["name"].lower()
        if not re.search(name_pat, n):
            continue
        ver = version_key(a["name"], tag)
        candidates.append((ver, tag, a["name"]))
        if want and want not in tag and want not in a["name"]:
            continue
        if not n.endswith((".tar.gz", ".tgz", ".zip")):
            continue
        if re.search(os_pat, n) and re.search(arch_pat, n):
            matches.append((ver, tag, a["name"], a["browser_download_url"]))

candidates.sort(reverse=True)
matches.sort(reverse=True)
best = matches[0][1:] if matches else None

if list_only:
    if not candidates:
        print("Keine c8run-Assets in den letzten Releases gefunden.")
    for ver, tag, name in candidates[:60]:
        print("%s\t%s" % (tag, name))
    sys.exit(0)

if not best:
    sys.stderr.write("Kein passendes c8run-Asset fuer %s/%s gefunden.\n" % (os_name, arch))
    if candidates:
        sys.stderr.write("Gefundene c8run-Assets (Auszug):\n")
        for ver, tag, name in candidates[:15]:
            sys.stderr.write("  %s  %s\n" % (tag, name))
    else:
        sys.stderr.write("Ueberhaupt keine c8run-Assets in den letzten Releases.\n")
    sys.stderr.write("Manuell pruefen: https://github.com/camunda/camunda/releases\n"
                     "und mit --url <direkte URL> erneut starten.\n")
    sys.exit(1)

print("\t".join(best))
PY
}

# --- main -------------------------------------------------------------------
check_java
check_python
detect_platform
log "Plattform: ${OS}/${ARCH}"

RELEASES_JSON="${TMPDIR_LOCAL}/releases.json"
PARSER="${TMPDIR_LOCAL}/parse.py"
RESULT="${TMPDIR_LOCAL}/result.txt"

TAG=""; ASSET_NAME=""; ASSET_URL=""

if [[ -n "$MANUAL_URL" ]]; then
  ASSET_URL="$MANUAL_URL"
  ASSET_NAME="$(basename "${MANUAL_URL%%\?*}")"
  TAG="manual"
  log "Manuelle URL: $ASSET_URL"
else
  log "Ermittle passendes Camunda-8-Run-Release ..."
  fetch_releases "$RELEASES_JSON"
  write_parser "$PARSER"

  if $DO_LIST; then
    OS="$OS" ARCH="$ARCH" WANT="$WANT_VERSION" PRE="$INCLUDE_PRERELEASE" LIST=true \
      python3 "$PARSER" "$RELEASES_JSON"
    exit 0
  fi

  # Fehler des Parsers muss das Skript abbrechen -> Exitcode explizit pruefen
  if ! OS="$OS" ARCH="$ARCH" WANT="$WANT_VERSION" PRE="$INCLUDE_PRERELEASE" LIST=false \
        python3 "$PARSER" "$RELEASES_JSON" > "$RESULT"; then
    die "Release-Aufloesung fehlgeschlagen (Details oben)."
  fi

  IFS=$'\t' read -r TAG ASSET_NAME ASSET_URL < "$RESULT"
  [[ -n "$ASSET_URL" ]] || die "Leere Download-URL - Abbruch."
  log "Gefunden: $TAG -> $ASSET_NAME"

  # Vor 8.9 startet C8 Run ein gebuendeltes Elasticsearch statt H2 -
  # auf dem Mac die haeufigste Startfehlerquelle.
  VER_MAJ="$(printf '%s' "$ASSET_NAME$TAG" | sed -nE 's/.*([0-9]+)\.([0-9]+)\.[0-9]+.*/\1/p' | head -1)"
  VER_MIN="$(printf '%s' "$ASSET_NAME$TAG" | sed -nE 's/.*([0-9]+)\.([0-9]+)\.[0-9]+.*/\2/p' | head -1)"
  if [[ -n "$VER_MAJ" && -n "$VER_MIN" ]] &&
     { [ "$VER_MAJ" -lt 8 ] || { [ "$VER_MAJ" -eq 8 ] && [ "$VER_MIN" -lt 9 ]; }; }; then
    warn "Version < 8.9: diese Distribution startet ein gebuendeltes Elasticsearch
     (erst ab 8.9 ist H2 der Default). Bei 'Elasticsearch did not start' ins
     log/elasticsearch.log der Distribution schauen. Neuere Version: --version 8.9"
  fi
fi

DIST_DIR="${BASE_DIR}/dist"
TARGET_DIR="${BASE_DIR}/${TAG}"
mkdir -p "$DIST_DIR" "$TARGET_DIR"

ARCHIVE="${DIST_DIR}/${ASSET_NAME}"
if [[ -s "$ARCHIVE" ]]; then
  log "Archiv bereits vorhanden: $ARCHIVE"
else
  log "Lade herunter ..."
  curl -fSL --progress-bar -o "${ARCHIVE}.part" "$ASSET_URL"
  mv "${ARCHIVE}.part" "$ARCHIVE"
fi

if [[ -z "$(ls -A "$TARGET_DIR" 2>/dev/null || true)" ]]; then
  log "Entpacke nach $TARGET_DIR"
  case "$ASSET_NAME" in
    *.zip)          unzip -q "$ARCHIVE" -d "$TARGET_DIR" ;;
    *.tar.gz|*.tgz) tar -xzf "$ARCHIVE" -C "$TARGET_DIR" ;;
    *) die "Unbekanntes Archivformat: $ASSET_NAME" ;;
  esac
else
  log "Zielverzeichnis nicht leer, ueberspringe Entpacken."
fi

# c8run-Verzeichnis finden (kein xargs -r: gibt es auf macOS nicht)
RUN_DIR="$TARGET_DIR"
FOUND="$(find "$TARGET_DIR" -maxdepth 3 -name 'start.sh' -print 2>/dev/null | head -1 || true)"
if [[ -n "$FOUND" ]]; then
  RUN_DIR="$(dirname "$FOUND")"
fi

if [[ "$OS" == "darwin" ]]; then
  # ohne das blockt Gatekeeper die entpackten Binaries
  xattr -dr com.apple.quarantine "$TARGET_DIR" 2>/dev/null || true
fi

chmod +x "$RUN_DIR"/*.sh 2>/dev/null || true
[[ -f "$RUN_DIR/c8run" ]] && chmod +x "$RUN_DIR/c8run" 2>/dev/null || true

# --- 4. Port setzen ---------------------------------------------------------
# Zwei Wege, absichtlich beide:
#   a) CLI-Flag --port beim Start (dokumentiert)
#   b) server.port in configuration/application.yaml (greift auch dann,
#      wenn das Flag in der jeweiligen Version nicht alle Webapps umstellt)
CONFIG_FILE=""
for cand in "$RUN_DIR/configuration/application.yaml" \
            "$RUN_DIR/configuration/application.yml"; do
  [[ -f "$cand" ]] && { CONFIG_FILE="$cand"; break; }
done

patch_port() {
  local file="$1" port="$2"
  [[ -f "${file}.orig" ]] || cp "$file" "${file}.orig"
  FILE="$file" PORT="$port" python3 - <<'PY'
import os, re

path = os.environ["FILE"]
port = os.environ["PORT"]
src  = open(path, encoding="utf-8").read()
lines = src.splitlines()

def top_level_block(name):
    for i, l in enumerate(lines):
        if re.match(r'^%s\s*:\s*$' % re.escape(name), l):
            return i
    return None

i = top_level_block("server")
if i is None:
    # Kein server-Block -> anhaengen
    if lines and lines[-1].strip():
        lines.append("")
    lines += ["server:", "  port: %s" % port]
else:
    # innerhalb des Blocks nach port: suchen (bis zur naechsten Top-Level-Zeile)
    j = i + 1
    replaced = False
    while j < len(lines):
        l = lines[j]
        if l.strip() and not l.startswith((" ", "\t")):
            break
        if re.match(r'^\s+port\s*:', l):
            indent = re.match(r'^(\s*)', l).group(1)
            lines[j] = "%sport: %s" % (indent, port)
            replaced = True
            break
        j += 1
    if not replaced:
        lines.insert(i + 1, "  port: %s" % port)

open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("server.port = %s gesetzt in %s" % (port, path))
PY
}

if [[ -n "$CONFIG_FILE" ]]; then
  if patch_port "$CONFIG_FILE" "$PORT"; then
    log "Port in Konfiguration gesetzt (Original als ${CONFIG_FILE}.orig gesichert)"
  else
    warn "Konnte $CONFIG_FILE nicht patchen - Port nur ueber das --port-Flag."
  fi
else
  warn "Keine configuration/application.yaml gefunden - Port kommt nur ueber das --port-Flag."
fi

# Bequemer Starter mit fixem Port.
# ES_JAVA_HOME: Elasticsearch 8.13 (in C8 Run < 8.9) aktiviert den Security
# Manager, den JDK 24+ nicht mehr zulaesst (JEP 486) -> "Enabling a Security
# Manager is not supported". c8run reicht das System-Java an ES durch, deshalb
# ES hier explizit auf das mitgelieferte JDK 21 zeigen lassen.
cat > "$RUN_DIR/start-${PORT}.sh" <<EOF
#!/usr/bin/env bash
# erzeugt von c8run-setup.sh
cd "\$(dirname "\$0")"

ESJDK="\$(ls -d elasticsearch-*/jdk.app/Contents/Home 2>/dev/null | head -1)"
[ -z "\$ESJDK" ] && ESJDK="\$(ls -d elasticsearch-*/jdk 2>/dev/null | head -1)"
if [ -n "\$ESJDK" ]; then
  export ES_JAVA_HOME="\$PWD/\$ESJDK"
  echo "ES_JAVA_HOME=\$ES_JAVA_HOME"
fi

exec ./start.sh --port ${PORT} "\$@"
EOF
chmod +x "$RUN_DIR/start-${PORT}.sh"

# Java 24+ zusammen mit einer ES-basierten Distribution ist die Kombination,
# die genau in diesen Fehler laeuft.
if [[ -d "$RUN_DIR" ]] && ls -d "$RUN_DIR"/elasticsearch-* >/dev/null 2>&1; then
  JMAJ="$(java -version 2>&1 | grep -E '(openjdk|java|jdk) version "' | head -1 |
          sed -E 's/.*version "([0-9]+).*/\1/')"
  if [[ "$JMAJ" =~ ^[0-9]+$ ]] && [ "$JMAJ" -ge 24 ]; then
    warn "Java $JMAJ + gebuendeltes Elasticsearch: der erzeugte Starter setzt
     ES_JAVA_HOME auf das mitgelieferte JDK 21. Falls Camunda selbst zickt,
     die ganze Distribution auf JDK 21 fahren:
       export JAVA_HOME=\$(/usr/libexec/java_home -v 21)"
  fi
fi

cat <<EOF

--------------------------------------------------------------------
Camunda 8 Run installiert: $RUN_DIR

  Starten:   cd "$RUN_DIR" && ./start-${PORT}.sh
             (entspricht ./start.sh --port ${PORT})
  Stoppen:   cd "$RUN_DIR" && ./shutdown.sh
  Ohne Connectors:  ./start-${PORT}.sh --disable-connectors

  Operate:   http://localhost:${PORT}/operate
  Tasklist:  http://localhost:${PORT}/tasklist
  Login:     demo / demo
  Zeebe gRPC: localhost:26500   (vom --port-Flag NICHT betroffen)

  Secondary Storage: ab 8.9 standardmaessig H2.

  Pruefen, ob der Port wirklich ueberall greift:
    lsof -nP -iTCP:${PORT} -sTCP:LISTEN
    lsof -nP -iTCP:8080  -sTCP:LISTEN   # sollte nur Camunda 7 zeigen
--------------------------------------------------------------------
EOF

if $DO_START; then
  log "Starte Camunda 8 Run auf Port ${PORT} ..."
  cd "$RUN_DIR" && ./start.sh --port "$PORT"
fi
