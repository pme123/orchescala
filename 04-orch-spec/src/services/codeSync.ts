// «Mit Code abgleichen» of a service orchestration - the plan from the sources of the project:
// its classes from the CustomTask object (In, Out, its schema, see enrichServiceSpec), then its
// CustomWorker against the export of the spec (see workerSync.ts). Nothing is written here.
import type { MergeStatus } from '../bpmn';
import { mergeDomain, type DomainMergeReport } from '../domainMerge';
import { scanFiles } from '../domainScan';
import { enrichServiceSpec, type ProjectFile } from '../projectImport';
import { indexTypes } from '../scala';
import { modelMappers } from '../typeMappers';
import { mappingVarNodes, type VarNode } from '../feel';
import type { Model } from '../types';
import { allTypes } from './orchestration';
import { orchestrationFiles } from './scalaOrchestration';
import { asOrchestration, callableServices, collectionsOf, serviceProcessTopic, type ServiceProcess } from './serviceProcess';
import type { ServiceCollectionSpec } from './types';
import { syncWorker, type WorkerSyncReport } from './workerSync';

export interface CodeSyncPlan {
  spec: ServiceProcess;
  /** the classes - null: the domain has no CustomTask object of the topic */
  domain: { report: DomainMergeReport; unresolved: string[] } | null;
  /** the worker - null: the project has no worker file of it */
  worker: WorkerSyncReport | null;
  /** where the worker is in the project */
  workerPath?: string;
}

/** The worker file of the orchestration: `…/03-worker/src/main/…/<Name>Worker.scala` of its package. */
export function workerFileOf(files: ProjectFile[], spec: ServiceProcess): ProjectFile | undefined {
  const name = `/${spec.service.name}Worker.scala`;
  const api = `/${spec.service.api.split('.').join('/')}/v${spec.service.apiVersion}/`;
  const candidates = files.filter(f => f.path.endsWith(name) && !f.path.includes('/src/test/'));
  // only the one of its API - a worker of the same name in another API or version is another one
  return candidates.find(f => f.path.includes(api));
}

/** The worker the export writes for `spec` - the one the code is compared with. */
export function generatedWorker(spec: ServiceProcess, collections: ServiceCollectionSpec[], model: Model | null): string {
  const all = collectionsOf(callableServices(collections, model));
  const o = asOrchestration(spec);
  return orchestrationFiles(o, all, model).find(f => f.path.endsWith(`/${o.name}Worker.scala`))?.content ?? '';
}

export function planCodeSync(spec: ServiceProcess, files: ProjectFile[], model: Model | null, collections: ServiceCollectionSpec[],
  status: MergeStatus = { added: 'implemented', changed: 'changed' }): CodeSyncPlan {
  const scan = scanFiles(files);
  let current = spec;
  let domain: CodeSyncPlan['domain'] = null;
  // 1. the classes: In, Out and its schema from the CustomTask object
  const enriched = enrichServiceSpec(spec, scan.types, model, serviceProcessTopic(spec));
  if (enriched) {
    const merged = mergeDomain(spec, enriched.spec, { status });
    current = merged.spec as ServiceProcess;
    domain = { report: merged.report, unresolved: enriched.unresolved };
  }
  // 2. the worker against the export of the spec (with the classes of 1.)
  const file = workerFileOf(files, current);
  if (!file) return { spec: current, domain, worker: null };
  const all = collectionsOf(callableServices(collections, model));
  const idx = indexTypes(allTypes(asOrchestration(current), all), model);
  const r = syncWorker(current, generatedWorker(current, collections, model), file.text, {
    services: callableServices(collections, model),
    mappers: modelMappers(model),
    nameOf: idx.nameOf,
    // the extensions of the project's own type mappers - also those the catalog does not have yet
    extensions: scan.mappers.map(m => m.method),
    sourcePaths: s => {
      if (!s.fieldMapping) return undefined;
      const paths = new Set<string>();
      let open = false;
      const walk = (n: VarNode, at: string) => {
        const p = at ? `${at}.${n.name}` : n.name;
        paths.add(p);
        if (n.open) open = true;
        for (const ch of n.children ?? []) walk(ch, p);
      };
      for (const n of mappingVarNodes(s.fieldMapping, current, model).sources) walk(n, '');
      // a Map in it: paths into it cannot be checked
      return open ? undefined : (p: string) => paths.has(p);
    },
  }, status.changed);
  return { spec: r.spec, domain, worker: r.report, workerPath: file.path };
}
