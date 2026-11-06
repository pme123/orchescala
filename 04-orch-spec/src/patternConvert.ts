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
import { NO_DI, applyPattern, detectPatterns, fragmentFor, graftEventSubExtras, keepPositions, patternParams, resolvedDefaults, stripPatternItems, type PatternHit } from './patterns.ts';
import { engineLabel } from './engineLabels.ts';
import { paramForChecked, paramView } from './patternParams.ts';
import type { WriteIssue, WriteResult } from './bpmnWrite.ts';
import type { EngineId, PatternDef } from './types.ts';

type Failed = Map<number, { h: PatternHit; why: string }>;
const sameParams = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys({ ...a, ...b }).every(k => (a[k] ?? '') === (b[k] ?? ''));

export function convertWithPatterns(xml: string, target: EngineId, defs: PatternDef[] | undefined, opts: ConvertOptions = {}): WriteResult & { changed: boolean } {
  const from = detectEngine(xml);
  if (from === target || !defs?.length) return convertBpmn(xml, target, opts);
  // one definition per ID - the first, as in patternDefs (own before standard)
  const unique = defs.filter((d, i) => defs.findIndex(x => x.id === d.id) === i);
  const byId = new Map(unique.map(d => [d.id, d]));
  // a pattern that could not be inserted again is converted like the rest in the next pass - it
  // is not lost, and the others still go over in their target form. Each pass skips all failures
  // so far, so it ends after at most one pass per hit.
  const failed: Failed = new Map();
  /** the result with the patterns; null: nothing to do with them, or they gave up */
  let result: (WriteResult & { changed: boolean }) | null = null;
  let gaveUp: string | null = null;
  try {
    for (let pass = 0, limit = 1; ; pass++) {
      const run = attempt(xml, target, byId, unique, opts, new Set(failed.keys()));
      limit = run.hits;
      if (!run.failed.size) { result = run.result; break; }
      for (const [i, f] of run.failed) failed.set(i, f);
      if (pass >= limit) { gaveUp = 'zu viele Durchgänge'; break; }
    }
  } catch (e) {
    // a fault in converting the rest or in recognising: the plain conversion
    gaveUp = e instanceof Error ? e.message : String(e);
  }
  // without patterns (none to do, or given up): the plain conversion - with the notes
  if (!result) result = convertBpmn(xml, target, opts);
  if (!failed.size && !gaveUp) return result;
  const note: WriteIssue[] = [...failed.values()].map(({ h, why }) => ({
    stepId: h.targetId ?? '', where: 'Pattern',
    text: `«${byId.get(h.patternId)!.name}» liess sich nicht in der Form für ${engineLabel(target)} einsetzen${why ? ` (${why})` : ''} — umgewandelt wie der Rest, von Hand prüfen.`,
  }));
  if (gaveUp) note.push({ stepId: '', where: 'Pattern', text: `Die Pattern liessen sich nicht in der Form für ${engineLabel(target)} einsetzen (${gaveUp}) — alle umgewandelt wie der Rest, von Hand prüfen.` });
  return { ...result, issues: [...result.issues, ...note] };
}

/**
 * One conversion: take out the patterns that have a target form and are not skipped (by their
 * position, see stripPatternItems), convert the rest, insert them again. `failed`: those that did
 * not come back on their element; `result` is null if there is nothing to do with patterns.
 */
function attempt(xml: string, target: EngineId, byId: Map<string, PatternDef>, defs: PatternDef[], opts: ConvertOptions, skip: ReadonlySet<number>):
  { result: (WriteResult & { changed: boolean }) | null; failed: Failed; hits: number } {
  // a hit only comes from one of the definitions - one without is left as it is
  const hasTarget = (h: PatternHit) => { const d = byId.get(h.patternId); return !!d && !!fragmentFor(d, target); };
  const strip = stripPatternItems(xml, defs, detectEngine(xml), (h, i) => hasTarget(h) && !skip.has(i));
  const without = strip.all.filter(h => byId.has(h.patternId) && !hasTarget(h));
  const failed: Failed = new Map();
  if (!strip.taken.length && !without.length) return { result: null, failed, hits: strip.all.length };

  const conv = convertBpmn(strip.xml, target, opts);
  let out = conv.xml;
  const extra: WriteIssue[] = without.map(h => ({
    stepId: h.targetId ?? '', where: 'Pattern',
    text: `«${byId.get(h.patternId)!.name}» hat kein BPMN für ${engineLabel(target)} — umgewandelt wie der Rest, von Hand prüfen.`,
  }));
  // the parameters in the form of the target engine (`${…}` ⇄ `=…`, fixed text stays)
  // translated once per hit - keyed by the hit object: strip.taken points into strip.all, and every
  // use below takes the hits from there
  const cache = new Map<PatternHit, Array<readonly [string, { value: string; untranslated?: string }]>>();
  const checked = (h: PatternHit) => {
    let c = cache.get(h);
    if (!c) { c = Object.entries(h.params).map(([k, v]) => [k, paramForChecked(v, target, opts.juel?.vars ?? [])] as const); cache.set(h, c); }
    return c;
  };
  const paramsIn = (h: PatternHit) => Object.fromEntries(checked(h).map(([k, c]) => [k, c.value]));
  const inserted = new Map<number, { changed: boolean; issues: string[] }>();
  for (const i of strip.taken) {
    const h = strip.all[i];
    // a parameter without a form for the target engine: the pattern goes over like the rest
    const untranslated = checked(h).filter(([, c]) => c.untranslated);
    if (untranslated.length) {
      failed.set(i, { h, why: untranslated.map(([k, c]) => `«${k}» = «${paramView(h.params[k])}» ist nicht für ${engineLabel(target)} übersetzbar: ${c.untranslated}`).join('; ') });
      continue;
    }
    try {
      const res = applyPattern(out, byId.get(h.patternId)!, target, h.targetId, paramsIn(h));
      if (res.changed) out = res.xml;
      inserted.set(i, res);
    } catch (e) {
      // a fault of inserting - the pattern goes over like the rest, the reason is in the note
      failed.set(i, { h, why: e instanceof Error ? e.message : String(e) });
    }
  }

  // the own steps of an event sub process back into it
  const grafted = graftEventSubExtras(out, strip.extras, defs, target);
  out = grafted.xml;
  for (const text of grafted.issues) extra.push({ stepId: '', where: 'Pattern', text });

  // each pattern on its element again - with the same parameters; a hit is matched only once,
  // the one with the same parameters first. Another one of the pattern on the element counts only
  // if it is the only one there - with several, a different one could pass for it
  const pool = [...detectPatterns(out, defs, target).hits];
  // a parameter of one engine only (`engines`: the process ID C8 gets when inserted, C7 reads it at
  // runtime) does not go over - and the other way round it takes its default: no change either way
  const oneEngine = new Map<PatternDef, Set<string>>();
  const defaultsCache = new Map<PatternDef, Record<string, string>>();
  const defaultsOf = (def: PatternDef) => {
    let d = defaultsCache.get(def);
    if (!d) { d = resolvedDefaults(xml, def); defaultsCache.set(def, d); }
    return d;
  };
  const onTarget = (def: PatternDef, p: Record<string, string>) => {
    let skip = oneEngine.get(def);
    if (!skip) {
      skip = new Set(patternParams(def).filter(x => !!x.engines?.length && !(x.engines.includes('c7') && x.engines.includes('c8'))).map(x => x.name));
      oneEngine.set(def, skip);
    }
    return Object.fromEntries(Object.entries(p).filter(([k]) => !skip.has(k)));
  };
  const samePlace = (a: PatternHit, b: PatternHit) => a.patternId === b.patternId && (a.targetId ?? '') === (b.targetId ?? '');
  const take1 = (h: PatternHit) => {
    const def = byId.get(h.patternId);
    if (!def) return undefined;
    const k = pool.findIndex(x => samePlace(x, h) && sameParams(onTarget(def, x.params), onTarget(def, paramsIn(h))));
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
    if (!again) { failed.set(i, { h, why: res.issues.join(' ') || 'nach dem Einsetzen nicht wiedererkannt' }); continue; }
    // what inserting says (a limitation on the engine, a kept correlation key) - not when it
    // found everything there already
    // (a diagram without shapes stays one - no note about that)
    if (res.changed) for (const text of res.issues) if (text !== NO_DI) extra.push({ stepId, where: 'Pattern', text });
    const wanted = onTarget(def, paramsIn(h)), found = onTarget(def, again.params);
    if (!sameParams(wanted, found)) {
      const keys = Object.keys({ ...wanted, ...found }).filter(k => (wanted[k] ?? '') !== (found[k] ?? ''));
      const shown = (v: string | undefined) => paramView(v ?? '');
      extra.push({ stepId, where: 'Pattern', text: `«${def.name}»: ${keys.map(k => `«${k}» war «${shown(h.params[k])}», ist jetzt «${shown(found[k])}»`).join(', ')} — prüfen.` });
    }
    // a parameter the target engine does not have, with a value other than its default (set by
    // hand, or stale - the caller ID after a rename): it does not go over
    const absent = patternParams(def).filter(p => !!p.engines?.length && !p.engines.includes(target) && h.params[p.name]);
    // (the defaults only when there is such a parameter - they read the diagram; once per pattern)
    const defaults = absent.length ? defaultsOf(def) : {};
    const differs = absent
      .filter(p => h.params[p.name] !== (defaults[p.name] ?? ''))
      .map(p => `«${p.label ?? p.name}» ist «${paramView(h.params[p.name])}», nicht die Vorgabe «${paramView(defaults[p.name] ?? '')}»`);
    if (differs.length) extra.push({ stepId, where: 'Pattern', text: `«${def.name}»: ${differs.join(', ')} — auf ${engineLabel(target)} gibt es den Parameter nicht, beim Zurückwechseln gilt die Vorgabe.` });
  }
  // a block taken out and inserted again (on the process) stays where it was
  out = keepPositions(xml, out);
  return { result: { xml: out, issues: [...conv.issues, ...extra], changed: out !== xml }, failed, hits: strip.all.length };
}
