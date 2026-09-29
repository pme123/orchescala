// Behandelte Fehler im BPMN: `_handledErrors` und `_regexHandledErrors`.
//
// Ein Eintrag ist ein fester Text (`404`, `.*timeout.*`) oder — mit `=`
// davor — ein FEEL-Ausdruck, der den Text liefert (`= errorCodes.notFound`).
// Ein Ausdruck darf einen Text oder eine Liste von Texten liefern. Die Form im
// BPMN hängt an der Engine:
//
//   Camunda 8   eine Liste         =["404"]  bzw. mit Ausdrücken
//                                  =flatten(["404", errorCodes.notFound])
//   Camunda 7   Text mit Kommas    404, ${errorCodes.notFound}
//               ein Ausdruck allein ${errorCodes.all} — dann kommt sein Wert
//               (auch eine Liste) unverändert beim Worker an
//
// Beide Formen werden wieder zur Liste der Einträge gelesen.

import type { EngineId } from './types';
import { feelBody, feelToJuel } from './feelJuel';
import { importExpression } from './juelFeel';

/** Ein FEEL-Text: `"…"` mit maskiertem `\` und `"` */
export const feelString = (v: string): string => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const unquote = (s: string): string | null => {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s.trim());
  return m ? m[1].replace(/\\(["\\])/g, '$1') : null;
};

/** An Kommas auf oberster Ebene trennen — nicht in Text, Klammern oder `${…}` */
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

/** Einträge → Wert im BPMN. `onIssue` meldet FEEL, das nicht nach JUEL geht (bleibt dann als FEEL stehen). */
export function errorListSource(entries: string[], engine: EngineId, onIssue?: (entry: string, reason: string) => void): string {
  const list = entries.map(e => e.trim()).filter(Boolean);
  if (engine === 'c8') {
    const items = `[${list.map(e => feelBody(e)?.trim() ?? feelString(e)).join(', ')}]`;
    // ein Ausdruck kann selbst eine Liste liefern — `flatten` macht daraus eine Liste von Texten
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

/** Wert im BPMN → Einträge. Liest Liste und Text mit Kommas, gleich aus welcher Engine. */
export function parseErrorList(source: string): string[] {
  const t = source.trim();
  if (!t) return [];
  const body = feelBody(t);
  if (body != null) {
    let b = body.trim();
    const flat = /^flatten\(\s*(\[[\s\S]*\])\s*\)$/.exec(b);
    if (flat) b = flat[1];
    // Liste: jedes Element ein Text oder ein Ausdruck
    const list = /^\[([\s\S]*)\]$/.exec(b);
    if (list) return splitTop(list[1]).map(x => unquote(x) ?? `= ${x}`);
    // ein Text (auch einer mit Kommas aus einer alten Umwandlung)
    const text = unquote(b);
    if (text != null) return splitTop(text);
    return [`= ${b}`];
  }
  // Camunda 7: Text mit Kommas, Ausdrücke als `${…}`
  return splitTop(t).map(x => (/^[$#]\{/.test(x) ? importExpression(x) : x));
}
