// Findings per step — for the triangle in the tree row.
//
// What the properties panel on the right reports at one place (FEEL errors,
// duplicate or missing required fields, an interaction without In/Out, a
// service the catalog does not know) should already be visible in the flow —
// as a red (error) or orange (warning) triangle on the row, with the
// first messages in the tooltip. The same rules as in the panel, just collected.

import type { DomainType, EngineId, ErrorHandling, Field, Interaction, InteractionKind, Mapping, Model, MultiInstanceSpec, ProcessSpec, ServiceDef, Step, TimerSpec } from './types';
import { C7_LABEL, C8_LABEL } from './engineLabels';
import { INTERACTION_META } from './types';
import { checkFeel, conditionExpected, domainInputNames, domainRequired, inConfigField, inConfigWarning, referencedVariables, expectedFor, expectedFromDomain, isFeel, multiInstanceScopes, processVariables, resultVariables, stepDomainMember, withMultiInstance, type VarNode } from './feel';
import { feelBody, feelSyntaxOk, feelToGroovy, feelToJuel } from './feelJuel';
import { isJuel } from './juelFeel';
import { catalogEntry, interactionKind, interactionOrigin, wiringSteps } from './interactions';
import { dmnIssues, packageOf } from './scala';
import { GENERAL_VARIABLES, allSteps, isEventBoundary, isInitWorker, timerVariable, unnamed } from './bpmn';
import { correlationOf } from './messageCall';
import { patternMappings, patternDefs } from './patterns';
import { ALL_VARIANTS, chosenVariant, classFieldsOf, noVariantText, routingMissing, routingText, variantAllows, variantRequires, variantsOf } from './variants';

export interface Finding {
  errors: string[];
  warnings: string[];
  /**
   * Messages the step's panel already shows in place (mapping row,
   * handled error) — the list at the top of the step does not repeat them.
   * They are still counted (tree, filter).
   */
  inline?: string[];
}

const NONE: Finding = { errors: [], warnings: [], inline: [] };

/**
 * All findings of a process, per step — computed once, then retrievable per
 * step ID. The process variables are built once, the
 * result variables per step.
 */
export function collectFindings(spec: ProcessSpec, model: Model | null, steps: Step[]): Map<string, Finding> {
  const out = new Map<string, Finding>();
  const variables = processVariables(spec, model);
  const scopes = multiInstanceScopes(spec.steps);
  const wiring = wiringSteps(spec);
  const kinds = timerKinds(spec.steps);
  for (const step of steps) {
    const f = stepFindings(step, spec, model, variables, { scopes, wiring, kinds });
    if (f.errors.length || f.warnings.length) out.set(step.id, f);
  }
  return out;
}

/** The required inputs: not optional in the own In, in the domain — or `required` according to the catalog. */
function requiredNames(refFields: Field[] | null, dom: DomainType | null, service: ServiceDef | null): string[] {
  return refFields
    ? refFields.filter(f => !f.optional).map(f => f.name)
    : [...(dom?.fields ?? []), ...(dom?.cases ?? []).flatMap(c => c.fields ?? [])].filter(p => domainRequired(dom, p.name)).map(p => p.name)
      .concat((service?.inputs ?? []).filter(p => p.required && domainRequired(dom, p.name) == null).map(p => p.name));
}

/**
 * The required inputs of a step that have no row yet — by
 * the same rule as the finding «Pflichtfeld … fehlt». Not for
 * user tasks, custom workers and the init worker (they read their In from
 * the process variables) and not if a pattern defines the call.
 * A deselected row counts as present: someone decided it that way.
 */
/**
 * Who reads their `In` directly from the process variables — without mapping, so without
 * the finding «Pflichtfeld fehlt»: user tasks, custom workers, DMN decisions
 * of the process and the init worker. One rule for both checks
 * (`missingRequiredInputs`, `stepFindings`).
 */
export const readsInDirectly = (kind: InteractionKind | null | undefined, initWorker: boolean): boolean =>
  initWorker || kind === 'userTask' || kind === 'customTask' || kind === 'decision';

export function missingRequiredInputs(step: Step, spec: ProcessSpec, model: Model | null): string[] {
  const processId = spec.processId ?? '';
  const initWorker = isInitWorker(step, processId);
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id) ?? null;
  const kind = ia?.kind ?? interactionKind(step, processId);
  if (readsInDirectly(kind, initWorker)) return [];
  if (patternMappings(patternDefs(model), step.patterns, spec.engine ?? 'c7').inputs.size) return [];
  const types = spec.types ?? [];
  const inT = ia?.inTypeId ? types.find(t => t.id === ia.inTypeId) : undefined;
  const refFields = ia?.inTypeId ? (inT ? classFieldsOf(inT) : []) : null;
  const service = catalogEntry(step, model);
  const dom = stepDomainMember(step, spec, model, 'In');
  const variants = variantsOf(step, spec, model, 'inputs', service);
  const chosen = chosenVariant(step, 'inputs', variants);
  const have = new Set((step.inputs ?? []).map(m => m.name.trim()));
  // Switches: one is enough — without a row for any of them, the first (`useCase`)
  const routing = variants?.routing?.some(n => have.has(n)) ? [] : variants?.routing?.slice(0, 1) ?? [];
  return [...new Set([...requiredNames(refFields, dom, service), ...routing])]
    .filter(n => (variantRequires(variants, chosen, n) || routing.includes(n)) && !have.has(n));
}

/**
 * All fields of a service call as rows — on import, on reconciliation and
 * on opening: what the service can receive or return is listed; **checked**
 * are only the required inputs and the outputs the process needs
 * (`_outputVariables`), the rest is deselected (visible, does not go into the BPMN).
 * Existing rows stay as they are. Not for user tasks, custom
 * workers, the init worker and decisions (they read or write their
 * variables directly) and not if a pattern defines the call.
 * `added` names «Schritt: Feld» of the newly checked rows.
 *
 * `importing`: the BPMN is just coming in (create, reconciliation). If the
 * inputs then pass fields of several variants, the worker decides — the
 * step gets «alle Ausprägungen». Not on opening: there a
 * mixed choice is a mistake that the warning should show.
 */
export function withServiceRows(spec: ProcessSpec, model: Model | null, opts: { importing?: boolean } = {}): { spec: ProcessSpec; added: string[]; changed: boolean } {
  const added: string[] = [];
  let changed = false;
  const processId = spec.processId ?? '';
  const types = spec.types ?? [];
  const visit = (steps: Step[]): Step[] => steps.map(s => {
    let next = s;
    const ia = (spec.interactions ?? []).find(i => i.stepId === s.id) ?? null;
    const kind = ia?.kind ?? interactionKind(s, processId);
    const eligible = (s.kind === 'service' || s.kind === 'call' || s.kind === 'send')
      && !isInitWorker(s, processId) && kind !== 'userTask' && kind !== 'customTask'
      && !patternMappings(patternDefs(model), s.patterns, spec.engine ?? 'c7').inputs.size;
    if (eligible) {
      const service = catalogEntry(s, model);
      const inConfig = inConfigField(stepDomainMember(s, spec, model, 'In'));
      const fieldsOf = (list: 'inputs' | 'outputs'): Array<{ name: string; description?: string }> => {
        const typeId = list === 'inputs' ? ia?.inTypeId : ia?.outTypeId;
        const own = typeId ? types.find(t => t.id === typeId) : undefined;
        if (own) return [...(own.fields ?? []), ...(own.values ?? []).flatMap(v => v.fields ?? [])].filter(f => f.name).map(f => ({ name: f.name, description: f.description }));
        const dom = stepDomainMember(s, spec, model, list === 'inputs' ? 'In' : 'Out');
        // not `inConfig`: the own one is different from that of the callee
        if (dom) return [...(dom.fields ?? []), ...(dom.cases ?? []).flatMap(c => c.fields ?? [])].filter(f => f.name !== inConfig).map(f => ({ name: f.name, description: f.description }));
        return ((list === 'inputs' ? service?.inputs : service?.outputs) ?? []).map(p => ({ name: p.name, description: p.description }));
      };
      const required = new Set(missingRequiredInputs(s, spec, model));
      const wanted = new Set(s.outputVariables ?? []);
      const rows = (list: 'inputs' | 'outputs'): Mapping[] | null => {
        // a deselected output the process needs according to the BPMN (`_outputVariables`)
        // gets checked — e.g. added on opening, before the reconciliation brought the list.
        // Whoever deselects it removes it from `_outputVariables` on export.
        let enabled = false;
        // a deselected row `inConfig`, as it used to be created here, is dropped
        const kept = (s[list] ?? []).filter(m => !(list === 'inputs' && m.disabled && m.name === inConfig));
        if (kept.length !== (s[list] ?? []).length) enabled = true;
        const have = kept.map(m => {
          if (list !== 'outputs' || !m.disabled || !wanted.has(m.name.trim())) return m;
          enabled = true;
          added.push(`${s.name}: ${m.name}`);
          const { disabled: _, ...rest } = m;
          return rest;
        });
        // for outputs a field that an existing row already reads also counts
        const used = new Set([...have.map(m => m.name.trim()), ...(list === 'outputs' ? have.flatMap(m => referencedVariables(m.expression)) : [])]);
        const seen = new Set<string>();
        const neu: Mapping[] = [];
        for (const f of fieldsOf(list)) {
          if (!f.name || used.has(f.name) || seen.has(f.name)) continue;
          seen.add(f.name);
          const on = list === 'inputs' ? required.has(f.name) : wanted.has(f.name);
          if (on) added.push(`${s.name}: ${f.name}`);
          neu.push({
            name: f.name, expression: `= ${f.name}`,
            ...(f.description ? { description: f.description } : {}),
            ...(on ? {} : { disabled: true }),
            // an output of the service — an entry in `_outputVariables`, not a mapping
            ...(list === 'outputs' ? { fromService: true } : {}),
          });
        }
        return neu.length || enabled ? [...have, ...neu] : null;
      };
      const ins = rows('inputs'), outs = rows('outputs');
      if (ins || outs) { changed = true; next = { ...s, ...(ins ? { inputs: ins } : {}), ...(outs ? { outputs: outs } : {}) }; }
      // needed outputs from several variants: the service returns one —
      // it decides which; the outputs then read from all (`*`)
      if (outs && next.outVariant == null) {
        const v = variantsOf(next, spec, model, 'outputs', service);
        if (v && chosenVariant(next, 'outputs', v).mixed.length) next = { ...next, outVariant: ALL_VARIANTS };
      }
      // inputs from several variants (as in the BPMN): the worker supports
      // several cases and decides on unmarshalling which one it is (`*`)
      if (opts.importing && next.inVariant == null) {
        const v = variantsOf(next, spec, model, 'inputs', service);
        if (v && chosenVariant(next, 'inputs', v).mixed.length) { changed = true; next = { ...next, inVariant: ALL_VARIANTS }; }
      }
    }
    if (next.children) next = { ...next, children: visit(next.children) };
    if (next.branches) next = { ...next, branches: next.branches.map(b => ({ ...b, steps: visit(b.steps) })) };
    if (next.errors) next = { ...next, errors: next.errors.map(e => (e.steps ? { ...e, steps: visit(e.steps) } : e)) };
    return next;
  });
  const steps = visit(spec.steps);
  return { spec: changed ? { ...spec, steps } : spec, added, changed };
}

/**
 * The timer of an event or boundary event: a variable with a default —
 * not a fixed value. `at` names the boundary event (`Boundary «inform»: `),
 * `kinds` the kinds per timer variable (otherwise computed).
 */
export function timerFindings(timer: TimerSpec, spec: ProcessSpec, errors: string[], warnings: string[], opts: { at?: string; kinds?: Map<string, Set<TimerSpec['kind']>> } = {}) {
  const at = opts.at ?? '';
  const kinds = opts.kinds ?? timerKinds(spec.steps);
  const expr = timer.expression.trim();
  if (!expr) { errors.push(`${at}Timer ohne Wert — eine Variable aus dem InConfig setzen, z. B. = timerWait.`); return; }
  const name = timerVariable(timer);
  if (!name) {
    if (!isFeel(expr)) warnings.push(`${at}Fester Timer «${expr}» — besser eine Variable mit dieser Vorgabe, z. B. = timerWait: sie kommt als Konstante ins InConfig und lässt sich je Umgebung einstellen.`);
    return;
  }
  // a constant has only one type in the InConfig — a duration is not a point in time
  const other = [...kinds.get(name) ?? []].find(k => k !== timer.kind);
  if (other) warnings.push(`${at}«${name}» ist hier ${KIND_TEXT[timer.kind]}, an einem anderen Timer ${KIND_TEXT[other]} — im InConfig hat sie nur einen Typ; eine eigene Variable je Art nehmen.`);
  const own = (spec.types ?? []).find(t => t.inConfig)?.fields?.some(f => f.name === name);
  const given = timer.default?.trim();
  if (!given && !own) warnings.push(`${at}Timer «${name}» ohne Vorgabe — im Schritt setzen (z. B. P7D), sonst steht im InConfig eine Platzhalter-Dauer.`);
  if (given && !ISO_TIMER[timer.kind].test(given)) {
    warnings.push(`${at}Vorgabe «${given}» von «${name}» ist kein${timer.kind === 'duration' ? 'e Dauer' : timer.kind === 'date' ? ' Zeitpunkt' : ' Zyklus'} nach ISO 8601 (z. B. ${ISO_EXAMPLE[timer.kind]}) — der Timer schlüge zur Laufzeit fehl.`);
  }
}

/** ISO 8601, as Camunda reads it for timers: duration `P7D`, point in time `2026-12-31T08:00:00Z`, cycle `R3/PT1H` */
const DURATION = 'P(?!$)(?:\\d+Y)?(?:\\d+M)?(?:\\d+W)?(?:\\d+D)?(?:T(?=\\d)(?:\\d+H)?(?:\\d+M)?(?:\\d+(?:[.,]\\d+)?S)?)?';
const ISO_TIMER: Record<TimerSpec['kind'], RegExp> = {
  duration: new RegExp(`^${DURATION}$`),
  date: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  cycle: new RegExp(`^R\\d*/(?:[^/]+/)?${DURATION}$`),
};
/** The kinds per timer variable in the whole process — `collectFindings` computes them once */
export function timerKinds(steps: Step[]): Map<string, Set<TimerSpec['kind']>> {
  const kinds = new Map<string, Set<TimerSpec['kind']>>();
  for (const s of allSteps(steps)) {
    for (const t of [s.timer, ...(s.errors ?? []).map(e => e.timer)]) {
      const name = timerVariable(t);
      if (name && t) kinds.set(name, (kinds.get(name) ?? new Set()).add(t.kind));
    }
  }
  return kinds;
}

const KIND_TEXT: Record<TimerSpec['kind'], string> = { duration: 'eine Dauer', date: 'ein Zeitpunkt', cycle: 'ein Zyklus' };
const ISO_EXAMPLE: Record<TimerSpec['kind'], string> = { duration: 'P7D', date: '2026-12-31T08:00:00Z', cycle: 'R3/PT1H' };

/** What is the same for all steps — `collectFindings` computes it once; if missing, `stepFindings` computes it */
export interface ProcessContext {
  scopes?: Map<string, MultiInstanceSpec[]>;
  wiring?: Set<string>;
  /** the kinds per timer variable (see timerKinds) */
  kinds?: Map<string, Set<TimerSpec['kind']>>;
}

export function stepFindings(step: Step, spec: ProcessSpec, model: Model | null, baseVariables: VarNode[], ctx: ProcessContext = {}): Finding {
  const scopes = ctx.scopes ?? multiInstanceScopes(spec.steps);
  const wiring = ctx.wiring ?? wiringSteps(spec);
  const kinds = ctx.kinds ?? timerKinds(spec.steps);
  // a step in the block of a pattern has no inputs and outputs of its own — the pattern fills it
  if (step.kind === 'goto' || step.pattern) return NONE;
  // in a multi-instance `loopCounter` and the element are added
  const variables = withMultiInstance(baseVariables, scopes.get(step.id));
  const errors: string[] = [];
  const warnings: string[] = [];
  const types = spec.types ?? [];
  const processId = spec.processId ?? '';
  const ia: Interaction | null = (spec.interactions ?? []).find(i => i.stepId === step.id) ?? null;
  // without a label in the BPMN the step is named like its ID — the name here goes in on export
  // (in a pattern block the pattern names it)
  if (unnamed(step) && !wiring.has(step.id)) warnings.push('Kein Name — im BPMN fehlt das Label; hier einen Namen setzen, der Export schreibt ihn ins BPMN.');
  // Timer: the wait time is a constant in the InConfig — otherwise it cannot be set per environment
  if (step.eventKind === 'timer' && step.timer) timerFindings(step.timer, spec, errors, warnings, { kinds });
  // the init worker is not measured against the process's catalog entry (as in the panel)
  const initWorker = isInitWorker(step, processId);
  const service = initWorker ? null : catalogEntry(step, model);
  // Camunda 8: the InitWorker sets its own processInstanceId only when it is done —
  // on its own task it is empty (in Camunda 7 `execution.processInstanceId` was already there)
  if (initWorker && spec.engine === 'c8') {
    const reads = (step.inputs ?? []).filter(m => !m.disabled && referencedVariables(m.expression).includes('processInstanceId'));
    for (const m of reads) {
      warnings.push(`Eingabe «${m.name}» liest processInstanceId — in ${C8_LABEL} setzt sie der InitWorker erst, wenn er fertig ist; hier ist sie leer. Die eigene ID nimmt der InitWorker aus EngineRunContext.processInstance (customInitZIO).`);
    }
  }

  // ── Interaction: what the DSL requires ───────────────────────────────────
  if (ia) {
    // via the key in the catalog: a foreign object is referenced, not exported
    const origin = interactionOrigin(ia, model, packageOf(spec, model));
    if (origin.ambiguous) {
      warnings.push(`${ia.name}: «${ia.key}» gibt es in mehreren Projekten (${origin.ambiguous.join(', ')}) — wird als neues Objekt exportiert; prüfen.`);
    }
    const inT = ia.inTypeId ? types.find(t => t.id === ia.inTypeId) : null;
    const outT = ia.outTypeId ? types.find(t => t.id === ia.outTypeId) : null;
    const empty = (t: typeof inT) => !!t && !(t.fields ?? []).some(f => f.name) && !(t.values ?? []).some(v => v.name);
    // DMN decision: simple values, and for a single value exactly one field in the Out
    if (!origin.foreign) for (const m of dmnIssues(ia, types)) warnings.push(`${ia.name}: ${m}`);
    if (INTERACTION_META[ia.kind].hasOut && !origin.foreign) {
      if (!inT) warnings.push(`${ia.name}: In fehlt.`);
      else if (empty(inT)) warnings.push(`${ia.name}: In ist leer.`);
      if (!outT) warnings.push(`${ia.name}: Out fehlt.`);
      else if (empty(outT)) warnings.push(`${ia.name}: Out ist leer.`);
    }
    // Signals and messages may do without In — even an empty one is not a defect
  } else if (interactionKind(step, processId) && step.id !== spec.steps.find(s => s.kind === 'start')?.id && !wiring.has(step.id)) {
    // the start of the process is not a message of its own — that is its In; likewise
    // everything in a pattern block and the message with the name of the process (see wiringSteps)
    warnings.push('Noch keine Interaktion — Objekt mit In/Out anlegen (Datenmodell → aus dem Ablauf).');
  }

  // ── Service: does the catalog know it? ───────────────────────────────────
  // a matched interaction is the process's own — even without the process ID in its key
  const foreign = (step.serviceId || step.topic) && !ia && !interactionKind(step, processId) && step.topic !== processId;
  if (foreign && model?.services?.length && !service) {
    errors.push(`Service «${step.serviceId ?? step.topic}» steht nicht im Katalog.`);
  }

  // ── Mappings: required, duplicate, FEEL ──────────────────────────────────
  // the own class — for an enum also the fields of its cases (the variant says which apply)
  const classFields = (id: string | undefined): Field[] | null => {
    if (!id) return null;
    const t = types.find(x => x.id === id);
    return t ? classFieldsOf(t) : [];
  };
  const inFields = classFields(ia?.inTypeId);
  const outFields = classFields(ia?.outTypeId);
  const domainIn = initWorker ? null : stepDomainMember(step, spec, model, 'In');
  const domainOut = initWorker ? null : stepDomainMember(step, spec, model, 'Out');
  const resultVars = withMultiInstance(resultVariables(step, spec, model, service), scopes.get(step.id));

  const ownKind = ia?.kind ?? interactionKind(step, processId);
  const implicitIn = readsInDirectly(ownKind, initWorker);
  // what a pattern contributes to the element is implementation — not checked,
  // and it does not report missing required fields: the pattern defines the call
  const fromPattern = patternMappings(patternDefs(model), step.patterns, spec.engine ?? 'c7');
  const check = (list: 'inputs' | 'outputs', rows: Mapping[], refFields: Field[] | null, dom: typeof domainIn, vars: VarNode[]) => {
    // enum with cases: only the shared fields and those of the chosen variant count
    const variants = variantsOf(step, spec, model, list, service);
    const chosen = chosenVariant(step, list, variants);
    const allowed = (n: string) => variantAllows(variants, chosen, n);
    if (chosen.mixed.length) {
      warnings.push(`${list === 'inputs' ? 'Eingaben' : 'Ausgaben'} aus mehreren Ausprägungen (${chosen.mixed.join(', ')}) — eine Ausprägung wählen oder «alle Ausprägungen», wenn ${list === 'inputs' ? 'der Worker beim Unmarshalling' : 'der Service'} entscheidet.`);
    } else if (variants && !chosen.name && list === 'inputs' && !implicitIn && !fromPattern.inputs.size) {
      // the service gets exactly one case — without a choice it would get none
      warnings.push(noVariantText(variants));
    }
    const used = rows.filter(m => !m.disabled && m.name.trim() && allowed(m.name));
    const active = used.filter(m => !fromPattern[list].has(m.name));
    // duplicate also counts for rows of the pattern — the same input twice is an
    // error in the BPMN, unless the pattern itself brings the name several times
    const names = new Map<string, number>();
    for (const m of used) names.set(m.name, (names.get(m.name) ?? 0) + 1);
    for (const [n, k] of names) if (k > (fromPattern.times[list].get(n) ?? 1)) errors.push(`${list === 'inputs' ? 'Eingabe' : 'Ausgabe'} «${n}» kommt doppelt vor.`);
    // Inputs the model or the catalog does not know: an extension
    // still missing there — the same rule as in the table (warning)
    if (list === 'inputs') {
      // plus what the domain has in the In — also `inConfig` and the fields of the `InConfig` (mocks)
      const known = refFields ? refFields.map(f => f.name) : [...(service?.inputs ?? []).map(p => p.name), ...domainInputNames(dom, model)];
      if (refFields || known.length) {
        // a general variable (`_idempotentId` …) is accepted by every worker — not an extension
        const ext = rows.filter(m => m.name.trim() && !fromPattern.inputs.has(m.name) && allowed(m.name) && !known.includes(m.name) && !GENERAL_VARIABLES.has(m.name));
        if (ext.length) {
          warnings.push(`${ext.map(m => `«${m.name}»`).join(', ')} noch nicht im ${refFields ? 'Modell' : 'Katalog'} — Erweiterung, dort nachziehen.`);
        }
      }
    }
    // `inConfig` of the callee: the own one is different — pass only individual fields
    const cfg = list === 'inputs' && !refFields ? inConfigField(dom) : null;
    if (cfg && active.some(m => m.name === cfg)) warnings.push(inConfigWarning(cfg));
    // Required fields that are missing or deselected — not for user
    // tasks and custom workers: they read their In directly from the
    // process variables, without mapping
    if (list === 'inputs' && !implicitIn && !fromPattern.inputs.size) {
      const required = requiredNames(refFields, dom, service).filter(n => variantRequires(variants, chosen, n));
      for (const n of required) if (!active.some(m => m.name === n)) errors.push(`Pflichtfeld «${n}» fehlt in den Eingaben.`);
      // Switches of the decoder: the service must get one of them
      const routing = routingMissing(variants, active);
      if (routing) errors.push(`Pflicht: ${routingText(routing)} fehlt in den Eingaben — eines davon wählt die Ausprägung.`);
    }
    for (const m of active) {
      if (isFeel(m.expression)) {
        const expected = refFields ? expectedFor(refFields.find(f => f.name === m.name), types, model) : expectedFromDomain(dom, m.name, model);
        const r = checkFeel(m.expression, vars, expected);
        for (const i of r.issues) (i.level === 'error' ? errors : warnings).push(`«${m.name}»: ${i.text}`);
        if (spec.engine !== 'c8') {
          const body = feelBody(m.expression);
          // incomplete FEEL is already reported by the check above
          const j = body != null && feelSyntaxOk(body) ? feelToJuel(body) : null;
          // a list or a context goes as a JSON script (Groovy) — just not as `camunda:in`
          const json = body != null && step.kind !== 'call' && feelToGroovy(body).ok;
          if (j && !j.ok && !json) warnings.push(`«${m.name}»: für ${C7_LABEL} nicht nach JUEL übersetzbar (${j.reason}).`);
        }
      } else if (isScriptValue(m.expression)) {
        warnings.push(`«${m.name}»: ${scriptWarning(spec.engine)}`);
      } else if (isJuel(m.expression)) {
        warnings.push(`«${m.name}»: JUEL aus dem Import, nicht nach FEEL übersetzbar.`);
      }
    }
  };
  // what is reported from here on is shown in the panel in place — on the mapping row or the error
  const atPlace = { errors: errors.length, warnings: warnings.length };
  check('inputs', step.inputs ?? [], inFields, domainIn, variables);
  check('outputs', step.outputs ?? [], outFields, domainOut, resultVars);

  // ── Handled errors: only report what is wrong ────────────────────────────
  (step.errors ?? []).forEach((e, i, all) => {
    const issue = handledErrorIssue(e, i, all, { variables, engine: spec.engine });
    if (issue) (issue.level === 'error' ? errors : warnings).push(issue.text);
    // the timer of a boundary event: like that of an event — the panel shows it on the entry
    if (e.boundary && e.timer) timerFindings(e.timer, spec, errors, warnings, { at: `Boundary «${e.code}»: `, kinds });
    // a message on the boundary waits — as on the event: key chosen, old name reported
    if (isEventBoundary(e) && e.eventKind === 'message' && !e.pattern) {
      const corr = correlationOf(e.correlationKey, spec.engine);
      if (corr.missing) warnings.push(`Nachricht «${e.code}»: kein Korrelationsschlüssel — in ${C8_LABEL} findet sie keine wartende Instanz.`);
      if (corr.misnamed) errors.push(`Nachricht «${e.code}»: processInstanceKey ist der alte Name — «processInstanceId» wählen.`);
    }
  });

  for (const r of step.regexHandledErrors ?? []) {
    const rx = regexIssue(r, spec.engine, variables, (step.regexHandledErrors ?? []).length <= 1);
    if (rx) (rx.level === 'error' ? errors : warnings).push(rx.text);
  }

  // ── Branches: conditions ─────────────────────────────────────────────────
  for (const b of step.branches ?? []) {
    if (b.isDefault || !b.condition || !isFeel(b.condition)) continue;
    const r = checkFeel(b.condition, variables, conditionExpected(spec.engine));
    for (const i of r.issues) (i.level === 'error' ? errors : warnings).push(`Zweig «${b.label}»: ${i.text}`);
  }

  const inline = [...errors.slice(atPlace.errors), ...warnings.slice(atPlace.warnings)];
  return errors.length || warnings.length ? { errors, warnings, inline } : NONE;
}

/** Is the expression in `_regexHandledErrors` a valid regular expression? Otherwise the reason. */
export function regexIssue(pattern: string | undefined, engine?: EngineId, variables?: VarNode[], alone?: boolean): { level: 'error' | 'warn'; text: string } | null {
  if (!pattern?.trim()) return { level: 'error', text: 'Regulärer Ausdruck ist leer.' };
  // `= …` yields the expression only at runtime — the FEEL is checked
  if (isFeel(pattern)) return feelEntryIssue(pattern.trim(), `Regex «${pattern.trim()}»`, { variables, engine, alone });
  try { new RegExp(pattern); }
  catch (e) { return { level: 'error', text: `Regulärer Ausdruck «${pattern}» ungültig: ${(e as Error).message.replace(/^Invalid regular expression: /, '').replace(/^\/.*\/[a-z]*: /, '')}` }; }
  // in Camunda 7 it is a text with commas — a comma in the expression separates the entries there
  if (engine !== 'c8' && pattern.includes(',')) return { level: 'warn', text: `«${pattern}»: In ${C7_LABEL} trennt das Komma die Einträge — den Ausdruck ohne Komma schreiben (z. B. {1,2} als {1}|{2}).` };
  return null;
}

/** Placeholder for a new regular expression (StepDetail «+ Regex») */
export const NEW_REGEX = '.*neue-meldung.*';

/** A mapping value that describes a script from the BPMN (`«groovy» …`) */
export const isScriptValue = (expression: string): boolean => expression.trimStart().startsWith('«');

/**
 * An adopted script: the specification only describes it. In Camunda 7
 * it stays unchanged in the diagram on export; Camunda 8 knows no
 * scripts in mappings — there it has to be rewritten as FEEL.
 */
export const scriptWarning = (engine: EngineId | undefined): string => (engine === 'c8'
  ? `Skript aus dem BPMN — ${C8_LABEL} kennt keine Skripte in Mappings: als «= …» (FEEL) neu schreiben.`
  : `Skript aus dem BPMN — beim Export für ${C7_LABEL} bleibt es unverändert im Diagramm; für ${C8_LABEL} müsste es als «= …» (FEEL) neu geschrieben werden.`);

/** Placeholder a new handled error starts with (StepDetail «+ Fehler») */
export const NEW_ERROR_CODE = 'neuer-fehler';

/** Placeholder for a new error that is not taken yet (`neuer-fehler`, `neuer-fehler-2` …) */
export function newErrorCode(existing: ErrorHandling[]): string {
  const taken = new Set(existing.map(e => e.code.trim()));
  if (!taken.has(NEW_ERROR_CODE)) return NEW_ERROR_CODE;
  let n = 2;
  while (taken.has(`${NEW_ERROR_CODE}-${n}`)) n++;
  return `${NEW_ERROR_CODE}-${n}`;
}

/**
 * What is wrong with a handled error — otherwise null. A handled
 * error is the normal case and not a warning; only an empty,
 * duplicate or not yet replaced code is reported. Side paths have no code.
 */
export function handledErrorIssue(e: ErrorHandling, index: number, all: ErrorHandling[], ctx: FeelCtx = {}): { level: 'error' | 'warn'; text: string } | null {
  // A side path needs no code — only a path that leads nowhere is an error in the diagram
  if (e.side) return e.steps?.length ? null : { level: 'warn', text: 'Der Pfad am Boundary-Event führt nirgends hin.' };
  // Signal, message, escalation on the boundary: no error code — their name is the label in the diagram
  if (isEventBoundary(e)) return e.steps?.length ? null : { level: 'warn', text: `Der Pfad von «${e.code}» am Boundary-Event führt nirgends hin.` };
  const code = e.code.trim();
  if (!code) return { level: 'error', text: 'Behandelter Fehler ohne Code.' };
  if (all.findIndex(x => !x.side && !isEventBoundary(x) && x.code.trim() === code) !== index) return { level: 'error', text: `Behandelter Fehler «${code}» kommt doppelt vor.` };
  if (e.boundary && !e.steps?.length) return { level: 'warn', text: `Der Pfad des Fehlers «${code}» am Boundary-Event führt nirgends hin.` };
  if (code.startsWith(NEW_ERROR_CODE)) return { level: 'warn', text: `Behandelter Fehler «${code}»: noch der Platzhalter — den echten Code eintragen.` };
  return feelEntryIssue(code, `Behandelter Fehler «${code}»`, { ...ctx, alone: all.filter(x => x.code.trim() && (x.declared || !x.boundary)).length <= 1 });
}

interface FeelCtx { variables?: VarNode[]; engine?: EngineId; /** the only entry of the list? */ alone?: boolean }

/**
 * An entry with `=` is a FEEL expression that yields the text: valid,
 * variables known, result a text — and translatable to JUEL for Camunda 7.
 */
function feelEntryIssue(entry: string, label: string, { variables, engine, alone }: FeelCtx): { level: 'error' | 'warn'; text: string } | null {
  if (!isFeel(entry)) return null;
  const r = checkFeel(entry, variables ?? null, { accepts: ['string', 'list'], label: 'Text oder Liste von Texten', kind: 'scalar' });
  const first = r.issues.find(i => i.level === 'error') ?? r.issues[0];
  if (first) return { level: first.level, text: `${label}: ${first.text}` };
  if (engine !== 'c8') {
    const j = feelToJuel(feelBody(entry) ?? '');
    if (!j.ok) return { level: 'warn', text: `${label}: für ${C7_LABEL} nicht nach JUEL übersetzbar (${j.reason}) — beim Export bleibt das FEEL stehen.` };
    // in Camunda 7 it is a text with commas — a list only stays a list as the only entry
    if (r.result === 'list' && alone === false) return { level: 'warn', text: `${label}: liefert eine Liste — in ${C7_LABEL} geht das nur als einziger Eintrag, sonst wird sie zu Text.` };
  }
  return null;
}
