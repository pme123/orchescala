// Orchescala-Domain einlesen.
//
// Sammelt aus Scala-Quellen alle Typen, die sich in einer Spezifikation als
// Feldtyp verwenden lassen:
//
//  · die Objekte im `schema/`-Ordner (`case class`, `enum` auf oberster Ebene)
//  · die `In` / `Out` der Services und Prozesse
//
// Drei Eigenheiten der Orchescala-Domain muss der Parser kennen:
//
//  1. **Geteilte Paketangaben.** `package valiant.graviton.domain` gefolgt von
//     `package account.v1` ergibt zusammen das Paket.
//  2. **`In` als ADT.** `enum In: case Iban(...) case Generic(...)` — ein enum
//     mit Parametern, nicht nur eine Werteliste.
//  3. **`Out` steht oft nicht in der Datei.** Es kommt aus dem Service-Trait.
//     Deshalb bekommt jedes Service-/Prozess-Objekt `In` und `Out`, auch wenn
//     die Datei sie nicht ausschreibt.
//
// Bewusst ein Zeilen-Parser, kein Scala-Compiler: die Domain ist im ganzen Haus
// gleich formatiert, und was der Parser nicht sicher erkennt, lässt er lieber
// weg, statt zu raten.

import type { DomainType } from './types';
import { parseParams } from './scalaTypes.ts';

const PACKAGE = /^package\s+([\w.]+)\s*$/;
const IMPORT = /^import\s/;
const OBJECT = /^(\s*)(?:case\s+)?object\s+(\w+)\b/;
const CASE_CLASS = /^(\s*)(?:final\s+)?case\s+class\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(/;
const ENUM = /^(\s*)enum\s+(\w+)\b/;
const ENUM_CASE = /^\s*case\s+([A-Za-z]\w*)\s*(?:\(|$|,)/;
const ENUM_CASES = /^\s*case\s+([A-Za-z][\w,\s]*)$/;
const FIELD = /^\s*(?:@\w+.*)?(?:^|\s)([a-z]\w*)\s*:\s*\S/;
const SCALADOC = /^\s*\/\*\*\s*(.*?)\s*\*\/\s*$/;
const END = /^(\s*)end\s+(\w+)/;
// Woran ein Service- oder Prozess-Objekt zu erkennen ist
const SERVICE_MARK = /^\s+(?:val|lazy val)\s+(topicName|processName)\s*=\s*"?([^"\n]*)"?/;
const TYPE_MEMBER = /^(\s+)type\s+(\w+)\s*=/;

/** Klammern zählen, um das Ende einer Parameterliste zu finden. */
function balance(line: string, depth: number): number {
  let d = depth;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === '"' && line[i - 1] !== '\\') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '/' && line[i + 1] === '/') break; // Zeilenkommentar
    if (ch === '(' || ch === '[') d++;
    if (ch === ')' || ch === ']') d--;
  }
  return d;
}

/**
 * Paket der Datei — geteilte Angaben werden zusammengesetzt. Gültig sind nur
 * die `package`-Zeilen am Dateianfang (vor Imports und allem anderen).
 */
export function packageOfFile(lines: string[]): string {
  const parts: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    const p = PACKAGE.exec(line);
    if (p) { parts.push(p[1]); continue; }
    if (IMPORT.test(t)) continue;
    break;
  }
  return parts.join('.');
}

export interface ScanResult {
  types: DomainType[];
  /** Dateien ohne erkennbares `package` — dort wäre die Zuordnung geraten */
  skipped: string[];
  /** verworfene Pakete (siehe `mergeDomainTypes`) */
  discarded: DiscardedPackage[];
}

// ── Vorrang der Quellen ──────────────────────────────────────────────────────
//
// Dieselbe Schnittstelle liegt in mehreren Projekten — `client` gibt es unter
// `swisscom.fil.is.domain` und unter `valiant.fil.is.domain`. Beide zu führen
// hiesse, dass die Typ-Auswahl zwei gleich heissende Objekte anbietet und der
// Import zur Glückssache wird.
//
// Darum gilt: **die zuerst eingelesene Quelle gewinnt**. Kommt später ein
// Paket mit demselben Schlüssel aus einem anderen Projekt, wird es verworfen —
// und gemeldet, damit die Reihenfolge bewusst gewählt bleibt.

/**
 * Paket ohne das Firmen-Segment. `swisscom.fil.is.domain.client.v1` und
 * `valiant.fil.is.domain.client.v1` ergeben denselben Schlüssel; die Version
 * bleibt Teil des Schlüssels, denn `client.v1` und `client.v4` sind zwei APIs.
 */
export function packageKey(pkg: string): string {
  const parts = pkg.split('.');
  return parts.length > 1 ? parts.slice(1).join('.') : pkg;
}

export interface DiscardedPackage {
  /** das verworfene Paket */
  pkg: string;
  /** das Paket, das den Vorrang hatte */
  insteadOf: string;
  /** wie viele Typen damit wegfielen */
  count: number;
}

export interface MergeResult {
  types: DomainType[];
  discarded: DiscardedPackage[];
}

/**
 * Vorhandenen Katalog und neue Typen vereinen. `prior` hat Vorrang: Pakete,
 * die dort schon unter demselben Schlüssel stehen, verdrängen die neuen.
 */
export function mergeDomainTypes(prior: DomainType[], incoming: DomainType[]): MergeResult {
  const winner = new Map<string, string>(); // Schlüssel → Paket mit Vorrang
  const byId = new Map<string, DomainType>();
  const dropped = new Map<string, DiscardedPackage>();

  const take = (t: DomainType) => {
    const key = packageKey(t.pkg);
    const held = winner.get(key);
    if (held === undefined) winner.set(key, t.pkg);
    else if (held !== t.pkg) {
      const d = dropped.get(t.pkg) ?? { pkg: t.pkg, insteadOf: held, count: 0 };
      d.count++;
      dropped.set(t.pkg, d);
      return;
    }
    byId.set(t.id, t);
  };

  for (const t of prior) take(t);
  for (const t of incoming) take(t);

  return {
    types: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    discarded: [...dropped.values()].sort((a, b) => b.count - a.count),
  };
}

/** Die `In`/`Out`, die ein Service-Objekt immer hat. */
const SERVICE_MEMBERS = ['In', 'Out'] as const;

/** Eine Scala-Datei einlesen. `path` dient nur der Nachvollziehbarkeit. */
export function scanScala(source: string, path = ''): DomainType[] {
  const lines = source.split('\n');
  const pkg = packageOfFile(lines);
  if (!pkg) return [];

  const out: DomainType[] = [];
  const seen = new Set<string>();
  /** Objekte auf oberster Ebene, die wie ein Service/Prozess aussehen */
  const serviceObjects: string[] = [];
  /** `val processName = "valiant-addresschange"` je Objekt — der Schlüssel,
   *  mit dem sich ein BPMN-Prozess seiner Domain sicher zuordnen lässt. */
  const processNames = new Map<string, string>();
  /** `val topicName = "…"` je Objekt — dasselbe für Worker */
  const topicNames = new Map<string, string>();
  let owner: string | null = null;
  let doc = '';

  const add = (name: string, kind: DomainType['kind'], extra: Partial<DomainType> = {}) => {
    const full = owner ? `${owner}.${name}` : name;
    const id = `${pkg}.${full}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name: full,
      pkg,
      kind,
      ...(owner ? { owner } : {}),
      importPath: `${pkg}.${owner ?? name}`,
      ...(doc ? { descr: doc } : {}),
      ...(path ? { source: path } : {}),
      ...extra,
    });
    doc = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const d = SCALADOC.exec(line);
    if (d) { doc = d[1]; continue; }

    const e = END.exec(line);
    if (e && owner === e[2]) { owner = null; continue; }

    const o = OBJECT.exec(line);
    if (o) {
      // Nur ein Objekt auf oberster Ebene trägt Member wie `In` / `Out`.
      if (o[1].length === 0) owner = o[2];
      doc = '';
      continue;
    }

    const mark = owner ? SERVICE_MARK.exec(line) : null;
    if (owner && mark) {
      if (!serviceObjects.includes(owner)) serviceObjects.push(owner);
      const wert = mark[2]?.trim();
      if (wert) (mark[1] === 'processName' ? processNames : topicNames).set(owner, wert);
      continue;
    }

    // `type Out = Seq[Account]` — ebenfalls ein verwendbarer Typ
    const tm = TYPE_MEMBER.exec(line);
    if (tm && owner) { add(tm[2], 'alias'); continue; }

    const cc = CASE_CLASS.exec(line);
    if (cc) {
      const saved: string | null = owner;
      if (cc[1].length === 0) owner = null; // oberste Ebene: kein Member
      // Die ganze Parameterliste einsammeln und als Scala lesen — damit
      // stehen Typ, Vorgabe und Beschreibung fest, nicht nur der Name.
      const open = line.indexOf('(');
      let depth = balance(line.slice(open), 0);
      let text = line.slice(open + 1);
      let j = i;
      while (depth > 0 && j + 1 < lines.length) {
        j++;
        text += '\n' + lines[j];
        depth = balance(lines[j], depth);
      }
      const close = text.lastIndexOf(')');
      const fields = parseParams(close >= 0 ? text.slice(0, close) : text);
      add(cc[2], 'case', fields.length ? { fields } : {});
      owner = saved;
      i = j;
      continue;
    }

    const en = ENUM.exec(line);
    if (en) {
      const indent = en[1].length;
      const saved: string | null = owner;
      if (indent === 0) owner = null;
      // Werte stehen in den `case`-Zeilen des Blocks — mit oder ohne Parameter
      const values: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (!l.trim()) continue;
        if (l.search(/\S/) <= indent) break;
        const many = ENUM_CASES.exec(l);
        if (many) { values.push(...many[1].split(',').map(v => v.trim()).filter(Boolean)); continue; }
        const one = ENUM_CASE.exec(l);
        if (one) values.push(one[1]);
      }
      add(en[2], 'enum', values.length ? { values } : {});
      owner = saved;
      continue;
    }

    doc = '';
  }

  // `In` und `Out` der Services ergänzen — `Out` steht meist im Trait
  for (const obj of serviceObjects) {
    owner = obj;
    for (const member of SERVICE_MEMBERS) add(member, 'member');
  }
  // `In`/`Out` sind oft schon als `case class` erfasst — den Prozessnamen
  // deshalb am Ende an alle Typen des Objekts hängen, nicht nur an neue.
  for (const t of out) {
    if (!t.owner) continue;
    const process = processNames.get(t.owner);
    const topic = topicNames.get(t.owner);
    if (process) t.processName = process;
    if (topic) t.topicName = topic;
  }
  return out;
}

/**
 * Mehrere Dateien einlesen und zu einem Katalog vereinen. Die **Reihenfolge
 * der Dateien ist der Vorrang** — sie ergibt sich aus der Reihenfolge der
 * eingelesenen Ordner.
 */
export function scanFiles(files: Array<{ path: string; text: string }>): ScanResult {
  const found: DomainType[] = [];
  const byId = new Map<string, DomainType>();
  const skipped: string[] = [];
  for (const f of files) {
    const types = scanScala(f.text, f.path);
    if (!types.length && !packageOfFile(f.text.split('\n'))) { skipped.push(f.path); continue; }
    for (const t of types) {
      // Ein ausgeschriebener Typ schlägt den ergänzten Service-Member
      const prev = byId.get(t.id);
      if (prev && prev.kind !== 'member') continue;
      byId.set(t.id, t);
      found.push(t);
    }
  }
  // in Datei-Reihenfolge, aber je id nur der zuletzt gewonnene Eintrag
  const ordered = found.filter(t => byId.get(t.id) === t);
  const { types, discarded } = mergeDomainTypes([], ordered);
  return { types, skipped, discarded };
}

/** Nur Domain-Quellen — Tests, Ziel- und Build-Ordner bleiben draussen. */
export function isDomainSource(path: string): boolean {
  if (!path.endsWith('.scala')) return false;
  const p = path.replace(/\\/g, '/');
  if (/\/(target|\.bloop|\.scala-build|\.bsp|\.git|node_modules)\//.test(p)) return false;
  if (/\/src\/test\//.test(p)) return false;
  return true;
}
