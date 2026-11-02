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

export function convertWithPatterns(xml: string, target: EngineId, defs: PatternDef[] | undefined, opts: Opts = {}): WriteResult & { changed: boolean } {
  const from = detectEngine(xml);
  if (from === target || !defs?.length) return convertBpmn(xml, target, opts);
  const defOf = (id: string) => defs.find(d => d.id === id);
  const hasTarget = (h: PatternHit) => !!fragmentFor(defOf(h.patternId)!, target);
  // a pattern without BPMN for the target engine is converted like everything else
  const strip = stripPatternItems(xml, defs, from, hasTarget);
  const without = strip.all.filter(h => !hasTarget(h));
  if (!strip.hits.length && !without.length) return convertBpmn(xml, target, opts);

  const conv = convertBpmn(strip.xml, target, opts);
  let out = conv.xml;
  const extra: WriteIssue[] = without.map(h => ({
    stepId: h.targetId ?? '', where: 'Pattern',
    text: `«${defOf(h.patternId)!.name}» hat kein BPMN für ${engineLabel(target)} - umgewandelt wie der Rest, von Hand prüfen.`,
  }));
  const inserted = new Map<PatternHit, { changed: boolean; issues: string[] }>();
  for (const h of strip.hits) {
    const res = applyPattern(out, defOf(h.patternId)!, target, h.targetId, h.params);
    if (res.changed) out = res.xml;
    inserted.set(h, res);
  }

  // each pattern on its element again - with the same parameters
  const now = detectPatterns(out, defs, target).hits;
  for (const h of strip.hits) {
    const def = defOf(h.patternId)!;
    const stepId = h.targetId ?? '';
    const again = now.find(x => x.patternId === h.patternId && x.targetId === h.targetId);
    // what inserting says (a limitation on the engine, a kept correlation key, why it failed) -
    // not when it found everything there already
    const res = inserted.get(h)!;
    if (res.changed || !again) for (const text of res.issues) extra.push({ stepId, where: 'Pattern', text });
    if (!again) {
      extra.push({ stepId, where: 'Pattern', text: `«${def.name}» liess sich nicht in der Form für ${engineLabel(target)} einsetzen - von Hand ergänzen.` });
      continue;
    }
    const changed = Object.keys({ ...h.params, ...again.params }).filter(k => (h.params[k] ?? '') !== (again.params[k] ?? ''));
    if (changed.length) extra.push({ stepId, where: 'Pattern', text: `«${def.name}»: ${changed.map(k => `«${k}» war «${h.params[k] ?? ''}», ist jetzt «${again.params[k] ?? ''}»`).join(', ')} - prüfen.` });
  }
  return { xml: out, issues: [...conv.issues, ...extra], changed: true };
}
