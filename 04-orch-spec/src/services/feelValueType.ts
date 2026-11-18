// The type of the value a FEEL expression gives - for a variable no field and no conversion types:
// an output row that computes (`= if count != null then count + 1 else 0` → Int), a script assignment.
// Only what the expression says for sure; otherwise undefined (the caller keeps its default).

/** A variable the expression may read, with its type (`Int`, `String`, a class id). */
export interface TypedName {
  name: string;
  type: string;
  collection?: boolean;
}

const NUMBERS = ['Int', 'Long', 'BigDecimal', 'Double'];
const COMPARISON = ['!=', '<=', '>=', '=', '<', '>'];

/**
 * The type of the value of `expression` (with or without `=`): a literal, a variable it reads, a
 * comparison or `and`/`or` (Boolean), arithmetic of numbers, `+` with a text (String),
 * `if … then … else …` (its branches), `count`/`string`/`not`. undefined: not sure.
 */
export function feelValueType(expression: string, vars: readonly TypedName[]): string | undefined {
  return typeOf(expression.trim().replace(/^=\s*/, ''), vars);
}

function typeOf(raw: string, vars: readonly TypedName[]): string | undefined {
  const e = withoutParens(raw.trim());
  if (!e) return undefined;
  const cond = ifThenElse(e);
  if (cond) return either(typeOf(cond.then, vars), typeOf(cond.else, vars));
  if (topLevel(e, [' or ', ' and ']).length > 1) return 'Boolean';
  if (splitAt(e, COMPARISON)) return 'Boolean';
  const sum = topLevel(e, ['+', '-', '*', '/']);
  if (sum.length > 1) {
    const types = sum.map(p => typeOf(p, vars));
    // `+` with a text joins texts
    if (types.includes('String')) return 'String';
    if (types.some(t => t && !NUMBERS.includes(t))) return undefined;
    // a part not known (`count + 1` of the variable itself): the number the others say
    const known = types.filter((t): t is string => !!t);
    if (!known.length) return undefined;
    if (/\//.test(e) && known.every(t => t === 'Int' || t === 'Long')) return 'BigDecimal';
    return known.reduce((a, b) => widest(a, b));
  }
  if (/^-?\d+$/.test(e)) return 'Int';
  if (/^-?\d+\.\d+$/.test(e)) return 'BigDecimal';
  if (/^"(?:[^"\\]|\\.)*"$/.test(e)) return 'String';
  if (e === 'true' || e === 'false') return 'Boolean';
  if (e === 'null') return undefined;
  const call = /^([a-z][\w ]*?)\s*\(/.exec(e)?.[1];
  if (call === 'not' || call === 'is defined' || call === 'contains' || call === 'starts with' || call === 'ends with') return 'Boolean';
  if (call === 'count') return 'Int';
  if (call === 'string' || call === 'upper case' || call === 'lower case' || call === 'substring') return 'String';
  const v = vars.find(x => x.name === e);
  return v && !v.collection ? v.type : undefined;
}

/** Two branches: the one that is known (`null` is none), numbers the wider one; two different: not sure. */
function either(a: string | undefined, b: string | undefined): string | undefined {
  if (!a || !b) return a ?? b;
  if (a === b) return a;
  return NUMBERS.includes(a) && NUMBERS.includes(b) ? widest(a, b) : undefined;
}

const widest = (a: string, b: string) => (NUMBERS.indexOf(a) >= NUMBERS.indexOf(b) ? a : b);

/** `if c then a else b` at the top level - the else part may hold another if. */
function ifThenElse(e: string): { then: string; else: string } | null {
  if (!/^if\s/.test(e)) return null;
  const then = wordAt(e, ' then ');
  if (then < 0) return null;
  const rest = e.slice(then + 6);
  const els = wordAt(rest, ' else ');
  return els < 0 ? null : { then: rest.slice(0, els), else: rest.slice(els + 6) };
}

/** The index of `word` outside texts and brackets, skipping nested `if … else` - -1 for none. */
function wordAt(e: string, word: string): number {
  let depth = 0;
  let ifs = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '"') { i = endOfText(e, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0) {
      if (e.startsWith(' if ', i) || (i === 0 && e.startsWith('if '))) ifs++;
      if (e.startsWith(word, i)) {
        if (word === ' else ' && ifs > 0) ifs--;
        else return i;
      }
    }
  }
  return -1;
}

/** The parts between the operators at the top level (outside texts and brackets). */
function topLevel(e: string, ops: string[]): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '"') { i = endOfText(e, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0) {
      const op = ops.find(o => e.startsWith(o, i));
      // a sign (`-1`, `* -2`) is no operator
      if (op && (op.trim() !== '-' || e.slice(from, i).trim())) {
        parts.push(e.slice(from, i));
        i += op.length - 1;
        from = i + 1;
      }
    }
  }
  parts.push(e.slice(from));
  return parts.map(p => p.trim());
}

/** A comparison at the top level. */
const splitAt = (e: string, ops: string[]) => topLevel(e, ops).length > 1;

function endOfText(e: string, i: number): number {
  for (let j = i + 1; j < e.length; j++) {
    if (e[j] === '\\') j++;
    else if (e[j] === '"') return j;
  }
  return e.length;
}

/** `(x)` → `x` - only brackets around the whole. */
function withoutParens(e: string): string {
  while (e.startsWith('(') && closing(e) === e.length - 1) e = e.slice(1, -1).trim();
  return e;
}

function closing(e: string): number {
  let depth = 0;
  for (let i = 0; i < e.length; i++) {
    if (e[i] === '"') { i = endOfText(e, i); continue; }
    if (e[i] === '(') depth++;
    else if (e[i] === ')' && --depth === 0) return i;
  }
  return -1;
}
