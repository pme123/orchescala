// Data model of the services — next to the processes.
//
// A **service collection** is what one OpenAPI of a service project offers — all
// of it or a sub path (`/clients/…`). Orchescala wraps it API by API: each API
// has its package and version (`client.v1`, `crm.v2`) and a super trait
// (`ClientV1`, a `CompanyBpmnServiceTaskDsl`); per operation one object extends
// it (`object GetClient extends ClientV1`), with its `In` and `Out` for the process
// and its `ServiceIn` / `ServiceOut` for the HTTP call — and one `ServiceWorker`
// that builds the request from the `In` and the `Out` from the response.
//
// The operations come from an OpenAPI (tick the ones you want), the request
// and response types from its schemas. What the spec adds: further `In` and
// `Out` variables and the mappings between them — FEEL, as everywhere in the
// app; the export translates them to Scala.
//
// File: `services/<slug>.json`.
import type { CommentThread, Mapping, Status, Step, TypeDef } from '../types';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type ParamIn = 'path' | 'query' | 'header';

/** A parameter of the request — in the path, the query or a header. */
export interface RequestParam {
  /** as in the API: `clientKey`, `request-id` */
  name: string;
  in: ParamIn;
  /** a ScalaType or the id of a type of the collection */
  type: string;
  required?: boolean;
  /** several values (`?status=a&status=b`) */
  collection?: boolean;
  description?: string;
  /** where the value comes from — FEEL against the `In` (`= clientKey`) */
  expression: string;
  /** not sent (an optional parameter nobody needs) */
  disabled?: boolean;
  [key: string]: unknown;
}

/** The body of the request or the response: a type of the collection or a ScalaType. */
export interface BodyRef {
  /** TypeDef id or ScalaType */
  type: string;
  /** `Seq[…]` — a list */
  collection?: boolean;
  /** `Option[…]` — a POST that may answer without body */
  optional?: boolean;
  [key: string]: unknown;
}

export interface CollectionService {
  /** stable — the In/Out types point to it (`TypeDef.interactionId`) */
  id: string;
  /** the API it belongs to, e.g. `client` — package `acme.crm.domain.client.v1`, trait `ClientV1` */
  api: string;
  /** version of its API — `v1` */
  apiVersion: number;
  /** Scala object, e.g. `GetClient` — also the last part of the topic */
  name: string;
  status: Status;
  /** what it does (Markdown) — `val descr` */
  description?: string;
  method: HttpMethod;
  /** path of the API, e.g. `/clients/{clientKey}` */
  path: string;
  /** from the OpenAPI — how it is recognized again on a new import */
  operationId?: string;
  /**
   * taken over from the catalog: method and path come from the ServiceTask, but query,
   * headers and the mappings of the body are not known — an OpenAPI still completes it
   */
  fromCatalog?: boolean;
  params: RequestParam[];
  /** body of the request — without: `type ServiceIn = NoInput` */
  serviceIn?: BodyRef;
  /**
   * how the body is built from the `In`: per field of the `ServiceIn` a FEEL
   * expression (`name` = field). Missing fields: the `In` field of the same name.
   */
  bodyMappings?: Mapping[];
  /** body of the response — without: `type ServiceOut = NoOutput` */
  serviceOut?: BodyRef;
  /** the success status (200, 201, 204) — for the mock */
  responseStatus?: number;
  /** headers of the response the API names (`etag`, `location`) */
  responseHeaders?: string[];
  /** `type In = NoInput` — the service needs nothing from the process (its In type is not written) */
  noIn?: boolean;
  /** `type Out = NoOutput` — the process gets nothing back (no outputMapper) */
  noOut?: boolean;
  /** ids of the TypeDefs for `In` and `Out` (with `interactionId` = this id) */
  inTypeId?: string;
  outTypeId?: string;
  /**
   * how the `Out` comes from the response: per `Out` field FEEL against
   * `body` (the `ServiceOut`), `headers` and the fields of the `In`
   */
  outMappings?: Mapping[];
  /** an `Out` with cases (enum): per case when it is that case and its fields — see `OutCase` */
  outCases?: OutCase[];
  [key: string]: unknown;
}

/**
 * One case of an `Out` with cases (enum / ADT) in the output mapping: the first case whose
 * condition holds is the result; a case without a condition is the otherwise (the last one).
 */
export interface OutCase {
  /** the case of the `Out` */
  name: string;
  /** FEEL, a Boolean — when the result is this case */
  condition?: string;
  /** per field of the case (the shared ones included) a FEEL expression */
  mappings?: Mapping[];
}

export interface ServiceCollectionSpec {
  kind: 'serviceCollection';
  version: number;
  slug: string;
  /** business title, e.g. «Kunden-API» */
  title: string;
  /** the service project (sbt), e.g. `acme-crm` — package `acme.crm.domain.…` */
  project: string;
  /** the API a new service gets, e.g. `client` (each service has its own, see CollectionService.api) */
  api: string;
  /** … and its version */
  apiVersion: number;
  /** the part of the OpenAPI the collection covers — a path prefix like `/clients`; empty: all of it */
  pathPrefix?: string;
  /**
   * the start of every path the company puts into `serviceBasePath` already —
   * `/banks/{bankNumber}` with `serviceBasePath = s"…/crm/api/v2/banks/$bankNumber"`.
   * Its placeholders are no parameters of the services; the worker adds only the rest.
   */
  pathBase?: string;
  /**
   * `def serviceBasePath` per API (`client.v1` → `s"$filIsBasePath/…/banks/$bankNumber"`) — the
   * Scala expression the project has in the worker's `exports.scala`; the Abgleich takes it over
   */
  serviceBasePaths?: Record<string, string>;
  /** `serviceLabel` of the super trait — what the description of each service names */
  serviceLabel?: string;
  status: Status;
  description?: string;
  epics?: string[];
  comments?: CommentThread[];
  createdAt: string;
  updatedAt: string;
  /** where the operations came from — the last OpenAPI read in */
  source?: { file?: string; title?: string; version?: string; basePath?: string };
  /** request/response types from the schemas, plus `In`/`Out` of every service */
  types: TypeDef[];
  services: CollectionService[];
  [key: string]: unknown;
}

/** What a task of an orchestration does — per BPMN element ID. */
export interface OrchTask {
  /** service task: the topic of the service it calls — `acme-crm-clientV1.GetClient` */
  service?: string;
  /** service task: per field of the service's `In` a FEEL expression against what is known there */
  inputs?: Mapping[];
  /** service task: the name of its result afterwards (`client`) — without: the service name, first letter small */
  result?: string;
  /**
   * service task, as a process describes it: per variable afterwards a FEEL expression against
   * the fields of the service's `Out` (`etag = etag`). Then the result itself is not known
   * afterwards — only these variables (a disabled row is not set).
   */
  outputs?: Mapping[];
  /** script task: assignments — `name` gets the value of the FEEL `expression` */
  assignments?: Mapping[];
  [key: string]: unknown;
}

/**
 * A **service orchestration**: one worker that calls service workers — like a process, but
 * only service and script tasks, parallel and exclusive gateways. In Orchescala a
 * CustomTask (`object UpdateClient extends CompanyBpmnCustomTaskDsl`) and its CustomWorker,
 * whose `runWorkZIO` calls the workers of the services one after the other
 * (`GetClientWorker().runWorkFromWorkerUnsafe(GetClient.In(…))`), in parallel (`zipPar`)
 * or depending on a condition.
 */
export interface ServiceOrchestrationSpec {
  kind: 'serviceOrchestration';
  version: number;
  slug: string;
  /** business title, e.g. «Kunde ändern» */
  title: string;
  /** the service project (sbt) — `acme-crm` */
  project: string;
  /** the API it belongs to — package `acme.crm.domain.client.v1`, topic `acme-crm-clientV1.<name>` */
  api: string;
  apiVersion: number;
  /** Scala object of the CustomTask, e.g. `UpdateClient` — also the last part of the topic */
  name: string;
  status: Status;
  /** what it does (Markdown) — `val descr` */
  description?: string;
  epics?: string[];
  comments?: CommentThread[];
  createdAt: string;
  updatedAt: string;
  /** the flow — BPMN 2.0, edited like the one of a process */
  bpmn: string;
  /** the flow as steps already (a process in service mode) — then the BPMN is not read again */
  steps?: Step[];
  /** per BPMN element ID: what the task does */
  tasks: Record<string, OrchTask>;
  /** per branch of an exclusive gateway (ID of the sequence flow) its condition in FEEL */
  conditions?: Record<string, string>;
  /** `In`, `Out` and own types */
  types: TypeDef[];
  inTypeId?: string;
  outTypeId?: string;
  /** `type In = NoInput` */
  noIn?: boolean;
  /** `type Out = NoOutput` */
  noOut?: boolean;
  /** per `Out` field a FEEL expression against what is known at the end */
  outMappings?: Mapping[];
  /** an `Out` with cases (enum): per case when it is that case and its fields */
  outCases?: OutCase[];
  [key: string]: unknown;
}

/** Everything under `services/`: collections and orchestrations. */
export type ServiceSpec = ServiceCollectionSpec | ServiceOrchestrationSpec;

export const isCollection = (s: ServiceSpec): s is ServiceCollectionSpec => s.kind === 'serviceCollection';
export const isOrchestration = (s: ServiceSpec): s is ServiceOrchestrationSpec => s.kind === 'serviceOrchestration';
