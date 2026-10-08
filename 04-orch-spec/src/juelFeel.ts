// JUEL → FEEL: was aus einem Camunda-7-Diagramm kommt, wird beim Import zur
// Sprache der Spezifikation.
//
// Gegenstück zu `feelJuel.ts`. Ein Wert wie `${client.address.zip}` wird zu
// `= client.address.zip`, `${a == b ? 'x' : 'y'}` zu
// `= if a = b then "x" else "y"`. Auch gemischte Vorlagen gehen:
// `Hallo ${name}` wird `= "Hallo " + name`. Was kein FEEL-Gegenstück hat
// (unbekannte Methoden, Java-Aufrufe), bleibt als JUEL stehen und wird in
// der Oberfläche als solches gemeldet — lieber sichtbar als still verändert.
//
// JUEL hat keinen fertigen Parser im Browser; die Grammatik ist aber klein.
// Ein Tokenizer und ein rekursiver Abstieg genügen:
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

import { C7_LABEL } from './engineLabels';

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

const feelString = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Ein JSON-Wert als FEEL-Literal: `[1, 2]`, `{a: 1, "b-c": "x"}`, `"text"`, `true`, `null` */
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
 * Das Argument von `JSON('…')` / `S('…')` (als FEEL-Text `"[6026, 102]"`): ist der
 * Text eine JSON-Liste oder ein JSON-Objekt, das FEEL-Literal dafür — sonst null.
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
 * Ein Teil einer Text-Verkettung: FEEL addiert nur Text mit Text, JUEL
 * macht aus allem einen String. Was kein Text-Literal ist, wird deshalb
 * mit `string(…)` zu Text — sonst scheitert `"a" + 1` in FEEL.
 */
const asText = (feel: string): string =>
  (/^"(?:[^"\\]|\\.)*"$/.test(feel) || /^string\(.*\)$/.test(feel) || (/^(?:"|string\()/.test(feel) && feel.includes(' + ')) ? feel : `string(${feel})`);

/**
 * Spin `.jsonPath("…")` → FEEL-Pfad. Gelesen wird ein String-Literal mit
 * `$` (Wurzel), `.feld`, `[n]` (Java ab 0 → FEEL ab 1), `[*]` und Filtern
 * `[?(@.code == 22 || @.code == 24)]` → `[item.code = 22 or item.code = 24]`.
 * Rekursion (`..`) und Funktionen kennt FEEL so nicht — dann bleibt es JUEL.
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
      // bis zur passenden Klammer — Text in Anführungszeichen zählt nicht
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

/** Steht der Ausdruck ganz in einem Klammerpaar — `(a or b)`, nicht `(a) or (b)`? */
function wrapped(feel: string): boolean {
  if (!feel.startsWith('(') || !feel.endsWith(')')) return false;
  let depth = 0;
  for (const part of feel.split(/"(?:[^"\\]|\\.)*"/)) {
    for (let i = 0; i < part.length; i++) {
      if (part[i] === '(') depth++;
      else if (part[i] === ')') depth--;
    }
  }
  // die erste Klammer schliesst erst am Ende: kein Zwischenstand auf 0
  let d = 0;
  const flat = feel.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (let i = 0; i < flat.length - 1; i++) {
    if (flat[i] === '(') d++;
    else if (flat[i] === ')' && --d === 0) return false;
  }
  return depth === 0;
}

/**
 * Ein älterer Import liess `execution.x` als FEEL stehen (`= execution.processInstanceId`).
 * Was ein Gegenstück hat, wird FEEL; sonst wird der Wert wieder JUEL (mit dessen
 * Warnung) — `execution` gibt es in FEEL nicht. Anderes bleibt, wie es ist.
 */
export function healExecution(expression: string): string {
  const t = expression.trim();
  if (!t.startsWith('=') || !/(?<![\w.])execution\s*\./.test(t.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) return expression;
  const body = t.slice(1).trim();
  const back = juelToFeel(body);  // `execution.x` liest sich in JUEL wie in FEEL
  return back.ok ? `= ${back.feel}` : `\${${body}}`;
}

/**
 * `execution.x` — die Laufzeit von Camunda 7. Was Camunda 8 als Variable führt,
 * wird FEEL (der Export für Camunda 7 macht daraus wieder `execution.…`, siehe
 * feelJuel.ts); alles andere hat kein Gegenstück und bleibt JUEL.
 */
const EXECUTION: Record<string, string> = {
  processInstanceId: 'processInstanceKey',
  processBusinessKey: 'businessKey',
  businessKey: 'businessKey',
};
function executionProperty(name: string): string {
  const feel = EXECUTION[name];
  if (!feel) throw new Unsupported(`«execution.${name}» gibt es nur in ${C7_LABEL} — kein FEEL-Gegenstück`);
  return feel;
}

/** Methodenaufrufe mit FEEL-Gegenstück: `a.concat(b)` → `a + b` usw. */
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
    // FEEL kennt nur einen Zahlentyp — `numberValue().intValue()` ist schon die Zahl
    // (`number(…)` liest in FEEL einen Text und hätte kein JUEL-Gegenstück)
    case 'intValue': case 'longValue': case 'doubleValue': case 'floatValue': return one(a => a);
    // Spin (Camunda 7 JSON): in FEEL ist die Variable schon JSON — eine Liste
    // ist eine Liste, ein Feld ein Feld, ein Wert ein Wert
    case 'elements': case 'elementList': case 'value': case 'stringValue': case 'numberValue': case 'boolValue': case 'listValue':
      return one(a => a);
    // `a.prop("k", v)` setzt das Feld und gibt den Knoten zurück — in FEEL `context put`
    case 'prop': return args.length === 2 ? `context put(${target}, ${args[0]}, ${args[1]})`
      : two((a, b) => (/^"[A-Za-z_]\w*"$/.test(b) ? `${a}.${b.slice(1, -1)}` : `${a}[${b}]`));
    case 'hasProp': return two((a, b) => `${a}.${b.replace(/^"|"$/g, '')} != null`);
    case 'isNull': return one(a => `${a} = null`);
    // `execution.getVariable("x")` — in FEEL heisst die Variable einfach `x`
    case 'getVariable': return two((_a, b) => (/^"[A-Za-z_]\w*"$/.test(b) ? b.slice(1, -1) : (() => { throw new Unsupported('getVariable nur mit festem Namen'); })()));
    // Camunda-7-Laufzeit → die Variablen, die Camunda 8 dafür führt
    case 'getProcessInstanceId': return one(() => 'processInstanceKey');
    case 'getBusinessKey': case 'getProcessBusinessKey': return one(() => 'businessKey');
    case 'getProcessDefinition': return one(() => '__processDefinition');
    case 'getKey': case 'getId': return one(a => (a === '__processDefinition' ? 'processDefinitionKey' : (() => { throw new Unsupported(`Methode «${name}()» hat kein FEEL-Gegenstück`); })()));
    // Zeit: `dateTime().now()`, `.toLocalDate()`, `.plusDays(3)`, `.toString("yyyy-MM-dd")`
    case 'now': return one(a => a);
    case 'toLocalDate': return one(a => (a === 'now()' ? 'today()' : `date(${a})`));
    case 'plusYears': case 'plusMonths': case 'plusWeeks': case 'plusDays':
    case 'minusYears': case 'minusMonths': case 'minusWeeks': case 'minusDays': {
      const unit = { Years: 'Y', Months: 'M', Weeks: 'W', Days: 'D' }[name.replace(/^(plus|minus)/, '')]!;
      const sign = name.startsWith('plus') ? '+' : '-';
      return two((a, n) => `(${a} ${sign} duration("P${n.replace(/^"|"$/g, '')}${unit}"))`);
    }
    // `.get("k")` einer Map bzw. eines DMN-Ergebnisses — ein Feld
    case 'get': return two((a, b) => (/^"[A-Za-z_]\w*"$/.test(b) ? `${a}.${b.slice(1, -1)}`
      // `.get(0)` einer Liste: Java zählt ab 0, FEEL ab 1
      : /^\d+$/.test(b) ? `${a}[${Number(b) + 1}]` : `${a}[${b} + 1]`));
    case 'jsonPath': return two((a, b) => jsonPathToFeel(a, b));
    default: throw new Unsupported(`Methode «${name}()» hat kein FEEL-Gegenstück`);
  }
}

/**
 * Der Test auf einen Spin-Pfad, wie ihn der Export schreibt (feelJuel.ts:
 * `a != null && a.hasProp("b") && !a.prop("b").isNull()`), kommt wörtlich als
 * `a != null and a.b != null and not(a.b = null)` an — gemeint ist `a.b != null`.
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
  } while (f !== prev);
  return f;
}

/** Den Rumpf eines JUEL-Ausdrucks (ohne `${}`) nach FEEL übersetzen. */
export function juelToFeel(body: string): FeelResult {
  try {
    const toks = tokenize(body.trim());
    let p = 0;
    const peek = () => toks[p];
    const isOp = (...vs: string[]) => { const t = peek(); return t.t === 'op' && vs.includes(t.v); };
    const take = () => toks[p++];
    const expect = (v: string) => { if (!isOp(v)) throw new Unsupported(`«${v}» erwartet`); p++; };

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
    const add = () => binary(mul, { '+': '+', '-': '-' });
    const mul = () => binary(unary, { '*': '*', '/': '/', div: '/', '%': (a, b) => `modulo(${a}, ${b})`, mod: (a, b) => `modulo(${a}, ${b})` });
    const unary = (): string => {
      if (isOp('!', 'not')) { take(); return `not(${unary()})`; }
      if (isOp('-')) { take(); return `-${unary()}`; }
      // JUEL `empty`: null, leerer Text — oder eine leere Liste
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
          } else {
            v = v === 'execution' ? executionProperty(n.v) : `${v}.${n.v}`;
          }
          continue;
        }
        if (isOp('[')) {
          take();
          const idx = peek();
          // JUEL zählt ab 0, FEEL ab 1
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
        // Aufruf einer Funktion: `S(x)` / `JSON(x)` sind Spin-Hüllen (in FEEL
        // ist x schon JSON), `dateTime()` ist der Zeitpunkt jetzt
        if (isOp('(')) {
          take();
          const args: string[] = [];
          if (!isOp(')')) { args.push(expr()); while (isOp(',')) { take(); args.push(expr()); } }
          expect(')');
          if ((t.v === 'S' || t.v === 'JSON') && args.length === 1) {
            // `JSON('[6026, 102]')`: der Text ist JSON — in FEEL der Wert selbst (Liste, Kontext)
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
          // eine Klammer um ein if/then/else ist in FEEL unnötig — und eine zweite um
          // etwas, das schon ganz in Klammern steht (`(empty x)` → `(x = null or …)`)
          return inner.startsWith('if ') || wrapped(inner) ? inner : `(${inner})`;
        }
      }
      throw new Unsupported(t.t === 'end' ? 'Ausdruck unvollständig' : `unerwartet: «${'v' in t ? t.v : ''}»`);
    };

    const feel = expr();
    if (peek().t !== 'end') throw new Unsupported(`unerwartet: «${(peek() as { v?: string }).v ?? ''}»`);
    return { ok: true, feel: presence(feel) };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, reason: e.message };
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export const isJuel = (text: string): boolean => /[$#]\{/.test(text);

/**
 * Ein Wert aus dem BPMN in die Form der Spezifikation:
 *
 *   `${x}` · `#{x}`          → `= x`           (JUEL übersetzt)
 *   `Hallo ${name}`          → `= "Hallo " + name`
 *   `=x`                     → `= x`           (FEEL aus Camunda 8)
 *   `fest`                   → `fest`          (fester Text bleibt)
 *
 * Lässt sich JUEL nicht übersetzen, bleibt der Wert unverändert — die
 * Oberfläche zeigt ihn dann als alten JUEL-Ausdruck an.
 */
/**
 * Bedingungen eines Zweigs in Camunda 8 null-sicher: `(…) = true`. In
 * Camunda 7 wird `null` zu `false` (JUEL); in Camunda 8 muss eine Bedingung
 * einen Boolean liefern, sonst gibt es einen Incident — `null = true` ist
 * dagegen schlicht `false`. So verhalten sich beide Engines gleich.
 */
const NULL_SAFE = /^\(([\s\S]*)\)\s*=\s*true$/;
/** Klammern ausgeglichen (ausserhalb von Texten)? Nur dann ist `(…) = true` eine Hülle. */
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
/** FEEL-Rumpf einer Bedingung → null-sicher (ein Literal oder schon gehüllt bleibt). */
export function nullSafeCondition(body: string): string {
  const b = body.trim();
  if (/^(true|false)$/.test(b)) return b;
  const m = NULL_SAFE.exec(b);
  if (m && balanced(m[1])) return b;
  return `(${b}) = true`;
}
/** Die Hülle wieder ab: `=(x > 3) = true` bzw. `= (x > 3) = true` → `= x > 3`. Anderes bleibt. */
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
  // in Vorlagen-Teile zerlegen: fester Text und ${…}-Ausdrücke
  const parts: string[] = [];
  /** Positionen der `${…}`-Teile — in einer Verkettung werden sie zu Text */
  const tmpl: number[] = [];
  let i = 0;
  while (i < t.length) {
    const m = /[$#]\{/.exec(t.slice(i));
    if (!m) { parts.push(feelString(t.slice(i))); break; }
    const start = i + m.index;
    if (start > i) parts.push(feelString(t.slice(i, start)));
    // schliessende Klammer — Zeichenketten im Ausdruck können `}` enthalten
    let j = start + 2, depth = 1, quote: string | null = null;
    for (; j < t.length; j++) {
      const ch = t[j];
      if (quote) { if (ch === '\\') j++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) break;
    }
    if (j >= t.length) return t; // nicht geschlossen — so lassen
    const r = juelToFeel(t.slice(start + 2, j));
    if (!r.ok) return t;
    // ein zusammengesetzter Teil braucht in einer Verkettung Klammern
    parts.push(/\s/.test(r.feel) ? `(${r.feel})` : r.feel);
    tmpl.push(parts.length - 1);
    i = j + 1;
  }
  if (parts.length === 1 && parts[0].startsWith('(') && parts[0].endsWith(')')) return `= ${parts[0].slice(1, -1)}`;
  if (parts.length === 1) return `= ${parts[0]}`;
  // Vorlage mit festem Text: die Ausdrücke darin werden zu Text
  return `= ${parts.map((p, k) => (tmpl.includes(k) ? asText(p.startsWith('(') && p.endsWith(')') ? p.slice(1, -1) : p) : p)).join(' + ')}`;
}

/** Übersetzbares JUEL nach FEEL — was sich nicht übersetzen lässt, bleibt JUEL. */
export const feelIfPossible = (text: string): string => (isJuel(text) ? importExpression(text) : text);
