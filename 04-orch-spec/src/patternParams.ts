// The value of a pattern parameter is written literally into the BPMN (`{{name}}`) - so it is
// kept in the form of the engine: `${x}` in Camunda 7, `=x` in Camunda 8. It is shown and edited
// like a mapping value: with «=» FEEL, otherwise fixed text. A switch of engine translates it.
import { feelBody, feelToJuel } from './feelJuel.ts';
import { importExpression, isJuel } from './juelFeel.ts';
import type { VarNode } from './feel.ts';
import type { EngineId } from './types.ts';

/** How a stored value is shown: FEEL with «=», fixed text as it is */
export const paramView = (stored: string): string => (isJuel(stored) || feelBody(stored) != null ? importExpression(stored) : stored);

/**
 * Into the form of the engine, and why FEEL did not translate to JUEL - then the value stays FEEL
 * (Camunda 7 would take it as fixed text; reported where it is edited and by the engine switch).
 * `vars`: they determine how a Spin path ends (`numberValue()` …).
 */
export function paramStoredChecked(view: string, engine: EngineId, vars: readonly VarNode[] = []): { value: string; untranslated?: string } {
  const body = feelBody(view);
  if (body == null) return { value: view };
  if (engine === 'c8') return { value: `=${body.trim()}` };
  const r = feelToJuel(body, { vars });
  return r.ok ? { value: `\${${r.juel}}` } : { value: view, untranslated: r.reason };
}

/** Back into the form of the engine (see paramStoredChecked) */
export const paramStored = (view: string, engine: EngineId, vars: readonly VarNode[] = []): string => paramStoredChecked(view, engine, vars).value;

/** A stored value of one engine in the form of the other - with the reason if FEEL did not translate */
export const paramForChecked = (stored: string, engine: EngineId, vars: readonly VarNode[] = []) => paramStoredChecked(paramView(stored), engine, vars);
