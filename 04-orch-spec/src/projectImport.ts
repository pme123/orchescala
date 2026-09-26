// Import aus einem Projekt — Ordner oder ZIP.
//
// Ein Orchescala-Projekt bringt alles mit, was eine Spezifikation braucht:
// das BPMN unter `src/main/resources/…` und die Domain unter `01-domain`.
// Statt nur die Datei zu wählen, wählt man das Projekt — die App findet die
// BPMNs, liest die Domain und baut daraus je Prozess eine Spezifikation mit
// **Datenmodell** (In, InitIn, Out und die eigenen Typen dahinter) und
// **Interaktionen** (Benutzeraufgaben, eigene Worker, Signale, Nachrichten)
// samt deren In/Out.
//
// Zuordnung ohne Raten: der Prozess findet sein Objekt über `val processName`,
// eine Benutzeraufgabe ihres über `val name` (= BPMN-Element-ID), ein Worker
// über `val topicName`. Signale und Nachrichten haben nur den Objektnamen —
// die passen über die Namenskonvention (`CancelAddressChangeSE`).
//
// Typen aus dem Projekt selbst werden **eigene Typen** der Spezifikation;
// Typen aus anderen Projekten (`GravitonConsultant`) zeigen auf den
// Domain-Katalog, wenn er sie kennt — sonst bleibt der Name stehen und wird
// gemeldet.

import { unzipSync } from 'fflate';
import type { DomainType, Field, Interaction, InteractionKind, Model, ProcessSpec, Step, TypeDef } from './types';
import { SCALA_TYPES } from './types';
import { isDomainSource, scanFiles } from './domainScan';
import { allSteps, importBpmn } from './bpmn';
import { typeShape } from './scalaTypes';
import { interactionKind, resolveType, suggestName } from './interactions';
import { domainRef } from './serviceTypes';
import { uid } from './util';

export interface ProjectFile { path: string; text: string }

const IGNORE = new Set(['target', '.bloop', '.scala-build', '.bsp', '.git', 'node_modules', '.idea', 'dist', '__MACOSX']);

const wanted = (path: string) => path.endsWith('.bpmn') || isDomainSource(path);

/** Ordner rekursiv lesen — nur BPMN und Domain-Quellen, Build-Ordner bleiben draussen. */
export async function readProjectDir(dir: FileSystemDirectoryHandle, prefix = ''): Promise<ProjectFile[]> {
  const out: ProjectFile[] = [];
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (IGNORE.has(name) || name.startsWith('.')) continue;
      out.push(...await readProjectDir(handle as FileSystemDirectoryHandle, path));
    } else if (wanted(path)) {
      out.push({ path, text: await (handle as FileSystemFileHandle).getFile().then(f => f.text()) });
    }
  }
  return out;
}

/** ZIP lesen — dieselbe Auswahl wie beim Ordner. */
export function readProjectZip(data: Uint8Array): ProjectFile[] {
  const dec = new TextDecoder();
  const entries = unzipSync(data, {
    filter: f => wanted(f.name) && !f.name.split('/').some(seg => IGNORE.has(seg)),
  });
  return Object.entries(entries).map(([path, bytes]) => ({ path, text: dec.decode(bytes) }));
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

  constructor(private readonly domain: DomainType[], private readonly model: Model | null) {}

  /** Typ eines Feldes: Grundtyp ohne Option/Seq → Feldtyp der Spezifikation. */
  fieldType(base: string, pkg: string, depth = 0): { type: string; constraint?: string } {
    if (isScalar(base)) return { type: base };
    if (depth > 8) return { type: base };
    // im Projekt: gleiches Paket zuerst, dann irgendwo im Projekt
    const own = this.domain.find(t => t.id === `${pkg}.${base}`)
      ?? this.domain.find(t => t.name === base)
      ?? this.domain.find(t => t.name.endsWith(`.${base}`));
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
    if (dom.kind === 'enum') {
      t.values = (dom.values ?? []).map(v => ({ name: v }));
    } else {
      // `InConfig` ist Implementations-Detail — weder als Typ noch als Feld
      t.fields = (dom.fields ?? []).filter(p => !/^InConfig$|\.InConfig$/.test(typeShape(p.type).base)).map(p => {
        const shape = typeShape(p.type);
        const ft = this.fieldType(shape.base, dom.pkg);
        const f: Field = { id: uid('f'), name: p.name, type: ft.type };
        if (shape.optional) f.optional = true;
        if (shape.collection) f.collection = true;
        const constraint = shape.constraint ?? ft.constraint;
        if (constraint) f.constraint = constraint;
        if (p.default && p.default !== 'None') f.default = p.default;
        if (p.description) f.description = p.description;
        return f;
      });
    }
    return id;
  }
}

// ── Analyse ──────────────────────────────────────────────────────────────────

export interface ProjectProcess {
  /** Pfad der BPMN-Datei im Projekt */
  file: string;
  /** dieselbe Prozess-ID liegt auch unter diesen Pfaden (Kopien im Projekt) */
  copies: string[];
  /** das BPMN selbst — wird neben der Spezifikation abgelegt */
  xml: string;
  spec: ProcessSpec;
  /** Zahl der Schritte im Baum */
  steps: number;
  /** Domain-Objekt des Prozesses — fehlt, wenn keins `val processName` mit der Prozess-ID trägt */
  object?: string;
  /** zugeordnete Interaktionen (Objektnamen) */
  matched: string[];
  /** Interaktions-Objekte des Pakets ohne passenden Schritt */
  unmatched: string[];
  /** Typnamen, die weder das Projekt noch der Katalog kennt */
  unresolved: string[];
  warnings: string[];
}

export interface ProjectAnalysis {
  processes: ProjectProcess[];
  bpmnFiles: number;
  scalaFiles: number;
  domainTypes: number;
  errors: string[];
}

const DSL_KIND: Record<string, InteractionKind> = {
  UserTask: 'userTask', CustomTask: 'customTask', SignalEvent: 'signal', MessageEvent: 'message',
};

/** Alle Dateien eines Projekts → je BPMN eine fertige Spezifikation. */
export function analyzeProject(files: ProjectFile[], model: Model | null): ProjectAnalysis {
  const bpmns = files.filter(f => f.path.endsWith('.bpmn'));
  const scala = files.filter(f => isDomainSource(f.path));
  const domain = scanFiles(scala).types;
  const errors: string[] = [];
  const processes: ProjectProcess[] = [];

  // Dasselbe BPMN liegt oft mehrfach im Projekt (`src/main/resources` und
  // die Kopie im Worker-Modul). Je Prozess-ID zählt eines — das im
  // Projektstamm zuerst, sonst das mit dem kürzesten Pfad.
  const rank = (p: string) => (p.startsWith('src/') ? 0 : /^[0-9]{2}-/.test(p) ? 2 : 1) * 1000 + p.length;
  const byProcess = new Map<string, { file: string; text: string; copies: string[] }>();
  for (const f of [...bpmns].sort((a, b) => rank(a.path) - rank(b.path))) {
    const id = /<(?:\w+:)?process\b[^>]*\bid="([^"]+)"[^>]*isExecutable="true"/.exec(f.text)?.[1]
      ?? /<(?:\w+:)?process\b[^>]*\bid="([^"]+)"/.exec(f.text)?.[1] ?? f.path;
    const prev = byProcess.get(id);
    if (prev) prev.copies.push(f.path);
    else byProcess.set(id, { file: f.path, text: f.text, copies: [] });
  }
  for (const f of byProcess.values()) {
    try {
      const { spec, stepCount } = importBpmn(f.text, f.file.split('/').pop() ?? f.file);
      processes.push({ ...buildProcess(f.file, spec, stepCount, domain, model), copies: f.copies, xml: f.text });
    } catch (e) {
      errors.push(`${f.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  processes.sort((a, b) => a.file.localeCompare(b.file));
  return { processes, bpmnFiles: bpmns.length, scalaFiles: scala.length, domainTypes: domain.length, errors };
}

type Built = Omit<ProjectProcess, 'copies' | 'xml'>;

function buildProcess(file: string, spec: ProcessSpec, steps: number, domain: DomainType[], model: Model | null): Built {
  const warnings: string[] = [];
  const procType = domain.find(t => t.processName === spec.processId && t.owner);
  if (!procType) {
    warnings.push(`Kein Domain-Objekt mit \`val processName = "${spec.processId}"\` — Datenmodell und Interaktionen bleiben leer.`);
    return { file, spec, steps, matched: [], unmatched: [], unresolved: [], warnings };
  }
  const owner = procType.owner!;
  const pkg = procType.pkg;
  const conv = new Converter(domain, model);
  const member = (obj: string, name: string) => domain.find(t => t.id === `${pkg}.${obj}.${name}`) ?? null;

  // Prozess: In · InitIn · Out — InConfig ist Implementations-Detail
  const inT = member(owner, 'In');
  if (inT?.kind === 'case') conv.convert(inT, { root: true }, 'In');
  else if (inT?.kind === 'enum') warnings.push('Das `In` des Prozesses ist ein enum (ADT) — der Klassenbauer kennt nur ein `In` als Klasse; es bleibt leer.');
  const initT = member(owner, 'InitIn');
  if (initT?.kind === 'case') conv.convert(initT, { initIn: true }, 'InitIn');
  const outT = member(owner, 'Out');
  if (outT && (outT.kind === 'case' || outT.kind === 'enum')) conv.convert(outT, { processOut: true }, 'Out');

  // Interaktionen: die Objekte des Projekts mit einem Interaktions-DSL —
  // zuerst die des eigenen Pakets, damit bei gleichem Namen diese gewinnen
  const objects = [...new Map(domain
    .filter(t => t.owner && t.dsl && DSL_KIND[t.dsl])
    .sort((a, b) => Number(b.pkg === pkg) - Number(a.pkg === pkg))
    .map(t => [`${t.pkg}.${t.owner!}`, t])).values()];
  const interactions: Interaction[] = [];
  const matched: string[] = [];
  const processId = spec.processId ?? '';
  const startId = spec.steps.find(s => s.kind === 'start')?.id;

  const memberType = (obj: string, name: 'In' | 'Out', iaId: string): string | undefined => {
    const t = member(obj, name);
    if (!t) return undefined;
    if (t.kind === 'case' || t.kind === 'enum') return conv.convert(t, { interactionId: iaId }, `${obj}.${name}`);
    if (t.kind === 'alias' && t.target && t.target !== 'NoInput' && t.target !== 'NoOutput') {
      // `type In = AdjustAddressUT.In` — dieselben Felder unter eigenem Namen
      const target = domain.find(x => x.name === t.target || x.id === `${pkg}.${t.target}`);
      if (target && (target.kind === 'case' || target.kind === 'enum')) {
        return conv.convert(target, { interactionId: iaId, description: `= ${t.target}` }, `${obj}.${name}`);
      }
      warnings.push(`${obj}.${name} = ${t.target}: Ziel nicht gefunden.`);
    }
    return undefined;
  };

  for (const step of allSteps(spec.steps)) {
    if (step.kind === 'goto' || step.id === startId) continue;
    // Ein Worker des Projekts erkennt man am Topic — auch wenn es nicht mit
    // der Prozess-ID beginnt (Worker eines Nachbarpakets)
    const byTopic = step.kind === 'service' && step.topic && step.topic !== processId
      ? objects.find(o => DSL_KIND[o.dsl!] === 'customTask' && o.topicName === step.topic) : undefined;
    // Ein Signal beschreibt das Objekt auch, wenn der Prozess es **fängt**
    // (Startereignis eines Ereignis-Subprozesses, Zwischenereignis)
    const caughtSignal = step.eventKind === 'signal' && step.messageName ? 'signal' as const : null;
    const kind = byTopic ? 'customTask' : (interactionKind(step, processId) ?? caughtSignal);
    if (!kind) continue;
    const obj = byTopic ?? objects.find(o => {
      const k = DSL_KIND[o.dsl!];
      if (k !== kind) return false;
      if (kind === 'userTask') return o.key === step.id;
      if (kind === 'customTask') return o.topicName === step.topic;
      // Signal / Nachricht: über den Namen im BPMN (bis zum dynamischen Teil), sonst die Konvention
      const key = (o.key ?? '').split('${')[0];
      if (key && step.messageName && (step.messageName === o.key || step.messageName.startsWith(key))) return true;
      return o.owner === suggestName(step, kind, processId, model);
    });
    if (!obj) continue;
    const ia: Interaction = {
      id: uid('ia'), stepId: step.id, kind, name: obj.owner!,
      key: obj.key ?? obj.topicName ?? '',
      ...(obj.ownerDescr ? { descr: obj.ownerDescr } : {}),
      status: 'implemented',
    };
    const inId = memberType(obj.owner!, 'In', ia.id);
    if (inId) ia.inTypeId = inId;
    if (kind === 'userTask' || kind === 'customTask') {
      const outId = memberType(obj.owner!, 'Out', ia.id);
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
  return { file, spec: built, steps, object: owner, matched, unmatched, unresolved: [...conv.unresolved].sort(), warnings };
}

/** Schritt-Zahl für die Anzeige — ohne Rücksprünge. */
export const stepCountOf = (steps: Step[]): number => allSteps(steps).filter(s => s.kind !== 'goto').length;
