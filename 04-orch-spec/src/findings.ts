// Befunde je Schritt — für das Dreieck in der Baumzeile.
//
// Was das Eigenschaften-Panel rechts an einer Stelle meldet (FEEL-Fehler,
// doppelte oder fehlende Pflichtfelder, eine Interaktion ohne In/Out, ein
// Service, den der Katalog nicht kennt), soll man im Ablauf schon sehen —
// als rotes (Fehler) oder oranges (Warnung) Dreieck an der Zeile, mit den
// ersten Meldungen im Tooltip. Dieselben Regeln wie im Panel, nur gesammelt.

import type { Field, Interaction, Mapping, Model, ProcessSpec, Step } from './types';
import { INTERACTION_META } from './types';
import { checkFeel, domainRequired, expectedFor, expectedFromDomain, isFeel, processVariables, resultVariables, stepDomainMember, type VarNode } from './feel';
import { feelBody, feelToJuel } from './feelJuel';
import { isJuel } from './juelFeel';
import { catalogEntry, interactionKind } from './interactions';

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
  for (const step of steps) {
    const f = stepFindings(step, spec, model, variables);
    if (f.errors.length || f.warnings.length) out.set(step.id, f);
  }
  return out;
}

export function stepFindings(step: Step, spec: ProcessSpec, model: Model | null, variables: VarNode[]): Finding {
  if (step.kind === 'goto') return NONE;
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
    } else if (inT && empty(inT)) warnings.push(`${ia.name}: In ist leer.`);
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
  const resultVars = resultVariables(step, spec, model, service);

  const check = (list: 'inputs' | 'outputs', rows: Mapping[], refFields: Field[] | null, dom: typeof domainIn, vars: VarNode[]) => {
    const active = rows.filter(m => !m.disabled && m.name.trim());
    const names = new Map<string, number>();
    for (const m of active) names.set(m.name, (names.get(m.name) ?? 0) + 1);
    for (const [n, k] of names) if (k > 1) errors.push(`${list === 'inputs' ? 'Eingabe' : 'Ausgabe'} «${n}» kommt doppelt vor.`);
    if (list === 'inputs') {
      // Pflichtfelder, die fehlen oder abgewählt sind
      const required = refFields
        ? refFields.filter(f => !f.optional).map(f => f.name)
        : (dom?.fields ?? []).filter(p => domainRequired(dom, p.name)).map(p => p.name)
          .concat((service?.inputs ?? []).filter(p => p.required && !dom?.fields?.some(f => f.name === p.name)).map(p => p.name));
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

  // ── Zweige: Bedingungen ──────────────────────────────────────────────────
  for (const b of step.branches ?? []) {
    if (b.isDefault || !b.condition || !isFeel(b.condition)) continue;
    const r = checkFeel(b.condition, variables, { accepts: ['boolean'], label: 'Bedingung', kind: 'scalar' });
    for (const i of r.issues) (i.level === 'error' ? errors : warnings).push(`Zweig «${b.label}»: ${i.text}`);
  }

  return errors.length || warnings.length ? { errors, warnings } : NONE;
}
