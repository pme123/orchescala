// Brackets and quotes while typing an expression - only where a bracket would be missing:
//  · a selection and an opening bracket (or `"`): the selection is wrapped, it stays selected
//  · an opening bracket (auto-close on): the closing one comes along, the cursor between them - only
//    when the text has no closing one too many (`= |x)` → nothing: it waits for it), and only before a
//    space, the end or a closing bracket, so `(` before a word stays alone
//  · a closing bracket where the same one follows and none is missing: the cursor steps over it -
//    a `"` only where it ends a string (`"abc|"`), not before one (`|"abc"`)
// Nothing else changes what is typed. Without UI, so that it can be tested (see FeelInput).

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"' };
const CLOSERS = new Set([')', ']', '}', '"']);

/** Replace `from`–`to` by `insert`, then select `selStart`–`selEnd`. */
export interface BracketEdit {
  from: number;
  to: number;
  insert: string;
  selStart: number;
  selEnd: number;
}

/** The edit for the key `key` typed at the selection `start`–`end` — `null`: the key as usual. */
export function bracketEdit(text: string, start: number, end: number, key: string, autoClose: boolean): BracketEdit | null {
  const close = PAIRS[key];
  if (start !== end) {
    if (!close) return null;
    return { from: start, to: end, insert: `${key}${text.slice(start, end)}${close}`, selStart: start + 1, selEnd: end + 1 };
  }
  if (!autoClose) return null;
  const prev = text[start - 1] ?? '';
  const next = text[start] ?? '';
  // over the closing one that is there - unless one is missing (`((x)|)`: typed, it closes the outer)
  if (CLOSERS.has(key) && next === key && (key === '"' ? inString(text, start) : !missingCloser(text, key))) {
    return { from: start, to: start, insert: '', selStart: start + 1, selEnd: start + 1 };
  }
  if (!close) return null;
  if (next && !/[\s)\]},]/.test(next)) return null;
  // a closing one too many in the text: it waits for this one - it is there already
  if (key !== '"' && balance(text, key, close) < 0) return null;
  // a quote right after a value (a word, a string, a call or a list) ends one — it does not open a pair
  if (key === '"' && /[\w")\]}]/.test(prev)) return null;
  return { from: start, to: start, insert: `${key}${close}`, selStart: start + 1, selEnd: start + 1 };
}

/** Is the position inside a string literal — an odd number of unescaped `"` before it? */
function inString(text: string, at: number): boolean {
  let open = false;
  for (let i = 0; i < at; i++) {
    if (text[i] === '\\' && open) i++;
    else if (text[i] === '"') open = !open;
  }
  return open;
}

/** Opening minus closing ones of a pair in the text - below 0: a closing one has none. */
function balance(text: string, open: string, close: string): number {
  let n = 0;
  for (const ch of text) { if (ch === open) n++; else if (ch === close) n--; }
  return n;
}

/** More opening than closing ones of the pair of `close` in the text - one is missing. */
function missingCloser(text: string, close: string): boolean {
  const open = Object.keys(PAIRS).find(k => PAIRS[k] === close)!;
  return balance(text, open, close) > 0;
}
