/** The reserved words of FEEL — no variable name, no plain context key. */
export const FEEL_WORDS = new Set([
  'true', 'false', 'null', 'if', 'then', 'else', 'for', 'in', 'return', 'some', 'every', 'satisfies',
  'and', 'or', 'not', 'between', 'instance', 'of', 'function', 'external', 'partial', 'item',
]);

/** A name FEEL reads as it is — letters (also beyond ASCII, `Gebühr`), digits, `_`, and no reserved word. */
export const isPlainFeelName = (name: string): boolean => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) && !FEEL_WORDS.has(name);

/** A variable or field as FEEL reads it: plain, otherwise in backticks (`` `letter-id` ``). */
export const feelRef = (name: string): string => (isPlainFeelName(name) ? name : `\`${name}\``);
