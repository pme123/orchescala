// Befunde je Schritt — für das Dreieck in der Baumzeile.
//
// Was das Eigenschaften-Panel rechts an einer Stelle meldet (FEEL-Fehler,
// doppelte oder fehlende Pflichtfelder, eine Interaktion ohne In/Out, ein
// Service, den der Katalog nicht kennt), soll man im Ablauf schon sehen —
// als rotes (Fehler) oder oranges (Warnung) Dreieck an der Zeile, mit den
// ersten Meldungen im Tooltip. Dieselben Regeln wie im Panel, nur gesammelt.

import type { DomainType, EngineId, ErrorHandling, Field, Interaction, Mapping, Model, MultiInstanceSpec, ProcessSpec, ServiceDef, Step } from './types';
import { INTERACTION_META } from './types';
import { checkFeel, conditionExpected, domainRequired, referencedVariables, expectedFor, expectedFromDomain, isFeel, multiInstanceScopes, processVariables, resultVariables, stepDomainMember, withMultiInstance, type VarNode } from './feel';
import { feelBody, feelToJuel } from './feelJuel';
import { isJuel } from './juelFeel';
import { catalogEntry, interactionKind } from './interactions';
import { isInitWorker } from './bpmn';
import { patternMappings } from './patterns';
import { ALL_VARIANTS, chosenVariant, variantAllows, variantsOf } from './variants';

export interface Finding {
  errors: string[];
  warnings: string[];
  /**
   * Meldungen, die das Panel des Schritts schon am Ort zeigt (Mapping-Zeile,
   * behandelter Fehler) — die Liste oben am Schritt nennt sie nicht noch einmal.
   * Gezählt (Baum, Filter) werden sie trotzdem.
   */
  inline?: string[];
}

const NONE: Finding = { errors: [], warnings: [], inline: [] };

/**
 * Alle Befunde eines Prozesses, je Schritt — einmal gerechnet, dann per
 * Schritt-ID abrufbar. Die Prozessvariablen werden einmal aufgebaut, die
 * Ergebnisvariablen je Schritt.
 */
export function collectFindings(spec: ProcessSpec, model: Model | null, steps: Step[]): Map<string, Finding> {
  const out = new Map<string, Finding>();
  const variables = processVariables(spec, model);
  const scopes = multiInstanceScopes(spec.steps);
  for (const step of steps) {
    const f = stepFindings(step, spec, model, variables, scopes);
    if (f.errors.length || f.warnings.length) out.set(step.id, f);
  }
  return out;
}

/** Die Pflicht-Eingaben: nicht optional im eigenen In, in der Domain — oder laut Katalog `required`. */
function requiredNames(refFields: Field[] | null, dom: DomainType | null, service: ServiceDef | null): string[] {
  return refFields
    ? refFields.filter(f => !f.optional).map(f => f.name)
    : [...(dom?.fields ?? []), ...(dom?.cases ?? []).flatMap(c => c.fields ?? [])].filter(p => domainRequired(dom, p.name)).map(p => p.name)
      .concat((service?.inputs ?? []).filter(p => p.required && domainRequired(dom, p.name) == null).map(p => p.name));
}

/**
 * Die Pflicht-Eingaben eines Schritts, die noch keine Zeile haben — nach
 * derselben Regel wie der Befund «Pflichtfeld … fehlt». Nicht bei
 * Benutzeraufgaben, eigenen Workern und dem Init-Worker (die lesen ihr In aus
 * den Prozessvariablen) und nicht, wenn ein Pattern den Aufruf festlegt.
 * Eine abgewählte Zeile zählt als vorhanden: das hat jemand so entschieden.
 */
export function missingRequiredInputs(step: Step, spec: ProcessSpec, model: Model | null): string[] {
  const processId = spec.processId ?? '';
  const initWorker = isInitWorker(step, processId);
  const ia = (spec.interactions ?? []).find(i => i.stepId === step.id) ?? null;
  const kind = ia?.kind ?? interactionKind(step, processId);
  if (initWorker || kind === 'userTask' || kind === 'customTask') return [];
  if (patternMappings(model?.patterns, step.patterns, spec.engine ?? 'c7').inputs.size) return [];
  const types = spec.types ?? [];
  const refFields = ia?.inTypeId ? (types.find(t => t.id === ia.inTypeId)?.fields ?? []).filter(f => f.name) : null;
  const service = catalogEntry(step, model);
  const dom = stepDomainMember(step, spec, model, 'In');
  const variants = refFields ? null : variantsOf(step, spec, model, 'inputs', service);
  const chosen = chosenVariant(step, 'inputs', variants);
  const have = new Set((step.inputs ?? []).map(m => m.name.trim()));
  return [...new Set(requiredNames(refFields, dom, service))]
    .filter(n => variantAllows(variants, chosen, n) && !have.has(n));
}

/**
 * Alle Felder eines Service-Aufrufs als Zeilen — beim Import, beim Abgleich und
 * beim Öffnen: was der Service bekommen bzw. liefern kann, steht da; **angehakt**
 * sind nur die Pflicht-Eingaben und die Ausgaben, die der Prozess braucht
 * (`_outputVariables`), der Rest ist abgewählt (sichtbar, kommt nicht ins BPMN).
 * Bestehende Zeilen bleiben, wie sie sind. Nicht bei Benutzeraufgaben, eigenen
 * Workern, dem Init-Worker und Entscheidungen (die lesen bzw. schreiben ihre
 * Variablen direkt) und nicht, wenn ein Pattern den Aufruf festlegt.
 * `added` nennt «Schritt: Feld» der neu angehakten Zeilen.
 */
export function withServiceRows(spec: ProcessSpec, model: Model | null): { spec: ProcessSpec; added: string[]; changed: boolean } {
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
      && !patternMappings(model?.patterns, s.patterns, spec.engine ?? 'c7').inputs.size;
    if (eligible) {
      const service = catalogEntry(s, model);
      const fieldsOf = (list: 'inputs' | 'outputs'): Array<{ name: string; description?: string }> => {
        const typeId = list === 'inputs' ? ia?.inTypeId : ia?.outTypeId;
        const own = typeId ? types.find(t => t.id === typeId) : undefined;
        if (own) return [...(own.fields ?? []), ...(own.values ?? []).flatMap(v => v.fields ?? [])].filter(f => f.name).map(f => ({ name: f.name, description: f.description }));
        const dom = stepDomainMember(s, spec, model, list === 'inputs' ? 'In' : 'Out');
        if (dom) return [...(dom.fields ?? []), ...(dom.cases ?? []).flatMap(c => c.fields ?? [])].map(f => ({ name: f.name, description: f.description }));
        return ((list === 'inputs' ? service?.inputs : service?.outputs) ?? []).map(p => ({ name: p.name, description: p.description }));
      };
      const required = new Set(missingRequiredInputs(s, spec, model));
      const wanted = new Set(s.outputVariables ?? []);
      const rows = (list: 'inputs' | 'outputs'): Mapping[] | null => {
        const have = s[list] ?? [];
        // bei Ausgaben zählt auch ein Feld, das eine bestehende Zeile schon liest
        const used = new Set([...have.map(m => m.name.trim()), ...(list === 'outputs' ? have.flatMap(m => referencedVariables(m.expression)) : [])]);
        const seen = new Set<string>();
        const neu: Mapping[] = [];
        for (const f of fieldsOf(list)) {
          if (!f.name || used.has(f.name) || seen.has(f.name)) continue;
          seen.add(f.name);
          const on = list === 'inputs' ? required.has(f.name) : wanted.has(f.name);
          if (on) added.push(`${s.name}: ${f.name}`);
          neu.push({ name: f.name, expression: `= ${f.name}`, ...(f.description ? { description: f.description } : {}), ...(on ? {} : { disabled: true }) });
        }
        return neu.length ? [...have, ...neu] : null;
      };
      const ins = rows('inputs'), outs = rows('outputs');
      if (ins || outs) { changed = true; next = { ...s, ...(ins ? { inputs: ins } : {}), ...(outs ? { outputs: outs } : {}) }; }
      // gebrauchte Ausgaben aus mehreren Ausprägungen: der Service liefert eine —
      // welche, entscheidet er; die Ausgaben lesen dann aus allen (`*`)
      if (outs && next.outVariant == null) {
        const v = variantsOf(next, spec, model, 'outputs', service);
        if (v && chosenVariant(next, 'outputs', v).mixed.length) next = { ...next, outVariant: ALL_VARIANTS };
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

export function stepFindings(step: Step, spec: ProcessSpec, model: Model | null, baseVariables: VarNode[], scopes: Map<string, MultiInstanceSpec[]> = multiInstanceScopes(spec.steps)): Finding {
  if (step.kind === 'goto') return NONE;
  // in einer Mehrfachausführung kommen `loopCounter` und das Element dazu
  const variables = withMultiInstance(baseVariables, scopes.get(step.id));
  const errors: string[] = [];
  const warnings: string[] = [];
  const types = spec.types ?? [];
  const processId = spec.processId ?? '';
  const ia: Interaction | null = (spec.interactions ?? []).find(i => i.stepId === step.id) ?? null;
  // der Init-Worker wird nicht am Katalogeintrag des Prozesses gemessen (wie im Panel)
  const initWorker = isInitWorker(step, processId);
  const service = initWorker ? null : catalogEntry(step, model);

  // ── Interaktion: was der DSL verlangt ────────────────────────────────────
  if (ia) {
    const inT = ia.inTypeId ? types.find(t => t.id === ia.inTypeId) : null;
    const outT = ia.outTypeId ? types.find(t => t.id === ia.outTypeId) : null;
    const empty = (t: typeof inT) => !!t && !(t.fields ?? []).some(f => f.name) && !(t.values ?? []).some(v => v.name);
    if (INTERACTION_META[ia.kind].hasOut) {
      if (!inT) warnings.push(`${ia.name}: In fehlt.`);
      else if (empty(inT)) warnings.push(`${ia.name}: In ist leer.`);
      if (!outT) warnings.push(`${ia.name}: Out fehlt.`);
      else if (empty(outT)) warnings.push(`${ia.name}: Out ist leer.`);
    }
    // Signale und Nachrichten dürfen ohne In auskommen — auch ein leeres ist kein Mangel
  } else if (interactionKind(step, processId) && step.id !== spec.steps.find(s => s.kind === 'start')?.id) {
    // der Start des Prozesses ist keine eigene Nachricht — das ist sein In
    warnings.push('Noch keine Interaktion — Objekt mit In/Out anlegen (Datenmodell → aus dem Ablauf).');
  }

  // ── Service: kennt ihn der Katalog? ──────────────────────────────────────
  const foreign = (step.serviceId || step.topic) && !interactionKind(step, processId) && step.topic !== processId;
  if (foreign && model?.services?.length && !service) {
    errors.push(`Service «${step.serviceId ?? step.topic}» steht nicht im Katalog.`);
  }

  // ── Mappings: Pflicht, doppelt, FEEL ─────────────────────────────────────
  const inFields: Field[] | null = ia?.inTypeId ? (types.find(t => t.id === ia.inTypeId)?.fields ?? []).filter(f => f.name) : null;
  const outFields: Field[] | null = ia?.outTypeId ? (types.find(t => t.id === ia.outTypeId)?.fields ?? []).filter(f => f.name) : null;
  const domainIn = initWorker ? null : stepDomainMember(step, spec, model, 'In');
  const domainOut = initWorker ? null : stepDomainMember(step, spec, model, 'Out');
  const resultVars = withMultiInstance(resultVariables(step, spec, model, service), scopes.get(step.id));

  const ownKind = ia?.kind ?? interactionKind(step, processId);
  const implicitIn = ownKind === 'userTask' || ownKind === 'customTask' || initWorker;
  // was ein Pattern am Element beisteuert, ist Implementation — nicht geprüft,
  // und fehlende Pflichtfelder meldet es nicht: den Aufruf legt das Pattern fest
  const fromPattern = patternMappings(model?.patterns, step.patterns, spec.engine ?? 'c7');
  const check = (list: 'inputs' | 'outputs', rows: Mapping[], refFields: Field[] | null, dom: typeof domainIn, vars: VarNode[]) => {
    // enum mit Fällen: nur die gemeinsamen Felder und die der gewählten Ausprägung zählen
    const variants = refFields ? null : variantsOf(step, spec, model, list, service);
    const chosen = chosenVariant(step, list, variants);
    const allowed = (n: string) => variantAllows(variants, chosen, n);
    if (chosen.mixed.length) {
      warnings.push(`${list === 'inputs' ? 'Eingaben' : 'Ausgaben'} aus mehreren Ausprägungen (${chosen.mixed.join(', ')}) — eine Ausprägung wählen.`);
    } else if (variants && !chosen.name && list === 'inputs' && !implicitIn && !fromPattern.inputs.size) {
      // der Service bekommt genau einen Fall — ohne Wahl bekäme er keinen
      warnings.push(`Keine Ausprägung gewählt — der Service erwartet eine davon (${variants.cases.map(c => c.name).join(', ')}).`);
    }
    const used = rows.filter(m => !m.disabled && m.name.trim() && allowed(m.name));
    const active = used.filter(m => !fromPattern[list].has(m.name));
    // doppelt zählt auch bei Zeilen des Patterns — dieselbe Eingabe zweimal ist ein
    // Fehler im BPMN, ausser das Pattern bringt den Namen selbst mehrmals mit
    const names = new Map<string, number>();
    for (const m of used) names.set(m.name, (names.get(m.name) ?? 0) + 1);
    for (const [n, k] of names) if (k > (fromPattern.times[list].get(n) ?? 1)) errors.push(`${list === 'inputs' ? 'Eingabe' : 'Ausgabe'} «${n}» kommt doppelt vor.`);
    // Pflichtfelder, die fehlen oder abgewählt sind — nicht bei Benutzer-
    // aufgaben und eigenen Workern: die lesen ihr In direkt aus den
    // Prozessvariablen, ohne Mapping
    if (list === 'inputs' && !implicitIn && !fromPattern.inputs.size) {
      const required = requiredNames(refFields, dom, service).filter(allowed);
      for (const n of required) if (!active.some(m => m.name === n)) errors.push(`Pflichtfeld «${n}» fehlt in den Eingaben.`);
    }
    for (const m of active) {
      if (isFeel(m.expression)) {
        const expected = refFields ? expectedFor(refFields.find(f => f.name === m.name), types, model) : expectedFromDomain(dom, m.name, model);
        const r = checkFeel(m.expression, vars, expected);
        for (const i of r.issues) (i.level === 'error' ? errors : warnings).push(`«${m.name}»: ${i.text}`);
        if (spec.engine !== 'c8') {
          const body = feelBody(m.expression);
          const j = body != null ? feelToJuel(body) : null;
          if (j && !j.ok) warnings.push(`«${m.name}»: für Camunda 7 nicht nach JUEL übersetzbar (${j.reason}).`);
        }
      } else if (isScriptValue(m.expression)) {
        warnings.push(`«${m.name}»: ${scriptWarning(spec.engine)}`);
      } else if (isJuel(m.expression)) {
        warnings.push(`«${m.name}»: JUEL aus dem Import, nicht nach FEEL übersetzbar.`);
      }
    }
  };
  // was ab hier gemeldet wird, steht im Panel am Ort — an der Mapping-Zeile bzw. am Fehler
  const atPlace = { errors: errors.length, warnings: warnings.length };
  check('inputs', step.inputs ?? [], inFields, domainIn, variables);
  check('outputs', step.outputs ?? [], outFields, domainOut, resultVars);

  // ── Behandelte Fehler: nur melden, was nicht stimmt ──────────────────────
  (step.errors ?? []).forEach((e, i, all) => {
    const issue = handledErrorIssue(e, i, all, { variables, engine: spec.engine });
    if (issue) (issue.level === 'error' ? errors : warnings).push(issue.text);
  });

  for (const r of step.regexHandledErrors ?? []) {
    const rx = regexIssue(r, spec.engine, variables, (step.regexHandledErrors ?? []).length <= 1);
    if (rx) (rx.level === 'error' ? errors : warnings).push(rx.text);
  }

  // ── Zweige: Bedingungen ──────────────────────────────────────────────────
  for (const b of step.branches ?? []) {
    if (b.isDefault || !b.condition || !isFeel(b.condition)) continue;
    const r = checkFeel(b.condition, variables, conditionExpected(spec.engine));
    for (const i of r.issues) (i.level === 'error' ? errors : warnings).push(`Zweig «${b.label}»: ${i.text}`);
  }

  const inline = [...errors.slice(atPlace.errors), ...warnings.slice(atPlace.warnings)];
  return errors.length || warnings.length ? { errors, warnings, inline } : NONE;
}

/** Ist der Ausdruck in `_regexHandledErrors` ein gültiger regulärer Ausdruck? Sonst der Grund. */
export function regexIssue(pattern: string | undefined, engine?: EngineId, variables?: VarNode[], alone?: boolean): { level: 'error' | 'warn'; text: string } | null {
  if (!pattern?.trim()) return { level: 'error', text: 'Regulärer Ausdruck ist leer.' };
  // `= …` liefert den Ausdruck erst zur Laufzeit — geprüft wird das FEEL
  if (isFeel(pattern)) return feelEntryIssue(pattern.trim(), `Regex «${pattern.trim()}»`, { variables, engine, alone });
  try { new RegExp(pattern); }
  catch (e) { return { level: 'error', text: `Regulärer Ausdruck «${pattern}» ungültig: ${(e as Error).message.replace(/^Invalid regular expression: /, '').replace(/^\/.*\/[a-z]*: /, '')}` }; }
  // in Camunda 7 ist es ein Text mit Kommas — ein Komma im Ausdruck trennt dort die Einträge
  if (engine !== 'c8' && pattern.includes(',')) return { level: 'warn', text: `«${pattern}»: In Camunda 7 trennt das Komma die Einträge — den Ausdruck ohne Komma schreiben (z. B. {1,2} als {1}|{2}).` };
  return null;
}

/** Platzhalter für einen neuen regulären Ausdruck (StepDetail «+ Regex») */
export const NEW_REGEX = '.*neue-meldung.*';

/** Ein Mapping-Wert, der ein Skript aus dem BPMN beschreibt (`«groovy» …`) */
export const isScriptValue = (expression: string): boolean => expression.trimStart().startsWith('«');

/**
 * Ein übernommenes Skript: die Spezifikation beschreibt es nur. In Camunda 7
 * bleibt es beim Export unverändert im Diagramm; Camunda 8 kennt keine
 * Skripte in Mappings — dort gehört es als FEEL neu geschrieben.
 */
export const scriptWarning = (engine: EngineId | undefined): string => (engine === 'c8'
  ? 'Skript aus dem BPMN — Camunda 8 kennt keine Skripte in Mappings: als «= …» (FEEL) neu schreiben.'
  : 'Skript aus dem BPMN — beim Export für Camunda 7 bleibt es unverändert im Diagramm; für Camunda 8 müsste es als «= …» (FEEL) neu geschrieben werden.');

/** Placeholder a new handled error starts with (StepDetail «+ Fehler») */
export const NEW_ERROR_CODE = 'neuer-fehler';

/** Platzhalter für einen neuen Fehler, der noch nicht vergeben ist (`neuer-fehler`, `neuer-fehler-2` …) */
export function newErrorCode(existing: ErrorHandling[]): string {
  const taken = new Set(existing.map(e => e.code.trim()));
  if (!taken.has(NEW_ERROR_CODE)) return NEW_ERROR_CODE;
  let n = 2;
  while (taken.has(`${NEW_ERROR_CODE}-${n}`)) n++;
  return `${NEW_ERROR_CODE}-${n}`;
}

/**
 * Was an einem behandelten Fehler nicht stimmt — sonst null. Ein behandelter
 * Fehler ist der Normalfall und keine Warnung; gemeldet wird nur ein leerer,
 * doppelter oder noch nicht ersetzter Code. Nebenpfade haben keinen Code.
 */
export function handledErrorIssue(e: ErrorHandling, index: number, all: ErrorHandling[], ctx: FeelCtx = {}): { level: 'error' | 'warn'; text: string } | null {
  // Ein Nebenpfad braucht keinen Code — nur ein Pfad, der nirgends hinführt, ist ein Fehler im Diagramm
  if (e.side) return e.steps?.length ? null : { level: 'warn', text: 'Der Pfad am Boundary-Event führt nirgends hin.' };
  const code = e.code.trim();
  if (!code) return { level: 'error', text: 'Behandelter Fehler ohne Code.' };
  if (all.findIndex(x => !x.side && x.code.trim() === code) !== index) return { level: 'error', text: `Behandelter Fehler «${code}» kommt doppelt vor.` };
  if (e.boundary && !e.steps?.length) return { level: 'warn', text: `Der Pfad des Fehlers «${code}» am Boundary-Event führt nirgends hin.` };
  if (code.startsWith(NEW_ERROR_CODE)) return { level: 'warn', text: `Behandelter Fehler «${code}»: noch der Platzhalter — den echten Code eintragen.` };
  return feelEntryIssue(code, `Behandelter Fehler «${code}»`, { ...ctx, alone: all.filter(x => x.code.trim() && (x.declared || !x.boundary)).length <= 1 });
}

interface FeelCtx { variables?: VarNode[]; engine?: EngineId; /** der einzige Eintrag der Liste? */ alone?: boolean }

/**
 * Ein Eintrag mit `=` ist ein FEEL-Ausdruck, der den Text liefert: gültig,
 * Variablen bekannt, Ergebnis ein Text — und für Camunda 7 nach JUEL übersetzbar.
 */
function feelEntryIssue(entry: string, label: string, { variables, engine, alone }: FeelCtx): { level: 'error' | 'warn'; text: string } | null {
  if (!isFeel(entry)) return null;
  const r = checkFeel(entry, variables ?? null, { accepts: ['string', 'list'], label: 'Text oder Liste von Texten', kind: 'scalar' });
  const first = r.issues.find(i => i.level === 'error') ?? r.issues[0];
  if (first) return { level: first.level, text: `${label}: ${first.text}` };
  if (engine !== 'c8') {
    const j = feelToJuel(feelBody(entry) ?? '');
    if (!j.ok) return { level: 'warn', text: `${label}: für Camunda 7 nicht nach JUEL übersetzbar (${j.reason}) — beim Export bleibt das FEEL stehen.` };
    // in Camunda 7 ist es ein Text mit Kommas — eine Liste bleibt nur als einziger Eintrag eine Liste
    if (r.result === 'list' && alone === false) return { level: 'warn', text: `${label}: liefert eine Liste — in Camunda 7 geht das nur als einziger Eintrag, sonst wird sie zu Text.` };
  }
  return null;
}
