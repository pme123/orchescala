// FEEL → JUEL: the specification speaks FEEL, Camunda 7 speaks JUEL.
//
// In the specification, mapping values and conditions are FEEL
// (`= client.address.zip`), independent of the engine. On export the app
// translates them into what the engine understands: Camunda 8 takes FEEL as it
// is; for Camunda 7 it becomes JUEL (`${client.address.zip}`).
//
// The translation is **structural** via the parse tree of feelin (lezer-feel),
// not by text replacement — otherwise `a = b` inside a string would become
// a `==`. The subset that has a JUEL counterpart:
//
//   Paths            client.address.zip      → client.prop("address").prop("zip").stringValue()
//   Literals         "x" · 1 · true · null   → same
//   Arithmetic       + - * /                 → same  (text + text → concat)
//   Comparisons      = != < > <= >=          → == != < > <= >=
//   between / in     a between 1 and 3       → (a >= 1 && a <= 3)
//   Logic            and · or · not(x)       → && · || · !(x)
//   Condition        if c then a else b      → (c ? a : b)
//   List index       items[1]                → items[0]  (FEEL counts from 1)
//   Filter           items[item.x = 1]       → S(items).jsonPath("$[?(@.x == 1)]").elementList()
//   Count            count(x)                → x.size()
//   empty list       x = []                  → empty x
//   set field        context put(x, "k", 1)  → x.prop("k", 1)
//
// A variable that may be missing is read by Camunda 7 with `execution.getVariable("x")`
// — `${x}` throws «Unknown property» if `x` is not set. This applies to
// every variable that is compared with `null` or checked for empty
// (`x != null`, `empty x`), and to every one that is optional according to the data model
// (`JuelOptions.optional`).
//
// A path reads JSON in Camunda 7: Orchescala stores objects as Spin JSON.
// So `prop("…")` per step and at the end the value according to the type of the field
// (`stringValue()`, `numberValue()`, `boolValue()`; a list for `count` and
// index as `elementList()`) — as written by hand in the project. Without a
// known type the value stays the JSON node, in a comparison `value()`.
// `a.b != null` checks every step (`hasProp`, `isNull`) — `prop` throws
// otherwise. The result of a DMN decision is not JSON but a Map or
// List (`JuelOptions.plainRoots`): there `a.b` stays.
//
// Everything else — other functions, contexts, date values, for/some/every —
// has no JUEL counterpart; the translation reports that instead of guessing.

import { parseExpression, SyntaxError as FeelSyntaxError } from 'feelin';
import type { SyntaxNode } from '@lezer/common';
import type { EngineId } from './types';
import type { FeelType, VarNode } from './feel';

export type JuelResult =
  | { ok: true; juel: string; /** bare variable path without `${}` — for `camunda:in source` */ plain?: string }
  | { ok: false; reason: string };

/** Body of a FEEL value: `= a + 1` → `a + 1`; null if it is not FEEL. */
export function feelBody(expression: string): string | null {
  const t = expression.trim();
  return t.startsWith('=') ? t.slice(1).trim() : null;
}

class Unsupported extends Error {}

/** Variables of Camunda 8 that Camunda 7 has on the execution — counterpart to the import (juelFeel.ts) */
const EXECUTION_JUEL: Record<string, string> = {
  processInstanceId: 'execution.processInstanceId',
  businessKey: 'execution.processBusinessKey',
  processDefinitionKey: 'execution.getProcessDefinition().getKey()',
};

const children = (n: SyntaxNode): SyntaxNode[] => {
  const out: SyntaxNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
};

export interface JuelOptions {
  /** Process variables that may be missing (optional in the data model) — `execution.getVariable("x")` */
  optional?: ReadonlySet<string>;
  /** the variables with their fields — determine how a Spin path ends (`stringValue()` …) */
  vars?: readonly VarNode[];
  /** Variables that are not JSON in Camunda 7 (result of a DMN decision) — their paths stay `a.b` */
  plainRoots?: ReadonlySet<string>;
}

/** How a Spin path ends, depending on the type of the field */
const SPIN_VALUE: Partial<Record<FeelType, string>> = {
  string: 'stringValue()', date: 'stringValue()', 'date time': 'stringValue()', time: 'stringValue()', duration: 'stringValue()',
  number: 'numberValue()', boolean: 'boolValue()',
};
/** What a value is used for: as a result, in a comparison or a calculation, as a list, in a test for empty */
type Use = 'value' | 'scalar' | 'list' | 'empty';

/** Translate a FEEL body to JUEL (without `${}`). */
export function feelToJuel(body: string, opts: JuelOptions = {}): JuelResult {
  const src = body.trim();
  if (!src) return { ok: false, reason: 'leerer Ausdruck' };
  let top: SyntaxNode;
  try {
    top = parseExpression(src, {}, 'expression').topNode;
  } catch (e) {
    return { ok: false, reason: e instanceof FeelSyntaxError ? 'kein gültiges FEEL' : String(e) };
  }
  const text = (n: SyntaxNode) => src.slice(n.from, n.to);
  /** out: the bare path (`plain`, for `camunda:in source`) — without `execution.getVariable` */
  let wrap = true;
  const getVariable = (name: string) => `execution.getVariable("${name}")`;
  /**
   * A variable that may be missing here: compared with `null` or checked
   * for empty. For a path (`a.b`) its start — `null.b` is null in JUEL.
   */
  const unsetSafe = (n: SyntaxNode): string => {
    if (n.name === 'PathExpression') {
      const [base, , prop] = children(n).filter(k => !k.type.isError);
      if (base && prop) return spin(n) ? `${unsetSafe(base)}.prop("${text(prop)}")` : `${unsetSafe(base)}.${text(prop)}`;
    }
    const name = n.name === 'VariableName' ? text(n) : '';
    return name && wrap && !EXECUTION_JUEL[name] && name !== 'item' && /^[A-Za-z_]\w*$/.test(name) ? getVariable(name) : tr(n);
  };

  /** the variable at the start of a path (`a` in `a.b[1].c`) */
  const rootOf = (n: SyntaxNode): SyntaxNode | null => {
    if (n.name === 'VariableName') return n;
    const [base, , index] = children(n).filter(k => !k.type.isError);
    if (n.name === 'PathExpression' && base) return rootOf(base);
    if (n.name === 'FilterExpression' && base && index?.name === 'NumericLiteral') return rootOf(base);
    return null;
  };
  /** a path in JSON (Spin) — not on the execution and not in the result of a DMN decision */
  const spin = (n: SyntaxNode): boolean => {
    if (n.name !== 'PathExpression') return false;
    const root = rootOf(n);
    const name = root ? text(root) : '';
    return !!root && !EXECUTION_JUEL[name] && !opts.plainRoots?.has(name);
  };
  /** the node in the variable tree — for the type at the end of a path */
  const varOf = (n: SyntaxNode): VarNode | null => {
    const [base, , prop] = children(n).filter(k => !k.type.isError);
    if (n.name === 'VariableName') return opts.vars?.find(v => v.name === text(n)) ?? null;
    if (n.name === 'PathExpression' && base && prop) return varOf(base)?.children?.find(c => c.name === text(prop)) ?? null;
    if (n.name === 'FilterExpression' && base) {
      const list = varOf(base);
      return list?.type === 'list' ? { ...list, type: list.children?.length ? 'context' : 'any' } : null;
    }
    return null;
  };
  /** the end of a Spin path: the value as `use` needs it */
  const ending = (n: SyntaxNode, chain: string, use: Use): string => {
    if (!spin(n)) return chain;
    const type = varOf(n)?.type ?? 'any';
    if (use === 'list') return `${chain}.elementList()`;
    if (use === 'empty') return type === 'string' ? `${chain}.stringValue()` : type === 'list' ? `${chain}.elementList()` : chain;
    const value = SPIN_VALUE[type];
    if (value) return `${chain}.${value}`;
    return use === 'scalar' && type !== 'list' && type !== 'context' ? `${chain}.value()` : chain;
  };
  /**
   * What a Spin path must check before it reads: per optional step (according to the
   * data model) `hasProp` and `isNull` — `prop` throws «Unable to find …» otherwise;
   * an optional variable at the start with `!= null`. Empty if nothing may be missing.
   */
  const guards = (n: SyntaxNode): string[] => {
    if (n.name === 'VariableName') {
      const name = text(n);
      return varOf(n)?.optional || opts.optional?.has(name) ? [`${unsetSafe(n)} != null`] : [];
    }
    if (n.name !== 'PathExpression' || !spin(n)) return [];
    const [base, , prop] = children(n).filter(k => !k.type.isError);
    if (!base || !prop || (base.name !== 'VariableName' && base.name !== 'PathExpression')) return [];
    const before = guards(base);
    if (!varOf(n)?.optional) return before;
    const b = tr(base), p = JSON.stringify(text(prop));
    return [...before, `${b}.hasProp(${p})`, `!${b}.prop(${p}).isNull()`];
  };
  const val = (n: SyntaxNode, use: Use): string => {
    const v = ending(n, tr(n), use);
    if ((use !== 'value' && use !== 'scalar') || n.name !== 'PathExpression' || !spin(n)) return v;
    const g = guards(n);
    return g.length ? `(${g.join(' && ')} ? ${v} : null)` : v;
  };
  /** is the value set? For a Spin path every step — `prop` throws if the field is missing */
  const present = (n: SyntaxNode): string => {
    if (spin(n)) {
      const [base, , prop] = children(n).filter(k => !k.type.isError);
      const b = unsetSafe(base), p = JSON.stringify(text(prop));
      return `${present(base)} && ${b}.hasProp(${p}) && !${b}.prop(${p}).isNull()`;
    }
    return `${unsetSafe(n)} != null`;
  };

  /**
   * A list or a context of fixed values only, as JSON text
   * (`[6026, 102]`, `{"a": 1}`) — null as soon as something in it is not a literal.
   */
  const constantJson = (n: SyntaxNode): string | null => {
    const kids = children(n).filter(k => !k.type.isError);
    switch (n.name) {
      case 'List': {
        const items = kids.filter(k => k.name !== '[' && k.name !== ']').map(constantJson);
        return items.some(x => x == null) ? null : `[${items.join(', ')}]`;
      }
      case 'Context': {
        const parts: string[] = [];
        for (const e of kids.filter(k => k.name === 'ContextEntry')) {
          const [key, value] = children(e).filter(k => !k.type.isError);
          if (!key || !value) return null;
          const name = children(key)[0];
          const k = name?.name === 'StringLiteral' ? JSON.parse(text(name)) as string : text(key).trim();
          const v = constantJson(value);
          if (v == null) return null;
          parts.push(`${JSON.stringify(k)}: ${v}`);
        }
        return `{${parts.join(', ')}}`;
      }
      case 'StringLiteral': return JSON.stringify(JSON.parse(text(n)) as string);
      case 'NumericLiteral': case 'BooleanLiteral': case 'null': return text(n);
      case 'ArithmeticExpression': {
        // a negative number (`-5`) is a calculation here
        const t = text(n).replace(/\s+/g, '');
        return /^-\d+(\.\d+)?$/.test(t) ? t : null;
      }
      default: return null;
    }
  };

  /** `string(x)` → the expression inside, otherwise null */
  const stringCall = (n: SyntaxNode): SyntaxNode | null => {
    if (n.name !== 'FunctionInvocation') return null;
    const [fn, , params] = children(n).filter(k => !k.type.isError);
    const args = params ? children(params) : [];
    return fn && text(fn) === 'string' && args.length === 1 ? args[0] : null;
  };
  /** does the node yield text? Literal, `string(…)` or a concatenation of these */
  const stringy = (n: SyntaxNode): boolean => {
    if (n.name === 'StringLiteral' || stringCall(n)) return true;
    if (n.name === 'ParenthesizedExpression') { const inner = children(n).find(k => k.name !== '(' && k.name !== ')'); return !!inner && stringy(inner); }
    if (n.name !== 'ArithmeticExpression') return false;
    const [a, op, b] = children(n).filter(k => !k.type.isError);
    return !!a && !!op && !!b && text(op) === '+' && (stringy(a) || stringy(b));
  };
  /**
   * The condition of a filter (`item.code = 22 or …`) as a JSONPath filter
   * (`@.code == 22 || …`) — this is how Spin reads a JSON list in Camunda 7.
   */
  const jpCond = (n: SyntaxNode): string => {
    const kids = children(n).filter(k => !k.type.isError);
    const operand = (x: SyntaxNode): string => {
      if (x.name === 'VariableName' && text(x) === 'item') return '@';
      if (x.name === 'PathExpression') return `${operand(kids0(x))}.${text(children(x).filter(k => !k.type.isError)[2] ?? x)}`;
      if (x.name === 'StringLiteral') return `'${JSON.parse(text(x)).replace(/'/g, "\\'")}'`;
      if (x.name === 'NumericLiteral' || x.name === 'BooleanLiteral' || x.name === 'null') return text(x);
      throw new Unsupported(`im Filter nur «item.feld» und feste Werte — nicht «${text(x)}»`);
    };
    switch (n.name) {
      case 'ParenthesizedExpression': { const inner = kids.find(k => k.name !== '(' && k.name !== ')'); if (!inner) throw new Unsupported('leere Klammer'); return `(${jpCond(inner)})`; }
      case 'Conjunction': case 'Disjunction': return kids.filter(k => k.name !== 'and' && k.name !== 'or').map(jpCond).join(n.name === 'Conjunction' ? ' && ' : ' || ');
      case 'Comparison': {
        const [a, op, b] = kids;
        if (!a || !op || !b || op.name !== 'CompareOp') throw new Unsupported('im Filter nur einfache Vergleiche');
        const o = text(op);
        return `${operand(a)} ${o === '=' ? '==' : o} ${operand(b)}`;
      }
      case 'FunctionInvocation': {
        const [fn, , params] = kids;
        const args = params ? children(params) : [];
        if (fn && text(fn) === 'not' && args.length === 1) return `!(${jpCond(args[0])})`;
        break;
      }
    }
    throw new Unsupported(`Filter «${text(n)}» hat kein JSONPath-Gegenstück`);
  };
  const kids0 = (x: SyntaxNode): SyntaxNode => children(x).filter(k => !k.type.isError)[0];
  /** an empty list `[]` */
  const emptyList = (x: SyntaxNode | undefined): boolean => !!x && x.name === 'List' && !children(x).some(k => k.name !== '[' && k.name !== ']');

  /** Argument of `concat`: `string(x)` needs no string() there anymore */
  const textArg = (n: SyntaxNode): string => { const inner = stringCall(n); return inner ? val(inner, 'scalar') : val(n, 'scalar'); };

  const tr = (n: SyntaxNode): string => {
    if (n.type.isError) throw new Unsupported('kein gültiges FEEL');
    const kids = children(n).filter(k => !k.type.isError);
    switch (n.name) {
      case 'Expression':
        if (kids.length !== 1) throw new Unsupported('unerwarteter Aufbau');
        return val(kids[0], 'value');
      case 'VariableName': {
        const name = text(n);
        if (/\s/.test(name)) throw new Unsupported(`Name mit Leerzeichen «${name}» geht in JUEL nicht`);
        // what Camunda 8 keeps as a variable, Camunda 7 has on the execution;
        // an optional variable is read so that it may be missing
        return EXECUTION_JUEL[name] ?? (wrap && opts.optional?.has(name) ? getVariable(name) : name);
      }
      case 'PathExpression': {
        const [base, , prop] = kids;
        if (!base || !prop) throw new Unsupported('unvollständiger Pfad');
        return spin(n) ? `${tr(base)}.prop(${JSON.stringify(text(prop))})` : `${tr(base)}.${text(prop)}`;
      }
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
      case 'null':
        return text(n);
      case 'ParenthesizedExpression': {
        const inner = kids.find(k => k.name !== '(' && k.name !== ')');
        if (!inner) throw new Unsupported('leere Klammer');
        return `(${val(inner, 'scalar')})`;
      }
      case 'ArithmeticExpression': {
        const [a, op, b] = kids;
        if (!a || !op || !b) throw new Unsupported('unvollständige Rechnung');
        const o = text(op);
        if (o === '**') throw new Unsupported('Potenz «**» gibt es in JUEL nicht');
        // Text + text: JUEL always computes «+» numerically. `concat` turns
        // the argument itself into a String — `string(x)` is dropped.
        if (o === '+' && (stringy(a) || stringy(b))) return `${val(a, 'scalar')}.concat(${textArg(b)})`;
        return `${val(a, 'scalar')} ${o} ${val(b, 'scalar')}`;
      }
      case 'Comparison': {
        const [a, op, ...rest] = kids;
        if (!a || !op) throw new Unsupported('unvollständiger Vergleich');
        if (op.name === 'CompareOp') {
          const o = text(op);
          const b = rest[0];
          if (!b) throw new Unsupported('unvollständiger Vergleich');
          // `x = []` — the empty list is called `empty` in JUEL
          if ((o === '=' || o === '!=') && (emptyList(b) || emptyList(a))) {
            const xn = emptyList(b) ? a : b;
            const x = ending(xn, unsetSafe(xn), 'list');
            return o === '=' ? `empty ${x}` : `!empty ${x}`;
          }
          // `x != null` — precisely then `x` may be missing
          if ((o === '=' || o === '!=') && (b.name === 'null' || a.name === 'null')) {
            const x = b.name === 'null' ? a : b;
            if (spin(x)) return o === '!=' ? present(x) : `!(${present(x)})`;
            return `${unsetSafe(a)} ${o === '=' ? '==' : o} ${unsetSafe(b)}`;
          }
          return `${val(a, 'scalar')} ${o === '=' ? '==' : o} ${val(b, 'scalar')}`;
        }
        if (op.name === 'between') {
          const lo = rest[0], hi = rest.find((k, i) => i > 0 && k.name !== 'and');
          if (!lo || !hi) throw new Unsupported('unvollständiges between');
          const x = val(a, 'scalar');
          return `(${x} >= ${val(lo, 'scalar')} && ${x} <= ${val(hi, 'scalar')})`;
        }
        if (op.name === 'in') {
          const test = rest[0];
          const list = test?.name === 'PositiveUnaryTest' ? children(test)[0] : test;
          if (list?.name !== 'List') throw new Unsupported('«in» nur mit einer Liste von Werten');
          const items = children(list).filter(k => k.name !== '[' && k.name !== ']');
          if (!items.length) throw new Unsupported('leere Liste bei «in»');
          const x = val(a, 'scalar');
          return `(${items.map(it => `${x} == ${val(it, 'scalar')}`).join(' || ')})`;
        }
        throw new Unsupported(`Vergleich «${text(op)}» hat kein JUEL-Gegenstück`);
      }
      case 'Conjunction':
      case 'Disjunction': {
        const parts = kids.filter(k => k.name !== 'and' && k.name !== 'or');
        if (parts.length < 2) throw new Unsupported('unvollständige Verknüpfung');
        // `x = null or x = "" or x = []` is JUEL's `empty x` (that is how the import translates it)
        if (n.name === 'Disjunction') {
          // `a or b or c` is nested — flatten first
          const flat = (x: SyntaxNode): SyntaxNode[] => (x.name === 'Disjunction'
            ? children(x).filter(k => !k.type.isError && k.name !== 'or').flatMap(flat) : [x]);
          const tested = parts.flatMap(flat).map(c => {
            const [a, op, b] = c.name === 'Comparison' ? children(c).filter(k => !k.type.isError) : [];
            return a && op?.name === 'CompareOp' && text(op) === '=' && b ? { x: text(a), v: emptyList(b) ? '[]' : text(b) } : null;
          });
          const x = tested[0]?.x;
          if (x && tested.every(t => t?.x === x) && new Set(tested.map(t => t!.v)).size === 3
            && tested.every(t => ['null', '""', '[]'].includes(t!.v))) {
            const xn = kids0(parts.flatMap(flat)[0]);
            return `empty ${ending(xn, unsetSafe(xn), 'empty')}`;
          }
        }
        return parts.map(x => val(x, 'scalar')).join(n.name === 'Conjunction' ? ' && ' : ' || ');
      }
      case 'IfExpression': {
        const parts = kids.filter(k => !['if', 'then', 'else'].includes(k.name));
        if (parts.length !== 3) throw new Unsupported('if braucht then und else');
        return `(${val(parts[0], 'scalar')} ? ${val(parts[1], 'value')} : ${val(parts[2], 'value')})`;
      }
      case 'FunctionInvocation': {
        const [fn, , params] = kids;
        const name = fn ? text(fn) : '';
        const args = params ? children(params) : [];
        if (name === 'not' && args.length === 1) return `!(${val(args[0], 'scalar')})`;
        // `string(x)` alone: JUEL has no toString — «empty + x» turns it into text
        if (name === 'string' && args.length === 1) return `"".concat(${val(args[0], 'scalar')})`;
        // `count(x)` — a list (Java or Spin) has `size()`
        if (name === 'count' && args.length === 1) return `${val(args[0], 'list')}.size()`;
        // `context put(x, "k", v)` — Spin sets the field with `prop("k", v)` and returns the node
        if (name === 'context put' && args.length === 3) {
          if (args[1].name !== 'StringLiteral') throw new Unsupported('«context put» nur mit festem Feldnamen');
          return `${tr(args[0])}.prop(${tr(args[1])}, ${val(args[2], 'value')})`;
        }
        throw new Unsupported(`Funktion «${name}()» hat kein JUEL-Gegenstück`);
      }
      case 'FilterExpression': {
        const [base, , index] = kids;
        if (!base || !index) throw new Unsupported('unvollständiger Index');
        // a filter over `item`: in Camunda 7 Spin reads the JSON list via JSONPath
        if (index.name !== 'NumericLiteral') return `S(${tr(base)}).jsonPath("$[?(${jpCond(index)})]").elementList()`;
        const i = Number(text(index));
        if (!Number.isInteger(i) || i < 1) throw new Unsupported('Index muss eine positive ganze Zahl sein (FEEL zählt ab 1)');
        return `${val(base, 'list')}[${i - 1}]`;
      }
      // from fixed values: JSON via Spin — `JSON('[6026, 102]')`, as by hand in the project
      case 'List':
      case 'Context': {
        const json = constantJson(n);
        if (json == null) throw new Unsupported(n.name === 'List'
          ? 'Listen «[…]» gibt es in JUEL nur aus festen Werten (JSON)'
          : 'Kontexte «{…}» gibt es in JUEL nur aus festen Werten (JSON)');
        return `JSON('${json.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`;
      }
      case 'DateTimeLiteral':
        throw new Unsupported('Datums- und Zeitwerte gibt es in JUEL nicht');
      default:
        throw new Unsupported(`«${n.name}» hat kein JUEL-Gegenstück`);
    }
  };

  try {
    const juel = tr(top);
    const first = children(top)[0];
    // the bare path — without `execution.getVariable`, that does not belong in a `source`
    wrap = false;
    const plain = first && (first.name === 'VariableName' || first.name === 'PathExpression') ? tr(top) : undefined;
    return { ok: true, juel, ...(plain ? { plain } : {}) };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, reason: e.message };
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ── FEEL → Groovy (JSON in Camunda 7) ───────────────────────────────────────
//
// A list or a context (`[{ accountKey: x, validUntil: "2299-12-31" }]`)
// has no counterpart in JUEL. Camunda 7 builds JSON with a Groovy script and
// Spin — following the house convention (`org.camunda.spin.Spin.JSON(…)`):
//
//   // FEEL: [{accountKey: x, validUntil: "2299-12-31"}]
//   def v = { … }   // read variable or path — if missing, null
//   org.camunda.spin.Spin.JSON(groovy.json.JsonOutput.toJson([['accountKey': v('x'), 'validUntil': '2299-12-31']]))
//
// The first line carries the FEEL: the import reads it back from there (see
// `fachlich` in bpmn.ts), so a sync with the diagram does not replace it
// with the script. What makes up JSON is translated: lists, contexts,
// literals, variables and paths (`client.address.zip`) — calculations, functions,
// `if` inside are not (that is reported).

/** Marks a script that originated from FEEL — the FEEL follows it */
export const FEEL_SCRIPT_MARK = '// FEEL: ';

/** Reads a variable or a path in the script — if missing, null; JSON (Spin) becomes Map/List */
const GROOVY_READ = [
  'def v = { String name, String... path ->',
  '  def x = execution.getVariable(name)',
  '  for (p in path) {',
  '    if (x == null) return null',
  '    x = x instanceof org.camunda.spin.json.SpinJsonNode ? (x.hasProp(p) ? x.prop(p) : null) : x instanceof Map ? x[p] : x."$p"',
  '  }',
  '  x instanceof org.camunda.spin.json.SpinJsonNode ? new groovy.json.JsonSlurper().parseText(x.toString()) : x',
  '}',
].join('\n');

export type GroovyResult = { ok: true; script: string } | { ok: false; reason: string };

/** Is the FEEL body syntactically complete? (Otherwise the parser yields error nodes instead of throwing.) */
export function feelSyntaxOk(body: string): boolean {
  try {
    const c = parseExpression(body.trim(), {}, 'expression').cursor();
    do { if (c.type.isError) return false; } while (c.next());
    return !!body.trim();
  } catch {
    return false;
  }
}

/** Is the expression a list or a context (JSON)? */
export function isJsonLiteral(body: string): boolean {
  try {
    const first = children(parseExpression(body.trim(), {}, 'expression').topNode)[0];
    return first?.name === 'List' || first?.name === 'Context';
  } catch {
    return false;
  }
}

/** A FEEL list or context as a Groovy script that yields JSON (Spin) */
export function feelToGroovy(body: string): GroovyResult {
  const src = body.trim();
  let top: SyntaxNode;
  try {
    top = parseExpression(src, {}, 'expression').topNode;
  } catch {
    return { ok: false, reason: 'kein gültiges FEEL' };
  }
  const text = (n: SyntaxNode) => src.slice(n.from, n.to);
  const kids = (n: SyntaxNode) => children(n).filter(k => !k.type.isError);
  const str = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  let reads = false;
  const path = (n: SyntaxNode): string[] => {
    if (n.name === 'VariableName') return [text(n)];
    if (n.name === 'PathExpression') {
      const [base, , prop] = kids(n);
      if (base && prop) return [...path(base), text(prop)];
    }
    throw new Unsupported(`«${text(n)}» geht im JSON nicht — nur Werte, Variablen und Pfade`);
  };
  const tr = (n: SyntaxNode): string => {
    if (n.type.isError) throw new Unsupported('kein gültiges FEEL');
    switch (n.name) {
      case 'Expression': {
        const k = kids(n);
        if (k.length !== 1) throw new Unsupported('unerwarteter Aufbau');
        return tr(k[0]);
      }
      case 'List':
        return `[${kids(n).filter(k => k.name !== '[' && k.name !== ']').map(tr).join(', ')}]`;
      case 'Context': {
        const entries = kids(n).filter(k => k.name === 'ContextEntry');
        if (!entries.length) return '[:]';
        return `[${entries.map(e => {
          const [key, value] = kids(e);
          if (!key || !value) throw new Unsupported('unvollständiger Eintrag');
          const name = kids(key)[0];
          const k = name?.name === 'StringLiteral' ? JSON.parse(text(name)) as string : text(key).trim();
          return `${str(k)}: ${tr(value)}`;
        }).join(', ')}]`;
      }
      case 'StringLiteral': return str(JSON.parse(text(n)) as string);
      case 'NumericLiteral': case 'BooleanLiteral': case 'null': return text(n);
      case 'ParenthesizedExpression': {
        const inner = kids(n).find(k => k.name !== '(' && k.name !== ')');
        if (!inner) throw new Unsupported('leere Klammer');
        return tr(inner);
      }
      case 'VariableName': case 'PathExpression': {
        const [name, ...rest] = path(n);
        reads = true;
        return `v(${[name, ...rest].map(str).join(', ')})`;
      }
      default:
        throw new Unsupported(`«${text(n)}» geht im JSON nicht — nur Werte, Variablen und Pfade`);
    }
  };
  try {
    const first = kids(top)[0];
    if (!first || (first.name !== 'List' && first.name !== 'Context')) return { ok: false, reason: 'nur eine Liste oder ein Kontext wird zu JSON' };
    const literal = tr(top);
    const script = [
      `${FEEL_SCRIPT_MARK}${src.replace(/\s*\n\s*/g, ' ')}`,
      ...(reads ? [GROOVY_READ] : []),
      `org.camunda.spin.Spin.JSON(groovy.json.JsonOutput.toJson(${literal}))`,
    ].join('\n');
    return { ok: true, script };
  } catch (e) {
    return { ok: false, reason: e instanceof Unsupported ? e.message : e instanceof Error ? e.message : String(e) };
  }
}

/**
 * An expression of the specification in the form the engine needs.
 * FEEL (`= …`) becomes `=…` for Camunda 8, `${…}` for Camunda 7; everything
 * else (JUEL from an old import) stays as it is.
 */
export function engineExpression(expression: string, engine: EngineId | undefined, opts: JuelOptions = {}): { text: string; issue?: string } {
  const body = feelBody(expression);
  if (body == null) return { text: expression };
  if (engine === 'c8') return { text: `=${body}` };
  const r = feelToJuel(body, opts);
  if (r.ok) return { text: `\${${r.juel}}` };
  return { text: expression, issue: r.reason };
}
