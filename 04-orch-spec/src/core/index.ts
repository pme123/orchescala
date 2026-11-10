// The core of orch-spec - its logic without UI, for orch-spec in the browser and for the studio on the
// server (E28): the tools of the AI (pages, processes, data model) with their agent loop, the BPMN, the
// findings, the types, the context for the model and the differences of a draft. orch-spec computes
// everything itself; the studio uses this package - never the other way round.
//
// The boundary (tests/checkCore.ts, on CI): from here neither React nor components (.tsx) nor the
// browser (window, document, localStorage …) is reached, and no package besides those it names.
// XML comes from the host: DOMParser and XMLSerializer on globalThis - the browser has them; Node
// installs them with installNodeDom(<a DOMParser>), orch-spec's tests and tools with linkedom.

// the AI: agent loop, tool kits, context, costs, differences, config of the studio
export * from '../ai/agent';
export * from '../ai/toolkit';
export * from '../ai/pageTools';
export * from '../ai/processTools';
export * from '../ai/bpmnEdit';
export * from '../ai/context';
export * from '../ai/cost';
export * from '../ai/diff';
export * from '../ai/config';

// the specification: types, BPMN, findings, the data model of a page and of a service orchestration
export * from '../types';
export { allSteps, importBpmn, mergeSpec } from '../bpmn';
export { collectFindings, PROCESS_FINDINGS } from '../findings';
export { checkTypes, indexTypes } from '../scala';
export { flatten, targetsOf, withIds, type PField, type Targets } from '../pages/designer/model';
export type { App, Component, Page } from '../pages/runtime/spec';
export { newCollection } from '../services/collection';
export { newServiceProcess, orchestrationTargets, withCollections } from '../services/serviceProcess';
export type { CollectionService, ServiceCollectionSpec } from '../services/types';

// XML in Node
export { installNodeDom, installXmlNamespaces, type DomParserClass } from './nodeDom';
