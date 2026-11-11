// A variable set on a gateway (a retry counter `count + 1`).
//
// Camunda 7 rejects an input/output mapping on a gateway (ENGINE-09005); there a
// listener sets the variable: `${execution.setVariable("count", …)}`. The specification
// shows it as an output of the gateway step — the import reads the listener as one, the
// export writes the output as one again (engineConvert does the same on a conversion).
//
// The listener runs on `start`: the conditions of the gateway already see the new value.
// Only a join of a parallel or inclusive gateway takes `end` — once, not once per branch.

const local = (el: Element): string => {
  const n = el.localName || el.tagName || '';
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};

export const isGateway = (el: Element): boolean => local(el).endsWith('Gateway');

/** `start`, or `end` at a join of a parallel or inclusive gateway (see above) */
export function gatewayListenerEvent(el: Element): 'start' | 'end' {
  const id = el.getAttribute('id');
  const incoming = Array.from(el.parentElement?.children ?? [])
    .filter(k => local(k) === 'sequenceFlow' && k.getAttribute('targetRef') === id).length;
  return (local(el) === 'parallelGateway' || local(el) === 'inclusiveGateway') && incoming > 1 ? 'end' : 'start';
}

/**
 * The variable and the value (JUEL, without `${}`) of a listener expression that is
 * exactly one `execution.setVariable("x", …)` — null for anything else.
 */
export function listenerAssignment(expression: string): { name: string; value: string } | null {
  const head = /^\s*\$\{\s*execution\.setVariable\(\s*(["'])([A-Za-z_][\w.-]*)\1\s*,/.exec(expression);
  if (!head) return null;
  let depth = 1, quote = '';
  for (let i = head[0].length; i < expression.length; i++) {
    const ch = expression[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) {
      if (!/^\s*\}\s*$/.test(expression.slice(i + 1))) return null;
      const value = expression.slice(head[0].length, i).trim();
      return value ? { name: head[2], value } : null;
    }
  }
  return null;
}

/** The listener expression for the variable and its JUEL value (without `${}`) */
export const listenerExpression = (name: string, value: string): string =>
  `\${execution.setVariable(${JSON.stringify(name)}, ${value})}`;

/** The `setVariable` listeners (start/end) of an element — per variable */
export function assignmentListeners(ext: Element | null): Map<string, { el: Element; value: string }> {
  const out = new Map<string, { el: Element; value: string }>();
  for (const l of Array.from(ext?.children ?? [])) {
    if (local(l) !== 'executionListener') continue;
    const event = l.getAttribute('event') ?? 'start';
    if (event !== 'start' && event !== 'end') continue;
    const a = listenerAssignment(l.getAttribute('expression') ?? '');
    if (a && !out.has(a.name)) out.set(a.name, { el: l, value: a.value });
  }
  return out;
}
