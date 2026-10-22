// Choose a BPMN — the app finds the domain via the key.
//
// An Orchescala process carries its ID in both worlds: in the BPMN as
// process ID, in the domain as `val processName`. So whoever chooses a BPMN
// no longer has to search for the domain — the app does it:
//
//   1. in the **domain catalog** (model.json or catalog.generated.json),
//   2. in the **remembered project folders** (Admin → Katalog → Projekt-Ordner),
//   3. otherwise it asks for the project folder or a ZIP.
//
// From the domain found, the **data model** (In, InitIn, Out
// and the own types behind them) and the **interactions** (user tasks,
// own workers, signals, messages) including their In/Out are created — mapped without
// guessing: a user task via `val name` (= element ID), a worker
// via `val topicName`, signal and message via the name in the BPMN.
//
// Types from the project itself become **own types** of the specification;
// types from other projects (`CrmConsultant`) point to the
// domain catalog if it knows them — otherwise the name stays and is
// reported.

import { unzipSync } from 'fflate';
import type { DomainField, DomainType, Field, Interaction, InteractionKind, Model, ProcessSpec, ProjectFolder, Step, TypeDef } from './types.ts';
import { SCALA_TYPES } from './types.ts';
import { isDomainSource, scanFiles } from './domainScan.ts';
import { allSteps } from './bpmn.ts';
import { exampleOf, importsForExpression, isCompoundType, isFixedCaseDefault, typeShape } from './scalaTypes.ts';
import { catalogEntry, createMemberType, interactionKind, missingInteractions, resolveType, suggestName, toInteraction, withOrigin, withoutWiringInteractions } from './interactions.ts';
import { packageOf, referencedClass } from './scala.ts';
import { INTERACTION_META } from './types.ts';
import { domainRef } from './serviceTypes.ts';
import { enumHasCase, splitEnumCase } from './feel.ts';
import { handleFor, readSources } from './projects.ts';
import { uid } from './util.ts';
import { catalogIndex } from './orchescalaTypes.ts';

export interface ProjectFile { path: string; text: string }

const IGNORE = new Set(['target', '.bloop', '.scala-build', '.bsp', '.git', 'node_modules', '.idea', 'dist', '__MACOSX']);

/** Read a folder recursively — only domain sources, build folders stay out. */
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

/** Read a ZIP — the same selection as for the folder. */
export function readProjectZip(data: Uint8Array): ProjectFile[] {
  const dec = new TextDecoder();
  const entries = unzipSync(data, {
    filter: f => isDomainSource(f.name) && !f.name.split('/').some(seg => IGNORE.has(seg)),
  });
  return Object.entries(entries).map(([path, bytes]) => ({ path, text: dec.decode(bytes) }));
}

/** Domain types from source files. */
export const scanDomain = (files: ProjectFile[]): DomainType[] => scanFiles(files.filter(f => isDomainSource(f.path))).types;

/** Does this domain know the process? */
export const hasProcess = (domain: DomainType[], processId: string): boolean =>
  domain.some(t => t.processName === processId && t.owner);

export interface DomainHit {
  domain: DomainType[];
  /** where from: `Katalog` or `Ordner <name>` */
  source: string;
  /** Caveat about the source, e.g. an older catalog without the cases of the enums */
  note?: string;
}

/**
 * Does the catalog know the details of today's scanner (kind of object,
 * key, cases and shared fields of the enums)? An older catalog
 * only has names and fields — that yields no ADT and no mapping via
 * `val name`.
 */
const isDetailed = (domain: DomainType[]): boolean => domain.some(t => t.dsl || t.keyName || t.cases?.length);

/**
 * Find the domain for the process: the catalog, if it knows the process **with
 * all details**; otherwise the remembered project folders — folders whose
 * name matches the process ID first (the browser asks for read permission
 * per folder); otherwise an older catalog with a caveat. `null` = nothing.
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
  // First the own project folder: it holds the current state — the
  // catalog is as old as its last build (Admin → Katalog, prepareDocs),
  // otherwise the sync would only see a change to the domain after that.
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

// ── Domain → own types ───────────────────────────────────────────────────────

const isScalar = (t: string) => (SCALA_TYPES as readonly string[]).includes(t);

/**
 * Translates domain types of the project into types of the specification. What belongs
 * to the project becomes an own type; foreign ones point into the catalog.
 */
class Converter {
  readonly types: TypeDef[] = [];
  readonly unresolved = new Set<string>();
  /** what the import has to say about what was recognized, e.g. recognized shared fields */
  readonly notes: string[] = [];
  private readonly ids = new Map<string, string>();

  constructor(
    private readonly domain: DomainType[], private readonly pkg: string, private readonly model: Model | null,
    /** Objects that are an interaction in the process — their In/Out stay **one** type, `Objekt.In` */
    private readonly interactionOwners: Set<string> = new Set(),
    /** the process object itself (`OrderCard`) — what is in it belongs to the specification */
    private readonly processOwner?: string,
  ) {}

  /** Does the type belong to the project of the process (same package root)? */
  private own(t: DomainType): boolean {
    const stem = this.pkg.replace(/\.domain\..*$/, '.domain');
    return t.pkg === this.pkg || t.pkg.startsWith(`${stem}.`) || t.pkg === stem;
  }

  /**
   * A class **of this process** — only it gets into the data model: free-standing
   * in the package or directly in the process object (`OrderCard.CustomProcessStatus`).
   * Classes of other processes of the project and those that live in another
   * object (`ResolveTimerDueDateWithOverwrite.DueDateSpec`) already
   * exist: they are referenced (otherwise the export would write them again).
   */
  private ownProcess(t: DomainType): boolean {
    const inProcessObject = !!t.owner && t.owner === this.processOwner;
    return (!t.owner || inProcessObject) && (t.pkg === this.pkg || t.pkg.startsWith(`${this.pkg}.`));
  }

  /**
   * A type via the imports of its file: `LoadPoas.Out` with
   * `import valiant.vollmacht.domain.loadPoas.v1.LoadPoas` — first the
   * explicit ones, then those with `*`; a relative import (`schema.*`) also
   * from the package.
   */
  private viaImports(base: string, pkg: string, imports: string[] | undefined): DomainType | null {
    if (!imports?.length) return null;
    const head = base.split('.')[0];
    const rest = base.slice(head.length);
    const index = catalogIndex(this.model?.domainTypes);
    const lookup = (id: string) => this.domain.find(t => t.id === id) ?? index.byId.get(id) ?? null;
    const at = (path: string) => lookup(path) ?? lookup(`${pkg}.${path}`);
    for (const imp of imports) if (imp.endsWith(`.${head}`) || imp === head) { const t = at(`${imp}${rest}`); if (t) return t; }
    for (const imp of imports) if (imp.endsWith('.*')) { const t = at(`${imp.slice(0, -2)}.${base}`); if (t) return t; }
    return null;
  }

  /** Type of a field: base type without Option/Seq → field type of the specification. */
  fieldType(base: string, pkg: string, depth = 0, scope?: string, imports?: string[]): { type: string; constraint?: string; enumCase?: string } {
    if (isScalar(base)) return { type: base };
    if (depth > 8) return { type: base };
    // `MockedServiceResponse[GetX.Out]` — a wrapper from Orchescala (the mock of a
    // service): it stays as a Scala type; the inner part is resolved and reported
    const wrapped = /^(MockedServiceResponse)\[(.+)\]$/.exec(base);
    if (wrapped) {
      this.fieldType(typeShape(wrapped[2]).base, pkg, depth + 1, scope, imports);
      return { type: base };
    }
    // What the file imports explicitly applies — even if the own project
    // has a class of the same name (`LoadPoas` from vollmacht, not from product).
    // Only for classes of other packages; in the same object the own one comes first.
    const inObject = scope ? this.domain.find(t => t.id === `${pkg}.${scope}.${base}`) : undefined;
    const imported = inObject ? null : this.viaImports(base, pkg, imports);
    if (imported && imported.pkg !== this.pkg && imported.kind !== 'alias') {
      return { type: this.domain.includes(imported) && this.ownProcess(imported) ? this.convert(imported, {}) : domainRef(imported.id) };
    }
    // `CustomDocContents.\`QI-Deklaration\`` — a variant of an ADT enum:
    // the field points to the enum and names the case
    const split = splitEnumCase(base);
    if (split && !/\.(In|Out)$/.test(base)) {
      const en = (scope ? this.domain.find(t => t.id === `${pkg}.${scope}.${split.base}`) : undefined)
        ?? this.domain.find(t => t.id === `${pkg}.${split.base}`)
        ?? this.domain.find(t => this.own(t) && t.name === split.base)
        ?? resolveType(split.base, this.model, pkg);
      if (en && enumHasCase(en, split.enumCase)) {
        const type = this.domain.includes(en) && this.ownProcess(en) ? this.convert(en, {}) : domainRef(en.id);
        return { type, enumCase: split.enumCase };
      }
    }
    // in the project: the same object first (`OrderCard.CustomProcessStatus` for a
    // field of `OrderCard.Out` — not the one with the same name in another object),
    // then the same package, then the project root — there a free-standing type
    // before a nested one
    const own = (scope ? this.domain.find(t => t.id === `${pkg}.${scope}.${base}`) : undefined)
      ?? this.domain.find(t => t.id === `${pkg}.${base}`)
      ?? this.domain.find(t => this.own(t) && t.name === base)
      ?? this.domain.find(t => this.own(t) && t.name.endsWith(`.${base}`));
    if (own) {
      if (own.kind === 'alias') {
        if (!own.target) { this.unresolved.add(base); return { type: base }; }
        // `type ReceivingSystems = Option[String] | Seq[X]` — a union type has no
        // counterpart in the app: the field keeps the alias (fully qualified, the export takes it over verbatim)
        if (isCompoundType(own.target)) {
          // without an object the name is not a Scala path that resolves without an import — report
          if (!own.owner) { this.unresolved.add(base); return { type: base }; }
          return { type: own.name };
        }
        const shape = typeShape(own.target);
        const inner = this.fieldType(shape.base, own.pkg, depth + 1);
        return shape.constraint ? { ...inner, constraint: inner.constraint ?? shape.constraint } : inner;
      }
      if (own.kind === 'member' && !own.fields?.length) { this.unresolved.add(base); return { type: base }; }
      // `MergeContractsForCAM.In` as a field type: the In/Out of an object. If
      // the object is an interaction of this process, it is the same type as
      // there — with its full name. Otherwise it belongs to a foreign object (DMN,
      // service) and points into the catalog if that knows it.
      if (own.owner && /\.(In|Out)$/.test(own.name)) {
        if (this.interactionOwners.has(own.owner)) return { type: this.convert(own, {}, own.name) };
        const ext = resolveType(base, this.model, pkg);
        if (ext) return { type: domainRef(ext.id) };
        this.unresolved.add(base);
        return { type: base };
      }
      // a class of another process or in an object: already exists
      if (!this.ownProcess(own)) return { type: domainRef(own.id) };
      return { type: this.convert(own, {}) };
    }
    // foreign project: the catalog may know it
    const ext = resolveType(base, this.model, pkg);
    if (ext) return { type: domainRef(ext.id) };
    this.unresolved.add(base);
    return { type: base };
  }

  /** Create a domain type as an own type (exactly once per domain type). */
  convert(dom: DomainType, flags: Partial<TypeDef>, copyAs?: string): string {
    const memo = copyAs ? `${dom.id}→${copyAs}` : dom.id;
    const known = this.ids.get(memo);
    if (known) {
      // already there (e.g. as a field type) — the role is added afterwards
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
      // a type in the process object (not its In/Out/InitIn/InConfig) stays there on export
      ...(dom.owner && dom.owner === this.processOwner && !/^(In|Out|InitIn|InConfig)$/.test(name) ? { inProcessObject: true } : {}),
      // where from — then it counts as a class of the process, even against an older catalog
      domainId: dom.id,
      ...flags,
    };
    this.types.push(t); // before the fields — against cycles
    const toFields = (ps: DomainField[] | undefined, pkg: string): Field[] =>
      // `InConfig` is an implementation detail — neither as a type nor as a field
      (ps ?? []).filter(p => !/^InConfig$|\.InConfig$/.test(typeShape(p.type).base)).map(p => {
        const shape = typeShape(p.type);
        const ft = this.fieldType(shape.base, pkg, 0, dom.owner, dom.imports);
        const f: Field = { id: uid('f'), name: p.name, type: ft.type };
        if (shape.optional) f.optional = true;
        if (shape.collection) f.collection = true;
        if (shape.map) f.map = true;
        if (ft.enumCase) f.enumCase = ft.enumCase;
        const constraint = shape.constraint ?? ft.constraint;
        if (constraint) f.constraint = constraint;
        if (p.default && p.default !== 'None' && !isFixedCaseDefault(f.enumCase, p.default)) f.default = p.default;
        if (p.description) f.description = p.description;
        if (p.descriptionExpr) {
          f.descriptionExpr = p.descriptionExpr;
          // the objects in it need their imports — as they are in the file
          const imports = importsForExpression(p.descriptionExpr, dom.imports);
          if (imports.length) f.descriptionImports = imports;
        }
        const example = exampleOf(p);
        if (example) f.example = example;
        // the example values (`defaultValidUntil`) with the imports of their file — which one
        // applies is decided by the file, not the catalog
        const named = example?.match(/\bdefault[A-Z]\w*/g) ?? [];
        if (named.length) f.exampleImports = (dom.imports ?? []).filter(i => named.some(n => i.endsWith(`.${n}`)));
        return f;
      });
    if (dom.kind === 'enum') {
      // Shared fields (`def x: T` in the body) — they appear again in every
      // case; only the specific ones stay there
      const common = toFields(dom.fields, dom.pkg);
      // a `def` has neither description nor example — they are in the
      // cases (`@description(clientKeyDescr)`, `example`); those of the first apply
      const inCases = (dom.cases ?? []).flatMap(c => c.fields ?? []);
      for (const f of common) {
        const described = inCases.find(p => p.name === f.name && p.description);
        if (!f.description && described) {
          f.description = described.description;
          if (described.descriptionExpr) f.descriptionExpr = described.descriptionExpr;
        }
        const withExample = inCases.find(p => p.name === f.name && p.example);
        const example = withExample && exampleOf(withExample);
        if (!f.example && example) f.example = example;
      }
      const commonNames = new Set(common.map(f => f.name));
      const cases = new Map((dom.cases ?? []).map(c => [c.name, c.fields]));
      const perCase = (dom.values ?? []).map(v => ({
        name: v, fields: toFields((cases.get(v) ?? []).filter(p => !commonNames.has(p.name)), dom.pkg),
        // the order in the code — the export writes the parameters that way again
        order: (cases.get(v) ?? []).map(p => p.name),
      }));
      // What appears in **all** cases with the same name and the same type is
      // shared as well — even if the domain does not declare it as `def`
      const shared = sharedFields(perCase.filter(c => c.fields.length).map(c => c.fields));
      if (shared.length) {
        const names = new Set(shared.map(f => f.name));
        for (const c of perCase) c.fields = c.fields.filter(f => !names.has(f.name));
        this.notes.push(`${name}: ${shared.length} gemeinsame Feld${shared.length === 1 ? '' : 'er'} erkannt (${shared.map(f => f.name).join(', ')}) — stehen in jedem Fall gleich.`);
      }
      if (common.length || shared.length) t.fields = [...common, ...shared];
      t.values = perCase.map(c => ({
        name: c.name,
        ...(c.fields.length ? { fields: c.fields } : {}),
        ...(c.order.length ? { order: c.order } : {}),
      }));
    } else {
      t.fields = toFields(dom.fields, dom.pkg);
    }
    return id;
  }
}

/**
 * Classes of the data model that do not (yet) exist in the domain — neither in the
 * `schema` nor in the process object nor anywhere else. New, or the import is missing.
 * Only if the domain knows the process (otherwise everything would be «neu»).
 */
export function classesNotInDomain(spec: ProcessSpec, model: Model | null): string[] {
  const domain = model?.domainTypes ?? [];
  if (!domain.some(d => d.processName === spec.processId)) return [];
  const ownPkg = packageOf(spec, model);
  return (spec.types ?? [])
    .filter(t => !t.root && !t.processOut && !t.initIn && !t.inConfig && !t.interactionId && t.name?.trim())
    .filter(t => !referencedClass(t, model, ownPkg).type)
    .filter(t => !domain.some(d => (d.kind === 'case' || d.kind === 'enum' || d.kind === 'alias')
      && (d.name === t.name || d.name.endsWith(`.${t.name}`))))
    .map(t => t.name);
}

/**
 * Remove classes that already exist in the domain (see `referencedClass`) from the
 * data model: older imports copied in classes of other processes and
 * ones from an object. The fields then point to the catalog
 * entry (`dom:`), the copy is dropped — otherwise the export would create it again.
 */
export function referenceExistingClasses(spec: ProcessSpec, model: Model | null): { spec: ProcessSpec; moved: string[] } {
  const ownPkg = packageOf(spec, model);
  const refs = new Map<string, DomainType>();
  for (const t of spec.types ?? []) {
    const ref = referencedClass(t, model, ownPkg).type;
    if (ref) refs.set(t.id, ref);
  }
  if (!refs.size) return { spec, moved: [] };
  const relink = (fs: Field[]) => fs.map(f => (refs.has(f.type) ? { ...f, type: domainRef(refs.get(f.type)!.id) } : f));
  const types = (spec.types ?? []).filter(t => !refs.has(t.id)).map(t => ({
    ...t,
    ...(t.fields ? { fields: relink(t.fields) } : {}),
    ...(t.values ? { values: t.values.map(v => (v.fields ? { ...v, fields: relink(v.fields) } : v)) } : {}),
  }));
  const moved = (spec.types ?? []).filter(t => refs.has(t.id)).map(t => `${t.name} → ${refs.get(t.id)!.pkg}`);
  return { spec: { ...spec, types }, moved };
}

/**
 * Fields that are the same in all cases: same name, same type and
 * the same wrappers (optional, multiple, map, variant, constraint).
 * Description and default come from the first case that has them. With a
 * single case there is nothing shared to recognize.
 */
export function sharedFields(cases: Field[][]): Field[] {
  if (cases.length < 2) return [];
  const key = (f: Field) => JSON.stringify([f.type, !!f.optional, !!f.collection, !!f.map, f.enumCase ?? '', f.constraint ?? '']);
  return cases[0].flatMap(f => {
    const k = key(f);
    const twins = cases.map(c => c.find(x => x.name === f.name && key(x) === k));
    if (twins.some(x => !x)) return [];
    const described = twins.find(x => x!.description);
    const dflt = twins.map(x => x!.default).find(Boolean);
    return [{
      ...f,
      ...(described ? { description: described.description, descriptionExpr: described.descriptionExpr } : {}),
      ...(dflt ? { default: dflt } : {}),
    }];
  });
}

// ── Enrich the specification ─────────────────────────────────────────────────

export interface Enriched {
  spec: ProcessSpec;
  /** Domain object of the process */
  object: string;
  /** mapped interactions (object names) */
  matched: string[];
  /** Interaction objects of the package without a matching step */
  unmatched: string[];
  /** Type names that neither the project nor the catalog knows */
  unresolved: string[];
  warnings: string[];
  /** Notes that need no action, e.g. recognized shared fields */
  notes: string[];
  /** Steps without a domain object — prepared as an interaction in draft, with In/Out */
  prepared: string[];
}

/**
 * Steps that need an interaction the domain does not know:
 * user tasks, own workers, signals, messages without an object. They
 * are **prepared** — interaction in draft, `In` and `Out` as
 * classes with the fields from the catalog, otherwise from the mappings of the
 * step — so that the domain can be created from them instead of the other way round.
 */
export function prepareInteractions(spec0: ProcessSpec, model: Model | null): { spec: ProcessSpec; prepared: string[] } {
  // an interaction prepared earlier at a pattern step is dropped (see wiringSteps)
  const spec = withoutWiringInteractions(spec0);
  const offen = missingInteractions(spec, model);
  if (!offen.length) return { spec, prepared: [] };
  const types = [...(spec.types ?? [])];
  const interactions = [...(spec.interactions ?? [])];
  const prepared: string[] = [];
  // The same object at two places in the flow (a signal that is thrown
  // twice) is **one** object: the second place shares the classes
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

/** `In`/`Out` of a prepared interaction: catalog, otherwise the mappings of the step, otherwise empty. */
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
  UserTask: 'userTask', CustomTask: 'customTask', SignalEvent: 'signal', MessageEvent: 'message', Decision: 'decision',
};

/**
 * Kind of a domain object. An older catalog does not know the DSL — then
 * topic and name suffix (`…UT`, `…SE`, `…ME`) reveal what it is.
 */
function objectKind(t: DomainType): InteractionKind | null {
  if (t.dsl) return DSL_KIND[t.dsl] ?? null;
  if (t.topicName) return 'customTask';
  if (t.keyName === 'decisionId') return 'decision';
  if (/UT$/.test(t.owner ?? '')) return 'userTask';
  if (/SE$/.test(t.owner ?? '')) return 'signal';
  if (/ME$/.test(t.owner ?? '')) return 'message';
  return null;
}

/**
 * Complete a specification read from the BPMN with data model and interactions
 * from the domain. `null` if the domain does not know the process.
 */
export function enrichSpec(spec: ProcessSpec, domain: DomainType[], model: Model | null): Enriched | null {
  const warnings: string[] = [];
  const procType = domain.find(t => t.processName === spec.processId && t.owner);
  if (!procType) return null;
  const owner = procType.owner!;
  const pkg = procType.pkg;
  // Objects with an interaction kind — their In/Out stay a type with full name
  const interactionOwners = new Set(domain.filter(t => t.owner && objectKind(t)).map(t => t.owner!));
  const conv = new Converter(domain, pkg, model, interactionOwners, owner);
  const member = (obj: string, name: string) => domain.find(t => t.id === `${pkg}.${obj}.${name}`) ?? null;

  // Process: In · InitIn · Out · InConfig
  const inT = member(owner, 'In');
  if (inT && (inT.kind === 'case' || inT.kind === 'enum')) conv.convert(inT, { root: true }, 'In');
  const initT = member(owner, 'InitIn');
  if (initT?.kind === 'case') conv.convert(initT, { initIn: true }, 'InitIn');
  // the InConfig as it is in the domain — with the mocks and the
  // settings of the loops; the generator only adds what it lacks
  // (own fields of the same name come first)
  const cfgT = member(owner, 'InConfig');
  if (cfgT?.kind === 'case' && cfgT.fields?.length) conv.convert(cfgT, { inConfig: true }, 'InConfig');
  const outT = member(owner, 'Out');
  if (outT && (outT.kind === 'case' || outT.kind === 'enum')) conv.convert(outT, { processOut: true }, 'Out');

  // The classes in the `schema` package of the process always belong to it — even those
  // that In and Out do not need (yet)
  for (const d of domain) {
    if (!d.owner && d.pkg === `${pkg}.schema` && (d.kind === 'case' || d.kind === 'enum')) conv.convert(d, {});
  }

  // Interactions: the objects with an interaction kind — those of the own package
  // first, so that they win on equal names
  const objects = [...new Map(domain
    .filter(t => t.owner && objectKind(t))
    .sort((a, b) => Number(b.pkg === pkg) - Number(a.pkg === pkg))
    .map(t => [`${t.pkg}.${t.owner!}`, t])).values()];
  const interactions: Interaction[] = [];
  const matched: string[] = [];
  const processId = spec.processId ?? '';
  const startId = spec.steps.find(s => s.kind === 'start')?.id;

  /** `type In = OrderCardUT.In`: resolved once all interactions are there — see below */
  const aliases: Array<{ iaId: string; member: 'In' | 'Out'; target: DomainType; copyId: string }> = [];
  const memberType = (o: DomainType, name: 'In' | 'Out', iaId: string): string | undefined => {
    const t = domain.find(x => x.id === `${o.pkg}.${o.owner}.${name}`);
    if (!t) return undefined;
    if (t.kind === 'case' || t.kind === 'enum') return conv.convert(t, { interactionId: iaId }, `${o.owner}.${name}`);
    if (t.kind === 'alias' && t.target && t.target !== 'NoInput' && t.target !== 'NoOutput') {
      // `type In = AdjustOrderUT.In` — the same fields under its own name
      const target = domain.find(x => x.name === t.target || x.id === `${pkg}.${t.target}`);
      if (target && (target.kind === 'case' || target.kind === 'enum')) {
        const copyId = conv.convert(target, { interactionId: iaId, description: `= ${t.target}` }, `${o.owner}.${name}`);
        aliases.push({ iaId, member: name, target, copyId });
        return copyId;
      }
      warnings.push(`${o.owner}.${name} = ${t.target}: Ziel nicht gefunden.`);
    }
    return undefined;
  };

  for (const step of allSteps(spec.steps)) {
    if (step.kind === 'goto' || step.id === startId) continue;
    // A worker of the project is recognized by its topic — even if it does not
    // start with the process ID (worker of a neighbouring package)
    const byTopic = step.kind === 'service' && step.topic && step.topic !== processId
      ? objects.find(o => objectKind(o) === 'customTask' && o.topicName === step.topic) : undefined;
    // A signal describes the object also when the process **catches** it
    // (start event of an event subprocess, intermediate event)
    const caughtSignal = step.eventKind === 'signal' && step.messageName ? 'signal' as const : null;
    const kind = byTopic ? 'customTask' : (interactionKind(step, processId) ?? caughtSignal);
    if (!kind) continue;
    const obj = byTopic ?? objects.find(o => {
      if (objectKind(o) !== kind) return false;
      if (kind === 'customTask') return o.topicName === step.topic;
      if (kind === 'userTask' && o.key) return o.key === step.id;
      if (kind === 'decision') return !!o.key && o.key.toLowerCase() === (step.topic ?? '').toLowerCase();
      // Signal / message: via the name in the BPMN (up to the dynamic part)
      const key = (o.key ?? '').split('${')[0];
      if (key && step.messageName && (step.messageName === o.key || step.messageName.startsWith(key))) return true;
      // otherwise the naming convention (`KartenbestellungPrufenBackofficeTask` → `KartenbestellungPrufenBackofficeUT`)
      return o.owner === suggestName(step, kind, processId, model);
    });
    if (!obj) continue;
    const ia: Interaction = {
      id: uid('ia'), stepId: step.id, kind, name: obj.owner!,
      key: obj.key ?? obj.topicName ?? (kind === 'userTask' ? step.id : step.messageName ?? ''),
      ...(kind === 'decision' && obj.decisionResult ? { decisionResult: obj.decisionResult } : {}),
      ...(obj.ownerDescr ? { descr: obj.ownerDescr } : {}),
      // an expression (`s"…${X.processName}…"`) stays one — with the imports of its file
      ...(obj.ownerDescrExpr ? { descrExpr: obj.ownerDescrExpr } : {}),
      ...(obj.ownerDescrExpr && importsForExpression(obj.ownerDescrExpr, obj.imports).length
        ? { descrImports: importsForExpression(obj.ownerDescrExpr, obj.imports) } : {}),
      status: 'implemented',
    };
    const inId = memberType(obj, 'In', ia.id);
    if (inId) ia.inTypeId = inId;
    if (kind === 'userTask' || kind === 'customTask' || kind === 'decision') {
      const outId = memberType(obj, 'Out', ia.id);
      if (outId) ia.outTypeId = outId;
    }
    // `userTask(OrderCardUT.In.example.copy(clientKeyIsIdentityOk = false), …)` — the differing values
    if (obj.exampleCopies?.In) ia.inExample = obj.exampleCopies.In;
    if (obj.exampleCopies?.Out) ia.outExample = obj.exampleCopies.Out;
    interactions.push(ia);
    matched.push(obj.owner!);
  }
  const unmatched = objects.filter(o => o.pkg === pkg).map(o => o.owner!).filter(o => !matched.includes(o));

  // An alias stays one: the member of an interaction of the process shares
  // its fields (the copy is dropped), otherwise it refers to the type of the domain
  // and keeps the copy for the fields
  const dropped = new Set<string>();
  for (const a of aliases) {
    const ia = interactions.find(i => i.id === a.iaId);
    if (!ia) continue;
    const aliasKey = a.member === 'In' ? 'inAlias' : 'outAlias';
    const typeKey = a.member === 'In' ? 'inTypeId' : 'outTypeId';
    const targetMember = a.target.name.endsWith('.Out') ? 'Out' : 'In';
    const other = a.target.owner ? interactions.find(i => i.id !== ia.id && i.name === a.target.owner) : undefined;
    const sharedId = other ? (targetMember === 'In' ? other.inTypeId : other.outTypeId) : undefined;
    if (other && sharedId) {
      ia[aliasKey] = `${other.id}.${targetMember}`;
      ia[typeKey] = sharedId;
      dropped.add(a.copyId);
    } else {
      ia[aliasKey] = domainRef(a.target.id);
    }
  }

  const enriched: ProcessSpec = {
    ...spec,
    ...(procType.ownerDescr && !spec.description ? { description: procType.ownerDescr } : {}),
    // the label per language comes from the domain — the export passes it along
    ...(procType.processLabels ? { processLabels: procType.processLabels } : {}),
    types: dropped.size ? conv.types.filter(t => !dropped.has(t.id)) : conv.types,
    interactions,
  };
  // what the domain does not know is prepared — as a draft, to catch up later
  const { spec: built, prepared } = prepareInteractions(enriched, model);
  return { spec: built, object: owner, matched, unmatched, unresolved: [...conv.unresolved].sort(), warnings, notes: conv.notes, prepared };
}
