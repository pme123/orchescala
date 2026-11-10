// The catalog of a folder: what is released (catalog.generated.json) plus what the folder brings and is
// not released yet - its service collections (their services and classes), its service orchestrations
// (each a service a step can call) and its processes (each a process a call activity or a page can
// start, with its In and Out). One model for every view - processes, orchestrations, pages - so a
// folder can be used as a whole before anything of it is implemented.
//
// What only the folder has is marked `unreleased`: the findings say «noch nicht released», the
// next release brings it into the catalog, and the mark goes away by itself. Without a catalog at all
// nothing is marked - there is nothing to tell released from not. The catalog wins for what
// it has; a collection wins over the catalog for its own services (it is what is built here).
import { scanScala } from './domainScan';
import { scalaFiles } from './scala';
import { isServiceProcess, serviceProcessTopic, withCollections } from './services/serviceProcess';
import { servicesByTopic } from './services/orchestration';
import type { ServiceCollectionSpec } from './services/types';
import type { DomainType, Field, Model, ProcessSpec, ServiceDef, ServiceParam } from './types';

export type Folder = { specs: ProcessSpec[]; collections: ServiceCollectionSpec[] };

const params = (fields: Field[] | undefined, required: boolean): ServiceParam[] =>
  (fields ?? []).filter((f) => f.name).map((f) => ({ name: f.name, ...(f.description ? { description: f.description } : {}), ...(required && !f.optional ? { required: true } : {}) }));

const rootIn = (s: ProcessSpec) => s.types?.find((t) => t.root);
const rootOut = (s: ProcessSpec) => s.types?.find((t) => t.processOut);

/** `01-domain/src/main/scala/acme/demo/domain/order/v1/Order.scala` → `acme.demo.domain.order.v1`, `Order` */
const placeOf = (path: string) => {
  const parts = path.replace(/\.scala$/, '').split('/');
  const from = parts.indexOf('scala');
  return { pkg: parts.slice(from + 1, -1).join('.'), object: parts[parts.length - 1] };
};

const domainCache = new WeakMap<ProcessSpec, { model: Model | null; types: DomainType[] }>();

/** The classes a process of the folder would bring - read from the Scala orch-spec exports for it, as the
  * catalog has them from a build: its In and Out in the process object (a process with `processName`, an
  * orchestration as a CustomTask with `topicName`), its interactions and its shared classes. */
export function domainOfSpec(spec: ProcessSpec, model: Model | null): DomainType[] {
  const hit = domainCache.get(spec);
  if (hit && hit.model === model) return hit.types;
  const types = (() => {
    try {
      return scalaFiles(spec, model).flatMap((f) => {
        if (!f.insert) return scanScala(f.content, f.path);
        // the process object comes as a part to insert - here a whole object, so it is read as one
        const { pkg, object } = placeOf(f.path);
        const head = isServiceProcess(spec)
          ? `object ${object} extends CompanyBpmnCustomTaskDsl:\n  val topicName = "${serviceProcessTopic(spec)}"`
          : `object ${object} extends CompanyBpmnProcessDsl:\n  val processName = "${spec.processId}"`;
        return scanScala(`package ${pkg}\n\n${head}\n\n${f.content}\nend ${object}\n`, f.path);
      });
    } catch (e) {
      console.warn(`Prozess «${spec.title || spec.slug}»: seine Klassen sind nicht im Katalog des Ordners - der Scala-Code lässt sich nicht erzeugen.`, e);
      return [];
    }
  })();
  domainCache.set(spec, { model, types });
  return types;
}

const released = (model: Model | null) => {
  const services = (model?.services ?? []).filter((s) => s.generated);
  return {
    // without a catalog nothing can be told released or not - nothing is marked
    any: services.length > 0,
    topic: new Set(services.map((s) => s.topic ?? s.id)),
    process: new Set(services.flatMap((s) => (s.kind === 'call' && s.calledProcess ? [s.calledProcess] : []))),
  };
};

/** The model of a folder - the catalog with the folder's collections, orchestrations and processes, `except`
  * the one that is open (it does not call itself). What only the folder has is `unreleased`. */
export function folderCatalog(model: Model | null, folder: Folder, except?: string): Model | null {
  const collections = folder.collections.filter((c) => c.slug !== except);
  const specs = folder.specs.filter((s) => s.slug !== except);
  const isReleased = released(model);
  const withColl = withCollections(model, collections) ?? model;
  const collectionTopics = new Set(servicesByTopic(collections).keys());
  const marked: ServiceDef[] = (withColl?.services ?? []).map((s) =>
    isReleased.any && !s.generated && collectionTopics.has(s.topic ?? s.id) && !isReleased.topic.has(s.topic ?? s.id) ? { ...s, unreleased: true } : s);
  const mark = isReleased.any ? { unreleased: true } : {};

  const known = new Set(marked.map((s) => s.topic ?? s.id));
  const knownProcesses = new Set(marked.flatMap((s) => (s.kind === 'call' && s.calledProcess ? [s.calledProcess] : [])));
  const added = specs.flatMap((s): { service: ServiceDef; spec: ProcessSpec }[] => {
    if (isServiceProcess(s)) {
      const topic = serviceProcessTopic(s);
      if (known.has(topic)) return [];
      return [{ spec: s, service: {
        id: topic, name: s.service.name, kind: 'service', topic, ...(s.title ? { description: s.title } : {}),
        inputs: params(rootIn(s)?.fields, true), outputs: params(rootOut(s)?.fields, false), ...mark,
      } }];
    }
    if (!s.processId || knownProcesses.has(s.processId)) return [];
    return [{ spec: s, service: {
      id: s.processId, name: s.title || s.processId, kind: 'call', calledProcess: s.processId,
      inputs: params(rootIn(s)?.fields, true), outputs: params(rootOut(s)?.fields, false), ...mark,
    } }];
  });
  if (!added.length) return withColl ? { ...withColl, services: marked } : withColl;

  // their classes - only those the catalog (or a collection) does not have
  const ids = new Set((withColl?.domainTypes ?? []).map((t) => t.id));
  const domain = added.flatMap(({ spec }) => domainOfSpec(spec, model)).filter((t) => {
    if (ids.has(t.id)) return false;
    ids.add(t.id);
    return true;
  }).map((t) => ({ ...t, ...mark }));

  return {
    ...(withColl ?? { version: 1, services: [] }),
    services: [...marked, ...added.map((a) => a.service)],
    domainTypes: [...(withColl?.domainTypes ?? []), ...domain],
  };
}
