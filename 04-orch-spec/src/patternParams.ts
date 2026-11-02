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
 * Back into the form of the engine — FEEL that does not translate to JUEL stays as is (and is
 * reported where it is edited). `vars`: they determine how a Spin path ends (`numberValue()` …).
 */
export function paramStored(view: string, engine: EngineId, vars: readonly VarNode[] = []): string {
  const body = feelBody(view);
  if (body == null) return view;
  if (engine === 'c8') return `=${body.trim()}`;
  const r = feelToJuel(body, { vars });
  return r.ok ? `\${${r.juel}}` : view;
}

/** A stored value of one engine in the form of the other */
export const paramFor = (stored: string, engine: EngineId, vars: readonly VarNode[] = []): string => paramStored(paramView(stored), engine, vars);

/**
 * Like paramFor, and why FEEL did not translate to JUEL - then the value stays FEEL, which
 * Camunda 7 would take as fixed text.
 */
export function paramForChecked(stored: string, engine: EngineId, vars: readonly VarNode[] = []): { value: string; untranslated?: string } {
  const view = paramView(stored);
  const body = feelBody(view);
  if (engine !== 'c7' || body == null) return { value: paramStored(view, engine, vars) };
  const r = feelToJuel(body, { vars });
  return r.ok ? { value: `\${${r.juel}}` } : { value: view, untranslated: r.reason };
}
