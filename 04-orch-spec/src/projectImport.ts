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
// Typen aus anderen Projekten (`CrmConsultant`) zeigen auf den
// Domain-Katalog, wenn er sie kennt — sonst bleibt der Name stehen und wird
// gemeldet.

import { unzipSync } from 'fflate';
import type { DomainField, DomainType, Field, Interaction, InteractionKind, Model, ProcessSpec, ProjectFolder, Step, TypeDef } from './types';
import { SCALA_TYPES } from './types';
import { isDomainSource, scanFiles } from './domainScan';
import { allSteps } from './bpmn';
import { typeShape } from './scalaTypes';
import { catalogEntry, createMemberType, interactionKind, loopSettings, missingInteractions, resolveType, suggestName, toInteraction, withOrigin } from './interactions';
import { packageOf } from './scala';
import { INTERACTION_META } from './types';
import { domainRef } from './serviceTypes';
import { enumHasCase, splitEnumCase } from './feel';
import { handleFor, readSources } from './projects';
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
  /** Vorbehalt zur Quelle, z. B. ein älterer Katalog ohne die Fälle der enums */
  note?: string;
}

/**
 * Kennt der Katalog die Angaben des heutigen Scanners (Art des Objekts,
 * Schlüssel, Fälle und gemeinsame Felder der enums)? Ein älterer Katalog
 * hat nur Namen und Felder — daraus wird kein ADT und keine Zuordnung über
 * `val name`.
 */
const isDetailed = (domain: DomainType[]): boolean => domain.some(t => t.dsl || t.keyName || t.cases?.length);

/**
 * Die Domain zum Prozess suchen: der Katalog, wenn er den Prozess **mit
 * allen Angaben** kennt; sonst die gemerkten Projekt-Ordner — Ordner, deren
 * Name zur Prozess-ID passt, zuerst (die Leseberechtigung fragt der Browser
 * je Ordner nach); sonst ein älterer Katalog mit Vorbehalt. `null` = nichts.
 */
export async function findDomain(processId: string, model: Model | null, onProgress?: (text: string) => void): Promise<DomainHit | null> {
  const catalog = model?.domainTypes ?? [];
  const inCatalog = hasProcess(catalog, processId);
  const roots = new Map<string, FileSystemDirectoryHandle | null>();
  const fromFolder = async (p: ProjectFolder): Promise<DomainHit | null> => {
    const handle = await handleFor(p, roots);
    if (!handle) return null;
    onProgress?.(`${p.name} wird gelesen …`);
    const files: ProjectFile[] = [];
    await readSources(handle, p.name, files, () => {});
    const domain = scanDomain(files);
    return hasProcess(domain, processId) ? { domain, source: `Ordner ${p.name}` } : null;
  };
  // Zuerst der eigene Projekt-Ordner: dort steht der aktuelle Stand — der
  // Katalog ist so alt wie sein letzter Aufbau (Admin → Katalog, prepareDocs),
  // eine Änderung an der Domain sähe der Abgleich sonst erst danach.
  const folders = model?.projects ?? [];
  const own = folders.filter(p => processId.startsWith(`${p.name}-`));
  for (const p of own) {
    const hit = await fromFolder(p);
    if (hit) return hit;
  }
  if (inCatalog && isDetailed(catalog)) return { domain: catalog, source: 'Katalog' };
  for (const p of folders.filter(p => !own.includes(p))) {
    const hit = await fromFolder(p);
    if (hit) return hit;
  }
  if (inCatalog) {
    return {
      domain: catalog, source: 'Katalog',
      note: 'Der Katalog ist von einem älteren Stand: Fälle und gemeinsame Felder der enums sowie die Schlüssel der Objekte fehlen darin. Katalog neu aufbauen (Admin → Katalog) oder den Projekt-Ordner wählen.',
    };
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
  /** was der Import über das Erkannte zu sagen hat, z. B. erkannte gemeinsame Felder */
  readonly notes: string[] = [];
  private readonly ids = new Map<string, string>();

  constructor(
    private readonly domain: DomainType[], private readonly pkg: string, private readonly model: Model | null,
    /** Objekte, die im Prozess eine Interaktion sind — deren In/Out bleiben **ein** Typ, `Objekt.In` */
    private readonly interactionOwners: Set<string> = new Set(),
  ) {}

  /** Gehört der Typ zum Projekt des Prozesses (gleicher Paketstamm)? */
  private own(t: DomainType): boolean {
    const stem = this.pkg.replace(/\.domain\..*$/, '.domain');
    return t.pkg === this.pkg || t.pkg.startsWith(`${stem}.`) || t.pkg === stem;
  }

  /** Typ eines Feldes: Grundtyp ohne Option/Seq → Feldtyp der Spezifikation. */
  fieldType(base: string, pkg: string, depth = 0): { type: string; constraint?: string; enumCase?: string } {
    if (isScalar(base)) return { type: base };
    if (depth > 8) return { type: base };
    // `CustomDocContents.\`QI-Deklaration\`` — eine Ausprägung eines ADT-enums:
    // das Feld zeigt auf das enum und nennt den Fall
    const split = splitEnumCase(base);
    if (split && !/\.(In|Out)$/.test(base)) {
      const en = this.domain.find(t => t.id === `${pkg}.${split.base}`)
        ?? this.domain.find(t => this.own(t) && t.name === split.base)
        ?? resolveType(split.base, this.model, pkg);
      if (en && enumHasCase(en, split.enumCase)) {
        const type = this.domain.includes(en) && this.own(en) ? this.convert(en, {}) : domainRef(en.id);
        return { type, enumCase: split.enumCase };
      }
    }
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
      // `MergeContractsForCAM.In` als Feldtyp: das In/Out eines Objekts. Ist
      // das Objekt eine Interaktion dieses Prozesses, ist es derselbe Typ wie
      // dort — mit vollem Namen. Sonst gehört es einem fremden Objekt (DMN,
      // Service) und zeigt in den Katalog, wenn der es kennt.
      if (own.owner && /\.(In|Out)$/.test(own.name)) {
        if (this.interactionOwners.has(own.owner)) return { type: this.convert(own, {}, own.name) };
        const ext = resolveType(base, this.model, pkg);
        if (ext) return { type: domainRef(ext.id) };
        this.unresolved.add(base);
        return { type: base };
      }
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
    if (known) {
      // schon da (etwa als Feldtyp) — die Rolle kommt nachträglich dazu
      const existing = this.types.find(t => t.id === known);
      if (existing) Object.assign(existing, flags);
      return known;
    }
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
        if (ft.enumCase) f.enumCase = ft.enumCase;
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
      const cases = new Map((dom.cases ?? []).map(c => [c.name, c.fields]));
      const perCase = (dom.values ?? []).map(v => ({
        name: v, fields: toFields((cases.get(v) ?? []).filter(p => !commonNames.has(p.name)), dom.pkg),
      }));
      // Was in **allen** Fällen mit gleichem Namen und gleichem Typ steht, ist
      // ebenfalls gemeinsam — auch wenn die Domain es nicht als `def` führt
      const shared = sharedFields(perCase.filter(c => c.fields.length).map(c => c.fields));
      if (shared.length) {
        const names = new Set(shared.map(f => f.name));
        for (const c of perCase) c.fields = c.fields.filter(f => !names.has(f.name));
        this.notes.push(`${name}: ${shared.length} gemeinsame Feld${shared.length === 1 ? '' : 'er'} erkannt (${shared.map(f => f.name).join(', ')}) — stehen in jedem Fall gleich.`);
      }
      if (common.length || shared.length) t.fields = [...common, ...shared];
      t.values = perCase.map(c => (c.fields.length ? { name: c.name, fields: c.fields } : { name: c.name }));
    } else {
      t.fields = toFields(dom.fields, dom.pkg);
    }
    return id;
  }
}

/**
 * Felder, die in allen Fällen gleich sind: gleicher Name, gleicher Typ und
 * dieselben Hüllen (optional, mehrfach, Map, Ausprägung, Einschränkung).
 * Beschreibung und Vorgabe kommen vom ersten Fall, der sie hat. Bei einem
 * einzigen Fall gibt es nichts Gemeinsames zu erkennen.
 */
export function sharedFields(cases: Field[][]): Field[] {
  if (cases.length < 2) return [];
  const key = (f: Field) => JSON.stringify([f.type, !!f.optional, !!f.collection, !!f.map, f.enumCase ?? '', f.constraint ?? '']);
  return cases[0].flatMap(f => {
    const k = key(f);
    const twins = cases.map(c => c.find(x => x.name === f.name && key(x) === k));
    if (twins.some(x => !x)) return [];
    const description = twins.map(x => x!.description).find(Boolean);
    const dflt = twins.map(x => x!.default).find(Boolean);
    return [{ ...f, ...(description ? { description } : {}), ...(dflt ? { default: dflt } : {}) }];
  });
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
  /** Hinweise ohne Handlungsbedarf, z. B. erkannte gemeinsame Felder */
  notes: string[];
  /** Schritte ohne Domain-Objekt — als Interaktion im Entwurf vorbereitet, mit In/Out */
  prepared: string[];
}

/**
 * Schritte, die eine Interaktion brauchen, die Domain aber nicht kennt:
 * Benutzeraufgaben, eigene Worker, Signale, Nachrichten ohne Objekt. Sie
 * werden **vorbereitet** — Interaktion im Entwurf, `In` und `Out` als
 * Klassen mit den Feldern aus dem Katalog, sonst aus den Mappings des
 * Schritts — damit die Domain daraus entstehen kann statt umgekehrt.
 */
export function prepareInteractions(spec: ProcessSpec, model: Model | null): { spec: ProcessSpec; prepared: string[] } {
  const offen = missingInteractions(spec, model);
  if (!offen.length) return { spec, prepared: [] };
  const types = [...(spec.types ?? [])];
  const interactions = [...(spec.interactions ?? [])];
  const prepared: string[] = [];
  // Dasselbe Objekt an zwei Stellen im Ablauf (ein Signal, das zweimal
  // geworfen wird) ist **ein** Objekt: die zweite Stelle teilt die Klassen
  const byName = new Map<string, Interaction>(interactions.map(i => [i.name, i]));
  for (const s of offen) {
    const ia: Interaction = { ...withOrigin(toInteraction(s), model, packageOf(spec, model)), status: 'draft' };
    const twin = byName.get(ia.name);
    if (twin) {
      if (twin.inTypeId) ia.inTypeId = twin.inTypeId;
      if (twin.outTypeId) ia.outTypeId = twin.outTypeId;
      interactions.push(ia);
      continue;
    }
    const entry = catalogEntry(s.step, model);
    const inT = memberFromStep(ia, 'In', s.step, entry, model, packageOf(spec, model));
    types.push(inT);
    ia.inTypeId = inT.id;
    if (INTERACTION_META[s.kind].hasOut) {
      const outT = memberFromStep(ia, 'Out', s.step, entry, model, packageOf(spec, model));
      types.push(outT);
      ia.outTypeId = outT.id;
    }
    interactions.push(ia);
    byName.set(ia.name, ia);
    prepared.push(`${ia.name} (${INTERACTION_META[s.kind].label} «${s.step.name}»)`);
  }
  return { spec: { ...spec, types, interactions }, prepared };
}

/** `In`/`Out` einer vorbereiteten Interaktion: Katalog, sonst die Mappings des Schritts, sonst leer. */
function memberFromStep(ia: Interaction, member: 'In' | 'Out', step: Step, entry: ReturnType<typeof catalogEntry>, model: Model | null, ownPkg: string): TypeDef {
  const t = createMemberType(ia, member, entry, model, ownPkg);
  if (!(t.fields ?? []).some(f => f.name)) {
    const maps = (member === 'In' ? step.inputs : step.outputs) ?? [];
    const fields: Field[] = maps.filter(m => !m.disabled && m.name.trim()).map(m => ({
      id: uid('f'), name: m.name.trim(), type: 'String', ...(m.description ? { description: m.description } : {}),
    }));
    if (fields.length) t.fields = fields;
  }
  return {
    ...t,
    status: 'draft',
    description: `Vorbereitet beim Import — in der Domain gibt es «${ia.name}» noch nicht. Felder und Typen prüfen.`,
  };
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
  // Objekte mit Interaktions-Art — deren In/Out bleiben ein Typ mit vollem Namen
  const interactionOwners = new Set(domain.filter(t => t.owner && objectKind(t)).map(t => t.owner!));
  const conv = new Converter(domain, pkg, model, interactionOwners);
  const member = (obj: string, name: string) => domain.find(t => t.id === `${pkg}.${obj}.${name}`) ?? null;

  // Prozess: In · InitIn · Out · InConfig
  const inT = member(owner, 'In');
  if (inT && (inT.kind === 'case' || inT.kind === 'enum')) conv.convert(inT, { root: true }, 'In');
  const initT = member(owner, 'InitIn');
  if (initT?.kind === 'case') conv.convert(initT, { initIn: true }, 'InitIn');
  // vom InConfig nur die eigenen Stellschrauben — Schleifen und Mocks
  // erzeugt der Generator aus dem Ablauf
  const cfgT = member(owner, 'InConfig');
  if (cfgT?.kind === 'case') {
    const erzeugt = new Set(loopSettings(spec).map(l => l.name));
    const eigene = (cfgT.fields ?? []).filter(f => !erzeugt.has(f.name) && !/Mock$/.test(f.name));
    if (eigene.length) conv.convert({ ...cfgT, fields: eigene }, { inConfig: true }, 'InConfig');
  }
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
      // `type In = AdjustOrderUT.In` — dieselben Felder unter eigenem Namen
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
      // sonst die Namenskonvention (`KartenbestellungPrufenBackofficeTask` → `KartenbestellungPrufenBackofficeUT`)
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

  const enriched: ProcessSpec = {
    ...spec,
    ...(procType.ownerDescr && !spec.description ? { description: procType.ownerDescr } : {}),
    types: conv.types,
    interactions,
  };
  // was die Domain nicht kennt, wird vorbereitet — als Entwurf, zum Nachziehen
  const { spec: built, prepared } = prepareInteractions(enriched, model);
  return { spec: built, object: owner, matched, unmatched, unresolved: [...conv.unresolved].sort(), warnings, notes: conv.notes, prepared };
}
