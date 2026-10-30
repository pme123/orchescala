// Data model of the services — next to the processes.
//
// A **service collection** is one REST API of a service project, as Orchescala
// wraps it: one object per operation that extends the API's super trait
// (`object GetClient extends ClientV1`, a `CompanyBpmnServiceTaskDsl`), with its
// `In` and `Out` for the process and its `ServiceIn` / `ServiceOut` for the
// HTTP call — and one `ServiceWorker` that builds the request from the `In` and
// the `Out` from the response.
//
// The operations come from an OpenAPI (tick the ones you want), the request
// and response types from its schemas. What the spec adds: further `In` and
// `Out` variables and the mappings between them — FEEL, as everywhere in the
// app; the export translates them to Scala.
//
// File: `services/<slug>.json`.
import type { CommentThread, Mapping, Status, TypeDef } from '../types';

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
  /** ids of the TypeDefs for `In` and `Out` (with `interactionId` = this id) */
  inTypeId?: string;
  outTypeId?: string;
  /**
   * how the `Out` comes from the response: per `Out` field FEEL against
   * `body` (the `ServiceOut`), `headers` and the fields of the `In`
   */
  outMappings?: Mapping[];
  [key: string]: unknown;
}

export interface ServiceCollectionSpec {
  kind: 'serviceCollection';
  version: number;
  slug: string;
  /** business title, e.g. «Kunden-API» */
  title: string;
  /** the service project (sbt), e.g. `acme-crm` — package `acme.crm.domain.…` */
  project: string;
  /** name of the API in the project, e.g. `client` — `acme.crm.domain.client.v1` */
  api: string;
  /** version of the API — `v1`, the super trait `ClientV1` */
  apiVersion: number;
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

/** Everything under `services/` — today only collections, the orchestrations follow. */
export type ServiceSpec = ServiceCollectionSpec;
