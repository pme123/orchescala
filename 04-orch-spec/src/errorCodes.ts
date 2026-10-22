// Handled errors in the BPMN: `_handledErrors` and `_regexHandledErrors`.
//
// An entry is a fixed text (`404`, `.*timeout.*`) or — with `=`
// in front — a FEEL expression that yields the text (`= errorCodes.notFound`).
// An expression may yield a text or a list of texts. The form in the
// BPMN depends on the engine:
//
//   Camunda 8   a list             =["404"]  or with expressions
//                                  =flatten(["404", errorCodes.notFound])
//   Camunda 7   text with commas   404, ${errorCodes.notFound}
//               an expression alone ${errorCodes.all} — then its value
//               (even a list) arrives unchanged at the worker
//
// Both forms are read back into the list of entries.

import type { EngineId } from './types.ts';
import { feelBody, feelToJuel } from './feelJuel.ts';
import { importExpression } from './juelFeel.ts';

/** A FEEL text: `"…"` with escaped `\` and `"` */
export const feelString = (v: string): string => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const unquote = (s: string): string | null => {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s.trim());
  return m ? m[1].replace(/\\(["\\])/g, '$1') : null;
};

/** Split at top-level commas — not in text, brackets or `${…}` */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = false, cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && i + 1 < text.length) cur += text[++i];
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/** Entries → value in the BPMN. `onIssue` reports FEEL that does not translate to JUEL (it then stays as FEEL). */
export function errorListSource(entries: string[], engine: EngineId, onIssue?: (entry: string, reason: string) => void): string {
  const list = entries.map(e => e.trim()).filter(Boolean);
  if (engine === 'c8') {
    const items = `[${list.map(e => feelBody(e)?.trim() ?? feelString(e)).join(', ')}]`;
    // an expression can itself yield a list — `flatten` turns it into a list of texts
    return list.some(e => feelBody(e) != null) ? `=flatten(${items})` : `=${items}`;
  }
  return list.map(e => {
    const body = feelBody(e);
    if (body == null) return e;
    const r = feelToJuel(body);
    if (r.ok) return `\${${r.juel}}`;
    onIssue?.(e, r.reason);
    return e;
  }).join(', ');
}

/** Value in the BPMN → entries. Reads a list and text with commas, regardless of the engine. */
export function parseErrorList(source: string): string[] {
  const t = source.trim();
  if (!t) return [];
  const body = feelBody(t);
  if (body != null) {
    let b = body.trim();
    const flat = /^flatten\(\s*(\[[\s\S]*\])\s*\)$/.exec(b);
    if (flat) b = flat[1];
    // list: each element a text or an expression
    const list = /^\[([\s\S]*)\]$/.exec(b);
    if (list) return splitTop(list[1]).map(x => unquote(x) ?? `= ${x}`);
    // a text (also one with commas from an old conversion)
    const text = unquote(b);
    if (text != null) return splitTop(text);
    return [`= ${b}`];
  }
  // Camunda 7: text with commas, expressions as `${…}`
  return splitTop(t).map(x => (/^[$#]\{/.test(x) ? importExpression(x) : x));
}
