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

/** Methodenaufrufe mit FEEL-Gegenstück: `a.concat(b)` → `a + b` usw. */
function method(target: string, name: string, args: string[]): string {
  const one = (fn: (a: string) => string) => { if (args.length !== 0) throw new Unsupported(`«${name}()» erwartet kein Argument`); return fn(target); };
  const two = (fn: (a: string, b: string) => string) => { if (args.length !== 1) throw new Unsupported(`«${name}()» erwartet ein Argument`); return fn(target, args[0]); };
  switch (name) {
    case 'concat': return two((a, b) => `${a} + ${b}`);
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
    case 'intValue': case 'longValue': case 'doubleValue': return one(a => `number(${a})`);
    // Spin (Camunda 7 JSON): in FEEL ist die Variable schon JSON — eine Liste
    // ist eine Liste, ein Feld ein Feld, ein Wert ein Wert
    case 'elements': case 'value': case 'stringValue': case 'numberValue': case 'boolValue': case 'listValue':
      return one(a => a);
    case 'prop': return two((a, b) => (/^"[A-Za-z_]\w*"$/.test(b) ? `${a}.${b.slice(1, -1)}` : `${a}[${b}]`));
    case 'hasProp': return two((a, b) => `${a}.${b.replace(/^"|"$/g, '')} != null`);
    case 'isNull': return one(a => `${a} = null`);
    // `execution.getVariable("x")` — in FEEL heisst die Variable einfach `x`
    case 'getVariable': return two((_a, b) => (/^"[A-Za-z_]\w*"$/.test(b) ? b.slice(1, -1) : (() => { throw new Unsupported('getVariable nur mit festem Namen'); })()));
    // Camunda-7-Laufzeit → die Variablen, die Camunda 8 dafür führt
    case 'getProcessInstanceId': return one(() => 'processInstanceKey');
    case 'getBusinessKey': return one(() => 'businessKey');
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
    case 'get': return two((a, b) => (/^"[A-Za-z_]\w*"$/.test(b) ? `${a}.${b.slice(1, -1)}` : `${a}[${b}]`));
    case 'jsonPath': return two((a, b) => `${a}.${b.replace(/^"\$?\.?|"$/g, '')}`);
    default: throw new Unsupported(`Methode «${name}()» hat kein FEEL-Gegenstück`);
  }
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
      if (isOp('empty')) { take(); const x = unary(); return `(${x} = null or ${x} = "")`; }
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
            v = `${v}.${n.v}`;
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
            if (args[0] === '"[]"') return '[]';
            if (args[0] === '"{}"') return '{}';
            return args[0];
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
          // eine Klammer um ein if/then/else ist in FEEL unnötig
          return inner.startsWith('if ') ? inner : `(${inner})`;
        }
      }
      throw new Unsupported(t.t === 'end' ? 'Ausdruck unvollständig' : `unerwartet: «${'v' in t ? t.v : ''}»`);
    };

    const feel = expr();
    if (peek().t !== 'end') throw new Unsupported(`unerwartet: «${(peek() as { v?: string }).v ?? ''}»`);
    return { ok: true, feel };
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
export function importExpression(text: string): string {
  const t = text.trim();
  if (!t) return t;
  if (t.startsWith('=')) return `= ${t.slice(1).trim()}`;
  if (!isJuel(t)) return t;
  // in Vorlagen-Teile zerlegen: fester Text und ${…}-Ausdrücke
  const parts: string[] = [];
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
    i = j + 1;
  }
  if (parts.length === 1 && parts[0].startsWith('(') && parts[0].endsWith(')')) return `= ${parts[0].slice(1, -1)}`;
  return `= ${parts.join(' + ')}`;
}
