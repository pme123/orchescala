// The export of a process in service mode: its CustomTask and CustomWorker as Scala, and the
// command for the helper — the same dialog as for a collection.
import { useMemo } from 'react';
import { helperCommandOf } from '../exporters';
import type { Model } from '../types';
import { ScalaExport } from './CollectionExport';
import { collectionPackage } from './collection';
import { orchestrationBundle, orchestrationTodos } from './scalaOrchestration';
import { servicePayload } from './servicePayload';
import { asOrchestration, callableServices, collectionsOf, type ServiceProcess } from './serviceProcess';
import type { ServiceCollectionSpec } from './types';

export default function ServiceProcessExport({ spec, model, collections, isDark, onClose }: {
  spec: ServiceProcess; model: Model | null; collections: ServiceCollectionSpec[]; isDark: boolean; onClose: () => void;
}) {
  const o = useMemo(() => asOrchestration(spec), [spec]);
  // the collections behind every service it can call — the local ones and those of the catalog
  const all = useMemo(() => collectionsOf(callableServices(collections, model)), [collections, model]);
  return (
    <ScalaExport title={spec.title} isDark={isDark} onClose={onClose}
      text={orchestrationBundle(o, all, model)} todos={orchestrationTodos(o, all, model)} fileName={`${spec.slug}.scala`}
      command={() => helperCommandOf(JSON.stringify(servicePayload(o, all, model)))}
      description={<>
        Ein CustomTask in <span className="font-mono">01-domain</span> und sein CustomWorker in <span className="font-mono">03-worker</span>,
        im Paket <span className="font-mono">{collectionPackage({ project: o.project, api: o.api, apiVersion: o.apiVersion })}</span>. Der Worker ruft die Services in
        <span className="font-mono"> runWorkZIO</span> auf. Der Helper legt an, was fehlt, vergleicht Bestehendes (überschreibt nie)
        und registriert den Worker in der WorkerApp und den Task in der API-Doku.
      </>} />
  );
}
