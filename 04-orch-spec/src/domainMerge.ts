// Datenmodell mit der Domain abgleichen — beim «Mit BPMN abgleichen».
//
// Beim Anlegen entsteht das Datenmodell aus der Domain (`enrichSpec`). Beim
// Abgleich gibt es schon eines: gepflegt, kommentiert, mit Status. Darum wird
// hier nicht ersetzt, sondern **zusammengeführt** — wie beim Ablauf:
//
//  · Die **Struktur** kommt aus der Domain: Felder, Typen, Optional/Seq/Map,
//    Einschränkung, Werte der Auswahlen; Name und Schlüssel der Interaktionen.
//  · Was die Spezifikation festlegt, **bleibt**: Beschreibungen, Beispiele —
//    Vorgaben nicht: die gelten aus der Domain, denn bei der Umsetzung werden
//    sie dort angepasst — und vor allem die
//    **IDs** von Typen, Feldern und Interaktionen. An ihnen hängen die
//    Kommentare (`type:<id>#field:<id>`, `ia:<id>`) und die Verweise.
//  · Was die Domain nicht (mehr) kennt, bleibt stehen und wird gemeldet —
//    entfernt nur auf Wunsch (`removeStale`), und auch dann nur, was schon
//    einmal umgesetzt war; ein Entwurf ist der Domain voraus, nicht veraltet.
//
// Zugeordnet wird ohne Raten: die Prozess-Klassen über ihre Rolle (In, Out,
// InitIn, InConfig), die In/Out einer Interaktion über den Schritt im
// Ablauf, alles andere über den Namen.

import type { EnumValue, Field, Interaction, ProcessSpec, Status, TypeDef } from './types';
import { settle, type MergeStatus } from './bpmn';

export interface DomainMergeReport {
  added: string[];
  changed: string[];
  /** was die Domain nicht (mehr) kennt — entfernt oder nur gemeldet, je nach `removeStale` */
  stale: string[];
  /** als Entwurf vorbereitete Interaktionen (Schritte ohne Domain-Objekt) */
  prepared: string[];
  /** standen auf «Angepasst», stimmen mit der Domain überein — bekommen den gewählten Status */
  confirmed: string[];
  kept: number;
}

export interface DomainMergeOptions {
  status: MergeStatus;
  /** Was die Domain nicht (mehr) kennt und schon umgesetzt war, entfernen */
  removeStale?: boolean;
  /** Schritte ohne Interaktion als Entwurf vorbereiten (wie beim Anlegen) */
  prepare?: boolean;
}

/** Vorbereitet beim Import — kein Domain-Objekt dahinter. */
const isPrepared = (x: { status?: Status }) => x.status === 'draft';
/** schon einmal umgesetzt — fehlt es in der Domain, ist es entfallen */
const wasImplemented = (x: { status?: Status }) => x.status === 'implemented' || x.status === 'accepted' || x.status === 'changed';

const ROLES = ['root', 'processOut', 'initIn', 'inConfig'] as const;
const roleOf = (t: TypeDef) => ROLES.find(r => !!t[r]);

/**
 * `previous` ist die Spezifikation nach dem Abgleich des Ablaufs (mit ihrem
 * bisherigen Datenmodell), `fresh` dieselbe, angereichert aus der Domain
 * (`enrichSpec`) — oder `null` ohne Domain: dann werden höchstens die
 * fehlenden Interaktionen vorbereitet (`preparedOnly`).
 */
export function mergeDomain(previous: ProcessSpec, fresh: ProcessSpec, opts: DomainMergeOptions): { spec: ProcessSpec; report: DomainMergeReport } {
  const report: DomainMergeReport = { added: [], changed: [], stale: [], prepared: [], confirmed: [], kept: 0 };
  const pTypes = previous.types ?? [];
  const pIas = previous.interactions ?? [];
  const pById = new Map(pTypes.map(t => [t.id, t]));
  const fById = new Map((fresh.types ?? []).map(t => [t.id, t]));

  // ── Interaktionen: über den Schritt ──────────────────────────────────────
  const pByStep = new Map(pIas.map(i => [i.stepId, i]));
  const dropTypes = new Set<string>();
  const freshIas: Interaction[] = [];
  for (const ia of fresh.interactions ?? []) {
    const prev = pByStep.get(ia.stepId);
    // vorbereitet, obwohl die Spezifikation schon eine hat (oder es nicht soll):
    // die der Spezifikation gilt
    if (isPrepared(ia) && (prev || !opts.prepare)) {
      for (const id of [ia.inTypeId, ia.outTypeId]) if (id) dropTypes.add(id);
      continue;
    }
    freshIas.push(ia);
  }
  // Zwei Schritte können sich ein vorbereitetes Objekt teilen — dessen Typen
  // bleiben, solange eine der Interaktionen bleibt
  for (const ia of freshIas) for (const id of [ia.inTypeId, ia.outTypeId]) if (id) dropTypes.delete(id);

  // ── Typen zuordnen: frische ID → bisherige ID ───────────────────────────
  const pair = new Map<string, string>();
  const paired = new Set<string>();
  const link = (f: string | undefined, p: string | undefined) => {
    if (!f || !p || pair.has(f) || paired.has(p) || !fById.has(f) || !pById.has(p)) return;
    pair.set(f, p);
    paired.add(p);
  };
  for (const r of ROLES) link((fresh.types ?? []).find(t => t[r])?.id, pTypes.find(t => t[r])?.id);
  for (const ia of freshIas) {
    const prev = pByStep.get(ia.stepId);
    if (!prev) continue;
    link(ia.inTypeId, prev.inTypeId);
    link(ia.outTypeId, prev.outTypeId);
  }
  for (const f of fresh.types ?? []) {
    if (pair.has(f.id) || dropTypes.has(f.id) || roleOf(f)) continue;
    const p = pTypes.find(t => !paired.has(t.id) && !roleOf(t) && t.name === f.name);
    if (p) link(f.id, p.id);
  }
  const mapType = (type: string) => pair.get(type) ?? type;

  // ── Interaktionen zusammenführen ─────────────────────────────────────────
  const iaIds = new Map<string, string>(); // frische Interaktions-ID → bisherige
  const interactions: Interaction[] = [];
  const touched = new Set<string>();
  for (const f of freshIas) {
    const prev = pByStep.get(f.stepId);
    if (!prev) {
      const ia: Interaction = { ...f, status: isPrepared(f) ? 'draft' : opts.status.added };
      interactions.push(ia);
      (isPrepared(f) ? report.prepared : report.added).push(f.name);
      continue;
    }
    touched.add(prev.id);
    iaIds.set(f.id, prev.id);
    const inTypeId = f.inTypeId ? mapType(f.inTypeId) : undefined;
    const outTypeId = f.outTypeId ? mapType(f.outTypeId) : undefined;
    const changed = prev.name !== f.name || prev.key !== f.key || prev.kind !== f.kind
      || (prev.inTypeId ?? '') !== (inTypeId ?? '') || (prev.outTypeId ?? '') !== (outTypeId ?? '')
      || isPrepared(prev);
    const { inTypeId: _i, outTypeId: _o, ...rest } = prev;
    interactions.push({
      ...rest,
      kind: f.kind, name: f.name, key: f.key,
      ...(prev.descr || f.descr ? { descr: prev.descr || f.descr } : {}),
      ...(inTypeId ? { inTypeId } : {}),
      ...(outTypeId ? { outTypeId } : {}),
      status: changed ? opts.status.changed : settle(prev.status, opts.status),
    });
    if (changed) report.changed.push(f.name === prev.name ? f.name : `${prev.name} → ${f.name}`);
    else if (settle(prev.status, opts.status) !== prev.status) report.confirmed.push(f.name);
    else report.kept++;
  }
  // die übrigen der Spezifikation bleiben — auch ohne Schritt im Ablauf
  // (der Klassenbauer markiert sie und bietet das Entfernen an)
  for (const ia of pIas) if (!touched.has(ia.id)) interactions.push(ia);

  // ── Typen zusammenführen ─────────────────────────────────────────────────
  const types: TypeDef[] = [];
  const fromFresh = new Set<string>();
  for (const f of fresh.types ?? []) {
    if (dropTypes.has(f.id)) continue;
    const iaId = f.interactionId ? (iaIds.get(f.interactionId) ?? f.interactionId) : undefined;
    const pid = pair.get(f.id);
    const prev = pid ? pById.get(pid) : undefined;
    if (!prev) {
      const t = remap({ ...f, ...(iaId ? { interactionId: iaId } : {}) }, mapType);
      t.status = isPrepared(f) ? 'draft' : opts.status.added;
      types.push(t);
      if (!isPrepared(f)) report.added.push(f.name);
      continue;
    }
    fromFresh.add(prev.id);
    const stale: string[] = [];
    const m = mergeType(prev, remap(f, mapType), stale, !!opts.removeStale);
    if (iaId) m.type.interactionId = iaId;
    const changed = m.changed || (isPrepared(prev) && !isPrepared(f));
    m.type.status = changed ? (isPrepared(f) ? 'draft' : opts.status.changed) : settle(prev.status, opts.status);
    types.push(m.type);
    report.stale.push(...stale.map(s => `${f.name}.${s}`));
    if (changed) report.changed.push(f.name);
    else if (m.type.status !== prev.status) report.confirmed.push(f.name);
    else report.kept++;
  }
  // was die Domain nicht kennt: bleibt — ausser es war umgesetzt, wird nicht
  // mehr gebraucht und soll weg
  const rest = pTypes.filter(t => !fromFresh.has(t.id));
  const used = new Set<string>();
  const use = (fs: Field[] | undefined) => { for (const x of fs ?? []) used.add(x.type); };
  for (const t of [...types, ...rest]) {
    use(t.fields);
    for (const v of t.values ?? []) use(v.fields);
  }
  for (const ia of interactions) for (const id of [ia.inTypeId, ia.outTypeId]) if (id) used.add(id);
  for (const t of rest) {
    const gone = !!fresh.types?.length && wasImplemented(t) && !used.has(t.id);
    if (gone) report.stale.push(t.name);
    if (gone && opts.removeStale) continue;
    types.push(t);
  }

  return { spec: { ...previous, types, interactions }, report };
}

/** Typverweise in Feldern (und Fällen) auf die bisherigen IDs umbiegen. */
function remap(t: TypeDef, mapType: (id: string) => string): TypeDef {
  const fields = (fs: Field[] | undefined) => fs?.map(f => ({ ...f, type: mapType(f.type) }));
  return {
    ...t,
    ...(t.fields ? { fields: fields(t.fields) } : {}),
    ...(t.values ? { values: t.values.map(v => (v.fields ? { ...v, fields: fields(v.fields) } : v)) } : {}),
  };
}

/** Was die Struktur eines Feldes ausmacht — Text und Beispiel gehören der Spezifikation. */
const fieldSig = (f: Field) =>
  JSON.stringify([f.type, !!f.optional, !!f.collection, !!f.map, f.enumCase ?? '', f.constraint ?? '', f.default ?? '']);

/**
 * Felder nach Namen: die Domain bestimmt, welche es gibt und wie sie aussehen
 * — auch die Vorgabe: hat sie keine (mehr), fällt die alte weg; bei der
 * Umsetzung wird sie in der Domain angepasst, dort gilt sie. ID, Beschreibung
 * und Beispiel kommen aus der Spezifikation.
 */
function mergeFields(prev: Field[] | undefined, fresh: Field[] | undefined, where: string, stale: string[], removeStale: boolean, wasImpl: boolean): { fields: Field[]; changed: boolean } {
  const before = new Map((prev ?? []).filter(f => f.name).map(f => [f.name, f]));
  let changed = false;
  const fields: Field[] = (fresh ?? []).map(f => {
    const p = before.get(f.name);
    if (!p) { changed = true; return f; }
    before.delete(f.name);
    // die Beschreibung der Spezifikation geht vor — samt ihrem Ausdruck (`clientKeyDescr`)
    const described = p.description ? p : f;
    const merged: Field = {
      ...f,
      id: p.id,
      ...(described.description ? { description: described.description } : {}),
      ...(described.descriptionExpr ? { descriptionExpr: described.descriptionExpr } : {}),
      ...(p.example || f.example ? { example: p.example || f.example } : {}),
      ...(f.default ? { default: f.default } : {}),
    };
    if (fieldSig(merged) !== fieldSig(p)) changed = true;
    return merged;
  });
  // nur in der Spezifikation: gemeldet; entfernt nur, wenn der Typ schon
  // umgesetzt war und es gewünscht ist — unfertige Felder bleiben ohnehin
  for (const p of prev ?? []) {
    if (!p.name) { fields.push(p); continue; }
    if (!before.has(p.name)) continue;
    stale.push(`${where}${p.name}`);
    if (removeStale && wasImpl) { changed = true; continue; }
    fields.push(p);
  }
  return { fields, changed };
}

function mergeType(prev: TypeDef, fresh: TypeDef, stale: string[], removeStale: boolean): { type: TypeDef; changed: boolean } {
  const wasImpl = wasImplemented(prev);
  let changed = prev.kind !== fresh.kind;
  const common = mergeFields(prev.fields, fresh.fields, '', stale, removeStale, wasImpl);
  changed ||= common.changed;
  let values: EnumValue[] | undefined;
  if (fresh.kind === 'enum') {
    const before = new Map((prev.values ?? []).map(v => [v.name, v]));
    values = (fresh.values ?? []).map(v => {
      const p = before.get(v.name);
      if (!p) { changed = true; return v; }
      before.delete(v.name);
      const fs = mergeFields(p.fields, v.fields, `${v.name}.`, stale, removeStale, wasImpl);
      changed ||= fs.changed;
      return {
        ...v,
        ...(p.description || v.description ? { description: p.description || v.description } : {}),
        ...(fs.fields.length ? { fields: fs.fields } : {}),
      };
    });
    for (const p of prev.values ?? []) {
      if (!before.has(p.name) || !p.name) continue;
      stale.push(p.name);
      if (removeStale && wasImpl) { changed = true; continue; }
      values.push(p);
    }
  }
  const { fields: _f, values: _v, ...head } = fresh;
  const type: TypeDef = {
    ...prev,
    ...head,
    id: prev.id,
    ...(prev.description || fresh.description ? { description: prev.description || fresh.description } : {}),
  };
  delete type.fields;
  delete type.values;
  if (common.fields.length) type.fields = common.fields;
  if (values) type.values = values;
  return { type, changed };
}
