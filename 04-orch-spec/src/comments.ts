// Kommentare — wie in Confluence, nur am richtigen Ort.
//
// Kommentiert wird dort, wo etwas zu klären ist: am **Prozess**, an den
// Elementen, die eine Fachdiskussion tragen (**Benutzeraufgabe, Nachricht,
// Signal, Aufruf eines Teilprozesses**) und an den **Datentypen**, die hier
// entstehen. Nicht an jedem Service-Task — dessen Vertrag steht im Katalog,
// nicht zur Debatte.
//
// Ein Faden gehört zu einem Ziel (`process`, `step:<id>`, `type:<id>`), hat
// einen ersten Beitrag und beliebig viele Antworten. Erledigte Fäden bleiben
// stehen und werden nur zugeklappt: wer später dazukommt, soll sehen, was
// besprochen wurde.

import type { CommentEntry, CommentThread, ProcessSpec, Step } from './types.ts';
import { nowIsoWithTimezone, uid } from './util.ts';

/** Das Ziel eines Fadens. */
export const processTarget = 'process';
export const stepTarget = (id: string) => `step:${id}`;
export const typeTarget = (id: string) => `type:${id}`;

/**
 * Trägt dieses Element eine Fachdiskussion? Prozess und Datentypen immer;
 * bei den Schritten die, an denen der Fachbereich etwas zu sagen hat.
 */
export function canComment(step: Step): boolean {
  if (step.kind === 'user' || step.kind === 'call' || step.kind === 'receive') return true;
  return step.kind === 'event' && (step.eventKind === 'message' || step.eventKind === 'signal');
}

/** Wofür der Faden hier steht — für die Überschrift. */
export function targetLabel(step: Step): string {
  if (step.kind === 'user') return 'Benutzeraufgabe';
  if (step.kind === 'call') return 'Teilprozess';
  if (step.kind === 'receive' || step.eventKind === 'message') return 'Nachricht';
  if (step.eventKind === 'signal') return 'Signal';
  if (step.kind === 'service') return 'Service';
  return 'Element';
}

export const threadsFor = (spec: ProcessSpec, target: string): CommentThread[] =>
  (spec.comments ?? []).filter(t => t.target === target);

/** Offene Fäden — das ist die Zahl, die im Baum steht. */
export const openCount = (spec: ProcessSpec, target: string): number =>
  threadsFor(spec, target).filter(t => !t.resolved).length;

/** Alle offenen Fäden des Prozesses — für die Übersicht. */
export const openTotal = (spec: ProcessSpec): number =>
  (spec.comments ?? []).filter(t => !t.resolved).length;

const eintrag = (author: string, text: string): CommentEntry => ({
  id: uid('ce'), author, at: nowIsoWithTimezone(), text: text.trim(),
});

/** Einen neuen Faden anlegen. */
export function addThread(spec: ProcessSpec, target: string, author: string, text: string): ProcessSpec {
  if (!text.trim()) return spec;
  const faden: CommentThread = { id: uid('ct'), target, entries: [eintrag(author, text)] };
  return { ...spec, comments: [...(spec.comments ?? []), faden] };
}

/** In einem Faden antworten — das hebt ihn zugleich wieder auf offen. */
export function addReply(spec: ProcessSpec, threadId: string, author: string, text: string): ProcessSpec {
  if (!text.trim()) return spec;
  return {
    ...spec,
    comments: (spec.comments ?? []).map(t => (t.id === threadId
      ? { ...t, resolved: false, entries: [...t.entries, eintrag(author, text)] }
      : t)),
  };
}

/** Erledigt / wieder offen. */
export function toggleResolved(spec: ProcessSpec, threadId: string): ProcessSpec {
  return {
    ...spec,
    comments: (spec.comments ?? []).map(t => (t.id === threadId ? { ...t, resolved: !t.resolved } : t)),
  };
}

/** Einen Faden ganz entfernen. */
export function removeThread(spec: ProcessSpec, threadId: string): ProcessSpec {
  return { ...spec, comments: (spec.comments ?? []).filter(t => t.id !== threadId) };
}

/**
 * Fäden zu Schritten und Typen, die es nicht mehr gibt, aufräumen. Der
 * Prozess-Faden bleibt immer.
 */
export function pruneComments(spec: ProcessSpec, lebendeStepIds: Set<string>, lebendeTypeIds: Set<string>): CommentThread[] {
  return (spec.comments ?? []).filter(t => {
    if (t.target === processTarget) return true;
    if (t.target.startsWith('step:')) return lebendeStepIds.has(t.target.slice(5));
    if (t.target.startsWith('type:')) return lebendeTypeIds.has(t.target.slice(5));
    return true;
  });
}

/**
 * Alle offenen Fäden in der Reihenfolge, in der man sie abarbeitet: erst der
 * Prozess, dann die Schritte **in der Reihenfolge des Ablaufs**, zuletzt die
 * Datentypen. Nach der Reihenfolge der Datei zu gehen wäre die Reihenfolge
 * des Schreibens — die hilft beim Durchsehen nicht.
 */
export function openThreads(spec: ProcessSpec, stepOrder: string[], typeOrder: string[]): CommentThread[] {
  const bekannt = new Set([processTarget, ...stepOrder.map(stepTarget), ...typeOrder.map(typeTarget)]);
  // Fäden ohne Element bleiben aussen vor. Sonst springt die Navigation auf
  // ein Ziel, das es nicht gibt — und zeigt dann den Prozess, weil kein
  // Schritt dazu gefunden wird. Zu sehen sind sie trotzdem: der Prozess führt
  // sie unter «Kommentare ohne Element».
  const offen = (spec.comments ?? []).filter(t => !t.resolved && bekannt.has(t.target));
  const rang = new Map<string, number>([[processTarget, 0]]);
  stepOrder.forEach((id, i) => rang.set(stepTarget(id), 1 + i));
  typeOrder.forEach((id, i) => rang.set(typeTarget(id), 1 + stepOrder.length + i));
  const platz = (t: CommentThread) => rang.get(t.target) ?? Number.MAX_SAFE_INTEGER;
  return [...offen].sort((a, b) => platz(a) - platz(b)
    || (a.entries[0]?.at ?? '').localeCompare(b.entries[0]?.at ?? ''));
}

/**
 * Fäden, deren Element es nicht mehr gibt — der Schritt wurde aus dem BPMN
 * entfernt, der Typ gelöscht. Sie werden **nicht** stillschweigend
 * weggeworfen: was besprochen wurde, gehört gelesen und abgehakt, nicht
 * verschwunden.
 */
export function orphanThreads(spec: ProcessSpec, stepIds: Set<string>, typeIds: Set<string>): CommentThread[] {
  return (spec.comments ?? []).filter(t => {
    if (t.target === processTarget) return false;
    if (t.target.startsWith('step:')) return !stepIds.has(t.target.slice(5));
    if (t.target.startsWith('type:')) return !typeIds.has(t.target.slice(5));
    return true;
  });
}

/** Wohin ein Faden zeigt — für die Navigation. */
export function threadTarget(t: CommentThread): { kind: 'process' } | { kind: 'step'; id: string } | { kind: 'type'; id: string } {
  if (t.target.startsWith('step:')) return { kind: 'step', id: t.target.slice(5) };
  if (t.target.startsWith('type:')) return { kind: 'type', id: t.target.slice(5) };
  return { kind: 'process' };
}

/** «vor 3 Tagen» ist hier zu ungenau — Datum und Uhrzeit, kurz. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
