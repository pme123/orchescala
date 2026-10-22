// Data model of the process specification.
//
// A specification is a **tree** of steps — not the flat
// BPMN graph. Gateways carry their branches (`branches`) as children, subprocesses
// their steps (`children`), loops are marked as `loop` on the
// repeated block. That is exactly the difference to the Confluence table: the
// whole process is readable at a glance and can be collapsed.

// ── Status ───────────────────────────────────────────────────────────────────
// Applies to the process **and** to every single step.
// Order = progress; a click on the chip advances it.
// «Angepasst» comes last: that is where the BPMN sync puts a step
// whose implementation has changed — even an accepted one.
/**
 * In order of progress — «Angepasst» (technically changed, after
 * «Final») comes before «Umgesetzt»: the lowest status is the state of the whole
 * (see overallStatus).
 */
export const STATUSES = ['draft', 'review', 'final', 'changed', 'implemented', 'accepted'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_META: Record<Status, { label: string; short: string; dark: string; light: string }> = {
  draft:       { label: 'Entwurf',    short: 'E', dark: 'bg-white/8 text-white/50 border-white/15',                 light: 'bg-black/5 text-black/50 border-black/15' },
  review:      { label: 'In Prüfung', short: 'P', dark: 'bg-amber-500/15 text-amber-300 border-amber-500/30',       light: 'bg-amber-50 text-amber-700 border-amber-300' },
  final:       { label: 'Final',      short: 'F', dark: 'bg-blue-500/15 text-blue-300 border-blue-500/30',          light: 'bg-blue-50 text-blue-700 border-blue-300' },
  implemented: { label: 'Umgesetzt',  short: 'U', dark: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', light: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  // Accepted is the final state — hence filled instead of tinted
  accepted:    { label: 'Abgenommen', short: 'A', dark: 'bg-emerald-500/80 text-black border-emerald-400',           light: 'bg-emerald-600 text-white border-emerald-700' },
  changed:     { label: 'Angepasst',  short: '~', dark: 'bg-rose-500/15 text-rose-300 border-rose-500/30',          light: 'bg-rose-50 text-rose-700 border-rose-300' },
};

// ── Steps ────────────────────────────────────────────────────────────────────
export type StepKind =
  | 'start' | 'end'
  | 'service' | 'user' | 'call' | 'send' | 'receive' | 'rule' | 'script' | 'manual'
  | 'subprocess'
  | 'gateway'          // exclusive / parallel / event-based (see gatewayType)
  | 'event'            // intermediate event (throwing/catching, timer, signal, message)
  | 'goto';            // jump back (loop) to a step already shown

export type GatewayType = 'exclusive' | 'parallel' | 'inclusive' | 'eventBased';

// A mapping entry: process variable ↔ service parameter.
// `expression` is the Camunda expression (e.g. `${renterClientKey}`),
// `description` the business meaning for the stakeholders.
export interface Mapping {
  name: string;
  expression: string;
  description?: string;
  /** does not occur in this process — stays, but does not count */
  disabled?: boolean;
  /**
   * Output of the service under its own name (`x = x`), from
   * `_outputVariables` or the catalog — checked means «the process needs
   * it»: an entry in `_outputVariables`, not an output parameter
   */
  fromService?: boolean;
  [key: string]: unknown;
}

// Repetition: the step/block is executed again as long as `condition`
// holds — in the savings account pattern «wait ${timer}» + «Tried ${max} times?».
export interface LoopSpec {
  condition: string;      // business condition for the repetition
  maxAttempts?: string;   // e.g. `${maxOpenAccount}`
  waitFor?: string;       // e.g. `${timerWaitOpenAccount}`
}

// Multiple execution (multi-instance): the step runs once per element of a
// collection. Read from the BPMN; the names apply in the step and in everything
// inside it (FEEL knows `loopCounter` and the element there).
export interface MultiInstanceSpec {
  /** FEEL expression of the collection without `=`, e.g. `order.items` */
  collection?: string;
  /** name of the variable for the current element (`inputElement` or `elementVariable`) */
  element?: string;
  sequential?: boolean;
}

// A gateway branch. `steps` is the block up to the merge.
export interface Branch {
  id: string;
  label: string;          // e.g. «ja» / «nein» / «severalMatches»
  condition?: string;     // technical expression from the BPMN
  isDefault?: boolean;
  steps: Step[];
  [key: string]: unknown;
}

// Error handling of a step (boundary event or `_handledErrors`).
/**
 * Timer of an event — when it fires. `expression` like a mapping:
 * `= timerEscalationCancel` (a variable — it goes into the `InConfig` with
 * `default`) or fixed text (`P7D`, ISO 8601).
 */
export interface TimerSpec {
  kind: 'duration' | 'date' | 'cycle';
  expression: string;
  /** default of the variable in the `InConfig`, ISO 8601 (e.g. `P7D`) */
  default?: string;
}

export interface ErrorHandling {
  code: string;           // e.g. `account-not-opened`, `404`
  label?: string;
  interrupting?: boolean;
  /** is in the step's `_handledErrors` */
  declared?: boolean;
  /** comes from a boundary event — code and path are in the diagram */
  boundary?: boolean;
  /** not an error, but a non-interrupting side path on the step */
  side?: boolean;
  /** belongs to a pattern (its id) — wiring, no business logic of its own */
  pattern?: string;
  /** a timer boundary event: when it fires — its variable is in the `InConfig` */
  timer?: TimerSpec;
  /** ID of the boundary event in the diagram — that is where the export writes timer, signal or message */
  boundaryId?: string;
  /**
   * Kind of the boundary event. Signal, message and escalation are not errors —
   * they are shown on the step under «Ereignisse am Rand» (see `isEventBoundary`)
   */
  eventKind?: Step['eventKind'];
  /** name of the signal or message — like `Step.messageName` */
  messageName?: string;
  /** waiting message: the correlation key — like `Step.correlationKey` */
  correlationKey?: string;
  steps?: Step[];         // handling path
  [key: string]: unknown;
}

/** shape of a DMN result — like `camunda:mapDecisionResult` or the factory in the domain object */
export type DecisionResult = 'singleEntry' | 'singleResult' | 'collectEntries' | 'resultList';

export interface Step {
  id: string;             // stable; on import the BPMN element ID
  kind: StepKind;
  name: string;
  status: Status;
  /** business description (Markdown) — what the stakeholders read */
  description?: string;

  // Service/worker binding
  serviceId?: string;     // catalog entry (= Camunda modelerTemplate)
  topic?: string;         // external topic, if not a catalog service
  calledProcess?: string; // for kind 'call': called process

  inputs?: Mapping[];
  outputs?: Mapping[];
  /** chosen variant of the service `In` or `Out`, if it is an enum with cases (see variants.ts) */
  inVariant?: string;
  outVariant?: string;
  errors?: ErrorHandling[];
  /** regular expressions for further handled error codes — `_regexHandledErrors` */
  regexHandledErrors?: string[];
  mock?: string;          // `_outputMock` / sample response (JSON)
  /**
   * What the step can be mocked with in tests: `output` = `_outputMock`
   * (the result of the worker or subprocess), `service` = `_outputServiceMock`
   * (the response of the service, only for service workers). Without a choice the
   * step passes `_servicesMocked` on. On export the field is created in the `InConfig`.
   */
  mockKind?: 'output' | 'service';
  /**
   * Decision (DMN): which process variable the result goes into
   * (`camunda:resultVariable` or `zeebe:calledDecision resultVariable`) …
   */
  resultVariable?: string;
  /**
   * … and in which shape (`camunda:mapDecisionResult`): a value
   * (`singleEntry`), an object (`singleResult`), a list of values
   * (`collectEntries`) or of objects (`resultList`, default in Camunda 7).
   */
  /**
   * `_outputVariables` from the BPMN — the variables the service delivers
   * and the process needs. On import they become the outputs or the
   * checked rows (see withServiceRows).
   */
  outputVariables?: string[];
  /**
   * Service from the BPMN: did it have `_manualOutMapping`? `false` — the worker
   * sets its outputs itself as process variables (`_outputVariables`
   * filters); `true` — they come back locally, the output parameters map them.
   * The export keeps the kind. If it is missing (created in the specification),
   * outputs are mapped by hand.
   */
  manualOutMapping?: boolean;
  decisionResult?: DecisionResult;

  // Structure
  gatewayType?: GatewayType;
  branches?: Branch[];    // for kind 'gateway'
  children?: Step[];      // for kind 'subprocess'
  loop?: LoopSpec;
  /** multiple execution — the step runs once per element of a collection */
  multiInstance?: MultiInstanceSpec;
  gotoId?: string;        // for kind 'goto': target step
  back?: boolean;         // for kind 'goto': jump back (loop) instead of merge

  /** block is not attached to any sequence flow (event subprocess, link target …) */
  orphan?: boolean;
  /** subprocess that is triggered by an event (triggeredByEvent) */
  eventSubprocess?: boolean;

  // Events
  eventKind?: 'timer' | 'signal' | 'message' | 'error' | 'escalation' | 'none';
  eventDirection?: 'throw' | 'catch';
  /** name of the signal or message (`<bpmn:signal name>` / `<bpmn:message name>`) */
  messageName?: string;
  /**
   * Catching message: the correlation key (FEEL), in Camunda 8 from
   * `zeebe:subscription` of the `<bpmn:message>` — Camunda 7 has no such thing in the BPMN
   */
  correlationKey?: string;
  /** timer event: when it fires — its variable is in the `InConfig` */
  timer?: TimerSpec;


  // ── Further details the specification defines ────────────────────────────
  // User task — like the mappings: with `=` FEEL, otherwise fixed text;
  // in the BPMN for Camunda 7 `camunda:…` (`${…}`), for Camunda 8 `zeebe:assignmentDefinition`
  /** user task: who sees it (`candidateGroups`) */
  candidateGroups?: string;
  /** user task: which persons see it (`candidateUsers`) */
  candidateUsers?: string;
  /** user task: who it is assigned to directly (`assignee`) */
  assignee?: string;

  // ── Pattern ──────────────────────────────────────────────────────────────
  /** pattern on this element — detected from the BPMN or chosen here */
  patterns?: AppliedPattern[];
  /** step itself belongs to a pattern (its id): a shared block */
  pattern?: string;

  [key: string]: unknown;
}

// ── Pattern ──────────────────────────────────────────────────────────────────
//
// A pattern is a recurring BPMN building block — «Benutzer per Mail
// informieren», «Eskalation», «Prozess-Event senden». The admin creates it as a
// small BPMN: an **anchor** (`PatternTarget`, e.g. a user task)
// with everything attached to it (listeners, inputs, boundary events including
// their path), and next to it blocks the process needs **once** (link target →
// call activity, event subprocess). Values that change per use
// appear in it as `{{name}}` — those are the parameters.
//
// Everything else follows from the same BPMN: choosing inserts it (src/patterns.ts),
// the import recognizes it again, removing takes it out.

/** parameter of a pattern — in the BPMN as `{{name}}` */
export interface PatternParam {
  name: string;
  label?: string;
  description?: string;
  /** default on insertion */
  default?: string;
  [key: string]: unknown;
}

export interface PatternDef {
  /** stable, e.g. `inform-user` — stored in the specifications */
  id: string;
  name: string;
  /** what it does and when to use it (Markdown) */
  description?: string;
  /** documentation, e.g. the pattern page */
  docUrl?: string;
  /**
   * BPMN element types it fits (`userTask`, `callActivity` …) —
   * `process` means: on the process itself. Default is the type of the anchor.
   */
  appliesTo: string[];
  params?: PatternParam[];
  /** the pattern as BPMN, per engine */
  bpmn: Partial<Record<EngineId, string>>;
  /**
   * Further notations of the same pattern (per engine) — detection
   * accepts them too, but `bpmn` is always what gets inserted. For older processes that
   * express the same thing differently (Groovy script instead of expression).
   */
  variants?: Partial<Record<EngineId, string[]>>;
  /**
   * Where the pattern appears on the step. `assignment`: it determines the
   * responsibility (e.g. a task listener that assigns the advisor) — it is shown under
   * «Zuständigkeit», and groups/person are then not editable.
   */
  area?: 'assignment';
  /**
   * Built into Orchescala, not maintained in the admin and not in the BPMN — its
   * values are in the specification (see ORCHESCALA_PATTERNS).
   */
  builtin?: boolean;
  [key: string]: unknown;
}

/** A pattern on an element (or on the process) */
export interface AppliedPattern {
  id: string;
  /** values of the parameters */
  params?: Record<string, string>;
  [key: string]: unknown;
}

// ── Data model (class builder) ───────────────────────────────────────────────
//
// Describes the business types of the process — above all the **In** of the
// process. Deliberately NOT included: `InConfig` and `InitIn`. Those are
// implementation details (mock control, initialized process variables)
// and do not belong in the specification.
//
// From these types `src/scala.ts` generates the Orchescala domain (case class +
// companion with ApiSchema/InOutCodec/example/exampleMinimal).

/** Scalar types Orchescala knows directly. */
export const SCALA_TYPES = [
  'String', 'Boolean', 'Int', 'Long', 'Double', 'BigDecimal',
  'LocalDate', 'LocalDateTime', 'Instant', 'Iso8601Duration', 'Iban',
] as const;
export type ScalaType = (typeof SCALA_TYPES)[number];

/** Templates for Iron refinements (`String :| ValidEmail`). `arg` = placeholder. */
export interface ConstraintTemplate {
  id: string;
  label: string;
  /** expression; `N` or `X` is replaced by the entered value */
  expr: string;
  arg?: 'zahl' | 'text';
  for: 'text' | 'zahl';
}

export const CONSTRAINTS: ConstraintTemplate[] = [
  { id: 'email',    label: 'gültige E-Mail',   expr: 'ValidEmail',        for: 'text' },
  { id: 'uuid',     label: 'gültige UUID',     expr: 'ValidUUID',         for: 'text' },
  { id: 'notBlank', label: 'nicht leer',       expr: 'Not[Blank]',        for: 'text' },
  { id: 'minLen',   label: 'Mindestlänge',     expr: 'MinLength[N]',      arg: 'zahl', for: 'text' },
  { id: 'maxLen',   label: 'Maximallänge',     expr: 'MaxLength[N]',      arg: 'zahl', for: 'text' },
  { id: 'fixLen',   label: 'genaue Länge',     expr: 'FixedLength[N]',    arg: 'zahl', for: 'text' },
  { id: 'match',    label: 'Muster (Regex)',   expr: 'Match["X"]',        arg: 'text', for: 'text' },
  { id: 'positive', label: 'grösser als 0',    expr: 'Positive',          for: 'zahl' },
  { id: 'min',      label: 'mindestens',       expr: 'GreaterEqual[N]',   arg: 'zahl', for: 'zahl' },
  { id: 'max',      label: 'höchstens',        expr: 'LessEqual[N]',      arg: 'zahl', for: 'zahl' },
];

export interface Field {
  /** stable — renaming does not break references */
  id: string;
  name: string;
  /** a `ScalaType` or the id of an own type */
  type: string;
  /** Option[T] — may be missing */
  optional?: boolean;
  /** Seq[T] — multiple */
  collection?: boolean;
  /** Map[String, T] — the key is always text in JSON, `type` is the value */
  map?: boolean;
  /**
   * A single **case** of an ADT enum as a type: `type` is the enum,
   * `enumCase` the case — in Scala `CustomDocContents.\`QI-Deklaration\``.
   */
  enumCase?: string;
  /** Iron refinement, e.g. `ValidEmail` → `String :| ValidEmail` */
  constraint?: string;
  /** default value as a Scala expression, e.g. `"CH"` or `Seq.empty` */
  default?: string;
  /** example value as a Scala expression — if not given, the app derives one */
  example?: string;
  /**
   * From the domain: the imports the example needs — as they appear in
   * the file (`swisscom.fil.is.domain.defaultValidUntil`); empty if
   * the values were visible without an import (company library, own package)
   */
  exampleImports?: string[];
  /** business meaning → `@description(...)` */
  description?: string;
  /**
   * `@description` from the domain that is not plain text — a reference
   * (`clientKeyDescr`), a call or `s"…${x}"`. The export writes it
   * verbatim; `description` is then only the readable version. Whoever changes the
   * description replaces it.
   */
  descriptionExpr?: string;
  /**
   * The imports `descriptionExpr` needs — from the domain's file:
   * `valiant.bpmn.domain.sendProcessEvent.v1.SendProcessEvent` for
   * `s"…${SendProcessEvent.processName}…"`, `…Escalation.*` for `timerStartEscalationDescr`
   */
  descriptionImports?: string[];
  [key: string]: unknown;
}

/**
 * A value of a choice. If it carries fields, the choice is an **ADT**
 * (`enum In: case Standard(…) case VermoegensVerwaltung(…)`) — each case
 * its own class, together one type.
 */
export interface EnumValue {
  name: string;
  description?: string;
  fields?: Field[];
  /**
   * The order of the case's parameters in the code — shared and own fields
   * together (`case Graviton(subStatusKey, subStatusScore, subStatusNr, …)`). The
   * export keeps it; without it (created in Orch Spec) the shared ones come first.
   */
  order?: string[];
  [key: string]: unknown;
}

/**
 * Choice with fields (ADT)? Either the cases carry fields, or the
 * choice has **shared fields** (`fields`) — in Scala 3 as `def` in the
 * enum body, which every case brings along.
 */
export const isAdt = (t: { kind: string; values?: EnumValue[]; fields?: Field[] }): boolean =>
  t.kind === 'enum' && ((t.values ?? []).some(v => !!v.fields?.length) || !!t.fields?.length);

// ── Interactions ─────────────────────────────────────────────────────────────
//
// Every place where the process talks to the outside has its own
// object in the domain with its own `In` and/or `Out`:
//
//   object AdvisorDepotUnlockUT      extends CompanyBpmnUserTaskDsl     · val name
//   object EvalNextPortfolioIdSuffix extends CompanyBpmnCustomTaskDsl · val topicName
//   object CancelOpenPensionAccountSE extends CompanyBpmnSignalEventDsl · val messageName
//
// The Scala object name cannot be derived from the BPMN (the task is
// called `DepotActivityUnlockAdvisorTask` there, the object `AdvisorDepotUnlockUT`) —
// which is why it is kept here.
export type InteractionKind = 'userTask' | 'customTask' | 'signal' | 'message' | 'decision';

export const INTERACTION_META: Record<InteractionKind, {
  label: string; dsl: string; keyName: string; factory: string; suffix: string; hasOut: boolean;
}> = {
  userTask:   { label: 'Benutzeraufgabe', dsl: 'CompanyBpmnUserTaskDsl',     keyName: 'name',        factory: 'userTask',    suffix: 'UT', hasOut: true },
  customTask: { label: 'Eigener Worker',  dsl: 'CompanyBpmnCustomTaskDsl',   keyName: 'topicName',   factory: 'customTask',  suffix: '',   hasOut: true },
  signal:     { label: 'Signal',          dsl: 'CompanyBpmnSignalEventDsl',  keyName: 'messageName', factory: 'signalEvent', suffix: 'SE', hasOut: false },
  message:    { label: 'Nachricht',       dsl: 'CompanyBpmnMessageEventDsl', keyName: 'messageName', factory: 'messageEvent', suffix: 'ME', hasOut: false },
  // the factory depends on the result shape (`decisionResult`, see dmnFactory in scala.ts)
  decision:   { label: 'DMN Decision',    dsl: 'CompanyBpmnDecisionDsl',     keyName: 'decisionId',  factory: 'singleResult', suffix: 'Dmn', hasOut: true },
};

export interface Interaction {
  id: string;
  /** step in the flow (BPMN element ID) */
  stepId: string;
  kind: InteractionKind;
  /** Scala object, e.g. `AdvisorDepotUnlockUT` */
  name: string;
  /** value for `name` / `topicName` / `messageName` */
  key: string;
  descr?: string;
  /** `val descr` from the domain that is not plain text (`s"…${X.processName}…"`) — verbatim in the export */
  descrExpr?: string;
  /** the imports `descrExpr` needs */
  descrImports?: string[];
  status?: Status;
  /** ids of the TypeDefs for In and Out */
  inTypeId?: string;
  outTypeId?: string;
  /**
   * In or Out is another type (`type In = OrderCardUT.In`): the member
   * of another interaction (`<id>.In`, `<id>.Out`) or a type of the domain
   * (`dom:<id>`). The fields remain available via `inTypeId`/`outTypeId`
   * (mappings, checks); the alias only determines what the export writes.
   */
  inAlias?: string;
  outAlias?: string;
  /**
   * Differing values in the interaction's example — per field the Scala expression:
   * `userTask(OrderCardUT.In.example.copy(clientKeyIsIdentityOk = false), …)`
   */
  inExample?: Record<string, string>;
  outExample?: Record<string, string>;
  /**
   * DMN decision: the shape of the result — `singleEntry` (a simple
   * value), `singleResult` (an object), `collectEntries` (list of simple
   * values), `resultList` (list of objects). For a simple value
   * the `Out` has exactly one field, whose type is the value. Without it `singleResult`.
   */
  decisionResult?: DecisionResult;
  /**
   * DMN decision with its own table: the file name in the project
   * (`src/main/resources/camunda[8]/…`) — set as soon as the app manages the table
   * (`processes/<slug>/<decisionId>.dmn`, see dmn.ts)
   */
  dmnFile?: string;
  /**
   * Package of the domain object if the interaction is one from the catalog
   * (found via its key, see `interactionOrigin`) — a foreign
   * package means: referenced, not exported. Missing for a new one.
   */
  pkg?: string;
  [key: string]: unknown;
}

export interface TypeDef {
  id: string;
  /** Scala name, e.g. `In`, `InAddress`, `ClientLanguage` */
  name: string;
  kind: 'case' | 'enum';
  description?: string;
  status?: Status;
  /** the `In` of the process — lives in the process object, not in `schema/` */
  root?: boolean;
  /** the `Out` of the process */
  processOut?: boolean;
  /** belongs to an interaction — lives in its object, not in `schema/` */
  interactionId?: string;
  /** lives in the process object itself (like `OrderCard.CustomProcessStatus`) — the export writes it there, not to `schema/` */
  inProcessObject?: boolean;
  /**
   * which domain type the import took the class from (`…orderCard.v1.schema.DueDateSpec`) —
   * it belongs to the process, even if an older catalog still lists it elsewhere
   */
  domainId?: string;
  /** the `InitIn` — fields come from the init worker, types are maintained */
  initIn?: boolean;
  /**
   * the `InConfig` — the process's own adjusting knobs; loops and
   * mocks are added from the flow on generation
   */
  inConfig?: boolean;
  /** fields of the class — for a choice (ADT) the **shared** fields of all cases */
  fields?: Field[];
  values?: EnumValue[]; // kind 'enum'
  [key: string]: unknown;
}

// ── Process specification (processes/<slug>.json) ────────────────────────────
export interface Variable {
  name: string;
  type?: string;
  description?: string;
  example?: string;
  [key: string]: unknown;
}

/**
 * A comment thread — like in Confluence: a post, replies below it,
 * and at some point checked off as resolved. Resolved ones stay; whoever
 * joins later should see what was discussed.
 */
export interface CommentThread {
  id: string;
  /**
   * what it refers to: an element (`process`, `step:<id>`, `ia:<id>`,
   * `type:<id>`) or a part of it (`step:<id>#in:<name>` …, see comments.ts)
   */
  target: string;
  /**
   * what the place was called while it still existed — a sync that
   * removes it remembers this; the panel shows the thread under «Ohne Stelle»
   */
  place?: string;
  resolved?: boolean;
  /** who checked it off, and when */
  resolvedBy?: string;
  resolvedAt?: string;
  entries: CommentEntry[];
  [key: string]: unknown;
}

export interface CommentEntry {
  id: string;
  author: string;
  /** e-mail of the author — only when signed in; recipient for Teams on replies */
  email?: string;
  /** ISO timestamp with zone */
  at: string;
  text: string;
  /** persons mentioned via «@» (the text contains «@Name») */
  mentions?: DirectoryUser[];
  /**
   * Teams notification (see Model.notifications.teams): e-mails of the
   * persons still to be notified or already notified.
   * Only the author's browser sends them.
   */
  notifyPending?: string[];
  notified?: string[];
  /**
   * Reactions (👍 ❤️ …): per emoji the persons who reacted that way —
   * clicking again takes back one's own (see toggleReaction)
   */
  reactions?: Record<string, { name: string; email?: string }[]>;
}

/**
 * Known person for @-mentions: from `users.json` in the shared folder
 * (every signed-in person registers on opening) or from the
 * Entra search (Microsoft Graph, permission User.ReadBasic.All).
 */
export interface DirectoryUser {
  name: string;
  email: string;
  /** ISO — only in users.json */
  lastSeen?: string;
}

export interface UsersFile {
  version: number;
  users: DirectoryUser[];
}

/**
 * Teams notification on @-mention and on replies to one's own
 * comment: the commenting person sends the mentioned one a personal chat message via Microsoft
 * Graph (1:1 chat, with a real @-mention and
 * a link into the app) — after a delay, batched, once.
 * Permissions (delegated): Chat.Create, ChatMessage.Send, User.ReadBasic.All.
 */
export interface TeamsNotifySettings {
  enabled: boolean;
  /** delay after the last comment in minutes (default 5) */
  delayMinutes?: number;
  /** placeholders: {{empfaenger}} {{von}} {{prozess}} {{anzahl}} {{kommentare}} {{link}} */
  template?: string;
}

/** The label of the process per language — `ProcessLabels(de, fr)` in Orchescala */
export interface ProcessLabels { de: string; fr: string }

export interface ProcessSpec {
  /** which engine this process is built for */
  engine?: EngineId;
  /** comments on the process, elements and data types */
  comments?: CommentThread[];
  version: number;
  slug: string;
  /** technical process name incl. version, e.g. `openSavingsV1` */
  name: string;
  /** business title, e.g. «Sparkonto eröffnen» */
  title: string;
  /** BPMN process ID, e.g. `globex-savings-openSavingsV1` */
  processId?: string;
  /** `override def processLabels` of the process object — from the domain, goes into the export */
  processLabels?: ProcessLabels;
  /** Orchescala project, e.g. `globex-savings` */
  project?: string;
  /**
   * Old name that does not follow the convention (`company-projekt-prozessVersion`)
   * and has to stay — e.g. `valiant-product-orderCard`. Then the only
   * check is that the ID has three parts.
   */
  legacyProcessId?: boolean;
  status: Status;
  /** description / initial situation / goal (Markdown) — `descr` of the process object */
  description?: string;
  /** how long the history is kept (`camunda:historyTimeToLive`, days) */
  timeToLive?: string;
  createdAt: string;
  updatedAt: string;
  variables?: Variable[];
  /** data model: the In of the process and its types (class builder) */
  types?: TypeDef[];
  /** interactions: user tasks, own workers, signals */
  interactions?: Interaction[];
  /**
   * Outputs of the init worker. The step itself is **not** in the flow —
   * it is wiring (in Camunda 8 possibly a listener) and is not
   * described. Its outputs, however, are the fields of the `InitIn`.
   */
  initOutputs?: Mapping[];
  /** pattern on the process itself (e.g. «einmalige Ausführung») */
  patterns?: AppliedPattern[];
  /** IDs of the epics (`Model.epics`) this process contributes to */
  epics?: string[];
  steps: Step[];
  [key: string]: unknown;
}

// ── Service catalog (model.json) ─────────────────────────────────────────────
// A catalog entry corresponds to a Camunda **element template**: name,
// topic and the prepared mapping. When a service is chosen on a step,
// the app takes over its inputs/outputs as a template.
export interface ServiceParam {
  name: string;
  expression?: string;    // default — from the template or `#{name}`
  description?: string;
  required?: boolean;
  /** only in these variants (OpenAPI `oneOf`) — missing: in all */
  variants?: string[];
  [key: string]: unknown;
}

export interface ServiceDef {
  id: string;             // = element-template id / modelerTemplate
  name: string;
  /**
   * Entry comes from the bundled `catalog.generated.json` (part of the
   * app build, regenerated on every release). Never written to the `model.json`
   * — the catalog is not maintainable by the user.
   */
  generated?: boolean;
  group?: string;         // e.g. `globex-crm`
  description?: string;
  topic?: string;
  kind?: StepKind;        // 'service' (worker), 'call' (process), 'user' (user task)
  inputs?: ServiceParam[];
  outputs?: ServiceParam[];
  handledErrors?: string[];
  /** for subprocesses the called process (`calledElement`) */
  calledProcess?: string;
  docUrl?: string;
  [key: string]: unknown;
}

// ── Domain catalog ───────────────────────────────────────────────────────────
// The types of the service projects, read from their Scala sources: the
// objects in the `schema/` folder as well as the `In` / `Out` of the services.
// When the catalog is exported, it can be read in where the sources
// are not available (e.g. in the banking zone).
/** A field of a domain type — as it appears in Scala. */
export interface DomainField {
  name: string;
  /** full type expression, e.g. `Option[Seq[InPerson]]` */
  type: string;
  default?: string;
  description?: string;
  /** `@description(clientKeyDescr)` — the expression, if it is not plain text (see Field.descriptionExpr) */
  descriptionExpr?: string;
  /** the value in the companion's `lazy val example = X(…)` — as it appears there, e.g. `Some(CardHolder.example)` */
  example?: string;
  [key: string]: unknown;
}

/**
 * An example value from the domain: `val defaultClientKey: Long = 74854564837991L`
 * at the top level of a package. If a field is called `clientKey`, the
 * `example` takes this value — as the projects do by hand.
 */
export interface DomainDefault {
  /** `defaultClientKey` */
  name: string;
  /** `valiant.orchescala.domain` */
  pkg: string;
  /** given or derived from the literal (`Long`) — without a type the value is not used */
  type?: string;
  /** from the generated catalog — does not belong in the model.json */
  generated?: boolean;
}

export interface DomainType {
  /** fully qualified, e.g. `globex.crm.domain.account.v1.GetAccount.Out` */
  id: string;
  /** from the bundled `catalog.generated.json` — see ServiceDef.generated */
  generated?: boolean;
  /** Scala type, e.g. `GetAccount.Out` or `InAddress` */
  name: string;
  pkg: string;
  /** `member` = In/Out of a service (comes from the trait), `alias` = `type X = …` */
  kind: 'case' | 'enum' | 'member' | 'alias';
  /** enclosing object for `In` / `Out` */
  owner?: string;
  /** what has to be imported (for members the object) */
  importPath: string;
  /** fields — for an enum the shared ones (`def x: T` in the body) */
  fields?: DomainField[];
  values?: string[];
  /** for an enum with parameters (ADT): the fields per case */
  cases?: Array<{ name: string; fields?: DomainField[] }>;
  /**
   * For a simple enum: the cases for which there are givens for the singleton type
   * (`X.fall.type`) — only they are fit as a fixed case. If missing, nothing is checked.
   */
  fixedCases?: string[];
  descr?: string;
  /**
   * `val processName` of a process object, e.g. `globex-ordercard`.
   * With it a BPMN process finds its domain without package and
   * object name having to be guessed from the ID.
   */
  processName?: string;
  /** `override def processLabels: ProcessLabels = ProcessLabels("…", "…")` of the process object */
  processLabels?: ProcessLabels;
  /** `val topicName` of a worker object — the same for service tasks */
  topicName?: string;
  /** kind of the object according to the DSL: `Process`, `UserTask`, `CustomTask`, `SignalEvent`, `MessageEvent`, `Decision` … */
  dsl?: string;
  /** key of the object: `name` (user task), `messageName`, `decisionId` — and its value */
  keyName?: string;
  key?: string;
  /** decision: the shape of the result according to `lazy val example = singleResult(…)` */
  decisionResult?: DecisionResult;
  /** `val descr` of the enclosing object */
  ownerDescr?: string;
  /** `val descr` as a Scala expression, if it is not plain text (`s"…${X}…"`) */
  ownerDescrExpr?: string;
  /** for `alias`: the target expression, e.g. `Int :| any.In[(11, 15)]` or `AdjustOrderUT.In` */
  target?: string;
  /**
   * Differing values in the object's example: `lazy val example =
   * userTask(OrderCardUT.In.example.copy(clientKeyIsIdentityOk = false), …)` —
   * per member (In, Out) the fields with their Scala expression
   */
  exampleCopies?: { In?: Record<string, string>; Out?: Record<string, string> };
  /**
   * The switches of the decoder of an `In` with cases: fields of which **one**
   * suffices for the decoder to choose the case — `useCase` directly or `clientType`
   * (the decoder then sets `useCase` itself). The first is the direct field,
   * the others choose the case at runtime. See domainScan.ts and variants.ts.
   */
  routing?: string[];
  /** origin (file) — only for traceability */
  source?: string;
  /**
   * The imports of the file (`valiant.vollmacht.domain.loadPoas.v1.LoadPoas`,
   * `a.b.*`) — a field type is resolved via them first, as in Scala
   */
  imports?: string[];
  [key: string]: unknown;
}

/**
 * The engine a process is built for. Each has a template
 * under `public/templates/` (see `template.ts`).
 */
export type EngineId = 'c7' | 'c8';

/** A project folder in the catalog. */
export interface ProjectFolder {
  /** stable across reordering; also the key of the folder access */
  id: string;
  /** folder name, e.g. `initech-core-banking` */
  name: string;
  /**
   * absolute path — only the CLI knows it. In the browser the folder picker
   * does not give out a path; there the remembered access leads back to the folder.
   */
  path?: string;
  /**
   * Name of the folder **above** the projects this project came from
   * (`projects`). Its access is remembered once and confirmed once —
   * the project folders below inherit it instead of each needing a dialog.
   */
  root?: string;
  /** number of types from this project at the last build */
  types?: number;
  /**
   * Color of the project (`#rrggbb`) — like `ProjectConfig.color` in Orchescala.
   * A worker or subprocess from this project gets it in the diagram.
   */
  color?: string;
  [key: string]: unknown;
}

/**
 * An epic — a bracket over several processes, e.g. a change. Only an admin
 * may create one; whoever edits may assign. The overview filters by it.
 */
export interface EpicDef {
  /** stable — stored in the specifications; renaming only changes `name` */
  id: string;
  name: string;
  description?: string;
  /** link, e.g. to the epic in the ticket system */
  url?: string;
  /** closed: no longer assignable, but stays on the process and in the filter */
  closed?: boolean;
}

export interface AuthSettings {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  adminRole?: string;
  reviewerRole?: string;
  viewerRole?: string;
}

export interface Model {
  version: number;
  /** name of the customer — shown on the left in the header */
  company?: string;
  /**
   * Logo of the customer as a data URI. It lives in the `model.json` so that it
   * comes along everywhere — in the shared folder as in SharePoint, without a second
   * file and without an address that would have to be reachable from outside.
   */
  logo?: string;
  auth?: AuthSettings;
  /** notifications for comments */
  notifications?: { teams?: TeamsNotifySettings };
  /** service catalog with prepared mapping */
  services: ServiceDef[];
  /** domain catalog: the types of the service projects */
  domainTypes?: DomainType[];
  /** example values of the domain (`defaultClientKey` …) — in order of precedence */
  domainDefaults?: DomainDefault[];
  /** most recently read source folders — as a reminder in the admin */
  domainSources?: string[];
  /**
   * The project folders of the domain catalog — **the order is the
   * precedence**. If the same package lives in several projects
   * (`initech.core.banking.domain.client` and `globex.core.banking.domain.client`),
   * the one higher up wins; the other is discarded.
   */
  projects?: ProjectFolder[];
  /** patterns the specifications can choose on their elements */
  patterns?: PatternDef[];
  /** epics processes can be assigned to — the order also applies in the filter */
  epics?: EpicDef[];
  /**
   * Project colors from the generated catalog (`prepareDocs`, `ProjectConfig.color`) —
   * only in memory, never in the model.json. A color on the project folder takes precedence.
   */
  projectColors?: Record<string, string>;
  [key: string]: unknown;
}
