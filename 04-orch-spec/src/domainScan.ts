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
//  1. **Geteilte Paketangaben.** `package globex.crm.domain` gefolgt von
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

import type { DecisionResult, DomainDefault, DomainField, DomainType } from './types';
import { cleanText, descriptionExpression, exampleArgs, parseParams, splitParams } from './scalaTypes.ts';

const PACKAGE = /^package\s+([\w.]+)\s*$/;
const IMPORT = /^import\s/;
const OBJECT = /^(\s*)(?:case\s+)?object\s+(\w+)\b/;
/** `object X extends CompanyBpmnUserTaskDsl` — welche Art Interaktion das Objekt ist */
const DSL = /extends\s+\w*Bpmn(Process|UserTask|CustomTask|SignalEvent|MessageEvent|Decision|ServiceTask|Service)\w*Dsl/;
/** `type AddressType = Int :| …` auf oberster Ebene — ein Alias mit Ziel */
const TYPE_TOP = /^type\s+(\w+)\s*=\s*(.+)$/;
/**
 * `val descr = "…"` bzw. `val descr: String = "…"` eines Objekts — auch
 * `"""…""".stripMargin`, `s"…"` und mit dem Wert erst auf der nächsten Zeile
 */
const DESCR = /^\s+(?:val|lazy val|def)\s+descr(?:\s*:\s*String)?\s*=\s*(.*)$/;
const CASE_CLASS = /^(\s*)(?:final\s+)?case\s+class\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(/;
const ENUM = /^(\s*)enum\s+(\w+)\b/;
// Fälle heissen auch mal `QI-Deklaration` — mit Backticks, wie in Scala nötig
const ENUM_CASE = /^\s*case\s+([A-Za-z]\w*|`[^`]+`)\s*(?:\(|$|,)/;
const ENUM_CASES = /^\s*case\s+((?:[A-Za-z]\w*|`[^`]+`)(?:\s*,\s*(?:[A-Za-z]\w*|`[^`]+`))*)\s*$/;
const FIELD = /^\s*(?:@\w+.*)?(?:^|\s)([a-z]\w*)\s*:\s*\S/;
const SCALADOC = /^\s*\/\*\*\s*(.*?)\s*\*\/\s*$/;
const END = /^(\s*)end\s+(\w+)/;
// Woran ein Service- oder Prozess-Objekt zu erkennen ist
const SERVICE_MARK = /^\s+(?:val|lazy val|def)\s+(topicName|processName|name|messageName|decisionId)(?:\s*:\s*String)?\s*=\s*s?"?([^"\n]*)"?/;
const TYPE_MEMBER = /^(\s+)type\s+(\w+)\s*=/;
/**
 * `lazy val example = In(` bzw. `lazy val example: In.Standard = In.Standard(` im
 * Companion — ebenso `exampleMinimal`; und `example = In.exampleMinimal.copy(`
 */
const EXAMPLE = /^\s+lazy\s+val\s+(example|exampleMinimal)\s*(?::\s*[\w.]+\s*)?=\s*([A-Za-z][\w.]*)\s*\(/;
/** Das Beispiel eines Objekts der DSL: `lazy val example = userTask(` — In, Out als Argumente */
const FACTORY_EXAMPLE = /^\s+lazy\s+val\s+example\s*=\s*(userTask|customTask|serviceTask|signalEvent|messageEvent|timerEvent)\s*\(/;
/** `In.exampleMinimal.copy` bzw. `exampleMinimal.copy` — das Beispiel ist eine Kopie des minimalen */
const COPY_OF_MINIMAL = /^(?:([A-Z][\w.]*)\.)?exampleMinimal\.copy$/;

/**
 * Klammern zählen, um das Ende einer Parameterliste zu finden. Zeichenketten
 * zählen nicht — auch dreifach angeführte (`"""…""".stripMargin`), die über
 * mehrere Zeilen gehen; deren Zustand trägt `state` von Zeile zu Zeile.
 */
function balance(line: string, depth: number, state: { triple: boolean } = { triple: false }): number {
  let d = depth;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (state.triple) {
      if (line.startsWith('"""', i)) { state.triple = false; i += 2; }
      continue;
    }
    if (inString) {
      if (ch === '"' && line[i - 1] !== '\\') inString = false;
      continue;
    }
    if (line.startsWith('"""', i)) { state.triple = true; i += 2; continue; }
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

/**
 * Die Imports einer Datei, je importiertem Namen ein Eintrag:
 * `import a.b.{C, D}` → `a.b.C`, `a.b.D`; `import a.b.*` → `a.b.*`.
 * Umbenennungen (`C => E`) und Ausschlüsse (`C => _`) bleiben aussen vor.
 */
export function importsOfFile(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s*import\s+([\w.]+?)\.(\{[^}]*\}|\*|_|[\w]+)\s*(?:\/\/.*)?$/.exec(line);
    if (!m) continue;
    const names = m[2].startsWith('{') ? m[2].slice(1, -1).split(',').map(n => n.trim()) : [m[2]];
    for (const n of names) {
      if (!n || n.includes('=>')) continue;
      out.push(`${m[1]}.${n === '_' ? '*' : n}`);
    }
  }
  return [...new Set(out)];
}

export interface ScanResult {
  types: DomainType[];
  /** Beispielwerte `default…` — in Datei-Reihenfolge, je Paket und Name einmal */
  defaults: DomainDefault[];
  /** Dateien ohne erkennbares `package` — dort wäre die Zuordnung geraten */
  skipped: string[];
  /** verworfene Pakete (siehe `mergeDomainTypes`) */
  discarded: DiscardedPackage[];
}

// ── Vorrang der Quellen ──────────────────────────────────────────────────────
//
// Dieselbe Schnittstelle liegt in mehreren Projekten — `client` gibt es unter
// `initech.core.banking.domain` und unter `globex.core.banking.domain`. Beide zu führen
// hiesse, dass die Typ-Auswahl zwei gleich heissende Objekte anbietet und der
// Import zur Glückssache wird.
//
// Darum gilt: **die zuerst eingelesene Quelle gewinnt**. Kommt später ein
// Paket mit demselben Schlüssel aus einem anderen Projekt, wird es verworfen —
// und gemeldet, damit die Reihenfolge bewusst gewählt bleibt.

/**
 * Paket ohne das Firmen-Segment. `initech.core.banking.domain.client.v1` und
 * `globex.core.banking.domain.client.v1` ergeben denselben Schlüssel; die Version
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

// ── Beispielwerte ────────────────────────────────────────────────────────────
//
// Die Projekte setzen in ihren Beispielen `clientKey = defaultClientKey` —
// Werte, die auf oberster Ebene eines Pakets stehen (meist `exports.scala`):
//
//   val defaultClientKey: Long = 74854564837991L
//   lazy val defaultResponsibleUser = 57441573686194L
//
// Nur oberste Ebene (ohne Einrückung): ein Wert in einem `object` bräuchte den
// Objektnamen davor. Der Typ steht da oder folgt aus dem Literal; ohne Typ wird
// der Wert gesammelt, aber nicht verwendet — lieber kein Beispielwert als einer,
// der nicht kompiliert.
const DEFAULT_TOP = /^(?:final\s+)?(?:lazy\s+val|val|def)\s+(default[A-Z]\w*)\s*(?::\s*([^=]+?))?\s*=\s*(.*?)\s*$/;

function literalType(value: string): string | undefined {
  if (/^-?\d+L$/.test(value)) return 'Long';
  if (/^-?\d+$/.test(value)) return 'Int';
  if (/^-?\d+\.\d+$/.test(value)) return 'Double';
  if (/^"(?:[^"\\]|\\.)*"$/.test(value)) return 'String';
  if (/^(true|false)$/.test(value)) return 'Boolean';
  if (/^BigDecimal\(/.test(value)) return 'BigDecimal';
  if (/^LocalDate\.(parse|of)\(/.test(value)) return 'LocalDate';
  if (/^LocalDateTime\.(parse|of)\(/.test(value)) return 'LocalDateTime';
  if (/^Instant\.(parse|ofEpoch\w*)\(/.test(value)) return 'Instant';
  return undefined;
}

/** Die Beispielwerte einer Scala-Datei (siehe oben). */
export function scanDefaults(source: string): DomainDefault[] {
  const lines = source.split('\n');
  const pkg = packageOfFile(lines);
  if (!pkg) return [];
  const out: DomainDefault[] = [];
  for (const line of lines) {
    const m = DEFAULT_TOP.exec(line);
    if (!m) continue;
    const type = m[2]?.trim().replace(/\s+/g, ' ') || literalType(m[3]);
    out.push({ name: m[1], pkg, ...(type ? { type } : {}) });
  }
  return out;
}

/** Beispielwerte vereinen: der zuerst gelesene gewinnt, je Paket und Name einmal. */
export function mergeDefaults(prior: DomainDefault[], incoming: DomainDefault[]): DomainDefault[] {
  const seen = new Set(prior.map(d => `${d.pkg}.${d.name}`));
  return [...prior, ...incoming.filter(d => !seen.has(`${d.pkg}.${d.name}`) && seen.add(`${d.pkg}.${d.name}`))];
}

/** Die `In`/`Out`, die ein Service-Objekt immer hat. */
const SERVICE_MEMBERS = ['In', 'Out'] as const;

/** Eine Scala-Datei einlesen. `path` dient nur der Nachvollziehbarkeit. */
export function scanScala(source: string, path = ''): DomainType[] {
  const lines = source.split('\n');
  const pkg = packageOfFile(lines);
  if (!pkg) return [];
  const imports = importsOfFile(lines);

  const out: DomainType[] = [];
  const seen = new Set<string>();
  /** Objekte auf oberster Ebene, die wie ein Service/Prozess aussehen */
  const serviceObjects: string[] = [];
  /** `val processName = "globex-ordercard"` je Objekt — der Schlüssel,
   *  mit dem sich ein BPMN-Prozess seiner Domain sicher zuordnen lässt. */
  const processNames = new Map<string, string>();
  /** `val topicName = "…"` je Objekt — dasselbe für Worker */
  const topicNames = new Map<string, string>();
  /** `val name` (Benutzeraufgabe), `val messageName` (Signal/Nachricht), `def decisionId` (DMN) je Objekt */
  const keys = new Map<string, { keyName: string; key: string }>();
  /** `extends CompanyBpmn…Dsl` je Objekt */
  const dsls = new Map<string, string>();
  /** `val descr = "…"` je Objekt — und, wenn es ein Ausdruck ist, dieser */
  const descrs = new Map<string, string>();
  const descrExprs = new Map<string, string>();
  /** `override def processLabels` je Objekt */
  const labels = new Map<string, { de: string; fr: string }>();
  /** Entscheidung: `lazy val example = singleResult(…)` — die Form des Ergebnisses */
  const decisionResults = new Map<string, DecisionResult>();
  const exampleCopies = new Map<string, NonNullable<DomainType['exampleCopies']>>();
  /**
   * `lazy val example = X(…)` bzw. `exampleMinimal = X(…)` — der Aufruf, das
   * umschliessende Objekt und die Argumente (roh); `example = X.exampleMinimal.copy(…)`
   * nennt statt des Aufrufs die Klasse, deren minimales Beispiel es kopiert
   */
  const examples: Array<{ owner: string | null; which: string; ctor?: string; minimalOf?: string; args: string }> = [];
  let owner: string | null = null;
  /** das zuletzt geöffnete Objekt — der Companion, in dem ein `exampleMinimal.copy(` steht */
  let companion: string | null = null;
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
      ...(imports.length ? { imports } : {}),
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
      companion = o[2];
      // Nur ein Objekt auf oberster Ebene trägt Member wie `In` / `Out`.
      if (o[1].length === 0) {
        owner = o[2];
        const dsl = DSL.exec(line);
        if (dsl) {
          dsls.set(owner, dsl[1]);
          if (!serviceObjects.includes(owner)) serviceObjects.push(owner);
        }
      }
      doc = '';
      continue;
    }

    const de = owner ? DESCR.exec(line) : null;
    if (owner && de) {
      // bis der Text zu ist: `"""` braucht sein Gegenstück, sonst genügt die Zeile
      let raw = de[1];
      let j = i;
      const open = (t: string) => {
        const s = t.trim().replace(/^s(?=")/, '');
        return !s || (s.startsWith('"""') && s.indexOf('"""', 3) < 0);
      };
      while (open(raw) && j + 1 < lines.length && j - i < 60) { j++; raw += '\n' + lines[j]; }
      i = j;
      const text = cleanText(raw);
      if (text) descrs.set(owner, text);
      const expr = descriptionExpression(raw);
      if (expr) descrExprs.set(owner, expr);
      continue;
    }
    // `override def processLabels: ProcessLabels =` — die Werte auf derselben oder einer der nächsten Zeilen
    if (owner && /^\s+override\s+(?:def|val|lazy\s+val)\s+processLabels\b/.test(line)) {
      const text = lines.slice(i, i + 3).join(' ');
      const pl = /ProcessLabels\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/.exec(text);
      if (pl) labels.set(owner, { de: pl[1], fr: pl[2] });
      continue;
    }
    const dr = owner ? /^\s+lazy val example\s*=\s*(singleEntry|singleResult|collectEntries|resultList)\s*\(/.exec(line) : null;
    if (owner && dr) { decisionResults.set(owner, dr[1] as DecisionResult); continue; }

    // Das Beispiel des Objekts (`userTask(OrderCardUT.In.example.copy(a = false), Out.example)`):
    // was es gegenüber dem Beispiel von In bzw. Out abweichend setzt
    const fx = owner ? FACTORY_EXAMPLE.exec(line) : null;
    if (owner && fx) {
      const open = fx[0].length - 1;
      const state = { triple: false };
      let depth = balance(line.slice(open), 0, state);
      let text = line.slice(open + 1);
      let j = i;
      while (depth > 0 && j + 1 < lines.length) {
        j++;
        text += '\n' + lines[j];
        depth = balance(lines[j], depth, state);
      }
      const close = text.lastIndexOf(')');
      const copies: NonNullable<DomainType['exampleCopies']> = {};
      splitParams(close >= 0 ? text.slice(0, close) : text).forEach((arg, k) => {
        const member = k === 0 ? 'In' : k === 1 ? 'Out' : null;
        const m = member ? /^\s*[A-Z][\w.]*\.example(?:Minimal)?\.copy\(([\s\S]*)\)\s*$/.exec(arg) : null;
        if (!member || !m) return;
        const values = exampleArgs(m[1], []);
        if (values.size) copies[member] = Object.fromEntries(values);
      });
      if (copies.In || copies.Out) exampleCopies.set(owner, copies);
      i = j;
      continue;
    }

    // Beispieldaten im Companion: die Argumente bis zur schliessenden Klammer
    // einsammeln — zugeordnet wird am Ende, wenn alle Klassen bekannt sind
    const ex = EXAMPLE.exec(line);
    if (ex) {
      const open = ex[0].length - 1;
      const state = { triple: false };
      let depth = balance(line.slice(open), 0, state);
      let text = line.slice(open + 1);
      let j = i;
      while (depth > 0 && j + 1 < lines.length) {
        j++;
        text += '\n' + lines[j];
        depth = balance(lines[j], depth, state);
      }
      const close = text.lastIndexOf(')');
      const args = close >= 0 ? text.slice(0, close) : text;
      const copy = COPY_OF_MINIMAL.exec(ex[2]);
      if (copy) examples.push({ owner, which: ex[1], minimalOf: copy[1] ?? companion ?? undefined, args });
      else if (/^[A-Z]/.test(ex[2]) && !ex[2].endsWith('.copy')) examples.push({ owner, which: ex[1], ctor: ex[2], args });
      i = j;
      continue;
    }

    const mark = owner ? SERVICE_MARK.exec(line) : null;
    if (owner && mark) {
      if (!serviceObjects.includes(owner)) serviceObjects.push(owner);
      const wert = mark[2]?.trim();
      if (wert) {
        if (mark[1] === 'processName') processNames.set(owner, wert);
        else if (mark[1] === 'topicName') topicNames.set(owner, wert);
        else keys.set(owner, { keyName: mark[1], key: wert });
      }
      continue;
    }

    // `type AddressType = Int :| …` — ein Alias auf oberster Ebene, mit Ziel;
    // das Ziel kann über mehrere Zeilen gehen (`any.In[(\n 11,\n 15 )]`)
    const tt = !owner ? TYPE_TOP.exec(line) : null;
    if (tt) {
      let target = tt[2].trim();
      let depth = balance(target, 0);
      while (depth > 0 && i + 1 < lines.length) {
        i++;
        target += ' ' + lines[i].trim();
        depth = balance(lines[i], depth);
      }
      add(tt[1], 'alias', { target: target.replace(/\s+/g, ' ') });
      continue;
    }

    // `type Out = Seq[Account]` — ebenfalls ein verwendbarer Typ (mit Ziel)
    const tm = TYPE_MEMBER.exec(line);
    if (tm && owner) { add(tm[2], 'alias', { target: line.slice(line.indexOf('=') + 1).trim() }); continue; }

    const cc = CASE_CLASS.exec(line);
    if (cc) {
      const saved: string | null = owner;
      if (cc[1].length === 0) owner = null; // oberste Ebene: kein Member
      // Die ganze Parameterliste einsammeln und als Scala lesen — damit
      // stehen Typ, Vorgabe und Beschreibung fest, nicht nur der Name.
      const open = line.indexOf('(');
      const state = { triple: false };
      let depth = balance(line.slice(open), 0, state);
      let text = line.slice(open + 1);
      let j = i;
      while (depth > 0 && j + 1 < lines.length) {
        j++;
        text += '\n' + lines[j];
        depth = balance(lines[j], depth, state);
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
      // Werte stehen in den `case`-Zeilen des Blocks — mit oder ohne
      // Parameter. Mit Parametern (`case Standard(clientKey: Long, …)`) ist
      // die Auswahl ein ADT: die Parameterliste wird wie bei einer Klasse gelesen.
      const values: string[] = [];
      const cases: Array<{ name: string; fields?: DomainField[] }> = [];
      /** `def clientKey: Long` im Rumpf — ein gemeinsames Feld aller Fälle */
      const common: DomainField[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (!l.trim()) continue;
        if (l.search(/\S/) <= indent) break;
        const cd = /^\s*def\s+([a-z]\w*)\s*:\s*([^=]+?)\s*$/.exec(l);
        if (cd) { common.push({ name: cd[1], type: cd[2] }); continue; }
        const many = ENUM_CASES.exec(l);
        if (many) { values.push(...many[1].split(',').map(v => v.trim()).filter(Boolean)); continue; }
        const one = ENUM_CASE.exec(l);
        if (!one) continue;
        values.push(one[1]);
        const open = l.indexOf('(');
        if (open < 0 || !/^\s*case\s+(?:\w+|`[^`]+`)\s*\(/.test(l)) { cases.push({ name: one[1] }); continue; }
        const state = { triple: false };
        let depth = balance(l.slice(open), 0, state);
        let text = l.slice(open + 1);
        let k = j;
        while (depth > 0 && k + 1 < lines.length) {
          k++;
          text += '\n' + lines[k];
          depth = balance(lines[k], depth, state);
        }
        const close = text.lastIndexOf(')');
        const fields = parseParams(close >= 0 ? text.slice(0, close) : text);
        cases.push(fields.length ? { name: one[1], fields } : { name: one[1] });
        j = k;
      }
      add(en[2], 'enum', {
        ...(values.length ? { values } : {}),
        ...(cases.some(c => c.fields?.length) ? { cases } : {}),
        ...(common.length ? { fields: common } : {}),
      });
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
  for (const ex of examples.filter(x => x.which === 'example')) {
    if (ex.ctor) applyExample(out, ex.owner, ex.ctor, [ex.args]);
    else if (ex.minimalOf) {
      // eine Kopie des minimalen Beispiels: dessen Werte, überschrieben mit denen der Kopie
      const min = examples.find(x => x.which === 'exampleMinimal' && x.owner === ex.owner && x.ctor === ex.minimalOf);
      if (min) applyExample(out, ex.owner, ex.minimalOf, [min.args, ex.args]);
    }
  }
  // ohne eigenes `example` (`processExample(In(), …)`) sind die Vorgaben die Beispieldaten
  for (const t of out) {
    for (const fs of [t.fields, ...(t.cases ?? []).map(c => c.fields)]) {
      if (t.kind === 'enum' && fs === t.fields) continue; // `def x: T` hat keine Vorgabe
      if (!fs?.length || fs.some(f => f.example != null)) continue;
      for (const f of fs) if (f.default && f.default !== 'None') f.example = f.default;
    }
  }
  // `In`/`Out` sind oft schon als `case class` erfasst — den Prozessnamen
  // deshalb am Ende an alle Typen des Objekts hängen, nicht nur an neue.
  for (const t of out) {
    if (!t.owner) continue;
    const process = processNames.get(t.owner);
    const topic = topicNames.get(t.owner);
    if (process) t.processName = process;
    if (topic) t.topicName = topic;
    const dsl = dsls.get(t.owner);
    if (dsl) t.dsl = dsl;
    const key = keys.get(t.owner);
    if (key) { t.keyName = key.keyName; t.key = key.key; }
    const descr = descrs.get(t.owner);
    if (descr) t.ownerDescr = descr;
    const descrExpr = descrExprs.get(t.owner);
    if (descrExpr) t.ownerDescrExpr = descrExpr;
    const pl = labels.get(t.owner);
    if (pl) t.processLabels = pl;
    const dr = decisionResults.get(t.owner);
    if (dr) t.decisionResult = dr;
    const ec = exampleCopies.get(t.owner);
    if (ec) t.exampleCopies = ec;
  }
  return out;
}

/**
 * Ein `lazy val example = X(…)` an die Felder seiner Klasse hängen. `X` ist
 * die Klasse im umschliessenden Objekt (`OrderCreditcard.In`) oder auf
 * oberster Ebene (`CardHolder`), `In.Standard` ein Fall des ADT `In`. Ein
 * Feld, das der Aufruf nicht nennt, hat als Beispiel seine Vorgabe — sonst
 * kompilierte der Aufruf nicht. Das erste `example` je Klasse gilt.
 */
function applyExample(types: DomainType[], owner: string | null, ctor: string, args: string[]) {
  const byName = (name: string): DomainType | null =>
    (owner ? types.find(t => t.name === `${owner}.${name}`) : undefined) ?? types.find(t => t.name === name) ?? null;
  let fields: DomainField[] | undefined;
  const cls = byName(ctor);
  if (cls?.kind === 'case') fields = cls.fields;
  else {
    const dot = ctor.lastIndexOf('.');
    const en = dot > 0 ? byName(ctor.slice(0, dot)) : null;
    const c = en?.kind === 'enum' ? en.cases?.find(x => x.name === ctor.slice(dot + 1)) : undefined;
    // die gemeinsamen Felder (`def x: T`) stehen im Fall nochmals
    fields = c?.fields;
  }
  if (!fields?.length || fields.some(f => f.example != null)) return;
  // mehrere Argumentlisten: die spätere überschreibt (`exampleMinimal.copy(…)`)
  const names = fields.map(f => f.name);
  const values = new Map(args.flatMap(a => [...exampleArgs(a, names)]));
  for (const f of fields) {
    const v = values.get(f.name) ?? (f.default && f.default !== 'None' ? f.default : undefined);
    if (v) f.example = v;
  }
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
  let defaults: DomainDefault[] = [];
  for (const f of files) {
    defaults = mergeDefaults(defaults, scanDefaults(f.text));
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
  return { types, defaults, skipped, discarded };
}

/** Nur Domain-Quellen — Tests, Ziel- und Build-Ordner bleiben draussen. */
export function isDomainSource(path: string): boolean {
  if (!path.endsWith('.scala')) return false;
  const p = path.replace(/\\/g, '/');
  if (/\/(target|\.bloop|\.scala-build|\.bsp|\.git|node_modules)\//.test(p)) return false;
  if (/\/src\/test\//.test(p)) return false;
  return true;
}
