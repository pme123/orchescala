// Switch engine with the patterns: what a pattern carries goes over in the form of its BPMN for
// the target engine - not as an expression translated piece by piece. «Identität übernehmen»
// has a C7 listener with `execution.getVariableTyped(…)`, which has no FEEL translation; its C8
// form (output mappings) is known, so the conversion takes that.
//
// 1. What the recognised patterns carry on their element is taken out (stripPatternItems) -
//    their paths and blocks stay where they are.
// 2. The rest is converted as before (convertBpmn), paths and blocks included.
// 3. Each pattern is inserted again at its element with its parameters, in the form of the
//    target engine. Paths and blocks that are already there are not added twice.
// So no old form stays beside the new one (C8 output mappings would otherwise become C7 output
// parameters next to the pattern's listeners).
import { convertBpmn, detectEngine } from './engineConvert.ts';
import { applyPattern, detectPatterns, fragmentFor, stripPatternItems, type PatternHit } from './patterns.ts';
import { engineLabel } from './engineLabels.ts';
import type { WriteIssue, WriteResult } from './bpmnWrite.ts';
import type { EngineId, PatternDef } from './types.ts';

type Opts = Parameters<typeof convertBpmn>[2];
const keyOf = (h: PatternHit) => `${h.patternId}@${h.targetId ?? ''}`;
const sameParams = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys({ ...a, ...b }).every(k => (a[k] ?? '') === (b[k] ?? ''));

export function convertWithPatterns(xml: string, target: EngineId, defs: PatternDef[] | undefined, opts: Opts = {}): WriteResult & { changed: boolean } {
  const from = detectEngine(xml);
  if (from === target || !defs?.length) return convertBpmn(xml, target, opts);
  const byId = new Map(defs.map(d => [d.id, d]));
  const hasTarget = (h: PatternHit) => !!fragmentFor(byId.get(h.patternId)!, target);
  const first = attempt(xml, target, byId, defs, opts, h => hasTarget(h));
  if (!first) return convertBpmn(xml, target, opts);
  // a pattern that could not be inserted again: convert it like the rest instead - it is not lost
  if (!first.failed.size) return first.result;
  const second = attempt(xml, target, byId, defs, opts, h => hasTarget(h) && !first.failed.has(keyOf(h)));
  const result = second?.result ?? convertBpmn(xml, target, opts);
  const note = [...first.failed.values()].map(({ h, why }) => ({
    stepId: h.targetId ?? '', where: 'Pattern',
    text: `«${byId.get(h.patternId)!.name}» liess sich nicht in der Form für ${engineLabel(target)} einsetzen${why ? ` (${why})` : ''} - umgewandelt wie der Rest, von Hand prüfen.`,
  }));
  return { ...result, issues: [...result.issues, ...note] };
}

/**
 * One conversion: take out the patterns `take` chooses, convert the rest, insert them again.
 * `failed`: the patterns that did not come back on their element - null if there is nothing to do.
 */
function attempt(xml: string, target: EngineId, byId: Map<string, PatternDef>, defs: PatternDef[], opts: Opts, take: (h: PatternHit) => boolean):
  { result: WriteResult & { changed: boolean }; failed: Map<string, { h: PatternHit; why: string }> } | null {
  const strip = stripPatternItems(xml, defs, detectEngine(xml), take);
  const without = strip.all.filter(h => !fragmentFor(byId.get(h.patternId)!, target));
  if (!strip.hits.length && !without.length) return null;

  const conv = convertBpmn(strip.xml, target, opts);
  let out = conv.xml;
  const extra: WriteIssue[] = without.map(h => ({
    stepId: h.targetId ?? '', where: 'Pattern',
    text: `«${byId.get(h.patternId)!.name}» hat kein BPMN für ${engineLabel(target)} - umgewandelt wie der Rest, von Hand prüfen.`,
  }));
  const inserted = new Map<PatternHit, { changed: boolean; issues: string[] }>();
  const failed = new Map<string, { h: PatternHit; why: string }>();
  for (const h of strip.hits) {
    try {
      const res = applyPattern(out, byId.get(h.patternId)!, target, h.targetId, h.params);
      if (res.changed) out = res.xml;
      inserted.set(h, res);
    } catch (e) {
      failed.set(keyOf(h), { h, why: e instanceof Error ? e.message : String(e) });
    }
  }

  // each pattern on its element again - with the same parameters; a hit is matched only once
  // (two of the same pattern on one element), the one with the same parameters first
  const pool = [...detectPatterns(out, defs, target).hits];
  const take1 = (h: PatternHit) => {
    const same = (x: PatternHit) => x.patternId === h.patternId && (x.targetId ?? '') === (h.targetId ?? '');
    const i = pool.findIndex(x => same(x) && sameParams(x.params, h.params));
    const j = i >= 0 ? i : pool.findIndex(same);
    return j >= 0 ? pool.splice(j, 1)[0] : undefined;
  };
  for (const h of strip.hits) {
    if (failed.has(keyOf(h))) continue;
    const def = byId.get(h.patternId)!;
    const stepId = h.targetId ?? '';
    const res = inserted.get(h)!;
    const again = take1(h);
    if (!again) { failed.set(keyOf(h), { h, why: res.issues.join(' ') }); continue; }
    // what inserting says (a limitation on the engine, a kept correlation key) - not when it
    // found everything there already
    if (res.changed) for (const text of res.issues) extra.push({ stepId, where: 'Pattern', text });
    if (!sameParams(h.params, again.params)) {
      const keys = Object.keys({ ...h.params, ...again.params }).filter(k => (h.params[k] ?? '') !== (again.params[k] ?? ''));
      extra.push({ stepId, where: 'Pattern', text: `«${def.name}»: ${keys.map(k => `«${k}» war «${h.params[k] ?? ''}», ist jetzt «${again.params[k] ?? ''}»`).join(', ')} - prüfen.` });
    }
  }
  return { result: { xml: out, issues: [...conv.issues, ...extra], changed: out !== xml }, failed };
}
