// Datenmodell der Prozess-Spezifikation.
//
// Eine Spezifikation ist ein **Baum** von Schritten — nicht der flache
// BPMN-Graph. Gateways tragen ihre Zweige (`branches`) als Kinder, Subprozesse
// ihre Schritte (`children`), Schleifen sind als `loop` am wiederholten Block
// markiert. Genau das macht den Unterschied zur Confluence-Tabelle: der
// gesamte Prozess ist auf einen Blick lesbar und lässt sich einklappen.

// ── Status ───────────────────────────────────────────────────────────────────
// Gilt für den Prozess **und** für jeden einzelnen Schritt.
// Reihenfolge = Fortschritt; ein Klick auf den Chip schaltet weiter.
// «Angepasst» steht am Ende: dorthin setzt der BPMN-Abgleich einen Schritt,
// dessen Implementation sich geändert hat — auch einen abgenommenen.
export const STATUSES = ['draft', 'review', 'final', 'implemented', 'accepted', 'changed'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_META: Record<Status, { label: string; short: string; dark: string; light: string }> = {
  draft:       { label: 'Entwurf',    short: 'E', dark: 'bg-white/8 text-white/50 border-white/15',                 light: 'bg-black/5 text-black/50 border-black/15' },
  review:      { label: 'In Prüfung', short: 'P', dark: 'bg-amber-500/15 text-amber-300 border-amber-500/30',       light: 'bg-amber-50 text-amber-700 border-amber-300' },
  final:       { label: 'Final',      short: 'F', dark: 'bg-blue-500/15 text-blue-300 border-blue-500/30',          light: 'bg-blue-50 text-blue-700 border-blue-300' },
  implemented: { label: 'Umgesetzt',  short: 'U', dark: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', light: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  // Abgenommen ist der Endzustand — deshalb gefüllt statt getönt
  accepted:    { label: 'Abgenommen', short: 'A', dark: 'bg-emerald-500/80 text-black border-emerald-400',           light: 'bg-emerald-600 text-white border-emerald-700' },
  changed:     { label: 'Angepasst',  short: '~', dark: 'bg-rose-500/15 text-rose-300 border-rose-500/30',          light: 'bg-rose-50 text-rose-700 border-rose-300' },
};

// ── Schritte ─────────────────────────────────────────────────────────────────
export type StepKind =
  | 'start' | 'end'
  | 'service' | 'user' | 'call' | 'send' | 'receive' | 'rule' | 'script' | 'manual'
  | 'subprocess'
  | 'gateway'          // exklusiv / parallel / ereignisbasiert (siehe gatewayType)
  | 'event'            // Zwischenereignis (werfend/fangend, Timer, Signal, Message)
  | 'goto';            // Rücksprung (Schleife) auf einen bereits gezeigten Schritt

export type GatewayType = 'exclusive' | 'parallel' | 'inclusive' | 'eventBased';

// Ein Mapping-Eintrag: Prozessvariable ↔ Service-Parameter.
// `expression` ist der Camunda-Ausdruck (z. B. `${renterClientKey}`),
// `description` die fachliche Bedeutung für die Stakeholder.
export interface Mapping {
  name: string;
  expression: string;
  description?: string;
  /** kommt in diesem Prozess nicht vor — bleibt stehen, zählt aber nicht */
  disabled?: boolean;
  [key: string]: unknown;
}

// Wiederholung: der Schritt/Block wird erneut ausgeführt, solange `condition`
// gilt — im MKK-Muster «wait ${timer}» + «Tried ${max} times?».
export interface LoopSpec {
  condition: string;      // fachliche Bedingung für die Wiederholung
  maxAttempts?: string;   // z. B. `${maxOpenAccount}`
  waitFor?: string;       // z. B. `${timerWaitOpenAccount}`
}

// Ein Gateway-Zweig. `steps` ist der Block bis zur Zusammenführung.
export interface Branch {
  id: string;
  label: string;          // z. B. «ja» / «nein» / «severalMatches»
  condition?: string;     // technischer Ausdruck aus dem BPMN
  isDefault?: boolean;
  steps: Step[];
  [key: string]: unknown;
}

// Fehlerbehandlung eines Schritts (Boundary-Event bzw. `_handledErrors`).
export interface ErrorHandling {
  code: string;           // z. B. `account-not-opened`, `404`
  label?: string;
  interrupting?: boolean;
  /** steht in `_handledErrors` des Schritts */
  declared?: boolean;
  /** kommt von einem Boundary-Event — Code und Pfad stehen im Diagramm */
  boundary?: boolean;
  /** kein Fehler, sondern ein nicht-unterbrechender Nebenpfad am Schritt */
  side?: boolean;
  steps?: Step[];         // Behandlungspfad
  [key: string]: unknown;
}

export interface Step {
  id: string;             // stabil; bei Import die BPMN-Element-ID
  kind: StepKind;
  name: string;
  status: Status;
  /** fachliche Beschreibung (Markdown) — das, was die Stakeholder lesen */
  description?: string;
  /** technische Notiz (Markdown) — für die Umsetzung */
  notes?: string;

  // Service-/Worker-Anbindung
  serviceId?: string;     // Katalog-Eintrag (= Camunda modelerTemplate)
  topic?: string;         // externes Topic, wenn kein Katalog-Service
  calledProcess?: string; // bei kind 'call': gerufener Prozess

  inputs?: Mapping[];
  outputs?: Mapping[];
  errors?: ErrorHandling[];
  mock?: string;          // `_outputMock` / Beispielantwort (JSON)

  // Struktur
  gatewayType?: GatewayType;
  branches?: Branch[];    // bei kind 'gateway'
  children?: Step[];      // bei kind 'subprocess'
  loop?: LoopSpec;
  gotoId?: string;        // bei kind 'goto': Ziel-Schritt
  back?: boolean;         // bei kind 'goto': Rücksprung (Schleife) statt Zusammenlauf

  /** Block hängt an keinem Sequenzfluss (Ereignis-Subprozess, Link-Ziel …) */
  orphan?: boolean;
  /** Subprozess, der durch ein Ereignis ausgelöst wird (triggeredByEvent) */
  eventSubprocess?: boolean;

  // Ereignisse
  eventKind?: 'timer' | 'signal' | 'message' | 'error' | 'escalation' | 'none';
  eventDirection?: 'throw' | 'catch';

  /** offene fachliche Fragen zu diesem Schritt */
  open?: string;

  // ── Weitere Angaben, die die Spezifikation festlegt ──────────────────────
  /** Benutzeraufgabe: wer sie sieht (`camunda:candidateGroups`) */
  candidateGroups?: string;
  /** Benutzeraufgabe: wem sie direkt zugeteilt ist (`camunda:assignee`) */
  assignee?: string;

  [key: string]: unknown;
}

// ── Datenmodell (Klassenbauer) ───────────────────────────────────────────────
//
// Beschreibt die fachlichen Typen des Prozesses — allen voran das **In** des
// Prozesses. Bewusst NICHT dabei: `InConfig` und `InitIn`. Das sind
// Implementations-Details (Mock-Steuerung, initialisierte Prozessvariablen)
// und gehören nicht in die Spezifikation.
//
// Aus diesen Typen erzeugt `src/scala.ts` die Orchescala-Domain (case class +
// Companion mit ApiSchema/InOutCodec/example/exampleMinimal).

/** Skalare Typen, die Orchescala direkt kennt. */
export const SCALA_TYPES = [
  'String', 'Boolean', 'Int', 'Long', 'Double', 'BigDecimal',
  'LocalDate', 'LocalDateTime', 'Iso8601Duration', 'Iban',
] as const;
export type ScalaType = (typeof SCALA_TYPES)[number];

/** Vorlagen für Iron-Refinements (`String :| ValidEmail`). `arg` = Platzhalter. */
export interface ConstraintTemplate {
  id: string;
  label: string;
  /** Ausdruck; `N` bzw. `X` wird durch den eingegebenen Wert ersetzt */
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
  /** stabil — Umbenennen bricht keine Verweise */
  id: string;
  name: string;
  /** ein `ScalaType` oder die id eines eigenen Typs */
  type: string;
  /** Option[T] — fehlen darf */
  optional?: boolean;
  /** Seq[T] — mehrfach */
  collection?: boolean;
  /** Iron-Refinement, z. B. `ValidEmail` → `String :| ValidEmail` */
  constraint?: string;
  /** Vorgabewert als Scala-Ausdruck, z. B. `"CH"` oder `Seq.empty` */
  default?: string;
  /** Beispielwert als Scala-Ausdruck — ohne Angabe leitet die App einen ab */
  example?: string;
  /** fachliche Bedeutung → `@description(...)` */
  description?: string;
  [key: string]: unknown;
}

export interface EnumValue {
  name: string;
  description?: string;
  [key: string]: unknown;
}

// ── Interaktionen ────────────────────────────────────────────────────────────
//
// Jede Stelle, an der der Prozess mit aussen spricht, hat in der Domain ein
// eigenes Objekt mit eigenem `In` und/oder `Out`:
//
//   object KubeDepotUnlockUT      extends CompanyBpmnUserTaskDsl     · val name
//   object EvalNextPortfolioIdSuffix extends CompanyBpmnCustomTaskDsl · val topicName
//   object CancelOpenPensionAccountSE extends CompanyBpmnSignalEventDsl · val messageName
//
// Der Scala-Objektname lässt sich nicht aus dem BPMN ableiten (die Aufgabe
// heisst dort `DepotActivityUnlockKUBETask`, das Objekt `KubeDepotUnlockUT`) —
// er wird deshalb hier geführt.
export type InteractionKind = 'userTask' | 'customTask' | 'signal' | 'message';

export const INTERACTION_META: Record<InteractionKind, {
  label: string; dsl: string; keyName: string; factory: string; suffix: string; hasOut: boolean;
}> = {
  userTask:   { label: 'Benutzeraufgabe', dsl: 'CompanyBpmnUserTaskDsl',     keyName: 'name',        factory: 'userTask',    suffix: 'UT', hasOut: true },
  customTask: { label: 'Eigener Worker',  dsl: 'CompanyBpmnCustomTaskDsl',   keyName: 'topicName',   factory: 'customTask',  suffix: '',   hasOut: true },
  signal:     { label: 'Signal',          dsl: 'CompanyBpmnSignalEventDsl',  keyName: 'messageName', factory: 'signalEvent', suffix: 'SE', hasOut: false },
  message:    { label: 'Nachricht',       dsl: 'CompanyBpmnMessageEventDsl', keyName: 'messageName', factory: 'messageEvent', suffix: 'ME', hasOut: false },
};

export interface Interaction {
  id: string;
  /** Schritt im Ablauf (BPMN-Element-ID) */
  stepId: string;
  kind: InteractionKind;
  /** Scala-Objekt, z. B. `KubeDepotUnlockUT` */
  name: string;
  /** Wert für `name` / `topicName` / `messageName` */
  key: string;
  descr?: string;
  status?: Status;
  /** ids der TypeDefs für In und Out */
  inTypeId?: string;
  outTypeId?: string;
  [key: string]: unknown;
}

export interface TypeDef {
  id: string;
  /** Scala-Name, z. B. `In`, `InAddress`, `ClientLanguage` */
  name: string;
  kind: 'case' | 'enum';
  description?: string;
  status?: Status;
  /** das `In` des Prozesses — liegt im Prozess-Objekt, nicht in `schema/` */
  root?: boolean;
  /** das `Out` des Prozesses */
  processOut?: boolean;
  /** gehört zu einer Interaktion — liegt in deren Objekt, nicht in `schema/` */
  interactionId?: string;
  /** das `InitIn` — Felder kommen aus dem Init-Worker, Typen werden gepflegt */
  initIn?: boolean;
  fields?: Field[];   // kind 'case'
  values?: EnumValue[]; // kind 'enum'
  [key: string]: unknown;
}

// ── Prozess-Spezifikation (processes/<slug>.json) ────────────────────────────
export interface Variable {
  name: string;
  type?: string;
  description?: string;
  example?: string;
  [key: string]: unknown;
}

/**
 * Ein Kommentar-Faden — wie in Confluence: ein Beitrag, Antworten darunter,
 * und irgendwann als erledigt abgehakt. Erledigte bleiben stehen; wer später
 * dazukommt, soll sehen, was besprochen wurde.
 */
export interface CommentThread {
  id: string;
  /** worauf er sich bezieht: `process`, `step:<id>` oder `type:<id>` */
  target: string;
  resolved?: boolean;
  entries: CommentEntry[];
  [key: string]: unknown;
}

export interface CommentEntry {
  id: string;
  author: string;
  /** ISO-Zeitpunkt mit Zone */
  at: string;
  text: string;
}

export interface ProcessSpec {
  /** für welche Engine dieser Prozess gebaut ist */
  engine?: EngineId;
  /** Kommentare zu Prozess, Elementen und Datentypen */
  comments?: CommentThread[];
  version: number;
  slug: string;
  /** technischer Prozessname inkl. Version, z. B. `openMkkV1` */
  name: string;
  /** fachlicher Titel, z. B. «Mietkautionskonto eröffnen» */
  title: string;
  /** BPMN-Prozess-ID, z. B. `valiant-mkk-openMkkV1` */
  processId?: string;
  /** Orchescala-Projekt, z. B. `valiant-mkk` */
  project?: string;
  status: Status;
  /** Ausgangslage / Ziel (Markdown) */
  description?: string;
  /** Link auf die Confluence-Seite, aus der die Spez. stammt */
  sourceUrl?: string;
  /** wie lange die Historie aufbewahrt wird (`camunda:historyTimeToLive`, Tage) */
  timeToLive?: string;
  createdAt: string;
  updatedAt: string;
  variables?: Variable[];
  /** Datenmodell: das In des Prozesses und seine Typen (Klassenbauer) */
  types?: TypeDef[];
  /** Interaktionen: Benutzeraufgaben, eigene Worker, Signale */
  interactions?: Interaction[];
  /**
   * Ausgaben des Init-Workers. Der Schritt selbst steht **nicht** im Ablauf —
   * er ist Verdrahtung (in Camunda 8 womöglich ein Listener) und wird nicht
   * beschrieben. Seine Ausgaben sind aber die Felder des `InitIn`.
   */
  initOutputs?: Mapping[];
  steps: Step[];
  [key: string]: unknown;
}

// ── Service-Katalog (model.json) ─────────────────────────────────────────────
// Ein Katalog-Eintrag entspricht einem Camunda **element-template**: Name,
// Topic und das vorbereitete Mapping. Wird ein Service an einem Schritt
// gewählt, übernimmt die App Ein-/Ausgaben als Vorlage.
export interface ServiceParam {
  name: string;
  expression?: string;    // Vorgabe — aus dem Template bzw. `#{name}`
  description?: string;
  required?: boolean;
  [key: string]: unknown;
}

export interface ServiceDef {
  id: string;             // = element-template id / modelerTemplate
  name: string;
  /**
   * Eintrag stammt aus der mitgelieferten `catalog.generated.json` (Teil des
   * App-Builds, bei jedem Release neu erzeugt). Wird nie in die `model.json`
   * geschrieben — der Katalog ist nicht vom Benutzer pflegbar.
   */
  generated?: boolean;
  group?: string;         // z. B. `valiant-graviton`
  description?: string;
  topic?: string;
  kind?: StepKind;        // 'service' (Worker), 'call' (Prozess), 'user' (Benutzeraufgabe)
  inputs?: ServiceParam[];
  outputs?: ServiceParam[];
  handledErrors?: string[];
  /** bei Teilprozessen der gerufene Prozess (`calledElement`) */
  calledProcess?: string;
  docUrl?: string;
  [key: string]: unknown;
}

// ── Domain-Katalog ───────────────────────────────────────────────────────────
// Die Typen der Service-Projekte, aus deren Scala-Quellen eingelesen: die
// Objekte im `schema/`-Ordner ebenso wie die `In` / `Out` der Services.
// Wird der Katalog exportiert, lässt er sich dort einlesen, wo die Quellen
// nicht liegen (z. B. in der Bankenzone).
/** Ein Feld eines Domain-Typs — so, wie es in Scala steht. */
export interface DomainField {
  name: string;
  /** voller Typausdruck, z. B. `Option[Seq[InPerson]]` */
  type: string;
  default?: string;
  description?: string;
  [key: string]: unknown;
}

export interface DomainType {
  /** voll qualifiziert, z. B. `valiant.graviton.domain.account.v1.GetAccount.Out` */
  id: string;
  /** aus der mitgelieferten `catalog.generated.json` — siehe ServiceDef.generated */
  generated?: boolean;
  /** Scala-Typ, z. B. `GetAccount.Out` oder `InAddress` */
  name: string;
  pkg: string;
  /** `member` = In/Out eines Services (kommt aus dem Trait), `alias` = `type X = …` */
  kind: 'case' | 'enum' | 'member' | 'alias';
  /** umschliessendes Objekt bei `In` / `Out` */
  owner?: string;
  /** was importiert werden muss (bei Membern das Objekt) */
  importPath: string;
  fields?: DomainField[];
  values?: string[];
  descr?: string;
  /**
   * `val processName` eines Prozess-Objekts, z. B. `valiant-addresschange`.
   * Damit findet ein BPMN-Prozess seine Domain, ohne dass Paket und
   * Objektname aus der ID geraten werden müssen.
   */
  processName?: string;
  /** `val topicName` eines Worker-Objekts — dasselbe für Service-Tasks */
  topicName?: string;
  /** Herkunft (Datei) — nur zur Nachvollziehbarkeit */
  source?: string;
  [key: string]: unknown;
}

/**
 * Die Engine, für die ein Prozess gebaut ist. Zu jeder gehört eine Vorlage
 * unter `public/templates/` (siehe `template.ts`).
 */
export type EngineId = 'c7' | 'c8';

/** Ein Projekt-Ordner im Katalog. */
export interface ProjectFolder {
  /** stabil über Umsortieren hinweg; zugleich Schlüssel des Ordner-Zugriffs */
  id: string;
  /** Ordnername, z. B. `swisscom-fil-is` */
  name: string;
  /**
   * absoluter Pfad — nur das CLI kennt ihn. Im Browser gibt der Ordnerwähler
   * keinen Pfad heraus; dort führt der gemerkte Zugriff zum Ordner zurück.
   */
  path?: string;
  /** Zahl der Typen aus diesem Projekt beim letzten Aufbau */
  types?: number;
  [key: string]: unknown;
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
  /** Name des Kunden — steht links in der Kopfzeile */
  company?: string;
  /**
   * Logo des Kunden als Data-URI. Es liegt in der `model.json`, damit es
   * überall mitkommt — im geteilten Ordner wie in SharePoint, ohne zweite
   * Datei und ohne Adresse, die von aussen erreichbar sein müsste.
   */
  logo?: string;
  auth?: AuthSettings;
  /** Service-Katalog mit vorbereitetem Mapping */
  services: ServiceDef[];
  /** Domain-Katalog: die Typen der Service-Projekte */
  domainTypes?: DomainType[];
  /** zuletzt eingelesene Quellordner — als Gedächtnisstütze im Admin */
  domainSources?: string[];
  /**
   * Die Projekt-Ordner des Domain-Katalogs — **die Reihenfolge ist der
   * Vorrang**. Liegt dasselbe Paket in mehreren Projekten
   * (`swisscom.fil.is.domain.client` und `valiant.fil.is.domain.client`),
   * gilt das weiter oben stehende; das andere wird verworfen.
   */
  projects?: ProjectFolder[];
  [key: string]: unknown;
}
