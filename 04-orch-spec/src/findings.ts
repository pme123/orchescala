// Befunde je Schritt — für das Dreieck in der Baumzeile.
//
// Was das Eigenschaften-Panel rechts an einer Stelle meldet (FEEL-Fehler,
// doppelte oder fehlende Pflichtfelder, eine Interaktion ohne In/Out, ein
// Service, den der Katalog nicht kennt), soll man im Ablauf schon sehen —
// als rotes (Fehler) oder oranges (Warnung) Dreieck an der Zeile, mit den
// ersten Meldungen im Tooltip. Dieselben Regeln wie im Panel, nur gesammelt.

import type { EngineId, ErrorHandling, Field, Interaction, Mapping, Model, MultiInstanceSpec, ProcessSpec, Step } from './types';
import { INTERACTION_META } from './types';
import { checkFeel, domainRequired, expectedFor, expectedFromDomain, isFeel, multiInstanceScopes, processVariables, resultVariables, stepDomainMember, withMultiInstance, type VarNode } from './feel';
import { feelBody, feelToJuel } from './feelJuel';
import { isJuel } from './juelFeel';
import { catalogEntry, interactionKind } from './interactions';
import { patternMappings } from './patterns';
import { chosenVariant, variantAllows, variantsOf } from './variants';

export interface Finding {
  errors: string[];
  warnings: string[];
}

const NONE: Finding = { errors: [], warnings: [] };

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

export function stepFindings(step: Step, spec: ProcessSpec, model: Model | null, baseVariables: VarNode[], scopes: Map<string, MultiInstanceSpec[]> = multiInstanceScopes(spec.steps)): Finding {
  if (step.kind === 'goto') return NONE;
  // in einer Mehrfachausführung kommen `loopCounter` und das Element dazu
  const variables = withMultiInstance(baseVariables, scopes.get(step.id));
  const errors: string[] = [];
  const warnings: string[] = [];
  const types = spec.types ?? [];
  const processId = spec.processId ?? '';
  const ia: Interaction | null = (spec.interactions ?? []).find(i => i.stepId === step.id) ?? null;
  const service = catalogEntry(step, model);

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
  const domainIn = stepDomainMember(step, spec, model, 'In');
  const domainOut = stepDomainMember(step, spec, model, 'Out');
  const resultVars = withMultiInstance(resultVariables(step, spec, model, service), scopes.get(step.id));

  const ownKind = ia?.kind ?? interactionKind(step, processId);
  const implicitIn = ownKind === 'userTask' || ownKind === 'customTask';
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
    // doppelt zählt auch bei Zeilen des Patterns — dieselbe Eingabe zweimal ist ein Fehler im BPMN
    const names = new Map<string, number>();
    for (const m of used) names.set(m.name, (names.get(m.name) ?? 0) + 1);
    for (const [n, k] of names) if (k > 1) errors.push(`${list === 'inputs' ? 'Eingabe' : 'Ausgabe'} «${n}» kommt doppelt vor.`);
    // Pflichtfelder, die fehlen oder abgewählt sind — nicht bei Benutzer-
    // aufgaben und eigenen Workern: die lesen ihr In direkt aus den
    // Prozessvariablen, ohne Mapping
    if (list === 'inputs' && !implicitIn && !fromPattern.inputs.size) {
      const required = refFields
        ? refFields.filter(f => !f.optional).map(f => f.name)
        : [...(dom?.fields ?? []), ...(dom?.cases ?? []).flatMap(c => c.fields ?? [])].filter(p => domainRequired(dom, p.name)).map(p => p.name)
          .concat((service?.inputs ?? []).filter(p => p.required && domainRequired(dom, p.name) == null).map(p => p.name))
          .filter(allowed);
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
      } else if (isJuel(m.expression)) {
        warnings.push(`«${m.name}»: JUEL aus dem Import, nicht nach FEEL übersetzbar.`);
      }
    }
  };
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
    const r = checkFeel(b.condition, variables, { accepts: ['boolean'], label: 'Bedingung', kind: 'scalar' });
    for (const i of r.issues) (i.level === 'error' ? errors : warnings).push(`Zweig «${b.label}»: ${i.text}`);
  }

  return errors.length || warnings.length ? { errors, warnings } : NONE;
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
