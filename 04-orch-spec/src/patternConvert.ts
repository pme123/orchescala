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
import { convertBpmn, detectEngine, type ConvertOptions } from './engineConvert.ts';
import { applyPattern, detectPatterns, fragmentFor, stripPatternItems, type PatternHit } from './patterns.ts';
import { engineLabel } from './engineLabels.ts';
import type { WriteIssue, WriteResult } from './bpmnWrite.ts';
import type { EngineId, PatternDef } from './types.ts';

type Opts = ConvertOptions;
type Failed = Map<number, { h: PatternHit; why: string }>;
const sameParams = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys({ ...a, ...b }).every(k => (a[k] ?? '') === (b[k] ?? ''));

export function convertWithPatterns(xml: string, target: EngineId, defs: PatternDef[] | undefined, opts: Opts = {}): WriteResult & { changed: boolean } {
  const from = detectEngine(xml);
  if (from === target || !defs?.length) return convertBpmn(xml, target, opts);
  // one definition per ID - the first, as in patternDefs (own before standard)
  const unique = defs.filter((d, i) => defs.findIndex(x => x.id === d.id) === i);
  const byId = new Map(unique.map(d => [d.id, d]));
  // a pattern that could not be inserted again is converted like the rest in the next pass - it
  // is not lost, and the others still go over in their target form. Each pass skips at least one
  // more hit, so it ends after at most one pass per hit; should it not, the plain conversion.
  const failed: Failed = new Map();
  let result: (WriteResult & { changed: boolean }) | null = null;
  let settled = false;
  for (let pass = 0, hits = 1; pass <= hits; pass++) {
    const run = attempt(xml, target, byId, unique, opts, new Set(failed.keys()));
    hits = run.hits;
    result = run.result;
    if (!run.failed.size) { settled = true; break; }
    for (const [i, f] of run.failed) failed.set(i, f);
  }
  // nothing left to do with patterns (all failed, or none) or not settled: the plain conversion -
  // with the notes
  if (!settled || !result) result = convertBpmn(xml, target, opts);
  if (!failed.size) return result;
  const note = [...failed.values()].map(({ h, why }) => ({
    stepId: h.targetId ?? '', where: 'Pattern',
    text: `«${byId.get(h.patternId)!.name}» liess sich nicht in der Form für ${engineLabel(target)} einsetzen${why ? ` (${why})` : ''} — umgewandelt wie der Rest, von Hand prüfen.`,
  }));
  return { ...result, issues: [...result.issues, ...note] };
}

/**
 * One conversion: take out the patterns that have a target form and are not skipped (by their
 * position, see stripPatternItems), convert the rest, insert them again. `failed`: those that did
 * not come back on their element; `result` is null if there is nothing to do with patterns.
 */
function attempt(xml: string, target: EngineId, byId: Map<string, PatternDef>, defs: PatternDef[], opts: Opts, skip: ReadonlySet<number>):
  { result: (WriteResult & { changed: boolean }) | null; failed: Failed; hits: number } {
  const hasTarget = (h: PatternHit) => !!fragmentFor(byId.get(h.patternId)!, target);
  const strip = stripPatternItems(xml, defs, detectEngine(xml), (h, i) => hasTarget(h) && !skip.has(i));
  const without = strip.all.filter(h => !hasTarget(h));
  const failed: Failed = new Map();
  if (!strip.taken.length && !without.length) return { result: null, failed, hits: strip.all.length };

  const conv = convertBpmn(strip.xml, target, opts);
  let out = conv.xml;
  const extra: WriteIssue[] = without.map(h => ({
    stepId: h.targetId ?? '', where: 'Pattern',
    text: `«${byId.get(h.patternId)!.name}» hat kein BPMN für ${engineLabel(target)} — umgewandelt wie der Rest, von Hand prüfen.`,
  }));
  const inserted = new Map<number, { changed: boolean; issues: string[] }>();
  for (const i of strip.taken) {
    const h = strip.all[i];
    try {
      const res = applyPattern(out, byId.get(h.patternId)!, target, h.targetId, h.params);
      if (res.changed) out = res.xml;
      inserted.set(i, res);
    } catch (e) {
      // not a misfit but a fault of inserting - logged, and the pattern goes over like the rest
      console.warn(`[orch-spec] inserting «${h.patternId}» at ${h.targetId ?? 'the process'} failed:`, e);
      failed.set(i, { h, why: e instanceof Error ? e.message : String(e) });
    }
  }

  // each pattern on its element again - with the same parameters; a hit is matched only once,
  // the one with the same parameters first. Another one of the pattern on the element counts only
  // if it is the only one there - with several, a different one could pass for it
  const pool = [...detectPatterns(out, defs, target).hits];
  const samePlace = (a: PatternHit, b: PatternHit) => a.patternId === b.patternId && (a.targetId ?? '') === (b.targetId ?? '');
  const take1 = (h: PatternHit) => {
    const k = pool.findIndex(x => samePlace(x, h) && sameParams(x.params, h.params));
    const alone = strip.all.filter(x => samePlace(x, h)).length === 1;
    const j = k >= 0 ? k : alone ? pool.findIndex(x => samePlace(x, h)) : -1;
    return j >= 0 ? pool.splice(j, 1)[0] : undefined;
  };
  for (const i of strip.taken) {
    if (failed.has(i)) continue;
    const h = strip.all[i];
    const def = byId.get(h.patternId)!;
    const stepId = h.targetId ?? '';
    const res = inserted.get(i)!;
    const again = take1(h);
    if (!again) { failed.set(i, { h, why: res.issues.join(' ') }); continue; }
    // what inserting says (a limitation on the engine, a kept correlation key) - not when it
    // found everything there already
    if (res.changed) for (const text of res.issues) extra.push({ stepId, where: 'Pattern', text });
    if (!sameParams(h.params, again.params)) {
      const keys = Object.keys({ ...h.params, ...again.params }).filter(k => (h.params[k] ?? '') !== (again.params[k] ?? ''));
      extra.push({ stepId, where: 'Pattern', text: `«${def.name}»: ${keys.map(k => `«${k}» war «${h.params[k] ?? ''}», ist jetzt «${again.params[k] ?? ''}»`).join(', ')} — prüfen.` });
    }
  }
  return { result: { xml: out, issues: [...conv.issues, ...extra], changed: out !== xml }, failed, hits: strip.all.length };
}
