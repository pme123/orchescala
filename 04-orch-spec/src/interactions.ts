// Interaktionen aus dem Ablauf ableiten.
//
// Welcher Schritt spricht mit aussen — und braucht damit ein eigenes Objekt
// mit `In` und/oder `Out`?
//
//  · **Benutzeraufgabe** — immer. `val name` ist die BPMN-Element-ID.
//  · **Eigener Worker** — ein Service-Task, dessen Topic zu diesem Prozess
//    gehört (`<prozess>-<Name>`). Fremde Services haben ihre Domain im eigenen
//    Projekt; die gehören nicht hierher.
//  · **Signal / Nachricht** — werfende Ereignisse mit Signal- oder
//    Message-Definition.
//
// Der **Init-Worker** ist ausgenommen: sein Topic ist der Prozess selbst, und
// sein Ergebnis ist das `InitIn` — das erzeugt der Generator ohnehin.

import type {
  DomainField, DomainType, Field, Interaction, InteractionKind, Mapping, Model,
  ProcessSpec, ServiceDef, Step, TypeDef,
} from './types.ts';
import { INTERACTION_META } from './types.ts';
import { allSteps } from './bpmn.ts';
import { typeShape } from './scalaTypes.ts';
import { domainRef } from './serviceTypes.ts';
import { SCALA_TYPES } from './types.ts';
import { uid } from './util.ts';

const upper = (s: string) => s.replace(/^(.)/, c => c.toUpperCase());

const UMLAUTE: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss',
  à: 'a', â: 'a', é: 'e', è: 'e', ê: 'e', î: 'i', ï: 'i', ô: 'o', û: 'u', ç: 'c',
};

/**
 * «Depot Activity Unlock KUBE» → `DepotActivityUnlockKUBE`.
 * Umlaute werden umschrieben, sonst bliebe von «Rückbestätigung» ein
 * `RCkbestTigung` übrig.
 */
export function pascal(text: string): string {
  const ascii = text.replace(/[äöüÄÖÜßàâéèêîïôûç]/g, c => UMLAUTE[c] ?? c);
  const parts = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.map(p => (/^[A-Z0-9]+$/.test(p) ? p : upper(p))).join('');
}

/**
 * Vorschlag für den Scala-Objektnamen einer Interaktion.
 *
 * Steht das Objekt schon in der Domain, gilt sein Name — das Topic allein
 * verrät ihn nicht: der Worker mit dem Topic
 * `…createPensionProductV1.CreatePensionProduct` heisst `ComposePensionProduct`,
 * und `CreatePensionProduct` ist der Prozess selbst.
 */
export function suggestName(step: Step, kind: InteractionKind, processId: string, model: Model | null = null): string {
  if (kind === 'customTask' && step.topic) {
    const bekannt = (model?.domainTypes ?? []).find(t => t.topicName === step.topic && t.owner);
    if (bekannt) return bekannt.owner!;
    // `valiant-depot-openPensionAccount3aV1-EvalNextPortfolioIdSuffix`
    const tail = step.topic.slice(processId.length).replace(/^[-.]/, '');
    // Trägt das Topic nur den Prozessnamen, hilft es nicht weiter
    if (tail && pascal(tail) !== pascal(processId.split(/[-.]/).pop() ?? '')) return pascal(tail);
  }
  const base = pascal(step.name).replace(/Task$/, '');
  return `${base}${INTERACTION_META[kind].suffix}`;
}

/** Der Schlüssel: `val name` / `val topicName` / `val messageName`. */
function keyOf(step: Step, kind: InteractionKind): string {
  if (kind === 'userTask') return step.id;
  if (kind === 'customTask') return step.topic ?? step.id;
  return step.name;
}

/** Zu welcher Art Interaktion gehört dieser Schritt — oder zu keiner? */
export function interactionKind(step: Step, processId: string): InteractionKind | null {
  if (step.kind === 'user') return 'userTask';
  if (step.kind === 'service') {
    // Nur die Worker dieses Prozesses; fremde Services haben ihre eigene Domain
    if (!step.topic || !processId) return null;
    if (step.topic === processId) return null;            // Init-Worker
    if (!step.topic.startsWith(processId)) return null;
    return 'customTask';
  }
  // Eine empfangene Nachricht beschreibt der RE mit ihrem `In` — die
  // werfende Seite genauso, beide nutzen denselben DSL. Das gilt auch für ein
  // Nachrichten-Startereignis: der Prozessstart selbst ist davon ausgenommen,
  // seine Felder stehen im `In` des Prozesses (siehe `missingInteractions`).
  if (step.kind === 'receive') return 'message';
  if (step.eventKind === 'message') return 'message';
  if (step.eventKind === 'signal' && step.eventDirection === 'throw') return 'signal';
  return null;
}

export interface Suggestion {
  step: Step;
  kind: InteractionKind;
  name: string;
  key: string;
}

/** Alle Schritte, die eine Interaktion brauchen und noch keine haben. */
export function missingInteractions(spec: ProcessSpec, model: Model | null = null): Suggestion[] {
  const processId = spec.processId ?? '';
  const known = new Set((spec.interactions ?? []).map(i => i.stepId));
  // Der Start des Prozesses ist keine eigene Nachricht — das ist sein `In`.
  const startId = spec.steps.find(s => s.kind === 'start')?.id;
  const out: Suggestion[] = [];
  for (const step of allSteps(spec.steps)) {
    if (step.kind === 'goto' || known.has(step.id) || step.id === startId) continue;
    const kind = interactionKind(step, processId);
    if (!kind) continue;
    out.push({ step, kind, name: suggestName(step, kind, processId, model), key: keyOf(step, kind) });
  }
  return out;
}

/** Aus einem Vorschlag eine Interaktion machen. */
export function toInteraction(s: Suggestion): Interaction {
  return {
    id: uid('ia'),
    stepId: s.step.id,
    kind: s.kind,
    name: s.name,
    key: s.key,
    ...(s.step.description ? { descr: s.step.description } : {}),
    status: 'draft',
  };
}

/**
 * Die Felder des `InitIn` — die Ausgaben des Init-Workers. Der steht nicht im
 * Ablauf (Verdrahtung, keine Fachlichkeit); der Import legt seine Ausgaben
 * beim Prozess ab.
 */
export function initOutputs(spec: ProcessSpec): Mapping[] {
  return (spec.initOutputs ?? []).filter(o => !o.disabled);
}

/**
 * Namen, die in Schleifen-Angaben stecken: aus `Tried ${maxOpenAccount} times?`
 * und `wait ${timerWaitOpenAccount}` werden die Felder des `InConfig`.
 */
export function loopSettings(spec: ProcessSpec): Array<{ name: string; kind: 'timer' | 'max' | 'counter' }> {
  const found = new Map<string, 'timer' | 'max' | 'counter'>();
  for (const step of allSteps(spec.steps)) {
    if (!step.loop) continue;
    for (const text of [step.loop.condition, step.loop.maxAttempts, step.loop.waitFor]) {
      for (const m of (text ?? '').matchAll(/\$\{([A-Za-z_]\w*)\}/g)) {
        const name = m[1];
        const kind = /^timer/i.test(name) ? 'timer' : /^counter/i.test(name) ? 'counter' : /^max/i.test(name) ? 'max' : null;
        if (kind) found.set(name, kind);
      }
    }
  }
  // Zu jedem `max…` gehört ein `counter…` — Orchescala zählt damit die Versuche
  for (const [name, kind] of [...found]) {
    if (kind !== 'max') continue;
    const counter = `counter${name.slice(3)}`;
    if (!found.has(counter)) found.set(counter, 'counter');
  }
  return [...found].map(([name, kind]) => ({ name, kind }));
}

/** Schritte, deren Ergebnis sich für Tests überschreiben lässt (`…Mock`). */
export function mockableSteps(spec: ProcessSpec): Step[] {
  return allSteps(spec.steps).filter(s => s.kind === 'service' || s.kind === 'call');
}

/**
 * Der Typ für `InitIn`: die Felder kommen aus den Ausgaben des Init-Workers.
 * Neue Ausgaben kommen dazu, bereits gepflegte Typen bleiben — deshalb ein
 * Abgleich statt eines Neuaufbaus.
 */
export function syncInitIn(spec: ProcessSpec): TypeDef[] | null {
  const outs = initOutputs(spec);
  if (!outs.length) return null;
  const types = spec.types ?? [];
  const existing = types.find(t => t.initIn);
  const have = new Map((existing?.fields ?? []).map(f => [f.name, f]));
  const fields: Field[] = outs.map(o => have.get(o.name) ?? {
    id: uid('f'),
    name: o.name,
    type: 'String',
    ...(o.description ? { description: o.description } : {}),
  });
  if (existing && existing.fields?.length === fields.length
      && fields.every((f, i) => existing.fields![i]?.name === f.name)) return null;
  const next: TypeDef = existing
    ? { ...existing, fields }
    : {
        id: uid('t'), name: 'InitIn', kind: 'case', initIn: true, status: 'draft',
        description: 'Die Prozessvariablen, die zu Beginn gesetzt werden. Die Felder kommen aus dem Prozess — die Typen hier pflegen.',
        fields,
      };
  return existing ? types.map(t => (t.initIn ? next : t)) : [...types, next];
}

// ── Klassen einer Interaktion ────────────────────────────────────────────────

/** Der Katalog-Eintrag zu einem Schritt — bei Benutzeraufgaben über die ID. */
export function catalogEntry(step: Step, model: Model | null): ServiceDef | null {
  const services = model?.services ?? [];
  // Entscheidungen: die camunda:decisionRef im BPMN und die Referenz aus der
  // OpenAPI unterscheiden sich teils in der Gross-/Kleinschreibung
  const ref = step.kind === 'rule' ? step.topic?.toLowerCase() : undefined;
  return services.find(s =>
    (step.kind === 'user' && s.kind === 'user' && s.name === step.id)
    || (step.serviceId && s.id === step.serviceId)
    || (step.topic && (s.id === step.topic || s.topic === step.topic))
    || (ref && s.kind === 'rule' && s.id.toLowerCase() === ref)
    || (step.calledProcess && s.calledProcess === step.calledProcess)) ?? null;
}

/**
 * `In` bzw. `Out` einer Interaktion anlegen. Kennt der Katalog die Felder
 * (aus der OpenAPI), kommen sie mitsamt Beschreibung — sonst ein leeres Feld.
 */
export function createMemberType(
  ia: Interaction,
  member: 'In' | 'Out',
  entry: ServiceDef | null,
  model: Model | null = null,
): TypeDef {
  // Steht der Typ schon in der Domain, gilt der — dort stehen die **echten**
  // Scala-Typen. Der Katalog aus der OpenAPI kennt nur Namen und Bedeutung.
  const fromDomain = domainMember(ia.name, member, model);
  const params = (member === 'In' ? entry?.inputs : entry?.outputs) ?? [];
  const fields: Field[] = fromDomain?.fields?.length
    ? fromDomain.fields.map(f => fieldFromScala(f, model, fromDomain.pkg))
    : params.length
      ? params.map(p => ({
          id: uid('f'),
          name: p.name,
          type: 'String',
          ...(p.description ? { description: p.description } : {}),
        }))
      : [{ id: uid('f'), name: '', type: 'String' }];
  return {
    id: uid('t'),
    name: `${ia.name}.${member}`,
    kind: 'case',
    interactionId: ia.id,
    status: 'draft',
    fields,
  };
}

// ── Felder aus der Domain übernehmen ─────────────────────────────────────────


/**
 * Einen Typnamen im Katalog auflösen. Die Reihenfolge ist entscheidend: ein
 * **genauer** Name schlägt einen Member gleichen Endes (`Account` ist der
 * Schema-Typ, nicht `GetAccount.Account`), und innerhalb dessen gewinnt das
 * Paket, aus dem das Feld stammt.
 */
export function resolveType(base: string, model: Model | null, pkg?: string): DomainType | null {
  const all = model?.domainTypes ?? [];
  const kandidaten = [
    (t: DomainType) => t.name === base && t.pkg === pkg,
    (t: DomainType) => t.name === base && !!pkg && t.pkg.startsWith(pkg.replace(/\.schema$/, '')),
    (t: DomainType) => t.name === base,
    (t: DomainType) => t.name.endsWith(`.${base}`) && t.pkg === pkg,
    (t: DomainType) => t.name.endsWith(`.${base}`),
  ];
  for (const passt of kandidaten) {
    const treffer = all.find(passt);
    if (treffer) return treffer;
  }
  return null;
}

/**
 * Ein Scala-Feld in ein Feld des Klassenbauers übersetzen: `Option[Seq[X]]`
 * wird zu optional + mehrfach, `String :| ValidEmail` zu Typ + Einschränkung,
 * und ein Verweis auf einen anderen Typ zeigt auf den Katalog-Eintrag.
 */
export function fieldFromScala(p: DomainField, model: Model | null, pkg?: string): Field {
  const shape = typeShape(p.type);
  const scalar = (SCALA_TYPES as readonly string[]).includes(shape.base);
  const ref = scalar ? null : resolveType(shape.base, model, pkg);
  return {
    id: uid('f'),
    name: p.name,
    type: scalar ? shape.base : ref ? domainRef(ref.id) : shape.base,
    ...(shape.optional ? { optional: true } : {}),
    ...(shape.collection ? { collection: true } : {}),
    ...(shape.constraint ? { constraint: shape.constraint } : {}),
    ...(p.default ? { default: p.default } : {}),
    ...(p.description ? { description: p.description } : {}),
  };
}

/** Der Domain-Typ zu einem Objekt-Member, z. B. `CheckDuplicatesUT.In`. */
export function domainMember(name: string, member: string, model: Model | null): DomainType | null {
  return (model?.domainTypes ?? []).find(t => t.name === `${name}.${member}`) ?? null;
}

/** Der Schritt, zu dem eine Interaktion gehört. */
export function interactionStep(spec: ProcessSpec, ia: Interaction): Step | null {
  return allSteps(spec.steps).find(s => s.id === ia.stepId) ?? null;
}
