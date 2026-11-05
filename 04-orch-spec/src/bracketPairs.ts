// Brackets and quotes while typing an expression — as in a code editor:
//  · a selection and an opening bracket (or `"`): the selection is wrapped, it stays selected
//  · an opening bracket (auto-close on): the closing one comes along, the cursor between them —
//    only before a space, the end or a closing bracket, so `(` before a word stays alone
//  · a closing bracket where the same one follows already: the cursor steps over it — a `"`
//    only where it ends a string (`"abc|"`), not before one (`|"abc"`)
//  · Backspace between an empty pair removes both
// Without UI, so that it can be tested — the field applies the edit (see FeelInput).

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
  if (CLOSERS.has(key) && next === key && (key !== '"' || inString(text, start))) return { from: start, to: start, insert: '', selStart: start + 1, selEnd: start + 1 };
  if (!close) return null;
  if (next && !/[\s)\]},]/.test(next)) return null;
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

/** Backspace at the cursor `start` (no selection) between an empty pair: both go. */
export function backspaceEdit(text: string, start: number, end: number): BracketEdit | null {
  if (start !== end || start === 0) return null;
  const open = text[start - 1];
  if (!PAIRS[open] || PAIRS[open] !== text[start]) return null;
  // `"a"|"b"`: the end of one string and the start of the next — not an empty pair
  if (open === '"' && !inString(text, start)) return null;
  return { from: start - 1, to: start + 1, insert: '', selStart: start - 1, selEnd: start - 1 };
}
