// Kommentare — wie im arch-review: eine Sprechblase an jeder Stelle, an der
// etwas zu klären sein kann, und ein Panel mit dem Faden dieser Stelle.
//
// Eine **Stelle** ist ein Element (Prozess, Schritt, Interaktion, Datentyp)
// oder ein Teil davon (Beschreibung, eine Mapping-Zeile, ein Zweig, ein Feld).
// Der Schlüssel ist `<Element>` oder `<Element>#<Teil>`:
//
//   process                    process#description     process#var:<name>
//   step:<id>                  step:<id>#description   step:<id>#in:<name>
//   step:<id>#out:<name>       step:<id>#branch:<id>   step:<id>#error:<code>
//   step:<id>#assignment       step:<id>#service
//   ia:<id>
//   type:<id>                  type:<id>#field:<id>    type:<id>#value:<name>
//
// Ein Faden hat einen ersten Beitrag und beliebig viele Antworten. Erledigte
// Fäden bleiben stehen und werden nur ausgeblendet: wer später dazukommt,
// soll sehen, was besprochen wurde.

import type { CommentEntry, CommentThread, Interaction, ProcessSpec, Step, TypeDef } from './types.ts';
import { KIND_LABEL } from './ui.tsx';
import { nowIsoWithTimezone, uid } from './util.ts';

/** Das Ziel eines Fadens. */
export const processTarget = 'process';
export const stepTarget = (id: string) => `step:${id}`;
export const typeTarget = (id: string) => `type:${id}`;
export const iaTarget = (id: string) => `ia:${id}`;
/** Ein Teil eines Elements, z. B. `sub(stepTarget(id), 'in:name')`. */
export const sub = (base: string, part: string) => `${base}#${part}`;

/** Das Element hinter einer Stelle: `step:x#in:y` → `step:x`. */
export const baseOf = (target: string) => target.split('#')[0];

/** Fäden des Elements samt seiner Teile. */
export const threadsUnder = (spec: ProcessSpec, base: string): CommentThread[] =>
  (spec.comments ?? []).filter(t => baseOf(t.target) === base);

export interface Counts { open: number; resolved: number }

/** Offene und erledigte Fäden je Stelle — einmal je Stand gerechnet. */
export function countIndex(spec: ProcessSpec): { exact: Map<string, Counts>; under: Map<string, Counts> } {
  const exact = new Map<string, Counts>();
  const under = new Map<string, Counts>();
  const add = (m: Map<string, Counts>, key: string, t: CommentThread) => {
    const c = m.get(key) ?? { open: 0, resolved: 0 };
    if (t.resolved) c.resolved++; else c.open++;
    m.set(key, c);
  };
  for (const t of spec.comments ?? []) {
    add(exact, t.target, t);
    add(under, baseOf(t.target), t);
  }
  return { exact, under };
}

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
      ? { ...t, resolved: false, resolvedBy: undefined, resolvedAt: undefined, entries: [...t.entries, eintrag(author, text)] }
      : t)),
  };
}

/** Erledigt / wieder offen — wer abgehakt hat, bleibt stehen. */
export function setResolved(spec: ProcessSpec, threadId: string, resolved: boolean, author: string): ProcessSpec {
  return {
    ...spec,
    comments: (spec.comments ?? []).map(t => (t.id !== threadId ? t : resolved
      ? { ...t, resolved: true, resolvedBy: author, resolvedAt: nowIsoWithTimezone() }
      : { ...t, resolved: false, resolvedBy: undefined, resolvedAt: undefined })),
  };
}

/** Einen Faden ganz entfernen. */
export function removeThread(spec: ProcessSpec, threadId: string): ProcessSpec {
  return { ...spec, comments: (spec.comments ?? []).filter(t => t.id !== threadId) };
}

/** Eine einzelne Antwort entfernen (nicht den ersten Beitrag). */
export function removeEntry(spec: ProcessSpec, threadId: string, entryId: string): ProcessSpec {
  return {
    ...spec,
    comments: (spec.comments ?? []).map(t => (t.id === threadId
      ? { ...t, entries: t.entries.filter((e, i) => i === 0 || e.id !== entryId) }
      : t)),
  };
}

/**
 * Fäden zu Schritten und Typen, die es nicht mehr gibt, aufräumen. Prozess,
 * Interaktionen und unbekannte Ziele bleiben — die zeigt das Panel unter
 * «Ohne Stelle».
 */
export function pruneComments(spec: ProcessSpec, lebendeStepIds: Set<string>, lebendeTypeIds: Set<string>): CommentThread[] {
  return (spec.comments ?? []).filter(t => {
    const base = baseOf(t.target);
    if (base.startsWith('step:')) return lebendeStepIds.has(base.slice(5));
    if (base.startsWith('type:')) return lebendeTypeIds.has(base.slice(5));
    return true;
  });
}

// ── Stellen ──────────────────────────────────────────────────────────────────

/** Eine kommentierbare Stelle, wie sie im Panel und in der Übersicht steht. */
export interface CommentTargetInfo {
  key: string;
  label: string;
  /** Überschrift in der Übersicht, z. B. «Ablauf» oder «Datenmodell» */
  group: string;
}

/** Wo eine Stelle zu finden ist — für die Navigation. */
export type TargetLocation =
  | { kind: 'process' }
  | { kind: 'step'; id: string }
  | { kind: 'ia'; id: string }
  | { kind: 'type'; id: string };

export function locate(target: string): TargetLocation {
  const base = baseOf(target);
  if (base.startsWith('step:')) return { kind: 'step', id: base.slice(5) };
  if (base.startsWith('type:')) return { kind: 'type', id: base.slice(5) };
  if (base.startsWith('ia:')) return { kind: 'ia', id: base.slice(3) };
  return { kind: 'process' };
}

const kurz = (s: string | undefined, n = 40) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Alle Stellen des Prozesses in der Reihenfolge, in der man sie abarbeitet:
 * erst der Prozess, dann die Schritte **in der Reihenfolge des Ablaufs** mit
 * ihren Teilen, dann die Interaktionen, zuletzt die Datentypen. Nach der
 * Reihenfolge der Datei zu gehen wäre die Reihenfolge des Schreibens — die
 * hilft beim Durchsehen nicht.
 */
export function commentTargets(spec: ProcessSpec, stepsInOrder: Step[]): CommentTargetInfo[] {
  const out: CommentTargetInfo[] = [];
  const P = 'Prozess';
  out.push({ key: processTarget, label: spec.title || spec.name || 'Prozess', group: P });
  out.push({ key: sub(processTarget, 'description'), label: 'Ausgangslage / Ziel', group: P });
  for (const v of spec.variables ?? []) {
    if (v.name) out.push({ key: sub(processTarget, `var:${v.name}`), label: `Variable ${v.name}`, group: P });
  }

  const A = 'Ablauf';
  for (const s of stepsInOrder) {
    if (s.kind === 'goto') continue;
    const base = stepTarget(s.id);
    const name = s.name || s.id;
    const teil = (part: string, label: string) => out.push({ key: sub(base, part), label: `${name} · ${label}`, group: A });
    out.push({ key: base, label: `${KIND_LABEL[s.kind]} ${name}`, group: A });
    teil('description', 'Beschreibung');
    if (s.kind === 'user') teil('assignment', 'Zuständigkeit');
    if (s.kind === 'service' || s.kind === 'call' || s.kind === 'send' || s.kind === 'rule') teil('service', 'Service');
    for (const m of s.inputs ?? []) if (m.name) teil(`in:${m.name}`, `Eingabe ${m.name}`);
    for (const m of s.outputs ?? []) if (m.name) teil(`out:${m.name}`, `Ausgabe ${m.name}`);
    for (const b of s.branches ?? []) teil(`branch:${b.id}`, `Zweig «${kurz(b.label, 30) || b.id}»`);
    for (const e of s.errors ?? []) if (e.code) teil(`error:${e.code}`, `Fehler «${e.code}»`);
  }

  const I = 'Interaktionen';
  for (const ia of spec.interactions ?? []) out.push(iaInfo(ia, I));

  const D = 'Datenmodell';
  for (const t of spec.types ?? []) out.push(...typeInfos(t, D));
  return out;
}

const iaInfo = (ia: Interaction, group: string): CommentTargetInfo =>
  ({ key: iaTarget(ia.id), label: ia.name || ia.id, group });

function typeInfos(t: TypeDef, group: string): CommentTargetInfo[] {
  const base = typeTarget(t.id);
  const name = t.name || t.id;
  const out: CommentTargetInfo[] = [{ key: base, label: name, group }];
  for (const f of t.fields ?? []) if (f.name) out.push({ key: sub(base, `field:${f.id}`), label: `${name}.${f.name}`, group });
  for (const v of t.values ?? []) {
    if (!v.name) continue;
    out.push({ key: sub(base, `value:${v.name}`), label: `${name}.${v.name}`, group });
    for (const f of v.fields ?? []) if (f.name) out.push({ key: sub(base, `field:${f.id}`), label: `${name}.${v.name}.${f.name}`, group });
  }
  return out;
}

/** «vor 3 Tagen» ist hier zu ungenau — Datum und Uhrzeit, kurz. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
