// Read the Orchescala domain.
//
// Collects from Scala sources all types that can be used as a field type
// in a specification:
//
//  · the objects in the `schema/` folder (`case class`, `enum` at the top level)
//  · the `In` / `Out` of the services and processes
//
// The parser has to know three peculiarities of the Orchescala domain:
//
//  1. **Split package clauses.** `package globex.crm.domain` followed by
//     `package account.v1` together make up the package.
//  2. **`In` as an ADT.** `enum In: case Iban(...) case Generic(...)` — an enum
//     with parameters, not just a list of values.
//  3. **`Out` is often not in the file.** It comes from the service trait.
//     That is why every service/process object gets `In` and `Out`, even if
//     the file does not spell them out.
//
// Deliberately a line parser, not a Scala compiler: the domain is formatted the same
// throughout the company, and what the parser does not recognize reliably it rather
// leaves out than guesses.

import type { DecisionResult, DomainDefault, DomainField, DomainType } from './types';
import { CHAR_LITERAL, cleanText, descriptionExpression, exampleArgs, parseParams, skipBackticks, splitParams } from './scalaTypes.ts';

const PACKAGE = /^package\s+([\w.]+)\s*$/;
const IMPORT = /^import\s/;
const OBJECT = /^(\s*)(?:case\s+)?object\s+(\w+)\b/;
/** `object X extends CompanyBpmnUserTaskDsl` — what kind of interaction the object is */
const DSL = /extends\s+\w*Bpmn(Process|UserTask|CustomTask|SignalEvent|MessageEvent|Decision|ServiceTask|Service)\w*Dsl/;
/** `type AddressType = Int :| …` at the top level — an alias with a target */
const TYPE_TOP = /^type\s+(\w+)\s*=\s*(.+)$/;
/**
 * `val descr = "…"` or `val descr: String = "…"` of an object — also `override def descr =`,
 * `"""…""".stripMargin`, `s"…"` and with the value only on the next line
 */
const DESCR = /^\s+(?:override\s+)?(?:val|lazy val|def)\s+descr(?:\s*:\s*String)?\s*=\s*(.*)$/;
const CASE_CLASS = /^(\s*)(?:final\s+)?case\s+class\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(/;
const ENUM = /^(\s*)enum\s+(\w+)\b/;
// cases are sometimes called `QI-Deklaration` — with backticks, as required in Scala
const ENUM_CASE = /^\s*case\s+([A-Za-z]\w*|`[^`]+`)\s*(?:\(|$|,)/;
const ENUM_CASES = /^\s*case\s+((?:[A-Za-z]\w*|`[^`]+`)(?:\s*,\s*(?:[A-Za-z]\w*|`[^`]+`))*)\s*$/;
const FIELD = /^\s*(?:@\w+.*)?(?:^|\s)([a-z]\w*)\s*:\s*\S/;
const SCALADOC = /^\s*\/\*\*\s*(.*?)\s*\*\/\s*$/;
const END = /^(\s*)end\s+(\w+)/;
// How a service or process object can be recognized
const SERVICE_MARK = /^\s+(?:(?:final|override)\s+)*(?:val|lazy val|def)\s+(topicName|processName|name|messageName|decisionId)(?:\s*:\s*String)?\s*=\s*s?"?([^"\n]*)"?/;
/** A nested scope for type names: `object`, `trait`, `class`, `enum` (indented) */
const NESTED_SCOPE = /^(\s*)(?:(?:sealed|final|abstract|private|protected|case|open)\s+)*(?:object|trait|class|enum)\s+(\w+)/;
/** Without a comment at the end of the line (`type Id = String // a | b`) — outside of text */
function withoutComment(text: string): string {
  /** the open string's delimiter: `"` or `"""` */
  let open = '';
  for (let i = 0; i < text.length - 1; i++) {
    if (open) {
      if (open === '"' && text[i] === '\\') i++;
      else if (text.startsWith(open, i)) { i += open.length - 1; open = ''; }
      continue;
    }
    if (text[i] === '"') { open = text.startsWith('"""', i) ? '"""' : '"'; i += open.length - 1; }
    // a char literal (`'"'`, `'\''`) does not open a string
    else if (text[i] === "'") i += (CHAR_LITERAL.exec(text.slice(i))?.[0].length ?? 1) - 1;
    else if (text[i] === '`' && skipBackticks(text, i) > 0) i = skipBackticks(text, i) - 1;
    else if (text[i] === '/' && text[i + 1] === '/') return text.slice(0, i);
  }
  return text;
}
const TYPE_MEMBER = /^(\s+)type\s+(\w+)\s*=/;
/**
 * `lazy val example = In(` or `lazy val example: In.Standard = In.Standard(` in the
 * companion — likewise `exampleMinimal`; and `example = In.exampleMinimal.copy(`
 */
const EXAMPLE = /^\s+lazy\s+val\s+(example|exampleMinimal)\s*(?::\s*[\w.]+\s*)?=\s*([A-Za-z][\w.]*)\s*\(/;
/** The example of a DSL object: `lazy val example = userTask(` — In, Out as arguments */
const FACTORY_EXAMPLE = /^\s+lazy\s+val\s+example\s*=\s*(userTask|customTask|serviceTask|signalEvent|messageEvent|timerEvent)\s*\(/;
/** `In.exampleMinimal.copy` or `exampleMinimal.copy` — the example is a copy of the minimal one */
const COPY_OF_MINIMAL = /^(?:([A-Z][\w.]*)\.)?exampleMinimal\.copy$/;
/** `lazy val decoder: InOutDecoder[In] =` or `given InOutDecoder[In] =` — a custom decoder of the `In` */
const IN_DECODER = /^(\s*)(?:(?:lazy\s+)?val\s+\w+\s*:|given\s+(?:\w+\s*:\s*)?)\s*\w*Decoder\[(?:\w+\.)?In\]/;

/**
 * The switches of a decoder: it reads `x <- c.downField("f").as[Option[…]]`;
 * a switch is such a field on whose value the decoder chooses the case
 * (`x.map: …`, `x.fold(…)`, `x match`). A field that only co-decides
 * (`(clientType, isUpdate) match`) is not one — it does not suffice on its own.
 *
 *   maybeClientType <- c.downField("clientType").as[Option[ClientType]]
 *   maybeUseCase    <- c.downField("useCase").as[Option[PutUseCaseType]]
 *   in <- maybeClientType.map: … .getOrElse: maybeUseCase.map: …
 *
 * yields `useCase`, `clientType`: first the field the decoder sets itself
 * (`_.add("useCase", …)`) — it names the case directly —, then the others.
 * Only from two switches on is there a choice.
 */
export function decoderRouting(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/(\w+)\s*<-\s*c\.downField\(\s*"(\w+)"\s*\)\.as\[Option\[/g)) {
    const [, v, field] = m;
    if (new RegExp(String.raw`\b${v}\s*\.\s*(?:map|fold|flatMap)\b|\b${v}\s+match\b`).test(block) && !out.includes(field)) out.push(field);
  }
  const added = new Set([...block.matchAll(/\.add\(\s*"(\w+)"/g)].map(m => m[1]));
  return out.length >= 2 ? [...out.filter(f => added.has(f)), ...out.filter(f => !added.has(f))] : [];
}

/**
 * Count brackets to find the end of a parameter list. Strings
 * do not count — not even triple-quoted ones (`"""…""".stripMargin`) that span
 * several lines; `state` carries their state from line to line.
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
    // a char literal (`'"'`, `'('`) neither opens a string nor counts as a bracket
    const char = ch === "'" ? CHAR_LITERAL.exec(line.slice(i)) : null;
    if (char) { i += char[0].length - 1; continue; }
    // a name in backticks (`Brief (neu)`) — its brackets do not count
    const bt = skipBackticks(line, i);
    if (bt > 0) { i = bt - 1; continue; }
    if (ch === '/' && line[i + 1] === '/') break; // line comment
    if (ch === '(' || ch === '[') d++;
    if (ch === ')' || ch === ']') d--;
  }
  return d;
}

/**
 * Package of the file — split clauses are combined. Only the
 * `package` lines at the start of the file (before imports and everything else) are valid.
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
 * The imports of a file, one entry per imported name:
 * `import a.b.{C, D}` → `a.b.C`, `a.b.D`; `import a.b.*` → `a.b.*`.
 * Renames (`a.b.C as E`, `a.b.{C => E}`) become `a.b.C as E` — valid Scala 3 as an
 * import line; `importName` / `importedPath` split it. Exclusions (`C => _`, `C as _`) are left out.
 */
export function importsOfFile(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s*import\s+([\w.]+?)\.(\{[^}]*\}|\*|_|\w+(?:\s+as\s+\w+)?)\s*(?:\/\/.*)?$/.exec(line);
    if (!m) continue;
    const names = m[2].startsWith('{') ? m[2].slice(1, -1).split(',').map(n => n.trim()) : [m[2]];
    for (const n of names) {
      if (!n) continue;
      const rename = /^(\w+)\s*(?:=>|\bas\b)\s*(\w+)$/.exec(n);
      if (rename) {
        if (rename[2] !== '_') out.push(`${m[1]}.${rename[1]} as ${rename[2]}`);
        continue;
      }
      if (n.includes('=>')) continue;
      out.push(`${m[1]}.${n === '_' ? '*' : n}`);
    }
  }
  return [...new Set(out)];
}

export interface ScanResult {
  types: DomainType[];
  /** example values `default…` — in file order, once per package and name */
  defaults: DomainDefault[];
  /** files without a recognizable `package` — the assignment there would be guesswork */
  skipped: string[];
  /** discarded packages (see `mergeDomainTypes`) */
  discarded: DiscardedPackage[];
}

// ── Precedence of the sources ────────────────────────────────────────────────
//
// The same interface lives in several projects — `client` exists under
// `initech.core.banking.domain` and under `globex.core.banking.domain`. Keeping both
// would mean the type selection offers two objects with the same name and the
// import becomes a matter of luck.
//
// Hence: **the source read first wins**. If later a
// package with the same key comes from another project, it is discarded —
// and reported, so that the order remains a deliberate choice.

/**
 * Package without the company segment. `initech.core.banking.domain.client.v1` and
 * `globex.core.banking.domain.client.v1` yield the same key; the version
 * stays part of the key, because `client.v1` and `client.v4` are two APIs.
 */
export function packageKey(pkg: string): string {
  const parts = pkg.split('.');
  return parts.length > 1 ? parts.slice(1).join('.') : pkg;
}

export interface DiscardedPackage {
  /** the discarded package */
  pkg: string;
  /** the package that had precedence */
  insteadOf: string;
  /** how many types were dropped with it */
  count: number;
}

export interface MergeResult {
  types: DomainType[];
  discarded: DiscardedPackage[];
}

/**
 * Merge the existing catalog and new types. `prior` has precedence: packages
 * that already exist there under the same key displace the new ones.
 */
export function mergeDomainTypes(prior: DomainType[], incoming: DomainType[]): MergeResult {
  const winner = new Map<string, string>(); // key → package with precedence
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

// ── Example values ───────────────────────────────────────────────────────────
//
// The projects set `clientKey = defaultClientKey` in their examples —
// values at the top level of a package (mostly `exports.scala`):
//
//   val defaultClientKey: Long = 74854564837991L
//   lazy val defaultResponsibleUser = 57441573686194L
//
// Only the top level (without indentation): a value in an `object` would need the
// object name in front. The type is given or follows from the literal; without a type the
// value is collected but not used — better no example value than one
// that does not compile.
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

/** The example values of a Scala file (see above). */
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

/** Merge example values: the one read first wins, once per package and name. */
export function mergeDefaults(prior: DomainDefault[], incoming: DomainDefault[]): DomainDefault[] {
  const seen = new Set(prior.map(d => `${d.pkg}.${d.name}`));
  return [...prior, ...incoming.filter(d => !seen.has(`${d.pkg}.${d.name}`) && seen.add(`${d.pkg}.${d.name}`))];
}

/** The `In`/`Out` a service object always has. */
const SERVICE_MEMBERS = ['In', 'Out'] as const;

/** Read a Scala file. `path` only serves traceability. */
export function scanScala(source: string, path = ''): DomainType[] {
  const lines = source.split('\n');
  const pkg = packageOfFile(lines);
  if (!pkg) return [];
  const imports = importsOfFile(lines);

  const out: DomainType[] = [];
  const seen = new Set<string>();
  /** top-level objects that look like a service/process */
  const serviceObjects: string[] = [];
  /** `val processName = "globex-ordercard"` per object — the key
   *  by which a BPMN process can be reliably assigned to its domain. */
  const processNames = new Map<string, string>();
  /** `val topicName = "…"` per object — the same for workers */
  const topicNames = new Map<string, string>();
  /** `val name` (user task), `val messageName` (signal/message), `def decisionId` (DMN) per object */
  const keys = new Map<string, { keyName: string; key: string }>();
  /** `extends CompanyBpmn…Dsl` per object */
  const dsls = new Map<string, string>();
  /** `val descr = "…"` per object — and, if it is an expression, that expression */
  const descrs = new Map<string, string>();
  const descrExprs = new Map<string, string>();
  /** `override def processLabels` per object */
  const labels = new Map<string, { de: string; fr: string }>();
  /** decision: `lazy val example = singleResult(…)` — the shape of the result */
  const decisionResults = new Map<string, DecisionResult>();
  const exampleCopies = new Map<string, NonNullable<DomainType['exampleCopies']>>();
  /** the switches of the decoder of `In` per object (see decoderRouting) */
  const routings = new Map<string, string[]>();
  /**
   * `lazy val example = X(…)` or `exampleMinimal = X(…)` — the call, the
   * enclosing object and the arguments (raw); `example = X.exampleMinimal.copy(…)`
   * names, instead of the call, the class whose minimal example it copies
   */
  const examples: Array<{ owner: string | null; which: string; ctor?: string; minimalOf?: string; args: string }> = [];
  let owner: string | null = null;
  /** the most recently opened object — the companion in which an `exampleMinimal.copy(` appears */
  let companion: string | null = null;
  /**
   * The nested objects, classes, traits and enums the line is in
   * (`object In:` ⏎ `type X = …` → `In.X`, inside it `trait H:` ⏎ `type Y` → `In.H.Y`) — each
   * ends with the first line that is not indented deeper (`end In`, `}`, the next one)
   */
  const typeScopes: Array<{ name: string; indent: number }> = [];
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
    const lineIndent = line.search(/\S/);
    // a comment (even at the far left) does not end a scope
    const comment = /^\s*(\/\/|\/\*|\*)/.test(line);
    while (!comment && typeScopes.length && lineIndent <= typeScopes[typeScopes.length - 1].indent) typeScopes.pop();
    const scope = NESTED_SCOPE.exec(line);
    if (scope && scope[1].length > 0) typeScopes.push({ name: scope[2], indent: scope[1].length });

    const d = SCALADOC.exec(line);
    if (d) { doc = d[1]; continue; }

    const e = END.exec(line);
    if (e && owner === e[2]) { owner = null; continue; }

    const o = OBJECT.exec(line);
    if (o) {
      companion = o[2];
      // Only a top-level object carries members like `In` / `Out`.
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
      // until the text is closed: `"""` needs its counterpart, otherwise the line suffices
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
    // `override def processLabels: ProcessLabels =` — the values on the same line or one of the next lines
    if (owner && /^\s+override\s+(?:def|val|lazy\s+val)\s+processLabels\b/.test(line)) {
      const text = lines.slice(i, i + 3).join(' ');
      const pl = /ProcessLabels\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/.exec(text);
      if (pl) labels.set(owner, { de: pl[1], fr: pl[2] });
      continue;
    }
    const dr = owner ? /^\s+lazy val example\s*=\s*(singleEntry|singleResult|collectEntries|resultList)\s*\(/.exec(line) : null;
    if (owner && dr) { decisionResults.set(owner, dr[1] as DecisionResult); continue; }

    // The example of the object (`userTask(OrderCardUT.In.example.copy(a = false), Out.example)`):
    // what it sets differently compared to the example of In or Out
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

    // Example data in the companion: collect the arguments up to the closing bracket
    // — they are assigned at the end, when all classes are known
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

    // a custom decoder of the `In`: the block up to the line that is not indented deeper
    const dec = owner ? IN_DECODER.exec(line) : null;
    if (owner && dec) {
      const indent = dec[1].length;
      let j = i;
      while (j + 1 < lines.length && (!lines[j + 1].trim() || lines[j + 1].search(/\S/) > indent)) j++;
      const routing = decoderRouting(lines.slice(i, j + 1).join('\n'));
      if (routing.length) routings.set(owner, routing);
      i = j;
      continue;
    }

    const mark = owner ? SERVICE_MARK.exec(line) : null;
    if (owner && mark) {
      if (!serviceObjects.includes(owner)) serviceObjects.push(owner);
      let wert = mark[2]?.trim();
      // the value on the next line (`val topicName: String =` ⏎ `"…"`) — scalafmt wraps long lines like this
      const next = !wert && /=\s*$/.test(line) ? /^\s*s?"([^"\n]*)"\s*$/.exec(lines[i + 1] ?? '') : null;
      if (next) {
        wert = next[1].trim();
        i++;
      }
      if (wert) {
        if (mark[1] === 'processName') processNames.set(owner, wert);
        else if (mark[1] === 'topicName') topicNames.set(owner, wert);
        else keys.set(owner, { keyName: mark[1], key: wert });
      }
      continue;
    }

    // `type AddressType = Int :| …` — a top-level alias, with a target;
    // the target can span several lines (`any.In[(\n 11,\n 15 )]`)
    const tt = !owner ? TYPE_TOP.exec(line) : null;
    if (tt) {
      let target = withoutComment(tt[2]).trim();
      let depth = balance(target, 0);
      while (depth > 0 && i + 1 < lines.length) {
        i++;
        target += ' ' + lines[i].trim();
        depth = balance(lines[i], depth);
      }
      add(tt[1], 'alias', { target: target.replace(/\s+/g, ' ') });
      continue;
    }

    // `type Out = Seq[Account]` — also a usable type (with a target)
    const tm = TYPE_MEMBER.exec(line);
    if (tm && owner) {
      // in the companion object (`object In:` ⏎ `type ReceivingSystems = …`) it is called `In.ReceivingSystems`
      const path = typeScopes.map(sc => sc.name).filter(n => n !== owner);
      add([...path, tm[2]].join('.'), 'alias', { target: withoutComment(line.slice(line.indexOf('=') + 1)).trim() });
      continue;
    }

    const cc = CASE_CLASS.exec(line);
    if (cc) {
      const saved: string | null = owner;
      if (cc[1].length === 0) owner = null; // top level: not a member
      // Collect the whole parameter list and read it as Scala — so that
      // type, default and description are known, not just the name.
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
      // Values are in the `case` lines of the block — with or without
      // parameters. With parameters (`case Standard(clientKey: Long, …)`)
      // the choice is an ADT: the parameter list is read like that of a class.
      const values: string[] = [];
      const cases: Array<{ name: string; fields?: DomainField[] }> = [];
      /** `def clientKey: Long` in the body — a field shared by all cases */
      const common: DomainField[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        // without a comment at the end (`case ACTIVE // - running`) — otherwise the case is not recognized
        const l = withoutComment(lines[j]).trimEnd();
        if (!l.trim()) continue;
        if (l.search(/\S/) <= indent) break;
        const cd = /^\s*def\s+([a-z]\w*)\s*:\s*([^=]+?)\s*$/.exec(l);
        if (cd) { common.push({ name: cd[1], type: cd[2] }); continue; }
        const many = ENUM_CASES.exec(l);
        if (many) { values.push(...splitParams(many[1]).map(v => v.trim()).filter(Boolean)); continue; }
        const one = ENUM_CASE.exec(l);
        if (!one) continue;
        values.push(one[1]);
        // the bracket after the name — not one inside it (`Brief (neu)`(…))
        const head = /^\s*case\s+(?:\w+|`[^`]+`)\s*\(/.exec(l);
        if (!head) { cases.push({ name: one[1] }); continue; }
        const open = head[0].length - 1;
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

  // complete `In` and `Out` of the services — `Out` is mostly in the trait
  for (const obj of serviceObjects) {
    owner = obj;
    for (const member of SERVICE_MEMBERS) add(member, 'member');
  }
  for (const ex of examples.filter(x => x.which === 'example')) {
    if (ex.ctor) applyExample(out, ex.owner, ex.ctor, [ex.args]);
    else if (ex.minimalOf) {
      // a copy of the minimal example: its values, overwritten with those of the copy
      const min = examples.find(x => x.which === 'exampleMinimal' && x.owner === ex.owner && x.ctor === ex.minimalOf);
      if (min) applyExample(out, ex.owner, ex.minimalOf, [min.args, ex.args]);
    }
  }
  // without an own `example` (`processExample(In(), …)`) the defaults are the example data
  for (const t of out) {
    for (const fs of [t.fields, ...(t.cases ?? []).map(c => c.fields)]) {
      if (t.kind === 'enum' && fs === t.fields) continue; // `def x: T` has no default
      if (!fs?.length || fs.some(f => f.example != null)) continue;
      for (const f of fs) if (f.default && f.default !== 'None') f.example = f.default;
    }
  }
  // `In`/`Out` are often already captured as `case class` — so attach the process name
  // to all types of the object at the end, not only to new ones.
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
    const routing = routings.get(t.owner);
    if (routing && t.name === `${t.owner}.In`) t.routing = routing;
  }
  return out;
}

/**
 * Attach a `lazy val example = X(…)` to the fields of its class. `X` is
 * the class in the enclosing object (`OrderCreditcard.In`) or at the
 * top level (`CardHolder`), `In.Standard` a case of the ADT `In`. A
 * field the call does not name has its default as example — otherwise
 * the call would not compile. The first `example` per class wins.
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
    // the shared fields (`def x: T`) appear again in the case
    fields = c?.fields;
  }
  if (!fields?.length || fields.some(f => f.example != null)) return;
  // several argument lists: the later one overwrites (`exampleMinimal.copy(…)`)
  const names = fields.map(f => f.name);
  const values = new Map(args.flatMap(a => [...exampleArgs(a, names)]));
  for (const f of fields) {
    const v = values.get(f.name) ?? (f.default && f.default !== 'None' ? f.default : undefined);
    if (v) f.example = v;
  }
}

/**
 * Read several files and merge them into one catalog. The **order
 * of the files is the precedence** — it results from the order of the
 * folders read.
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
      // A spelled-out type beats the added service member
      const prev = byId.get(t.id);
      if (prev && prev.kind !== 'member') continue;
      byId.set(t.id, t);
      found.push(t);
    }
  }
  // in file order, but per id only the entry that won last
  const ordered = found.filter(t => byId.get(t.id) === t);
  const { types, discarded } = mergeDomainTypes([], ordered);
  return { types, defaults, skipped, discarded };
}

const SKIPPED_DIRS = new Set(['target', 'node_modules', 'dist', '__MACOSX']);

/** Folders every domain scan leaves out (folder, ZIP and CLI): build output and
 *  hidden folders — e.g. `.claude/worktrees/…` holds a second, older copy of the domain. */
export function isSkippedDir(name: string): boolean {
  return SKIPPED_DIRS.has(name) || name.startsWith('.');
}

/** Only domain sources — tests, target and build folders stay out. */
export function isDomainSource(path: string): boolean {
  if (!path.endsWith('.scala')) return false;
  const p = path.replace(/\\/g, '/');
  if (/\/(target|\.bloop|\.scala-build|\.bsp|\.git|node_modules)\//.test(p)) return false;
  if (/\/src\/test\//.test(p)) return false;
  return true;
}
