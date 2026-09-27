// FEEL → JUEL: die Spezifikation spricht FEEL, Camunda 7 spricht JUEL.
//
// In der Spezifikation stehen Mapping-Werte und Bedingungen als FEEL
// (`= client.address.zip`), unabhängig von der Engine. Beim Export übersetzt
// die App sie in das, was die Engine versteht: Camunda 8 nimmt FEEL, wie es
// ist; für Camunda 7 wird daraus JUEL (`${client.address.zip}`).
//
// Übersetzt wird **strukturell** über den Parsebaum von feelin (lezer-feel),
// nicht mit Textersetzung — sonst würde aus `a = b` in einer Zeichenkette
// ein `==`. Die Teilmenge, die ein JUEL-Gegenstück hat:
//
//   Pfade            client.address.zip      → client.address.zip
//   Literale         "x" · 1 · true · null   → gleich
//   Arithmetik       + - * /                 → gleich  (Text + Text → concat)
//   Vergleiche       = != < > <= >=          → == != < > <= >=
//   between / in     a between 1 and 3       → (a >= 1 && a <= 3)
//   Logik            and · or · not(x)       → && · || · !(x)
//   Bedingung        if c then a else b      → (c ? a : b)
//   Listenindex      items[1]                → items[0]  (FEEL zählt ab 1)
//
// Alles andere — Funktionen, Filter, Kontexte, Datumswerte, for/some/every —
// hat kein JUEL-Gegenstück; die Übersetzung meldet das statt zu raten.

import { parseExpression, SyntaxError as FeelSyntaxError } from 'feelin';
import type { SyntaxNode } from '@lezer/common';
import type { EngineId } from './types';

export type JuelResult =
  | { ok: true; juel: string; /** blosser Variablenpfad ohne `${}` — für `camunda:in source` */ plain?: string }
  | { ok: false; reason: string };

/** Rumpf eines FEEL-Werts: `= a + 1` → `a + 1`; null, wenn es kein FEEL ist. */
export function feelBody(expression: string): string | null {
  const t = expression.trim();
  return t.startsWith('=') ? t.slice(1).trim() : null;
}

class Unsupported extends Error {}

const children = (n: SyntaxNode): SyntaxNode[] => {
  const out: SyntaxNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
};

/** FEEL-Rumpf nach JUEL (ohne `${}`) übersetzen. */
export function feelToJuel(body: string): JuelResult {
  const src = body.trim();
  if (!src) return { ok: false, reason: 'leerer Ausdruck' };
  let top: SyntaxNode;
  try {
    top = parseExpression(src, {}, 'expression').topNode;
  } catch (e) {
    return { ok: false, reason: e instanceof FeelSyntaxError ? 'kein gültiges FEEL' : String(e) };
  }
  const text = (n: SyntaxNode) => src.slice(n.from, n.to);

  /** `string(x)` → der Ausdruck dahinter, sonst null */
  const stringCall = (n: SyntaxNode): SyntaxNode | null => {
    if (n.name !== 'FunctionInvocation') return null;
    const [fn, , params] = children(n).filter(k => !k.type.isError);
    const args = params ? children(params) : [];
    return fn && text(fn) === 'string' && args.length === 1 ? args[0] : null;
  };
  /** liefert der Knoten Text? Literal, `string(…)` oder eine Verkettung davon */
  const stringy = (n: SyntaxNode): boolean => {
    if (n.name === 'StringLiteral' || stringCall(n)) return true;
    if (n.name === 'ParenthesizedExpression') { const inner = children(n).find(k => k.name !== '(' && k.name !== ')'); return !!inner && stringy(inner); }
    if (n.name !== 'ArithmeticExpression') return false;
    const [a, op, b] = children(n).filter(k => !k.type.isError);
    return !!a && !!op && !!b && text(op) === '+' && (stringy(a) || stringy(b));
  };
  /** Argument von `concat`: `string(x)` braucht dort kein string() mehr */
  const textArg = (n: SyntaxNode): string => { const inner = stringCall(n); return inner ? tr(inner) : tr(n); };

  const tr = (n: SyntaxNode): string => {
    if (n.type.isError) throw new Unsupported('kein gültiges FEEL');
    const kids = children(n).filter(k => !k.type.isError);
    switch (n.name) {
      case 'Expression':
        if (kids.length !== 1) throw new Unsupported('unerwarteter Aufbau');
        return tr(kids[0]);
      case 'VariableName': {
        const name = text(n);
        if (/\s/.test(name)) throw new Unsupported(`Name mit Leerzeichen «${name}» geht in JUEL nicht`);
        return name;
      }
      case 'PathExpression': {
        const [base, , prop] = kids;
        if (!base || !prop) throw new Unsupported('unvollständiger Pfad');
        return `${tr(base)}.${text(prop)}`;
      }
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
      case 'null':
        return text(n);
      case 'ParenthesizedExpression': {
        const inner = kids.find(k => k.name !== '(' && k.name !== ')');
        if (!inner) throw new Unsupported('leere Klammer');
        return `(${tr(inner)})`;
      }
      case 'ArithmeticExpression': {
        const [a, op, b] = kids;
        if (!a || !op || !b) throw new Unsupported('unvollständige Rechnung');
        const o = text(op);
        if (o === '**') throw new Unsupported('Potenz «**» gibt es in JUEL nicht');
        // Text + Text: JUEL rechnet bei «+» immer numerisch. `concat` macht
        // aus dem Argument selbst einen String — `string(x)` fällt dabei weg.
        if (o === '+' && (stringy(a) || stringy(b))) return `${tr(a)}.concat(${textArg(b)})`;
        return `${tr(a)} ${o} ${tr(b)}`;
      }
      case 'Comparison': {
        const [a, op, ...rest] = kids;
        if (!a || !op) throw new Unsupported('unvollständiger Vergleich');
        if (op.name === 'CompareOp') {
          const o = text(op);
          const b = rest[0];
          if (!b) throw new Unsupported('unvollständiger Vergleich');
          return `${tr(a)} ${o === '=' ? '==' : o} ${tr(b)}`;
        }
        if (op.name === 'between') {
          const lo = rest[0], hi = rest.find((k, i) => i > 0 && k.name !== 'and');
          if (!lo || !hi) throw new Unsupported('unvollständiges between');
          const x = tr(a);
          return `(${x} >= ${tr(lo)} && ${x} <= ${tr(hi)})`;
        }
        if (op.name === 'in') {
          const test = rest[0];
          const list = test?.name === 'PositiveUnaryTest' ? children(test)[0] : test;
          if (list?.name !== 'List') throw new Unsupported('«in» nur mit einer Liste von Werten');
          const items = children(list).filter(k => k.name !== '[' && k.name !== ']');
          if (!items.length) throw new Unsupported('leere Liste bei «in»');
          const x = tr(a);
          return `(${items.map(it => `${x} == ${tr(it)}`).join(' || ')})`;
        }
        throw new Unsupported(`Vergleich «${text(op)}» hat kein JUEL-Gegenstück`);
      }
      case 'Conjunction':
      case 'Disjunction': {
        const parts = kids.filter(k => k.name !== 'and' && k.name !== 'or');
        if (parts.length < 2) throw new Unsupported('unvollständige Verknüpfung');
        return parts.map(tr).join(n.name === 'Conjunction' ? ' && ' : ' || ');
      }
      case 'IfExpression': {
        const parts = kids.filter(k => !['if', 'then', 'else'].includes(k.name));
        if (parts.length !== 3) throw new Unsupported('if braucht then und else');
        return `(${tr(parts[0])} ? ${tr(parts[1])} : ${tr(parts[2])})`;
      }
      case 'FunctionInvocation': {
        const [fn, , params] = kids;
        const name = fn ? text(fn) : '';
        const args = params ? children(params) : [];
        if (name === 'not' && args.length === 1) return `!(${tr(args[0])})`;
        // `string(x)` allein: JUEL hat kein toString — «leer + x» macht Text daraus
        if (name === 'string' && args.length === 1) return `"".concat(${tr(args[0])})`;
        throw new Unsupported(`Funktion «${name}()» hat kein JUEL-Gegenstück`);
      }
      case 'FilterExpression': {
        const [base, , index] = kids;
        if (!base || !index) throw new Unsupported('unvollständiger Index');
        if (index.name !== 'NumericLiteral') throw new Unsupported('Filter «[…]» gibt es in JUEL nicht — nur ein fester Index wie [1]');
        const i = Number(text(index));
        if (!Number.isInteger(i) || i < 1) throw new Unsupported('Index muss eine positive ganze Zahl sein (FEEL zählt ab 1)');
        return `${tr(base)}[${i - 1}]`;
      }
      case 'List':
        throw new Unsupported('Listen «[…]» gibt es in JUEL nicht');
      case 'Context':
        throw new Unsupported('Kontexte «{…}» gibt es in JUEL nicht');
      case 'DateTimeLiteral':
        throw new Unsupported('Datums- und Zeitwerte gibt es in JUEL nicht');
      default:
        throw new Unsupported(`«${n.name}» hat kein JUEL-Gegenstück`);
    }
  };

  try {
    const juel = tr(top);
    const first = children(top)[0];
    const plain = first && (first.name === 'VariableName' || first.name === 'PathExpression') ? juel : undefined;
    return { ok: true, juel, ...(plain ? { plain } : {}) };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, reason: e.message };
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Ein Ausdruck der Spezifikation in der Form, die die Engine braucht.
 * FEEL (`= …`) wird für Camunda 8 zu `=…`, für Camunda 7 zu `${…}`; alles
 * andere (JUEL aus einem alten Import) bleibt, wie es ist.
 */
export function engineExpression(expression: string, engine: EngineId | undefined): { text: string; issue?: string } {
  const body = feelBody(expression);
  if (body == null) return { text: expression };
  if (engine === 'c8') return { text: `=${body}` };
  const r = feelToJuel(body);
  if (r.ok) return { text: `\${${r.juel}}` };
  return { text: expression, issue: r.reason };
}
