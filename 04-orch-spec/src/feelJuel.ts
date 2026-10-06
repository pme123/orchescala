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
//   Filter           items[item.x = 1]       → S(items).jsonPath("$[?(@.x == 1)]").elementList()
//   Anzahl           count(x)                → x.size()
//   leere Liste      x = []                  → empty x
//
// Eine Variable, die fehlen darf, liest Camunda 7 mit `execution.getVariable("x")`
// — `${x}` wirft «Unknown property», wenn `x` nicht gesetzt ist. Das gilt für
// jede Variable, die mit `null` verglichen oder auf leer geprüft wird
// (`x != null`, `empty x`), und für jede, die laut Datenmodell optional ist
// (`JuelOptions.optional`).
//
// Alles andere — übrige Funktionen, Kontexte, Datumswerte, for/some/every —
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

/** Variablen von Camunda 8, die Camunda 7 an der Ausführung hat — Gegenstück zum Import (juelFeel.ts) */
const EXECUTION_JUEL: Record<string, string> = {
  processInstanceKey: 'execution.processInstanceId',
  businessKey: 'execution.processBusinessKey',
  processDefinitionKey: 'execution.getProcessDefinition().getKey()',
};

const children = (n: SyntaxNode): SyntaxNode[] => {
  const out: SyntaxNode[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
};

export interface JuelOptions {
  /** Prozessvariablen, die fehlen dürfen (optional im Datenmodell) — `execution.getVariable("x")` */
  optional?: ReadonlySet<string>;
}

/** FEEL-Rumpf nach JUEL (ohne `${}`) übersetzen. */
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
  /** aus: der blosse Pfad (`plain`, für `camunda:in source`) — ohne `execution.getVariable` */
  let wrap = true;
  const getVariable = (name: string) => `execution.getVariable("${name}")`;
  /**
   * Eine Variable, die hier fehlen darf: verglichen mit `null` oder auf leer
   * geprüft. Bei einem Pfad (`a.b`) ihr Anfang — `null.b` ist in JUEL null.
   */
  const unsetSafe = (n: SyntaxNode): string => {
    if (n.name === 'PathExpression') {
      const [base, , prop] = children(n).filter(k => !k.type.isError);
      if (base && prop) return `${unsetSafe(base)}.${text(prop)}`;
    }
    const name = n.name === 'VariableName' ? text(n) : '';
    return name && wrap && !EXECUTION_JUEL[name] && name !== 'item' && /^[A-Za-z_]\w*$/.test(name) ? getVariable(name) : tr(n);
  };

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
  /**
   * Die Bedingung eines Filters (`item.code = 22 or …`) als JSONPath-Filter
   * (`@.code == 22 || …`) — so liest Spin in Camunda 7 eine JSON-Liste.
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
  /** eine leere Liste `[]` */
  const emptyList = (x: SyntaxNode | undefined): boolean => !!x && x.name === 'List' && !children(x).some(k => k.name !== '[' && k.name !== ']');

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
        // was Camunda 8 als Variable führt, hat Camunda 7 an der Ausführung;
        // eine optionale Variable liest es so, dass sie fehlen darf
        return EXECUTION_JUEL[name] ?? (wrap && opts.optional?.has(name) ? getVariable(name) : name);
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
          // `x = []` — die leere Liste heisst in JUEL `empty`
          if ((o === '=' || o === '!=') && (emptyList(b) || emptyList(a))) {
            const x = unsetSafe(emptyList(b) ? a : b);
            return o === '=' ? `empty ${x}` : `!empty ${x}`;
          }
          // `x != null` — gerade dann darf `x` fehlen
          if ((o === '=' || o === '!=') && (b.name === 'null' || a.name === 'null')) {
            return `${unsetSafe(a)} ${o === '=' ? '==' : o} ${unsetSafe(b)}`;
          }
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
        // `x = null or x = "" or x = []` ist JUELs `empty x` (so übersetzt es der Import)
        if (n.name === 'Disjunction') {
          // `a or b or c` steht geschachtelt da — erst glätten
          const flat = (x: SyntaxNode): SyntaxNode[] => (x.name === 'Disjunction'
            ? children(x).filter(k => !k.type.isError && k.name !== 'or').flatMap(flat) : [x]);
          const tested = parts.flatMap(flat).map(c => {
            const [a, op, b] = c.name === 'Comparison' ? children(c).filter(k => !k.type.isError) : [];
            return a && op?.name === 'CompareOp' && text(op) === '=' && b ? { x: text(a), v: emptyList(b) ? '[]' : text(b) } : null;
          });
          const x = tested[0]?.x;
          if (x && tested.every(t => t?.x === x) && new Set(tested.map(t => t!.v)).size === 3
            && tested.every(t => ['null', '""', '[]'].includes(t!.v))) return `empty ${unsetSafe(kids0(parts.flatMap(flat)[0]))}`;
        }
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
        // `count(x)` — eine Liste (Java oder Spin) hat `size()`
        if (name === 'count' && args.length === 1) return `${tr(args[0])}.size()`;
        throw new Unsupported(`Funktion «${name}()» hat kein JUEL-Gegenstück`);
      }
      case 'FilterExpression': {
        const [base, , index] = kids;
        if (!base || !index) throw new Unsupported('unvollständiger Index');
        // ein Filter über `item`: in Camunda 7 liest Spin die JSON-Liste per JSONPath
        if (index.name !== 'NumericLiteral') return `S(${tr(base)}).jsonPath("$[?(${jpCond(index)})]").elementList()`;
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
    // der blosse Pfad — ohne `execution.getVariable`, das gehört nicht in ein `source`
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
// Eine Liste oder ein Kontext (`[{ accountKey: x, validUntil: "2299-12-31" }]`)
// hat in JUEL kein Gegenstück. Camunda 7 baut JSON mit einem Groovy-Skript und
// Spin — so wie die Hauskonvention (`org.camunda.spin.Spin.JSON(…)`):
//
//   // FEEL: [{accountKey: x, validUntil: "2299-12-31"}]
//   def v = { … }   // Variable bzw. Pfad lesen — fehlt sie, null
//   org.camunda.spin.Spin.JSON(groovy.json.JsonOutput.toJson([['accountKey': v('x'), 'validUntil': '2299-12-31']]))
//
// Die erste Zeile trägt das FEEL: der Import liest es daraus zurück (siehe
// `fachlich` in bpmn.ts), ein Abgleich mit dem Diagramm ersetzt es also nicht
// durch das Skript. Übersetzt wird, was JSON ausmacht: Listen, Kontexte,
// Literale, Variablen und Pfade (`client.address.zip`) — Rechnen, Funktionen,
// `if` darin nicht (das wird gemeldet).

/** Kennzeichnet ein Skript, das aus FEEL entstanden ist — dahinter steht das FEEL */
export const FEEL_SCRIPT_MARK = '// FEEL: ';

/** Liest im Skript eine Variable bzw. einen Pfad — fehlt sie, null; JSON (Spin) wird zu Map/List */
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

/** Ist der FEEL-Rumpf syntaktisch vollständig? (Der Parser liefert sonst Fehlerknoten statt zu werfen.) */
export function feelSyntaxOk(body: string): boolean {
  try {
    const c = parseExpression(body.trim(), {}, 'expression').cursor();
    do { if (c.type.isError) return false; } while (c.next());
    return !!body.trim();
  } catch {
    return false;
  }
}

/** Ist der Ausdruck eine Liste bzw. ein Kontext (JSON)? */
export function isJsonLiteral(body: string): boolean {
  try {
    const first = children(parseExpression(body.trim(), {}, 'expression').topNode)[0];
    return first?.name === 'List' || first?.name === 'Context';
  } catch {
    return false;
  }
}

/** Eine FEEL-Liste bzw. ein -Kontext als Groovy-Skript, das JSON (Spin) liefert */
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
 * Ein Ausdruck der Spezifikation in der Form, die die Engine braucht.
 * FEEL (`= …`) wird für Camunda 8 zu `=…`, für Camunda 7 zu `${…}`; alles
 * andere (JUEL aus einem alten Import) bleibt, wie es ist.
 */
export function engineExpression(expression: string, engine: EngineId | undefined, opts: JuelOptions = {}): { text: string; issue?: string } {
  const body = feelBody(expression);
  if (body == null) return { text: expression };
  if (engine === 'c8') return { text: `=${body}` };
  const r = feelToJuel(body, opts);
  if (r.ok) return { text: `\${${r.juel}}` };
  return { text: expression, issue: r.reason };
}
