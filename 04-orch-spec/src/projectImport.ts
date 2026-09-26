// BPMN wählen — die Domain findet die App über den Schlüssel.
//
// Ein Orchescala-Prozess trägt seine ID in beiden Welten: im BPMN als
// Prozess-ID, in der Domain als `val processName`. Wer also ein BPMN wählt,
// muss die Domain nicht mehr suchen — die App tut es:
//
//   1. im **Domain-Katalog** (model.json bzw. catalog.generated.json),
//   2. in den **gemerkten Projekt-Ordnern** (Admin → Katalog → Projekt-Ordner),
//   3. sonst fragt sie nach dem Projekt-Ordner oder einem ZIP.
//
// Aus der gefundenen Domain entstehen das **Datenmodell** (In, InitIn, Out
// und die eigenen Typen dahinter) und die **Interaktionen** (Benutzeraufgaben,
// eigene Worker, Signale, Nachrichten) samt deren In/Out — zugeordnet ohne
// Raten: eine Benutzeraufgabe über `val name` (= Element-ID), ein Worker
// über `val topicName`, Signal und Nachricht über den Namen im BPMN.
//
// Typen aus dem Projekt selbst werden **eigene Typen** der Spezifikation;
// Typen aus anderen Projekten (`GravitonConsultant`) zeigen auf den
// Domain-Katalog, wenn er sie kennt — sonst bleibt der Name stehen und wird
// gemeldet.

import { unzipSync } from 'fflate';
import type { DomainField, DomainType, Field, Interaction, InteractionKind, Model, ProcessSpec, ProjectFolder, TypeDef } from './types';
import { SCALA_TYPES } from './types';
import { isDomainSource, scanFiles } from './domainScan';
import { allSteps } from './bpmn';
import { typeShape } from './scalaTypes';
import { interactionKind, resolveType, suggestName } from './interactions';
import { domainRef } from './serviceTypes';
import { ensureRead, getHandle } from './handles';
import { handleKey, readSources } from './projects';
import { uid } from './util';

export interface ProjectFile { path: string; text: string }

const IGNORE = new Set(['target', '.bloop', '.scala-build', '.bsp', '.git', 'node_modules', '.idea', 'dist', '__MACOSX']);

/** Ordner rekursiv lesen — nur Domain-Quellen, Build-Ordner bleiben draussen. */
export async function readProjectDir(dir: FileSystemDirectoryHandle, prefix = ''): Promise<ProjectFile[]> {
  const out: ProjectFile[] = [];
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (IGNORE.has(name) || name.startsWith('.')) continue;
      out.push(...await readProjectDir(handle as FileSystemDirectoryHandle, path));
    } else if (isDomainSource(path)) {
      out.push({ path, text: await (handle as FileSystemFileHandle).getFile().then(f => f.text()) });
    }
  }
  return out;
}

/** ZIP lesen — dieselbe Auswahl wie beim Ordner. */
export function readProjectZip(data: Uint8Array): ProjectFile[] {
  const dec = new TextDecoder();
  const entries = unzipSync(data, {
    filter: f => isDomainSource(f.name) && !f.name.split('/').some(seg => IGNORE.has(seg)),
  });
  return Object.entries(entries).map(([path, bytes]) => ({ path, text: dec.decode(bytes) }));
}

/** Domain-Typen aus Quelldateien. */
export const scanDomain = (files: ProjectFile[]): DomainType[] => scanFiles(files.filter(f => isDomainSource(f.path))).types;

/** Kennt diese Domain den Prozess? */
export const hasProcess = (domain: DomainType[], processId: string): boolean =>
  domain.some(t => t.processName === processId && t.owner);

export interface DomainHit {
  domain: DomainType[];
  /** woher: `Katalog` oder `Ordner <name>` */
  source: string;
}

/**
 * Die Domain zum Prozess suchen: erst der Katalog, dann die gemerkten
 * Projekt-Ordner — Ordner, deren Name zur Prozess-ID passt, zuerst (die
 * Leseberechtigung fragt der Browser je Ordner nach). `null` = nichts gefunden.
 */
export async function findDomain(processId: string, model: Model | null, onProgress?: (text: string) => void): Promise<DomainHit | null> {
  const catalog = model?.domainTypes ?? [];
  if (hasProcess(catalog, processId)) return { domain: catalog, source: 'Katalog' };

  const folders: ProjectFolder[] = [...(model?.projects ?? [])]
    .sort((a, b) => Number(processId.startsWith(b.name)) - Number(processId.startsWith(a.name)));
  for (const p of folders) {
    const handle = await getHandle(handleKey(p));
    if (!handle || !(await ensureRead(handle))) continue;
    onProgress?.(`${p.name} wird gelesen …`);
    const files: ProjectFile[] = [];
    await readSources(handle, p.name, files, () => {});
    const domain = scanDomain(files);
    if (hasProcess(domain, processId)) return { domain, source: `Ordner ${p.name}` };
  }
  return null;
}

// ── Domain → eigene Typen ────────────────────────────────────────────────────

const isScalar = (t: string) => (SCALA_TYPES as readonly string[]).includes(t);

/**
 * Übersetzt Domain-Typen des Projekts in Typen der Spezifikation. Was zum
 * Projekt gehört, wird ein eigener Typ; Fremdes zeigt in den Katalog.
 */
class Converter {
  readonly types: TypeDef[] = [];
  readonly unresolved = new Set<string>();
  private readonly ids = new Map<string, string>();

  constructor(private readonly domain: DomainType[], private readonly pkg: string, private readonly model: Model | null) {}

  /** Gehört der Typ zum Projekt des Prozesses (gleicher Paketstamm)? */
  private own(t: DomainType): boolean {
    const stem = this.pkg.replace(/\.domain\..*$/, '.domain');
    return t.pkg === this.pkg || t.pkg.startsWith(`${stem}.`) || t.pkg === stem;
  }

  /** Typ eines Feldes: Grundtyp ohne Option/Seq → Feldtyp der Spezifikation. */
  fieldType(base: string, pkg: string, depth = 0): { type: string; constraint?: string } {
    if (isScalar(base)) return { type: base };
    if (depth > 8) return { type: base };
    // im Projekt: gleiches Paket zuerst, dann der Projektstamm
    const own = this.domain.find(t => t.id === `${pkg}.${base}`)
      ?? this.domain.find(t => this.own(t) && (t.name === base || t.name.endsWith(`.${base}`)));
    if (own) {
      if (own.kind === 'alias') {
        if (!own.target) { this.unresolved.add(base); return { type: base }; }
        const shape = typeShape(own.target);
        const inner = this.fieldType(shape.base, own.pkg, depth + 1);
        return shape.constraint ? { ...inner, constraint: inner.constraint ?? shape.constraint } : inner;
      }
      if (own.kind === 'member' && !own.fields?.length) { this.unresolved.add(base); return { type: base }; }
      return { type: this.convert(own, {}) };
    }
    // fremdes Projekt: der Katalog kennt es vielleicht
    const ext = resolveType(base, this.model, pkg);
    if (ext) return { type: domainRef(ext.id) };
    this.unresolved.add(base);
    return { type: base };
  }

  /** Einen Domain-Typ als eigenen Typ anlegen (je Domain-Typ genau einmal). */
  convert(dom: DomainType, flags: Partial<TypeDef>, copyAs?: string): string {
    const memo = copyAs ? `${dom.id}→${copyAs}` : dom.id;
    const known = this.ids.get(memo);
    if (known) return known;
    const id = uid('t');
    this.ids.set(memo, id);
    const name = copyAs ?? (dom.owner ? dom.name.slice(dom.owner.length + 1) : dom.name);
    const t: TypeDef = {
      id,
      name,
      kind: dom.kind === 'enum' ? 'enum' : 'case',
      status: 'implemented',
      ...(dom.descr ? { description: dom.descr } : {}),
      ...flags,
    };
    this.types.push(t); // vor den Feldern — gegen Zyklen
    const toFields = (ps: DomainField[] | undefined, pkg: string): Field[] =>
      // `InConfig` ist Implementations-Detail — weder als Typ noch als Feld
      (ps ?? []).filter(p => !/^InConfig$|\.InConfig$/.test(typeShape(p.type).base)).map(p => {
        const shape = typeShape(p.type);
        const ft = this.fieldType(shape.base, pkg);
        const f: Field = { id: uid('f'), name: p.name, type: ft.type };
        if (shape.optional) f.optional = true;
        if (shape.collection) f.collection = true;
        if (shape.map) f.map = true;
        const constraint = shape.constraint ?? ft.constraint;
        if (constraint) f.constraint = constraint;
        if (p.default && p.default !== 'None') f.default = p.default;
        if (p.description) f.description = p.description;
        return f;
      });
    if (dom.kind === 'enum') {
      // Gemeinsame Felder (`def x: T` im Rumpf) — sie stehen in jedem Fall
      // nochmals; dort bleiben nur die speziellen
      const common = toFields(dom.fields, dom.pkg);
      const commonNames = new Set(common.map(f => f.name));
      if (common.length) t.fields = common;
      const cases = new Map((dom.cases ?? []).map(c => [c.name, c.fields]));
      t.values = (dom.values ?? []).map(v => {
        const fields = toFields((cases.get(v) ?? []).filter(p => !commonNames.has(p.name)), dom.pkg);
        return fields.length ? { name: v, fields } : { name: v };
      });
    } else {
      t.fields = toFields(dom.fields, dom.pkg);
    }
    return id;
  }
}

// ── Spezifikation anreichern ─────────────────────────────────────────────────

export interface Enriched {
  spec: ProcessSpec;
  /** Domain-Objekt des Prozesses */
  object: string;
  /** zugeordnete Interaktionen (Objektnamen) */
  matched: string[];
  /** Interaktions-Objekte des Pakets ohne passenden Schritt */
  unmatched: string[];
  /** Typnamen, die weder das Projekt noch der Katalog kennt */
  unresolved: string[];
  warnings: string[];
}

const DSL_KIND: Record<string, InteractionKind> = {
  UserTask: 'userTask', CustomTask: 'customTask', SignalEvent: 'signal', MessageEvent: 'message',
};

/**
 * Art eines Domain-Objekts. Ein älterer Katalog kennt das DSL nicht — dann
 * verraten Topic und Namensendung (`…UT`, `…SE`, `…ME`), was es ist.
 */
function objectKind(t: DomainType): InteractionKind | null {
  if (t.dsl) return DSL_KIND[t.dsl] ?? null;
  if (t.topicName) return 'customTask';
  if (/UT$/.test(t.owner ?? '')) return 'userTask';
  if (/SE$/.test(t.owner ?? '')) return 'signal';
  if (/ME$/.test(t.owner ?? '')) return 'message';
  return null;
}

/**
 * Eine aus dem BPMN gelesene Spezifikation um Datenmodell und Interaktionen
 * aus der Domain ergänzen. `null`, wenn die Domain den Prozess nicht kennt.
 */
export function enrichSpec(spec: ProcessSpec, domain: DomainType[], model: Model | null): Enriched | null {
  const warnings: string[] = [];
  const procType = domain.find(t => t.processName === spec.processId && t.owner);
  if (!procType) return null;
  const owner = procType.owner!;
  const pkg = procType.pkg;
  const conv = new Converter(domain, pkg, model);
  const member = (obj: string, name: string) => domain.find(t => t.id === `${pkg}.${obj}.${name}`) ?? null;

  // Prozess: In · InitIn · Out — InConfig ist Implementations-Detail
  const inT = member(owner, 'In');
  if (inT && (inT.kind === 'case' || inT.kind === 'enum')) conv.convert(inT, { root: true }, 'In');
  const initT = member(owner, 'InitIn');
  if (initT?.kind === 'case') conv.convert(initT, { initIn: true }, 'InitIn');
  const outT = member(owner, 'Out');
  if (outT && (outT.kind === 'case' || outT.kind === 'enum')) conv.convert(outT, { processOut: true }, 'Out');

  // Interaktionen: die Objekte mit Interaktions-Art — die des eigenen Pakets
  // zuerst, damit bei gleichem Namen diese gewinnen
  const objects = [...new Map(domain
    .filter(t => t.owner && objectKind(t))
    .sort((a, b) => Number(b.pkg === pkg) - Number(a.pkg === pkg))
    .map(t => [`${t.pkg}.${t.owner!}`, t])).values()];
  const interactions: Interaction[] = [];
  const matched: string[] = [];
  const processId = spec.processId ?? '';
  const startId = spec.steps.find(s => s.kind === 'start')?.id;

  const memberType = (o: DomainType, name: 'In' | 'Out', iaId: string): string | undefined => {
    const t = domain.find(x => x.id === `${o.pkg}.${o.owner}.${name}`);
    if (!t) return undefined;
    if (t.kind === 'case' || t.kind === 'enum') return conv.convert(t, { interactionId: iaId }, `${o.owner}.${name}`);
    if (t.kind === 'alias' && t.target && t.target !== 'NoInput' && t.target !== 'NoOutput') {
      // `type In = AdjustAddressUT.In` — dieselben Felder unter eigenem Namen
      const target = domain.find(x => x.name === t.target || x.id === `${pkg}.${t.target}`);
      if (target && (target.kind === 'case' || target.kind === 'enum')) {
        return conv.convert(target, { interactionId: iaId, description: `= ${t.target}` }, `${o.owner}.${name}`);
      }
      warnings.push(`${o.owner}.${name} = ${t.target}: Ziel nicht gefunden.`);
    }
    return undefined;
  };

  for (const step of allSteps(spec.steps)) {
    if (step.kind === 'goto' || step.id === startId) continue;
    // Ein Worker des Projekts erkennt man am Topic — auch wenn es nicht mit
    // der Prozess-ID beginnt (Worker eines Nachbarpakets)
    const byTopic = step.kind === 'service' && step.topic && step.topic !== processId
      ? objects.find(o => objectKind(o) === 'customTask' && o.topicName === step.topic) : undefined;
    // Ein Signal beschreibt das Objekt auch, wenn der Prozess es **fängt**
    // (Startereignis eines Ereignis-Subprozesses, Zwischenereignis)
    const caughtSignal = step.eventKind === 'signal' && step.messageName ? 'signal' as const : null;
    const kind = byTopic ? 'customTask' : (interactionKind(step, processId) ?? caughtSignal);
    if (!kind) continue;
    const obj = byTopic ?? objects.find(o => {
      if (objectKind(o) !== kind) return false;
      if (kind === 'customTask') return o.topicName === step.topic;
      if (kind === 'userTask' && o.key) return o.key === step.id;
      // Signal / Nachricht: über den Namen im BPMN (bis zum dynamischen Teil)
      const key = (o.key ?? '').split('${')[0];
      if (key && step.messageName && (step.messageName === o.key || step.messageName.startsWith(key))) return true;
      // sonst die Namenskonvention (`AdressanderungPrufenQMSTask` → `AdressanderungPrufenQMSUT`)
      return o.owner === suggestName(step, kind, processId, model);
    });
    if (!obj) continue;
    const ia: Interaction = {
      id: uid('ia'), stepId: step.id, kind, name: obj.owner!,
      key: obj.key ?? obj.topicName ?? (kind === 'userTask' ? step.id : step.messageName ?? ''),
      ...(obj.ownerDescr ? { descr: obj.ownerDescr } : {}),
      status: 'implemented',
    };
    const inId = memberType(obj, 'In', ia.id);
    if (inId) ia.inTypeId = inId;
    if (kind === 'userTask' || kind === 'customTask') {
      const outId = memberType(obj, 'Out', ia.id);
      if (outId) ia.outTypeId = outId;
    }
    interactions.push(ia);
    matched.push(obj.owner!);
  }
  const unmatched = objects.filter(o => o.pkg === pkg).map(o => o.owner!).filter(o => !matched.includes(o));

  const built: ProcessSpec = {
    ...spec,
    ...(procType.ownerDescr && !spec.description ? { description: procType.ownerDescr } : {}),
    types: conv.types,
    interactions,
  };
  return { spec: built, object: owner, matched, unmatched, unresolved: [...conv.unresolved].sort(), warnings };
}
