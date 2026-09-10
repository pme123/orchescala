#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Operaton (Camunda-7-Fork) - lokales Setup, Run-Distribution
#
#   1. prueft JDK (>= 17) und python3
#   2. ermittelt die Run-Distribution ueber die GitHub-API (operaton/operaton)
#   3. laedt das Archiv nach ~/operaton/dist und entpackt es
#   4. setzt den HTTP-Port in configuration/*.yml
#      (Default 8282: 8080 = Camunda 7, 8181 = Camunda 8 Run)
#
# Nutzung:
#   ./operaton-setup.sh                  # neuestes stabiles Release, Port 8282
#   ./operaton-setup.sh --port 8282      # HTTP-Port
#   ./operaton-setup.sh --version 2.0.0  # bestimmte Version
#   ./operaton-setup.sh --start          # nach dem Entpacken direkt starten
#   ./operaton-setup.sh --dir ~/dev/op   # anderes Zielverzeichnis
#   ./operaton-setup.sh --list           # zeigen, welche Assets es gibt
#   ./operaton-setup.sh --url <URL>      # Download-URL manuell vorgeben
#
# Kompatibel mit Bash 3.2 (macOS-Default).
# ---------------------------------------------------------------------------
set -euo pipefail

BASE_DIR="${HOME}/operaton"
WANT_VERSION=""
MANUAL_URL=""
PORT="8282"          # 8080 = Camunda 7, 8181 = Camunda 8 Run
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
    -h|--help)     sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
done

[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "--port braucht eine Zahl, nicht '$PORT'" >&2; exit 2; }

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

TMPDIR_LOCAL="$(mktemp -d "${TMPDIR:-/tmp}/operaton-setup.XXXXXX")"
cleanup() { rm -rf "$TMPDIR_LOCAL"; }
trap cleanup EXIT

# --- 1. Vorbedingungen ------------------------------------------------------
check_java() {
  local java_bin="java"
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
    java_bin="${JAVA_HOME}/bin/java"
  fi
  command -v "$java_bin" >/dev/null 2>&1 || die \
"Kein java gefunden. Operaton 2.x braucht mindestens Java 17 (21/25 unterstuetzt).
     brew install openjdk@21"

  local raw major
  # nicht head -1: JAVA_TOOL_OPTIONS/_JAVA_OPTIONS schieben eine "Picked up ..."-Zeile davor
  raw="$("$java_bin" -version 2>&1 | grep -E '(openjdk|java|jdk) version "' | head -1 || true)"
  [[ -n "$raw" ]] || die "Java-Version nicht ermittelbar."
  major="$(printf '%s' "$raw" | sed -E 's/.*version "([0-9]+).*/\1/')"
  [[ "$major" =~ ^[0-9]+$ ]] || die "Java-Version nicht lesbar: $raw"

  if [ "$major" -lt 17 ]; then
    die "Java $major gefunden, Operaton 2.x braucht mindestens 17.
     Umschalten: export JAVA_HOME=\$(/usr/libexec/java_home -v 21)"
  fi
  log "Java $major ok ($raw)"
}

check_python() {
  command -v python3 >/dev/null 2>&1 || die \
"python3 fehlt (fuer Release-Liste und YAML noetig).
     xcode-select --install   oder   brew install python"
}

# --- 2. Release ermitteln ---------------------------------------------------
# Operaton Run ist plattformunabhaengig -> kein OS/Arch-Matching noetig.
# Gesucht wird ein Asset, dessen Name "run" enthaelt (aber nicht tomcat/
# wildfly/sources/javadoc) und auf .zip/.tar.gz endet.
fetch_releases() {
  local out="$1" page url http
  : > "$out.pages"
  for page in 1 2; do
    url="https://api.github.com/repos/operaton/operaton/releases?per_page=100&page=${page}"
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
      403) die "GitHub-API antwortet 403 (Rate-Limit?). GITHUB_TOKEN setzen oder --url nutzen." ;;
      000) die "GitHub-API nicht erreichbar. Alternativ: --url <direkte URL>." ;;
      *)   die "GitHub-API antwortet HTTP $http." ;;
    esac
    grep -q '"tag_name"' "$out.page" || break
  done
  mv "$out.pages" "$out"
}

write_parser() {
  cat > "$1" <<'PY'
import json, os, re, sys

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

want      = os.environ["WANT"].strip()
allow_pre = os.environ["PRE"] == "true"
list_only = os.environ["LIST"] == "true"

# Die Distribution heisst je nach Release "operaton-bpm-<version>.zip"
# oder (Camunda-Konvention) "...-run-...". Beides akzeptieren, Nebenartefakte
# (SQL-Skripte, Reports, REST-API-Doku, Quellen) aussortieren.
run_pat  = re.compile(r"(^|[-_.])run([-_.]|$)")
dist_pat = re.compile(r"^operaton-bpm-\d+\.\d+\.\d+")
skip_pat = re.compile(r"sql-scripts|reports|rest-api|clirr|sources|javadoc|"
                      r"tomcat|wildfly|jboss|weblogic|websphere|"
                      r"checksum|\.sha|\.asc|\.pom")

def version_key(*texts):
    """Hoechste x.y.z aus Dateiname/Tag. Die GitHub-Liste ist nach
    Datum sortiert, nicht nach Version - ein Patch-Release eines alten
    Zweigs stuende sonst vor der neueren Minor-Version."""
    for t in texts:
        m = re.search(r"(\d+)\.(\d+)\.(\d+)", t or "")
        if m:
            return tuple(int(x) for x in m.groups())
    return (0, 0, 0)

candidates, matches = [], []

for r in releases:
    tag = r.get("tag_name", "")
    if r.get("draft"):
        continue
    if r.get("prerelease") and not allow_pre:
        continue
    for a in r.get("assets", []):
        n = a["name"].lower()
        if not n.endswith((".zip", ".tar.gz", ".tgz")):
            continue
        if skip_pat.search(n):
            continue
        ver = version_key(a["name"], tag)
        candidates.append((ver, tag, a["name"]))
        if want and want not in tag and want not in a["name"]:
            continue
        # Score: explizite Run-Distribution schlaegt die generische;
        # tar.gz vor zip (kein unzip noetig, Rechte bleiben erhalten).
        score = 2 if run_pat.search(n) else (1 if dist_pat.match(n) else 0)
        if score == 0:
            continue
        fmt = 1 if n.endswith((".tar.gz", ".tgz")) else 0
        matches.append((ver, score, fmt, tag, a["name"], a["browser_download_url"]))

candidates.sort(reverse=True)
matches.sort(reverse=True)
best = matches[0][3:] if matches else None   # (tag, name, url)

if list_only:
    if not candidates:
        print("Keine passenden Assets gefunden.")
    for ver, tag, name in candidates[:60]:
        print("%s\t%s" % (tag, name))
    sys.exit(0)

if not best:
    sys.stderr.write("Keine Operaton-Run-Distribution gefunden.\n")
    if candidates:
        sys.stderr.write("Verfuegbare Archive (Auszug):\n")
        for ver, tag, name in candidates[:15]:
            sys.stderr.write("  %s  %s\n" % (tag, name))
    sys.stderr.write("Manuell pruefen: https://github.com/operaton/operaton/releases\n"
                     "und mit --url <direkte URL> erneut starten.\n")
    sys.exit(1)

print("\t".join(best))
PY
}

# --- main -------------------------------------------------------------------
check_java
check_python

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
  log "Ermittle Operaton-Run-Release ..."
  fetch_releases "$RELEASES_JSON"
  write_parser "$PARSER"

  if $DO_LIST; then
    WANT="$WANT_VERSION" PRE="$INCLUDE_PRERELEASE" LIST=true \
      python3 "$PARSER" "$RELEASES_JSON"
    exit 0
  fi

  if ! WANT="$WANT_VERSION" PRE="$INCLUDE_PRERELEASE" LIST=false \
        python3 "$PARSER" "$RELEASES_JSON" > "$RESULT"; then
    die "Release-Aufloesung fehlgeschlagen (Details oben)."
  fi

  IFS=$'\t' read -r TAG ASSET_NAME ASSET_URL < "$RESULT"
  [[ -n "$ASSET_URL" ]] || die "Leere Download-URL - Abbruch."
  log "Gefunden: $TAG -> $ASSET_NAME"
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

# Run-Verzeichnis finden. Layout des Archivs ist nicht garantiert: start.sh
# kann direkt oben liegen oder in einem Unterordner (z.B. .../run/start.sh).
# Enthaelt das Archiv mehrere, gewinnt der Pfad mit "run" darin.
RUN_DIR="$TARGET_DIR"
STARTS="$(find "$TARGET_DIR" -maxdepth 5 -name 'start.sh' -print 2>/dev/null || true)"
if [[ -n "$STARTS" ]]; then
  FOUND="$(printf '%s\n' "$STARTS" | grep -i '/run/' | head -1 || true)"
  [[ -z "$FOUND" ]] && FOUND="$(printf '%s\n' "$STARTS" | head -1)"
  RUN_DIR="$(dirname "$FOUND")"
else
  warn "Kein start.sh im Archiv gefunden. Inhalt der obersten Ebene:"
  ls -1 "$TARGET_DIR" >&2 || true
  warn "Bitte Verzeichnis pruefen - evtl. ist das die falsche Distribution."
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  xattr -dr com.apple.quarantine "$TARGET_DIR" 2>/dev/null || true
fi
chmod +x "$RUN_DIR"/*.sh 2>/dev/null || true

# --- 3. Port setzen ---------------------------------------------------------
# Operaton Run ist Spring Boot: der Port steht in configuration/*.yml.
# Wir patchen jede gefundene YAML, damit auch production.yml stimmt.
patch_port() {
  local file="$1" port="$2"
  [[ -f "${file}.orig" ]] || cp "$file" "${file}.orig"
  FILE="$file" PORT="$port" python3 - <<'PY'
import os, re

path = os.environ["FILE"]
port = os.environ["PORT"]
lines = open(path, encoding="utf-8").read().splitlines()

def top_level_block(name):
    for i, l in enumerate(lines):
        if re.match(r'^%s\s*:\s*$' % re.escape(name), l):
            return i
    return None

i = top_level_block("server")
if i is None:
    if lines and lines[-1].strip():
        lines.append("")
    lines += ["server:", "  port: %s" % port]
else:
    j, replaced = i + 1, False
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
print("  server.port = %s  ->  %s" % (port, path))
PY
}

# YAMLs unterhalb von RUN_DIR suchen (configuration/ liegt nicht garantiert
# direkt daneben) - nur *.yml/*.yaml, keine .orig-Sicherungen.
PATCHED=0
YAMLS="$(find "$RUN_DIR" -maxdepth 3 \( -name '*.yml' -o -name '*.yaml' \) \
           -not -name '*.orig' -print 2>/dev/null || true)"
if [[ -n "$YAMLS" ]]; then
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    if patch_port "$f" "$PORT"; then PATCHED=$((PATCHED + 1)); fi
  done <<< "$YAMLS"
fi

if [[ "$PATCHED" -gt 0 ]]; then
  log "Port in $PATCHED Konfigurationsdatei(en) gesetzt (Originale als *.orig gesichert)"
else
  warn "Keine *.yml unter $RUN_DIR gefunden - Port nicht in der Konfiguration gesetzt.
     Der erzeugte Starter setzt SERVER_PORT=${PORT}; ob das greift, mit lsof pruefen."
fi

# Starter, der den Port zusaetzlich per Umgebungsvariable erzwingt
cat > "$RUN_DIR/start-${PORT}.sh" <<EOF
#!/usr/bin/env bash
# erzeugt von operaton-setup.sh
cd "\$(dirname "\$0")"
export SERVER_PORT=${PORT}
exec ./start.sh "\$@"
EOF
chmod +x "$RUN_DIR/start-${PORT}.sh"

cat <<EOF

--------------------------------------------------------------------
Operaton Run installiert: $RUN_DIR

  Starten:   cd "$RUN_DIR" && ./start-${PORT}.sh
  Stoppen:   Ctrl-C bzw. ./shutdown.sh (falls vorhanden)

  Webapps:   http://localhost:${PORT}/operaton/app/cockpit/
             http://localhost:${PORT}/operaton/app/tasklist/
             http://localhost:${PORT}/operaton/app/admin/
  REST-API:  http://localhost:${PORT}/engine-rest/

  Pruefen:
    lsof -nP -iTCP:${PORT} -sTCP:LISTEN   # Operaton
    lsof -nP -iTCP:8181 -sTCP:LISTEN      # Camunda 8 Run
    lsof -nP -iTCP:8080 -sTCP:LISTEN      # Camunda 7

  Hinweis: Kontextpfade und der Admin-User beim ersten Start sind
  distributionsabhaengig - siehe README, Abschnitt "Unsicher".
--------------------------------------------------------------------
EOF

if $DO_START; then
  log "Starte Operaton Run auf Port ${PORT} ..."
  cd "$RUN_DIR" && ./start-"${PORT}".sh
fi
