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

import type { CommentEntry, CommentThread, DirectoryUser, Interaction, ProcessSpec, Step, TypeDef } from './types.ts';
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

/** Wer schreibt — mit Anmeldung auch die E-Mail (Empfänger bei Antworten). */
export interface CommentAuthor { name: string; email?: string }

/** Was an einem neuen Beitrag hängt: Erwähnungen und wer benachrichtigt wird. */
export interface EntryExtras { mentions?: DirectoryUser[]; notifyPending?: string[] }

const eintrag = (author: CommentAuthor, text: string, extras: EntryExtras = {}): CommentEntry => ({
  id: uid('ce'), author: author.name, ...(author.email ? { email: author.email } : {}),
  at: nowIsoWithTimezone(), text: text.trim(),
  ...(extras.mentions?.length ? { mentions: extras.mentions } : {}),
  ...(extras.notifyPending?.length ? { notifyPending: extras.notifyPending } : {}),
});

/** Einen neuen Faden anlegen. */
export function addThread(spec: ProcessSpec, target: string, author: CommentAuthor, text: string, extras?: EntryExtras): ProcessSpec {
  if (!text.trim()) return spec;
  const faden: CommentThread = { id: uid('ct'), target, entries: [eintrag(author, text, extras)] };
  return { ...spec, comments: [...(spec.comments ?? []), faden] };
}

/** In einem Faden antworten — das hebt ihn zugleich wieder auf offen. */
export function addReply(spec: ProcessSpec, threadId: string, author: CommentAuthor, text: string, extras?: EntryExtras): ProcessSpec {
  if (!text.trim()) return spec;
  return {
    ...spec,
    comments: (spec.comments ?? []).map(t => (t.id === threadId
      ? { ...t, resolved: false, resolvedBy: undefined, resolvedAt: undefined, entries: [...t.entries, eintrag(author, text, extras)] }
      : t)),
  };
}

/**
 * Teams-Versand quittieren: die zugestellten Empfänger wandern von
 * `notifyPending` nach `notified` — was nicht durchkam, bleibt offen.
 */
export function markNotified(spec: ProcessSpec, done: { entryId: string; email: string }[]): ProcessSpec {
  if (!done.length) return spec;
  return {
    ...spec,
    comments: (spec.comments ?? []).map(t => ({
      ...t,
      entries: t.entries.map(e => {
        const mine = done.filter(d => d.entryId === e.id).map(d => d.email.toLowerCase());
        if (!mine.length) return e;
        const left = (e.notifyPending ?? []).filter(r => !mine.includes(r.toLowerCase()));
        const before = (e.notified ?? []).map(x => x.toLowerCase());
        const { notifyPending: _drop, ...rest } = e;
        void _drop;
        return { ...rest, ...(left.length ? { notifyPending: left } : {}), notified: [...(e.notified ?? []), ...mine.filter(m => !before.includes(m))] };
      }),
    })),
  };
}

/** Welcher Faden gehört zu einer Kommentar-ID — Faden oder einzelner Beitrag (Deep Link). */
export const threadOf = (spec: ProcessSpec, id: string): CommentThread | undefined =>
  (spec.comments ?? []).find(t => t.id === id || t.entries.some(e => e.id === id));

/** Erledigt / wieder offen — wer abgehakt hat, bleibt stehen. */
export function setResolved(spec: ProcessSpec, threadId: string, resolved: boolean, author: string): ProcessSpec {
  return {
    ...spec,
    comments: (spec.comments ?? []).map(t => (t.id !== threadId ? t : resolved
      ? { ...t, resolved: true, resolvedBy: author, resolvedAt: nowIsoWithTimezone() }
      : { ...t, resolved: false, resolvedBy: undefined, resolvedAt: undefined })),
  };
}

/**
 * Emojis: eine feste Auswahl statt eines ganzen Emoji-Pickers — Stimmung,
 * Zustimmung, Hinweis; dieselbe für Reaktionen und für den Kommentartext
 * (dort einfach ein Zeichen im Klartext).
 */
export const EMOJIS = [
  '😀', '😄', '😊', '😉', '😅', '😂', '🙂', '🙃',
  '😍', '🤩', '😎', '🤓', '🤔', '🤨', '😐', '😬',
  '🙄', '😮', '😢', '😭', '😡', '🤯', '😴', '🥳',
  '👍', '👎', '👏', '🙏', '💪', '👀', '🤝', '❤️',
  '✅', '❌', '⚠️', '❓', '❗', '💡', '🔥', '🚀',
] as const;

/** Wer reagiert hat — mit Anmeldung über die E-Mail, sonst über den Namen. */
export const personKey = (p: { name: string; email?: string }) => (p.email?.trim() || p.name.trim()).toLowerCase();

/** Eigene Reaktion an einem Beitrag setzen bzw. zurücknehmen. */
export function toggleReaction(spec: ProcessSpec, threadId: string, entryId: string, emoji: string, author: CommentAuthor): ProcessSpec {
  const key = personKey(author);
  return {
    ...spec,
    comments: (spec.comments ?? []).map(t => (t.id !== threadId ? t : {
      ...t,
      entries: t.entries.map(e => {
        if (e.id !== entryId) return e;
        const list = e.reactions?.[emoji] ?? [];
        const mine = list.some(x => personKey(x) === key);
        const next = mine ? list.filter(x => personKey(x) !== key) : [...list, { name: author.name, ...(author.email ? { email: author.email } : {}) }];
        const reactions = { ...(e.reactions ?? {}), [emoji]: next };
        if (!next.length) delete reactions[emoji];
        const { reactions: _old, ...rest } = e;
        void _old;
        return Object.keys(reactions).length ? { ...rest, reactions } : rest;
      }),
    })),
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
 * Fäden bleiben, auch wenn ihre Stelle verschwindet (ein Abgleich entfernt
 * einen Schritt, ein Feld …) — was besprochen wurde, soll gelesen und
 * abgehakt werden. Damit man im Panel unter «Ohne Stelle» noch weiss, worum
 * es ging, merkt sich der Faden den Namen der Stelle von `before`.
 */
export function rememberPlaces(before: ProcessSpec, after: ProcessSpec, stepsBefore: Step[], stepsAfter: Step[]): CommentThread[] | undefined {
  if (!after.comments?.length) return after.comments;
  const vorher = new Map(commentTargets(before, stepsBefore).map(t => [t.key, t.label]));
  const jetzt = new Set(commentTargets(after, stepsAfter).map(t => t.key));
  let changed = false;
  const comments = after.comments.map(t => {
    const label = vorher.get(t.target);
    if (jetzt.has(t.target) || !label || t.place === label) return t;
    changed = true;
    return { ...t, place: label };
  });
  return changed ? comments : after.comments;
}

// ── Stellen ──────────────────────────────────────────────────────────────────

/** Eine kommentierbare Stelle, wie sie im Panel und in der Übersicht steht. */
export interface CommentTargetInfo {
  key: string;
  label: string;
  /** Überschrift in der Übersicht, z. B. «Ablauf» oder «Datenmodell» */
  group: string;
  /** das Element, z. B. der Schrittname — für den Pfad «Element › Teil» */
  element?: string;
  /** der Teil des Elements, z. B. «Eingabe kind» */
  part?: string;
  /** Schrittart — für das Zeichen vor dem Element */
  stepKind?: Step['kind'];
  /** Art des Typs — Klasse oder Enum */
  typeKind?: TypeDef['kind'];
  /** eine Interaktion (Objekt mit In/Out) */
  ia?: boolean;
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
  const titel = spec.title || spec.name || 'Prozess';
  out.push({ key: processTarget, label: titel, group: P, element: titel });
  out.push({ key: sub(processTarget, 'description'), label: 'Beschrieb / Ausgangslage / Ziel', group: P, element: titel, part: 'Beschrieb / Ausgangslage / Ziel' });
  for (const v of spec.variables ?? []) {
    if (v.name) out.push({ key: sub(processTarget, `var:${v.name}`), label: `Variable ${v.name}`, group: P, element: titel, part: `Variable ${v.name}` });
  }

  const A = 'Ablauf';
  for (const s of stepsInOrder) {
    if (s.kind === 'goto') continue;
    const base = stepTarget(s.id);
    const name = s.name || s.id;
    const teil = (part: string, label: string) =>
      out.push({ key: sub(base, part), label: `${name} · ${label}`, group: A, element: name, part: label, stepKind: s.kind });
    out.push({ key: base, label: `${KIND_LABEL[s.kind]} ${name}`, group: A, element: name, stepKind: s.kind });
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
  ({ key: iaTarget(ia.id), label: ia.name || ia.id, group, element: ia.name || ia.id, ia: true });

function typeInfos(t: TypeDef, group: string): CommentTargetInfo[] {
  const base = typeTarget(t.id);
  const name = t.name || t.id;
  const k = t.kind;
  const out: CommentTargetInfo[] = [{ key: base, label: name, group, element: name, typeKind: k }];
  for (const f of t.fields ?? []) if (f.name) out.push({ key: sub(base, `field:${f.id}`), label: `${name}.${f.name}`, group, element: name, part: f.name, typeKind: k });
  for (const v of t.values ?? []) {
    if (!v.name) continue;
    out.push({ key: sub(base, `value:${v.name}`), label: `${name}.${v.name}`, group, element: name, part: v.name, typeKind: k });
    for (const f of v.fields ?? []) if (f.name) out.push({ key: sub(base, `field:${f.id}`), label: `${name}.${v.name}.${f.name}`, group, element: name, part: `${v.name}.${f.name}`, typeKind: k });
  }
  return out;
}

/**
 * «vor 3 Tagen» ist hier zu ungenau, das volle Datum zu lang: heute nur die
 * Uhrzeit, dieses Jahr «25.09. 09:45», sonst mit Jahr. Die volle Angabe
 * steht im Tooltip (`whenFull`).
 */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return time;
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  if (d.getFullYear() === now.getFullYear()) return `${dd}.${mm}. ${time}`;
  return `${dd}.${mm}.${d.getFullYear()} ${time}`;
}

/** Datum und Uhrzeit ausgeschrieben — für den Tooltip. */
export function whenFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-CH', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
