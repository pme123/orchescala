// JUEL → FEEL: what comes from a Camunda 7 diagram becomes on import the
// language of the specification.
//
// Counterpart of `feelJuel.ts`. A value like `${client.address.zip}` becomes
// `= client.address.zip`, `${a == b ? 'x' : 'y'}` becomes
// `= if a = b then "x" else "y"`. Mixed templates work too:
// `Hallo ${name}` becomes `= "Hallo " + name`. What has no FEEL counterpart
// (unknown methods, Java calls) stays as JUEL and is reported as such
// in the UI — better visible than silently changed.
//
// JUEL has no ready-made parser in the browser; but the grammar is small.
// A tokenizer and a recursive descent suffice:
//
//   ternary  := or ( '?' expr ':' expr )?
//   or       := and  ( ('||' | 'or')  and )*
//   and      := eq   ( ('&&' | 'and') eq )*
//   eq       := rel  ( ('==' | '!=' | 'eq' | 'ne') rel )*
//   rel      := add  ( ('<' | '>' | '<=' | '>=' | 'lt' | 'gt' | 'le' | 'ge') add )*
//   add      := mul  ( ('+' | '-') mul )*
//   mul      := unary( ('*' | '/' | 'div' | '%' | 'mod') unary )*
//   unary    := ('!' | 'not' | '-' | 'empty') unary | postfix
//   postfix  := primary ( '.' name ( '(' args ')' )? | '[' expr ']' )*
//   primary  := number | string | true | false | null | name | '(' expr ')'

import { C7_LABEL, C8_LABEL } from './engineLabels.ts';
import { feelRef, isPlainFeelName } from './feelNames.ts';

export type FeelResult = { ok: true; feel: string } | { ok: false; reason: string };

class Unsupported extends Error {}

type Tok =
  | { t: 'num'; v: string } | { t: 'str'; v: string } | { t: 'name'; v: string }
  | { t: 'op'; v: string } | { t: 'end' };

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!', '?', ':', '.', ',', '(', ')', '[', ']'];
const WORD_OPS = new Set(['and', 'or', 'not', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'div', 'mod', 'empty', 'true', 'false', 'null', 'instanceof']);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|^[0-9]+/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0] }); i += m[0].length; continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1, v = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) { v += src[j + 1]; j += 2; continue; }
        v += src[j]; j++;
      }
      if (j >= src.length) throw new Unsupported('Zeichenkette nicht geschlossen');
      out.push({ t: 'str', v }); i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      out.push(WORD_OPS.has(m[0]) ? { t: 'op', v: m[0] } : { t: 'name', v: m[0] });
      i += m[0].length; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new Unsupported(`unbekanntes Zeichen «${ch}»`);
    out.push({ t: 'op', v: op }); i += op.length;
  }
  out.push({ t: 'end' });
  return out;
}

/** A FEEL text literal — a raw line break is no valid FEEL text, so it is escaped too */
const feelString = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;

/** A JSON value as a FEEL literal: `[1, 2]`, `{a: 1, "b-c": "x"}`, `"text"`, `true`, `null` */
export function jsonToFeel(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(jsonToFeel).join(', ')}]`;
  if (typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${/^[A-Za-z_]\w*$/.test(k) ? k : feelString(k)}: ${jsonToFeel(x)}`).join(', ')}}`;
  }
  if (typeof v === 'string') return feelString(v);
  return String(v);
}

/**
 * Groovy names that are no variable FEEL could read — the script binding, Spin,
 * and the Groovy keywords: a list of them stays a script
 */
const GROOVY_ONLY = new Set([
  // the bindings of a Camunda 7 script and Spin
  'it', 'this', 'super', 'delegate', 'owner', 'execution', 'task', 'externalTask', 'caseExecution',
  'connector', 'authenticatedUserId', 'variableScope', 'S', 'JSON', 'XML',
  'abstract', 'as', 'assert', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'default',
  'do', 'else', 'enum', 'extends', 'final', 'finally', 'goto', 'implements', 'import', 'instanceof',
  'interface', 'native', 'new', 'package', 'private', 'protected', 'public', 'static', 'switch',
  'synchronized', 'throw', 'throws', 'trait', 'transient', 'try', 'var', 'void', 'volatile', 'while',
]);

// the tokens of `groovyToFeel` (Groovy and FEEL both allow letters beyond ASCII, `Gebühr`)
const IDENT = /[\p{L}_][\p{L}\p{N}_]*/uy;
// no leading zero: Groovy reads `010` as octal 8, FEEL as 10
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?![\w.])/y;
/** a path or a call after a name (`a.b`, `a()`, `a[0]`) */
const ACCESS = /\s*[.(\[]/y;

/**
 * A Groovy script that is only a literal — a list (`[fileIdLetter, docLink]`), a
 * map (`[key: x, 'b': 1]`), a variable, a text, a number, true/false/null, nested
 * as well — the same value in FEEL: the FEEL for it, otherwise null. One difference
 * remains: an unknown variable fails in Groovy (MissingPropertyException) and is
 * null in FEEL — the FEEL check reports it. Anything else
 * stays a script: a call, a path, an operator, a GString with `$`, a triple-quoted
 * text, a `\u` escape, a comment, several statements; also what would read
 * differently in FEEL — an octal number (`010`), a reserved word or a Groovy-only
 * name (`it`, `this`) as a variable, a map key given twice (Groovy keeps the last).
 *
 * A small recursive reader over the literal grammar only, with one cursor `i`:
 * a regex cannot match nested brackets, and the JUEL tokenizer here knows no
 * Groovy lists, maps or single-quoted texts.
 */
export function groovyToFeel(script: string): string | null {
  const src = script.trim().replace(/^return\s+/, '').replace(/;\s*$/, '');
  let i = 0;
  // sticky (`y`): matched at the cursor, without copying the rest of the text per token
  const at = (re: RegExp): RegExpExecArray | null => { re.lastIndex = i; return re.exec(src); };
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const ident = (): string | null => {
    const m = at(IDENT);
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  const text = (): string | null => {
    const q = src[i];
    if (q !== "'" && q !== '"') return null;
    let out = '';
    for (i++; i < src.length; i++) {
      const ch = src[i];
      if (ch === q) { i++; return out; }
      // a GString interpolates — not a literal
      if (ch === '$' && q === '"') return null;
      if (ch === '\\') {
        const next = src[++i];
        const esc: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', $: '$' };
        if (!(next in esc)) return null;
        out += esc[next];
      } else out += ch;
    }
    return null;
  };
  // deeper nesting than any mapping has: a script from a foreign BPMN, not read further
  const MAX_DEPTH = 50;
  let depth = 0;
  const value = (): string | null => {
    ws();
    const ch = src[i];
    if (ch === "'" || ch === '"') { const t = text(); return t == null ? null : feelString(t); }
    if (ch === '[') return collection();
    const num = at(NUMBER);
    if (num) { i += num[0].length; return num[0]; }
    // a variable, also true/false/null — no path or call (`a.b`, `a()`)
    const id = ident();
    if (!id || at(ACCESS)) return null;
    if (id === 'true' || id === 'false' || id === 'null') return id;
    return isPlainFeelName(id) && !GROOVY_ONLY.has(id) ? id : null;
  };
  // `[a, b]` a list, `[k: v]` a map, `[:]` the empty map
  const collection = (): string | null => {
    if (++depth > MAX_DEPTH) return null;
    i++; ws();
    if (src.startsWith(':]', i)) { i += 2; return '{}'; }
    if (src[i] === ']') { i++; return '[]'; }
    const items: string[] = [];
    const keys = new Set<string>();
    let map: boolean | null = null;
    for (;;) {
      ws();
      const start = i;
      // a key: a name or a text, followed by `:`
      const key = src[i] === "'" || src[i] === '"' ? text() : ident();
      ws();
      const isEntry = key != null && src[i] === ':';
      if (map != null && map !== isEntry) return null;
      map = isEntry;
      let v: string | null;
      if (isEntry) {
        i++;
        v = value();
        if (v == null || keys.has(key!)) return null;
        keys.add(key!);
        items.push(`${isPlainFeelName(key!) ? key : feelString(key!)}: ${v}`);
      } else {
        i = start;
        v = value();
        if (v == null) return null;
        items.push(v);
      }
      ws();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === ']') { i++; break; }
      return null;
    }
    depth--;
    return map ? `{${items.join(', ')}}` : `[${items.join(', ')}]`;
  };
  const feel = value();
  ws();
  return feel != null && i === src.length ? feel : null;
}

/**
 * The argument of `JSON('…')` / `S('…')` (as FEEL text `"[6026, 102]"`): if the
 * text is a JSON list or a JSON object, the FEEL literal for it — otherwise null.
 */
function jsonTextToFeel(feelText: string): string | null {
  if (!/^"[\s\S]*"$/.test(feelText)) return null;
  try {
    const text = JSON.parse(feelText) as string;
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' ? jsonToFeel(value) : null;
  } catch {
    return null;
  }
}
/**
 * A part of a text concatenation: FEEL only adds text to text, JUEL
 * turns everything into a string. Whatever is not a text literal therefore becomes
 * text with `string(…)` — otherwise `"a" + 1` fails in FEEL.
 */
const asText = (feel: string): string =>
  (/^"(?:[^"\\]|\\.)*"$/.test(feel) || /^string\(.*\)$/.test(feel) || (/^(?:"|string\()/.test(feel) && feel.includes(' + ')) ? feel : `string(${feel})`);

/**
 * Spin `.jsonPath("…")` → FEEL path. Reads a string literal with
 * `$` (root), `.feld`, `[n]` (Java from 0 → FEEL from 1), `[*]` and filters
 * `[?(@.code == 22 || @.code == 24)]` → `[item.code = 22 or item.code = 24]`.
 * FEEL does not know recursion (`..`) and functions this way — then it stays JUEL.
 */
function jsonPathToFeel(base: string, pathLiteral: string): string {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(pathLiteral);
  if (!m) throw new Unsupported('jsonPath nur mit festem Pfad');
  let path = m[1].replace(/\\"/g, '"');
  if (path.includes('..')) throw new Unsupported('jsonPath mit «..» hat kein FEEL-Gegenstück');
  if (path.startsWith('$')) path = path.slice(1);
  let out = base;
  let i = 0;
  while (i < path.length) {
    if (path[i] === '.') {
      const f = /^\.([A-Za-z_]\w*)/.exec(path.slice(i));
      if (!f) throw new Unsupported(`jsonPath «${m[1]}» nicht lesbar`);
      out += `.${f[1]}`; i += f[0].length; continue;
    }
    if (path.startsWith('[*]', i)) { i += 3; continue; }
    const idx = /^\[(\d+)\]/.exec(path.slice(i));
    if (idx) { out += `[${Number(idx[1]) + 1}]`; i += idx[0].length; continue; }
    if (path.startsWith('[?(', i)) {
      // up to the matching parenthesis — text in quotes does not count
      let depth = 0, j = i + 2, q: string | null = null;
      for (; j < path.length; j++) {
        const ch = path[j];
        if (q) { if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") q = ch;
        else if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) break;
      }
      if (path[j + 1] !== ']') throw new Unsupported(`jsonPath-Filter in «${m[1]}» nicht lesbar`);
      const cond = path.slice(i + 3, j)
        .replace(/'((?:[^'\\]|\\.)*)'/g, (_, x: string) => JSON.stringify(x))
        .replace(/@\./g, 'item.').replace(/(^|[^\w.])@(?![\w.])/g, '$1item')
        .replace(/\s*==\s*/g, ' = ').replace(/\s*\|\|\s*/g, ' or ').replace(/\s*&&\s*/g, ' and ')
        .replace(/!(?!=)/g, 'not ').trim();
      out += `[${cond}]`; i = j + 2; continue;
    }
    throw new Unsupported(`jsonPath «${m[1]}» nicht lesbar`);
  }
  return out;
}

/** Is the expression entirely in one pair of parentheses — `(a or b)`, not `(a) or (b)`? */
function wrapped(feel: string): boolean {
  if (!feel.startsWith('(') || !feel.endsWith(')')) return false;
  let depth = 0;
  for (const part of feel.split(/"(?:[^"\\]|\\.)*"/)) {
    for (let i = 0; i < part.length; i++) {
      if (part[i] === '(') depth++;
      else if (part[i] === ')') depth--;
    }
  }
  // the first parenthesis only closes at the end: no intermediate level of 0
  let d = 0;
  const flat = feel.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (let i = 0; i < flat.length - 1; i++) {
    if (flat[i] === '(') d++;
    else if (flat[i] === ')' && --d === 0) return false;
  }
  return depth === 0;
}

/**
 * An older import left `execution.x` as FEEL (`= execution.processInstanceId`).
 * What has a counterpart becomes FEEL; otherwise the value becomes JUEL again (with its
 * warning) — `execution` does not exist in FEEL. Anything else stays as it is.
 */
export function healExecution(expression: string): string {
  const t = expression.trim();
  if (!t.startsWith('=') || !/(?<![\w.])execution\s*\./.test(t.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) return expression;
  const body = t.slice(1).trim();
  const back = juelToFeel(body);  // `execution.x` reads the same in JUEL as in FEEL
  return back.ok ? `= ${back.feel}` : `\${${body}}`;
}

/**
 * `execution.x` — the runtime of Camunda 7. What Camunda 8 has as a variable
 * becomes FEEL (the export for Camunda 7 turns it back into `execution.…`, see
 * feelJuel.ts); everything else has no counterpart and stays JUEL.
 */
const EXECUTION: Record<string, string> = {
  // the own instance and its business key: always the context `camunda.processInstance`
  // (Camunda 8 from 8.10) — the key a number, as text like in Camunda 7
  processInstanceId: 'string(camunda.processInstance.key)',
  processBusinessKey: 'camunda.processInstance.businessId',
  businessKey: 'camunda.processInstance.businessId',
};
function executionProperty(name: string): string {
  const feel = EXECUTION[name];
  if (!feel) throw new Unsupported(`«execution.${name}» gibt es nur in ${C7_LABEL} — kein FEEL-Gegenstück`);
  return feel;
}

/**
 * `getVariable` with a computed name (`"fileLink".concat(loopCounter)`) has no counterpart:
 * FEEL cannot read a variable whose name is only known at runtime. And
 * `fileLink + string(loopCounter)` would append the number to the value, not read `fileLink3`.
 * `b` is the name already translated to FEEL; only `"name" + string(loopCounter)` gets a tailored example.
 */
function computedNameError(b: string): Unsupported {
  // only for `loopCounter`: in Camunda 8 it counts from 1, like a FEEL list — the
  // collected list (in the order of the collection) is then read with it as is
  const m = /^"([A-Za-z_]\w*)" \+ string\(loopCounter\)$/.exec(b);
  const example = m ? `${m[1]}s[loopCounter]` : 'liste[index]';
  return new Unsupported(`getVariable mit berechnetem Namen (${b}) — FEEL kennt keine Variable, deren Name erst zur Laufzeit entsteht. `
    + `Falls das eine Mehrfachausführung ist: in ${C8_LABEL} braucht es die Variable je Durchlauf nicht, «Ergebnisse sammeln» legt die Ergebnisse in eine Liste, dann z. B. «= ${example}»`);
}

/** Method calls with a FEEL counterpart: `a.concat(b)` → `a + b` etc. */
function method(target: string, name: string, args: string[]): string {
  const one = (fn: (a: string) => string) => { if (args.length !== 0) throw new Unsupported(`«${name}()» erwartet kein Argument`); return fn(target); };
  const two = (fn: (a: string, b: string) => string) => { if (args.length !== 1) throw new Unsupported(`«${name}()» erwartet ein Argument`); return fn(target, args[0]); };
  switch (name) {
    case 'concat': return two((a, b) => `${asText(a)} + ${asText(b)}`);
    case 'equals': return two((a, b) => `${a} = ${b}`);
    case 'equalsIgnoreCase': return two((a, b) => `lower case(${a}) = lower case(${b})`);
    case 'contains': return two((a, b) => `contains(${a}, ${b})`);
    case 'startsWith': return two((a, b) => `starts with(${a}, ${b})`);
    case 'endsWith': return two((a, b) => `ends with(${a}, ${b})`);
    case 'toUpperCase': return one(a => `upper case(${a})`);
    case 'toLowerCase': return one(a => `lower case(${a})`);
    case 'length': return one(a => `string length(${a})`);
    case 'size': return one(a => `count(${a})`);
    case 'isEmpty': return one(a => `count(${a}) = 0`);
    case 'toString': return args.length <= 1 ? `string(${target})` : (() => { throw new Unsupported('«toString()» mit mehr als einem Argument'); })();
    // FEEL knows only one number type — `numberValue().intValue()` already is the number
    // (`number(…)` reads a text in FEEL and would have no JUEL counterpart)
    case 'intValue': case 'longValue': case 'doubleValue': case 'floatValue': return one(a => a);
    // Spin (Camunda 7 JSON): in FEEL the variable already is JSON — a list
    // is a list, a field a field, a value a value
    case 'elements': case 'elementList': case 'value': case 'stringValue': case 'numberValue': case 'boolValue': case 'listValue':
      return one(a => a);
    // `a.prop("k", v)` sets the field and returns the node — in FEEL `context put`
    case 'prop': return args.length === 2 ? `context put(${target}, ${args[0]}, ${args[1]})`
      : two((a, b) => (/^"[A-Za-z_]\w*"$/.test(b) ? `${a}.${b.slice(1, -1)}` : `${a}[${b}]`));
    case 'hasProp': return two((a, b) => `${a}.${b.replace(/^"|"$/g, '')} != null`);
    case 'isNull': return one(a => `${a} = null`);
    // `execution.getVariable("x")` — in FEEL the variable is simply called `x`
    case 'getVariable': return two((_a, b) => {
      if (/^"[A-Za-z_]\w*"$/.test(b)) return b.slice(1, -1);
      throw computedNameError(b);
    });
    // Camunda 7 runtime → the variables Camunda 8 has for it
    case 'getProcessInstanceId': return one(() => 'string(camunda.processInstance.key)');
    case 'getBusinessKey': case 'getProcessBusinessKey': return one(() => 'camunda.processInstance.businessId');
    case 'getProcessDefinition': return one(() => '__processDefinition');
    case 'getKey': case 'getId': return one(a => (a === '__processDefinition' ? 'processDefinitionKey' : (() => { throw new Unsupported(`Methode «${name}()» hat kein FEEL-Gegenstück`); })()));
    // Time: `dateTime().now()`, `.toLocalDate()`, `.plusDays(3)`, `.toString("yyyy-MM-dd")`
    case 'now': return one(a => a);
    case 'toLocalDate': return one(a => (a === 'now()' ? 'today()' : `date(${a})`));
    case 'plusYears': case 'plusMonths': case 'plusWeeks': case 'plusDays':
    case 'minusYears': case 'minusMonths': case 'minusWeeks': case 'minusDays': {
      const unit = { Years: 'Y', Months: 'M', Weeks: 'W', Days: 'D' }[name.replace(/^(plus|minus)/, '')]!;
      const sign = name.startsWith('plus') ? '+' : '-';
      return two((a, n) => `(${a} ${sign} duration("P${n.replace(/^"|"$/g, '')}${unit}"))`);
    }
    // `.get("k")` of a map or a DMN result — a field
    case 'get': return two((a, b) => (/^"[A-Za-z_]\w*"$/.test(b) ? `${a}.${b.slice(1, -1)}`
      // `.get(0)` of a list: Java counts from 0, FEEL from 1
      : /^\d+$/.test(b) ? `${a}[${Number(b) + 1}]` : `${a}[${b} + 1]`));
    case 'jsonPath': return two((a, b) => jsonPathToFeel(a, b));
    default: throw new Unsupported(`Methode «${name}()» hat kein FEEL-Gegenstück`);
  }
}

/**
 * The test for a Spin path, as the export writes it (feelJuel.ts:
 * `a != null && a.hasProp("b") && !a.prop("b").isNull()`), arrives verbatim as
 * `a != null and a.b != null and not(a.b = null)` — what is meant is `a.b != null`.
 * A path the export guards (`(a.hasProp("b") && … ? a.prop("b").stringValue() : null)`, Spin
 * throws on a missing field) arrives as `if a.b != null then a.b else null` — in FEEL a path
 * to a missing field is null anyway: it is `a.b`. The guard belongs to the export only.
 */
function presence(feel: string): string {
  const P = String.raw`[A-Za-z_][\w.]*`;
  let prev: string;
  let f = feel;
  do {
    prev = f;
    f = f.replace(new RegExp(String.raw`(?<![\w.])(${P}) != null and not\(\1 = null\)`, 'g'), '$1 != null')
      .replace(new RegExp(String.raw`(?<![\w.])(${P}) != null and (?=\1\.[A-Za-z_][\w.]* != null)`, 'g'), '')
      .replace(new RegExp(String.raw`not\(\((${P}) != null\)\)|not\((${P}) != null\)`, 'g'), (_m, a, b) => `${a ?? b} = null`);
    f = unguard(f);
  } while (f !== prev);
  return f;
}

/**
 * `if a.b != null then a.b else null` → `a.b`: the guard the export writes around a Spin path (or
 * a variable), read back - in FEEL a missing value is null anyway. Texts stay as they are.
 */
export function unguard(feel: string): string {
  const P = String.raw`[A-Za-z_][\w.]*`;
  const guard = new RegExp(String.raw`\(if (${P}) != null then \1 else null\)|(?<![\w.])if (${P}) != null then \2 else null(?![\w.])`, 'g');
  return feel.split(/("(?:[^"\\]|\\.)*")/).map((part, i) => (i % 2 ? part : part.replace(guard, (_m, a, b) => a ?? b))).join('');
}

/** Translate the body of a JUEL expression (without `${}`) to FEEL. */
export function juelToFeel(body: string): FeelResult {
  /** the variables read with `execution.getVariable` — see `num` */
  const reads: string[] = [];
  const resolve = (x: string) => x.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => reads[Number(i)]);
  try {
    // the marker of a read (see `num`) must not come from the input
    if (body.includes('\u0001')) throw new Unsupported('Steuerzeichen U+0001 im Ausdruck');
    const toks = tokenize(body.trim());
    let p = 0;
    const peek = () => toks[p];
    const isOp = (...vs: string[]) => { const t = peek(); return t.t === 'op' && vs.includes(t.v); };
    const take = () => toks[p++];
    const expect = (v: string) => { if (!isOp(v)) throw new Unsupported(`«${v}» erwartet`); p++; };
    // `execution.getVariable("x")` may be missing: in JUEL arithmetic null counts
    // as 0 (`null + 1` is 1), in FEEL it stays null — there `(if x = null then 0 else x)`
    // (not `get or else(x, 0)`: feelin, the parser of the specification, does not know it).
    // Each such read becomes a marker (`\u0001n\u0001`) resolved at the end — so only
    // this read is wrapped, not a direct read of the same name or other equal text.
    // Only the read itself: a path from it (`getVariable("a").prop("b") + 1`) stays as it is.
    // `reads[n]` is always a plain name — a computed name (also a nested read) is rejected.
    // JUEL `+` is always a number (text is joined with `concat`), so no text operand gets the 0.
    const num = (x: string) => {
      const m = /^(?:\(\u0001(\d+)\u0001\)|\u0001(\d+)\u0001)$/.exec(x);
      const name = m ? reads[Number(m[1] ?? m[2])] : undefined;
      return name ? `(if ${name} = null then 0 else ${name})` : x;
    };
    const arith = (o: string) => (a: string, b: string) => `${num(a)} ${o} ${num(b)}`;

    const expr = (): string => {
      const c = or();
      if (isOp('?')) {
        take();
        const a = expr();
        expect(':');
        const b = expr();
        return `if ${c} then ${a} else ${b}`;
      }
      return c;
    };
    const binary = (next: () => string, ops: Record<string, string | ((a: string, b: string) => string)>): string => {
      let left = next();
      for (;;) {
        const t = peek();
        if (t.t !== 'op' || !(t.v in ops)) return left;
        take();
        const right = next();
        const o = ops[t.v];
        left = typeof o === 'string' ? `${left} ${o} ${right}` : o(left, right);
      }
    };
    const or = () => binary(and, { '||': 'or', or: 'or' });
    const and = () => binary(eq, { '&&': 'and', and: 'and' });
    const eq = () => binary(rel, { '==': '=', eq: '=', '!=': '!=', ne: '!=' });
    const rel = () => binary(add, { '<': '<', lt: '<', '>': '>', gt: '>', '<=': '<=', le: '<=', '>=': '>=', ge: '>=' });
    const add = () => binary(mul, { '+': arith('+'), '-': arith('-') });
    const modulo = (a: string, b: string) => `modulo(${num(a)}, ${num(b)})`;
    const mul = () => binary(unary, { '*': arith('*'), '/': arith('/'), div: arith('/'), '%': modulo, mod: modulo });
    const unary = (): string => {
      if (isOp('!', 'not')) { take(); return `not(${unary()})`; }
      if (isOp('-')) { take(); return `-${num(unary())}`; }
      // JUEL `empty`: null, empty text — or an empty list
      if (isOp('empty')) { take(); const x = unary(); return `(${x} = null or ${x} = "" or ${x} = [])`; }
      return postfix();
    };
    const postfix = (): string => {
      let v = primary();
      for (;;) {
        if (isOp('.')) {
          take();
          const n = take();
          if (n.t !== 'name') throw new Unsupported('Name nach «.» erwartet');
          if (isOp('(')) {
            take();
            const args: string[] = [];
            if (!isOp(')')) { args.push(expr()); while (isOp(',')) { take(); args.push(expr()); } }
            expect(')');
            v = method(v, n.v, args);
            if (n.v === 'getVariable') { reads.push(v); v = `\u0001${reads.length - 1}\u0001`; }
          } else {
            v = v === 'execution' ? executionProperty(n.v) : `${v}.${n.v}`;
          }
          continue;
        }
        if (isOp('[')) {
          take();
          const idx = peek();
          // JUEL counts from 0, FEEL from 1
          if (idx.t === 'num' && /^[0-9]+$/.test(idx.v)) { take(); expect(']'); v = `${v}[${Number(idx.v) + 1}]`; continue; }
          if (idx.t === 'str') { take(); expect(']'); v = `${v}.${idx.v}`; continue; }
          const e = expr();
          expect(']');
          v = `${v}[${e} + 1]`;
          continue;
        }
        return v;
      }
    };
    const primary = (): string => {
      const t = take();
      if (t.t === 'num') return t.v;
      if (t.t === 'str') return feelString(t.v);
      if (t.t === 'name') {
        // Function call: `S(x)` / `JSON(x)` are Spin wrappers (in FEEL
        // x already is JSON), `dateTime()` is the current point in time
        if (isOp('(')) {
          take();
          const args: string[] = [];
          if (!isOp(')')) { args.push(expr()); while (isOp(',')) { take(); args.push(expr()); } }
          expect(')');
          if ((t.v === 'S' || t.v === 'JSON') && args.length === 1) {
            // `JSON('[6026, 102]')`: the text is JSON — in FEEL the value itself (list, context)
            const literal = jsonTextToFeel(args[0]);
            return literal ?? args[0];
          }
          if (t.v === 'dateTime' && args.length === 0) return 'now()';
          throw new Unsupported(`Funktion «${t.v}()» hat kein FEEL-Gegenstück`);
        }
        return t.v;
      }
      if (t.t === 'op') {
        if (t.v === 'true' || t.v === 'false' || t.v === 'null') return t.v;
        if (t.v === '(') {
          const inner = expr();
          expect(')');
          // an if/then/else keeps its parentheses: `(a ? b : c) == x` is `(if a then b else c) = x` -
          // without, `else c = x` is the comparison (the whole expression loses them below); no second
          // pair around something that is already entirely in parentheses (`(empty x)` → `(x = null or …)`)
          return wrapped(inner) ? inner : `(${inner})`;
        }
      }
      throw new Unsupported(t.t === 'end' ? 'Ausdruck unvollständig' : `unerwartet: «${'v' in t ? t.v : ''}»`);
    };

    const feel = resolve(expr());
    if (peek().t !== 'end') throw new Unsupported(`unerwartet: «${(peek() as { v?: string }).v ?? ''}»`);
    // the whole expression needs no parentheses around its if/then/else
    const done = presence(feel);
    return { ok: true, feel: wrapped(done) && done.slice(1, -1).startsWith('if ') ? done.slice(1, -1) : done };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, reason: resolve(e.message) };
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export const isJuel = (text: string): boolean => /[$#]\{/.test(text);

/**
 * A value from the BPMN into the form of the specification:
 *
 *   `${x}` · `#{x}`          → `= x`           (JUEL translated)
 *   `Hallo ${name}`          → `= "Hallo " + name`
 *   `=x`                     → `= x`           (FEEL from Camunda 8)
 *   `fest`                   → `fest`          (fixed text stays)
 *
 * If JUEL cannot be translated, the value stays unchanged — the
 * UI then shows it as an old JUEL expression.
 */
/**
 * Conditions of a branch in Camunda 8 null-safe: `(…) = true`. In
 * Camunda 7 `null` becomes `false` (JUEL); in Camunda 8 a condition must
 * return a Boolean, otherwise there is an incident — `null = true` on the other hand
 * is simply `false`. That way both engines behave the same.
 */
const NULL_SAFE = /^\(([\s\S]*)\)\s*=\s*true$/;
/** Parentheses balanced (outside of texts)? Only then is `(…) = true` a wrapper. */
function balanced(s: string): boolean {
  let depth = 0;
  for (const part of s.split(/"(?:[^"\\]|\\.)*"/)) {
    for (const ch of part) {
      if (ch === '(') depth++;
      else if (ch === ')' && --depth < 0) return false;
    }
  }
  return depth === 0;
}
/** FEEL body of a condition → null-safe (a literal or an already wrapped one stays). */
export function nullSafeCondition(body: string): string {
  const b = body.trim();
  if (/^(true|false)$/.test(b)) return b;
  const m = NULL_SAFE.exec(b);
  if (m && balanced(m[1])) return b;
  return `(${b}) = true`;
}
/** Remove the wrapper again: `=(x > 3) = true` or `= (x > 3) = true` → `= x > 3`. Anything else stays. */
export function stripNullSafe(expression: string): string {
  const t = expression.trim();
  if (!t.startsWith('=')) return expression;
  const m = NULL_SAFE.exec(t.slice(1).trim());
  return m && balanced(m[1]) ? `= ${m[1].trim()}` : expression;
}

export function importExpression(text: string): string {
  const t = text.trim();
  if (!t) return t;
  if (t.startsWith('=')) return `= ${t.slice(1).trim()}`;
  if (!isJuel(t)) return t;
  const r = importJuel(t);
  return r.ok ? r.feel : t;
}

/** Why a JUEL value cannot be translated to FEEL — null if it can (or is no JUEL). */
export function juelImportReason(text: string): string | null {
  const t = text.trim();
  if (!t || t.startsWith('=') || !isJuel(t)) return null;
  const r = importJuel(t);
  return r.ok ? null : r.reason;
}

/**
 * Message for JUEL that cannot be translated: `«what» nicht nach FEEL übersetzbar`, the reason
 * (if known) as its own sentence, then `todo` (lower case start, e.g. `von Hand anpassen.`).
 */
export function untranslatableText(value: string, what: string, todo: string): string {
  const reason = juelImportReason(value)?.replace(/[.:;,\s]+$/, '');
  return reason
    ? `${what} nicht nach FEEL übersetzbar: ${reason}. ${todo.charAt(0).toUpperCase()}${todo.slice(1)}`
    : `${what} nicht nach FEEL übersetzbar — ${todo}`;
}

function importJuel(t: string): FeelResult {
  // split into template parts: fixed text and ${…} expressions
  const parts: string[] = [];
  /** Positions of the `${…}` parts — in a concatenation they become text */
  const tmpl: number[] = [];
  let i = 0;
  while (i < t.length) {
    const m = /[$#]\{/.exec(t.slice(i));
    if (!m) { parts.push(feelString(t.slice(i))); break; }
    const start = i + m.index;
    if (start > i) parts.push(feelString(t.slice(i, start)));
    // closing brace — strings in the expression may contain `}`
    let j = start + 2, depth = 1, quote: string | null = null;
    for (; j < t.length; j++) {
      const ch = t[j];
      if (quote) { if (ch === '\\') j++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) break;
    }
    if (j >= t.length) return { ok: false, reason: '«${» nicht geschlossen' };
    const r = juelToFeel(t.slice(start + 2, j));
    if (!r.ok) return r;
    // a compound part needs parentheses in a concatenation
    parts.push(/\s/.test(r.feel) ? `(${r.feel})` : r.feel);
    tmpl.push(parts.length - 1);
    i = j + 1;
  }
  if (parts.length === 1 && parts[0].startsWith('(') && parts[0].endsWith(')')) return { ok: true, feel: `= ${parts[0].slice(1, -1)}` };
  if (parts.length === 1) return { ok: true, feel: `= ${parts[0]}` };
  // template with fixed text: the expressions in it become text
  return { ok: true, feel: `= ${parts.map((p, k) => (tmpl.includes(k) ? asText(p.startsWith('(') && p.endsWith(')') ? p.slice(1, -1) : p) : p)).join(' + ')}` };
}

/** Translatable JUEL to FEEL — what cannot be translated stays JUEL. */
export const feelIfPossible = (text: string): string => (isJuel(text) ? importExpression(text) : text);

/**
 * The source of an output when a service is chosen: what the row already had,
 * otherwise the expression of the catalog, otherwise the field of the result of
 * the same name (as «+ aus Katalog»). An empty source is no choice — an output
 * without a source writes nothing — so it is filled as well.
 */
export const outputSource = (name: string, had: string | undefined, catalog: string | undefined): string =>
  (had?.trim() ? had : '') || feelIfPossible(catalog ?? '').trim() || `= ${feelRef(name)}`;
