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
/**
 * In der Reihenfolge des Fortschritts — «Angepasst» (technisch geändert, nach
 * «Final») steht vor «Umgesetzt»: der kleinste Status ist der Stand des Ganzen
 * (siehe overallStatus).
 */
export const STATUSES = ['draft', 'review', 'final', 'changed', 'implemented', 'accepted'] as const;
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
  /**
   * Ausgabe des Services unter ihrem eigenen Namen (`x = x`), aus
   * `_outputVariables` bzw. dem Katalog — angehakt heisst «der Prozess braucht
   * sie»: ein Eintrag in `_outputVariables`, kein Output-Parameter
   */
  fromService?: boolean;
  [key: string]: unknown;
}

// Wiederholung: der Schritt/Block wird erneut ausgeführt, solange `condition`
// gilt — im Sparkonto-Muster «wait ${timer}» + «Tried ${max} times?».
export interface LoopSpec {
  condition: string;      // fachliche Bedingung für die Wiederholung
  maxAttempts?: string;   // z. B. `${maxOpenAccount}`
  waitFor?: string;       // z. B. `${timerWaitOpenAccount}`
}

// Mehrfachausführung (Multi-Instance): der Schritt läuft je Element einer
// Sammlung. Gelesen aus dem BPMN; die Namen gelten im Schritt und in allem,
// was darin liegt (FEEL kennt dort `loopCounter` und das Element).
export interface MultiInstanceSpec {
  /** FEEL-Ausdruck der Sammlung ohne `=`, z. B. `order.items` */
  collection?: string;
  /** Name der Variable für das aktuelle Element (`inputElement` bzw. `elementVariable`) */
  element?: string;
  sequential?: boolean;
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
  /** gehört zu einem Pattern (dessen id) — Verdrahtung, keine eigene Fachlichkeit */
  pattern?: string;
  steps?: Step[];         // Behandlungspfad
  [key: string]: unknown;
}

/** Form eines DMN-Ergebnisses — wie `camunda:mapDecisionResult` bzw. die Fabrik im Domain-Objekt */
export type DecisionResult = 'singleEntry' | 'singleResult' | 'collectEntries' | 'resultList';

export interface Step {
  id: string;             // stabil; bei Import die BPMN-Element-ID
  kind: StepKind;
  name: string;
  status: Status;
  /** fachliche Beschreibung (Markdown) — das, was die Stakeholder lesen */
  description?: string;

  // Service-/Worker-Anbindung
  serviceId?: string;     // Katalog-Eintrag (= Camunda modelerTemplate)
  topic?: string;         // externes Topic, wenn kein Katalog-Service
  calledProcess?: string; // bei kind 'call': gerufener Prozess

  inputs?: Mapping[];
  outputs?: Mapping[];
  /** gewählte Ausprägung des Service-`In` bzw. `Out`, wenn es ein enum mit Fällen ist (siehe variants.ts) */
  inVariant?: string;
  outVariant?: string;
  errors?: ErrorHandling[];
  /** reguläre Ausdrücke für weitere behandelte Fehlercodes — `_regexHandledErrors` */
  regexHandledErrors?: string[];
  mock?: string;          // `_outputMock` / Beispielantwort (JSON)
  /**
   * Womit sich der Schritt in Tests mocken lässt: `output` = `_outputMock`
   * (das Ergebnis des Workers bzw. Teilprozesses), `service` = `_outputServiceMock`
   * (die Antwort des Services, nur bei Service-Workern). Ohne Wahl reicht der
   * Schritt `_servicesMocked` weiter. Beim Export entsteht das Feld im `InConfig`.
   */
  mockKind?: 'output' | 'service';
  /**
   * Entscheidung (DMN): in welche Prozessvariable das Ergebnis geht
   * (`camunda:resultVariable` bzw. `zeebe:calledDecision resultVariable`) …
   */
  resultVariable?: string;
  /**
   * … und in welcher Form (`camunda:mapDecisionResult`): ein Wert
   * (`singleEntry`), ein Objekt (`singleResult`), eine Liste von Werten
   * (`collectEntries`) oder von Objekten (`resultList`, Vorgabe in Camunda 7).
   */
  /**
   * `_outputVariables` aus dem BPMN — die Variablen, die der Service liefert
   * und der Prozess braucht. Daraus werden beim Import die Ausgaben bzw. die
   * angehakten Zeilen (siehe withServiceRows).
   */
  outputVariables?: string[];
  /**
   * Service aus dem BPMN: hatte er `_manualOutMapping`? `false` — der Worker
   * setzt seine Ausgaben selbst als Prozessvariablen (`_outputVariables`
   * filtert); `true` — sie kommen lokal zurück, die Output-Parameter mappen.
   * Der Export behält die Art. Fehlt die Angabe (in der Spezifikation
   * angelegt), wird bei Ausgaben von Hand gemappt.
   */
  manualOutMapping?: boolean;
  decisionResult?: DecisionResult;

  // Struktur
  gatewayType?: GatewayType;
  branches?: Branch[];    // bei kind 'gateway'
  children?: Step[];      // bei kind 'subprocess'
  loop?: LoopSpec;
  /** Mehrfachausführung — der Schritt läuft je Element einer Sammlung */
  multiInstance?: MultiInstanceSpec;
  gotoId?: string;        // bei kind 'goto': Ziel-Schritt
  back?: boolean;         // bei kind 'goto': Rücksprung (Schleife) statt Zusammenlauf

  /** Block hängt an keinem Sequenzfluss (Ereignis-Subprozess, Link-Ziel …) */
  orphan?: boolean;
  /** Subprozess, der durch ein Ereignis ausgelöst wird (triggeredByEvent) */
  eventSubprocess?: boolean;

  // Ereignisse
  eventKind?: 'timer' | 'signal' | 'message' | 'error' | 'escalation' | 'none';
  eventDirection?: 'throw' | 'catch';
  /** Name des Signals bzw. der Nachricht (`<bpmn:signal name>` / `<bpmn:message name>`) */
  messageName?: string;


  // ── Weitere Angaben, die die Spezifikation festlegt ──────────────────────
  // Benutzeraufgabe — wie die Mappings: mit `=` FEEL, sonst fester Text;
  // im BPMN für Camunda 7 `camunda:…` (`${…}`), für Camunda 8 `zeebe:assignmentDefinition`
  /** Benutzeraufgabe: wer sie sieht (`candidateGroups`) */
  candidateGroups?: string;
  /** Benutzeraufgabe: welche Personen sie sehen (`candidateUsers`) */
  candidateUsers?: string;
  /** Benutzeraufgabe: wem sie direkt zugeteilt ist (`assignee`) */
  assignee?: string;

  // ── Pattern ──────────────────────────────────────────────────────────────
  /** Pattern an diesem Element — aus dem BPMN erkannt bzw. hier gewählt */
  patterns?: AppliedPattern[];
  /** Schritt gehört selbst zu einem Pattern (dessen id): ein gemeinsamer Block */
  pattern?: string;

  [key: string]: unknown;
}

// ── Pattern ──────────────────────────────────────────────────────────────────
//
// Ein Pattern ist ein wiederkehrender BPMN-Baustein — «Benutzer per Mail
// informieren», «Eskalation», «Prozess-Event senden». Der Admin legt es als
// kleines BPMN an: ein **Anker** (`PatternTarget`, z. B. eine Benutzeraufgabe)
// mit allem, was an ihm hängt (Listener, Eingaben, Boundary-Ereignisse samt
// Pfad), und daneben Blöcke, die der Prozess **einmal** braucht (Link-Ziel →
// Call Activity, Ereignis-Subprozess). Werte, die je Einsatz wechseln,
// stehen als `{{name}}` darin — das sind die Parameter.
//
// Aus demselben BPMN folgt alles Weitere: wählen fügt es ein (src/patterns.ts),
// der Import erkennt es wieder, entfernen nimmt es heraus.

/** Parameter eines Patterns — im BPMN als `{{name}}` */
export interface PatternParam {
  name: string;
  label?: string;
  description?: string;
  /** Vorgabe beim Einfügen */
  default?: string;
  [key: string]: unknown;
}

export interface PatternDef {
  /** stabil, z. B. `inform-user` — steht in den Spezifikationen */
  id: string;
  name: string;
  /** was es tut und wann man es nimmt (Markdown) */
  description?: string;
  /** Doku, z. B. die Pattern-Seite */
  docUrl?: string;
  /**
   * BPMN-Elementtypen, an die es passt (`userTask`, `callActivity` …) —
   * `process` heisst: am Prozess selbst. Vorgabe ist der Typ des Ankers.
   */
  appliesTo: string[];
  params?: PatternParam[];
  /** das Pattern als BPMN, je Engine */
  bpmn: Partial<Record<EngineId, string>>;
  /**
   * Weitere Schreibweisen desselben Patterns (je Engine) — die Erkennung
   * nimmt sie auch an, eingefügt wird immer `bpmn`. Für ältere Prozesse, die
   * dasselbe anders ausdrücken (Groovy-Skript statt Ausdruck).
   */
  variants?: Partial<Record<EngineId, string[]>>;
  /**
   * Wo das Pattern am Schritt steht. `assignment`: es legt die Zuständigkeit
   * fest (z. B. ein Task-Listener, der den Berater zuweist) — es steht unter
   * «Zuständigkeit», und Gruppen/Person sind dann nicht editierbar.
   */
  area?: 'assignment';
  /**
   * Fest in Orchescala, nicht im Admin gepflegt und nicht im BPMN — seine
   * Werte stehen in der Spezifikation (siehe ORCHESCALA_PATTERNS).
   */
  builtin?: boolean;
  [key: string]: unknown;
}

/** Ein Pattern an einem Element (bzw. am Prozess) */
export interface AppliedPattern {
  id: string;
  /** Werte der Parameter */
  params?: Record<string, string>;
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
  'LocalDate', 'LocalDateTime', 'Instant', 'Iso8601Duration', 'Iban',
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
  /** Map[String, T] — Schlüssel ist im JSON immer ein Text, `type` ist der Wert */
  map?: boolean;
  /**
   * Eine einzelne **Ausprägung** eines ADT-enums als Typ: `type` ist das enum,
   * `enumCase` der Fall — in Scala `CustomDocContents.\`QI-Deklaration\``.
   */
  enumCase?: string;
  /** Iron-Refinement, z. B. `ValidEmail` → `String :| ValidEmail` */
  constraint?: string;
  /** Vorgabewert als Scala-Ausdruck, z. B. `"CH"` oder `Seq.empty` */
  default?: string;
  /** Beispielwert als Scala-Ausdruck — ohne Angabe leitet die App einen ab */
  example?: string;
  /**
   * Aus der Domain: die Imports, die das Beispiel braucht — so, wie sie in
   * der Datei stehen (`swisscom.fil.is.domain.defaultValidUntil`); leer, wenn
   * die Werte ohne Import sichtbar waren (Firmen-Bibliothek, eigenes Paket)
   */
  exampleImports?: string[];
  /** fachliche Bedeutung → `@description(...)` */
  description?: string;
  /**
   * `@description` aus der Domain, das kein reiner Text ist — eine Referenz
   * (`clientKeyDescr`), ein Aufruf oder `s"…${x}"`. Der Export schreibt ihn
   * wörtlich; `description` ist dann nur die lesbare Fassung. Wer die
   * Beschreibung ändert, ersetzt ihn.
   */
  descriptionExpr?: string;
  /**
   * Die Imports, die `descriptionExpr` braucht — aus der Datei der Domain:
   * `valiant.bpmn.domain.sendProcessEvent.v1.SendProcessEvent` für
   * `s"…${SendProcessEvent.processName}…"`, `…Escalation.*` für `timerStartEscalationDescr`
   */
  descriptionImports?: string[];
  [key: string]: unknown;
}

/**
 * Ein Wert einer Auswahl. Trägt er Felder, ist die Auswahl ein **ADT**
 * (`enum In: case Standard(…) case VermoegensVerwaltung(…)`) — jeder Fall
 * eine eigene Klasse, gemeinsam ein Typ.
 */
export interface EnumValue {
  name: string;
  description?: string;
  fields?: Field[];
  [key: string]: unknown;
}

/**
 * Auswahl mit Feldern (ADT)? Entweder tragen die Fälle Felder, oder die
 * Auswahl hat **gemeinsame Felder** (`fields`) — in Scala 3 als `def` im
 * enum-Rumpf, die jeder Fall mitbringt.
 */
export const isAdt = (t: { kind: string; values?: EnumValue[]; fields?: Field[] }): boolean =>
  t.kind === 'enum' && ((t.values ?? []).some(v => !!v.fields?.length) || !!t.fields?.length);

// ── Interaktionen ────────────────────────────────────────────────────────────
//
// Jede Stelle, an der der Prozess mit aussen spricht, hat in der Domain ein
// eigenes Objekt mit eigenem `In` und/oder `Out`:
//
//   object AdvisorDepotUnlockUT      extends CompanyBpmnUserTaskDsl     · val name
//   object EvalNextPortfolioIdSuffix extends CompanyBpmnCustomTaskDsl · val topicName
//   object CancelOpenPensionAccountSE extends CompanyBpmnSignalEventDsl · val messageName
//
// Der Scala-Objektname lässt sich nicht aus dem BPMN ableiten (die Aufgabe
// heisst dort `DepotActivityUnlockAdvisorTask`, das Objekt `AdvisorDepotUnlockUT`) —
// er wird deshalb hier geführt.
export type InteractionKind = 'userTask' | 'customTask' | 'signal' | 'message' | 'decision';

export const INTERACTION_META: Record<InteractionKind, {
  label: string; dsl: string; keyName: string; factory: string; suffix: string; hasOut: boolean;
}> = {
  userTask:   { label: 'Benutzeraufgabe', dsl: 'CompanyBpmnUserTaskDsl',     keyName: 'name',        factory: 'userTask',    suffix: 'UT', hasOut: true },
  customTask: { label: 'Eigener Worker',  dsl: 'CompanyBpmnCustomTaskDsl',   keyName: 'topicName',   factory: 'customTask',  suffix: '',   hasOut: true },
  signal:     { label: 'Signal',          dsl: 'CompanyBpmnSignalEventDsl',  keyName: 'messageName', factory: 'signalEvent', suffix: 'SE', hasOut: false },
  message:    { label: 'Nachricht',       dsl: 'CompanyBpmnMessageEventDsl', keyName: 'messageName', factory: 'messageEvent', suffix: 'ME', hasOut: false },
  // die Fabrik hängt an der Ergebnisform (`decisionResult`, siehe dmnFactory in scala.ts)
  decision:   { label: 'DMN Decision',    dsl: 'CompanyBpmnDecisionDsl',     keyName: 'decisionId',  factory: 'singleResult', suffix: 'Dmn', hasOut: true },
};

export interface Interaction {
  id: string;
  /** Schritt im Ablauf (BPMN-Element-ID) */
  stepId: string;
  kind: InteractionKind;
  /** Scala-Objekt, z. B. `AdvisorDepotUnlockUT` */
  name: string;
  /** Wert für `name` / `topicName` / `messageName` */
  key: string;
  descr?: string;
  /** `val descr` aus der Domain, das kein reiner Text ist (`s"…${X.processName}…"`) — wörtlich im Export */
  descrExpr?: string;
  /** die Imports, die `descrExpr` braucht */
  descrImports?: string[];
  status?: Status;
  /** ids der TypeDefs für In und Out */
  inTypeId?: string;
  outTypeId?: string;
  /**
   * In bzw. Out ist ein anderer Typ (`type In = OrderCardUT.In`): das Mitglied
   * einer anderen Interaktion (`<id>.In`, `<id>.Out`) oder ein Typ der Domain
   * (`dom:<id>`). Die Felder stehen weiter über `inTypeId`/`outTypeId` bereit
   * (Mappings, Prüfungen); der Alias bestimmt nur, was der Export schreibt.
   */
  inAlias?: string;
  outAlias?: string;
  /**
   * Abweichende Werte im Beispiel der Interaktion — je Feld der Scala-Ausdruck:
   * `userTask(OrderCardUT.In.example.copy(clientKeyIsIdentityOk = false), …)`
   */
  inExample?: Record<string, string>;
  outExample?: Record<string, string>;
  /**
   * DMN Decision: die Form des Ergebnisses — `singleEntry` (ein einfacher
   * Wert), `singleResult` (ein Objekt), `collectEntries` (Liste einfacher
   * Werte), `resultList` (Liste von Objekten). Bei einem einfachen Wert hat
   * das `Out` genau ein Feld, dessen Typ der Wert ist. Ohne Angabe `singleResult`.
   */
  decisionResult?: DecisionResult;
  /**
   * DMN Decision mit eigener Tabelle: der Dateiname im Projekt
   * (`src/main/resources/camunda[8]/…`) — gesetzt, sobald die App die Tabelle
   * führt (`processes/<slug>/<decisionId>.dmn`, siehe dmn.ts)
   */
  dmnFile?: string;
  /**
   * Package des Domain-Objekts, wenn die Interaktion eines aus dem Katalog ist
   * (über ihren Schlüssel gefunden, siehe `interactionOrigin`) — ein fremdes
   * Package heisst: referenziert, wird nicht exportiert. Fehlt bei einer neuen.
   */
  pkg?: string;
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
  /** steht im Prozess-Objekt selbst (wie `OrderCard.CustomProcessStatus`) — der Export schreibt es dorthin, nicht nach `schema/` */
  inProcessObject?: boolean;
  /**
   * aus welchem Domain-Typ der Import die Klasse übernommen hat (`…orderCard.v1.schema.DueDateSpec`) —
   * sie gehört zum Prozess, auch wenn ein älterer Katalog sie noch anderswo führt
   */
  domainId?: string;
  /** das `InitIn` — Felder kommen aus dem Init-Worker, Typen werden gepflegt */
  initIn?: boolean;
  /**
   * das `InConfig` — die eigenen Stellschrauben des Prozesses; Schleifen und
   * Mocks kommen beim Erzeugen aus dem Ablauf dazu
   */
  inConfig?: boolean;
  /** Felder der Klasse — bei einer Auswahl (ADT) die **gemeinsamen** Felder aller Fälle */
  fields?: Field[];
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
  /**
   * worauf er sich bezieht: ein Element (`process`, `step:<id>`, `ia:<id>`,
   * `type:<id>`) oder ein Teil davon (`step:<id>#in:<name>` …, siehe comments.ts)
   */
  target: string;
  /**
   * wie die Stelle hiess, als es sie noch gab — ein Abgleich, der sie
   * entfernt, merkt sich das; das Panel zeigt den Faden unter «Ohne Stelle»
   */
  place?: string;
  resolved?: boolean;
  /** wer abgehakt hat, und wann */
  resolvedBy?: string;
  resolvedAt?: string;
  entries: CommentEntry[];
  [key: string]: unknown;
}

export interface CommentEntry {
  id: string;
  author: string;
  /** E-Mail der Autorin/des Autors — nur mit Anmeldung; Empfänger für Teams bei Antworten */
  email?: string;
  /** ISO-Zeitpunkt mit Zone */
  at: string;
  text: string;
  /** per «@» erwähnte Personen (im Text steht «@Name») */
  mentions?: DirectoryUser[];
  /**
   * Teams-Benachrichtigung (siehe Model.notifications.teams): E-Mails der
   * Personen, die noch zu benachrichtigen sind bzw. schon benachrichtigt
   * wurden. Verschickt wird nur vom Browser der Autorin/des Autors.
   */
  notifyPending?: string[];
  notified?: string[];
  /**
   * Reaktionen (👍 ❤️ …): je Emoji die Personen, die so reagiert haben —
   * nochmals klicken nimmt die eigene zurück (siehe toggleReaction)
   */
  reactions?: Record<string, { name: string; email?: string }[]>;
}

/**
 * Bekannte Person für @-Erwähnungen: aus `users.json` im geteilten Ordner
 * (jede angemeldete Person trägt sich beim Öffnen ein) oder aus der
 * Entra-Suche (Microsoft Graph, Berechtigung User.ReadBasic.All).
 */
export interface DirectoryUser {
  name: string;
  email: string;
  /** ISO — nur in users.json */
  lastSeen?: string;
}

export interface UsersFile {
  version: number;
  users: DirectoryUser[];
}

/**
 * Teams-Benachrichtigung bei @-Erwähnung und bei Antworten auf den eigenen
 * Kommentar: die kommentierende Person schickt der erwähnten über Microsoft
 * Graph eine persönliche Chat-Nachricht (1:1-Chat, mit echtem @-Mention und
 * Link in die App) — nach einer Wartezeit, gesammelt, einmalig.
 * Berechtigungen (delegiert): Chat.Create, ChatMessage.Send, User.ReadBasic.All.
 */
export interface TeamsNotifySettings {
  enabled: boolean;
  /** Wartezeit nach dem letzten Kommentar in Minuten (Standard 5) */
  delayMinutes?: number;
  /** Platzhalter: {{empfaenger}} {{von}} {{prozess}} {{anzahl}} {{kommentare}} {{link}} */
  template?: string;
}

/** Die Bezeichnung des Prozesses je Sprache — `ProcessLabels(de, fr)` in Orchescala */
export interface ProcessLabels { de: string; fr: string }

export interface ProcessSpec {
  /** für welche Engine dieser Prozess gebaut ist */
  engine?: EngineId;
  /** Kommentare zu Prozess, Elementen und Datentypen */
  comments?: CommentThread[];
  version: number;
  slug: string;
  /** technischer Prozessname inkl. Version, z. B. `openSavingsV1` */
  name: string;
  /** fachlicher Titel, z. B. «Sparkonto eröffnen» */
  title: string;
  /** BPMN-Prozess-ID, z. B. `globex-savings-openSavingsV1` */
  processId?: string;
  /** `override def processLabels` des Prozess-Objekts — aus der Domain, geht in den Export */
  processLabels?: ProcessLabels;
  /** Orchescala-Projekt, z. B. `globex-savings` */
  project?: string;
  /**
   * Alter Name, der der Konvention (`company-projekt-prozessVersion`) nicht
   * folgt und bleiben muss — z. B. `valiant-product-orderCard`. Dann wird nur
   * noch geprüft, dass die ID drei Teile hat.
   */
  legacyProcessId?: boolean;
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
  /** Pattern am Prozess selbst (z. B. «einmalige Ausführung») */
  patterns?: AppliedPattern[];
  /** IDs der Epics (`Model.epics`), an denen dieser Prozess mitarbeitet */
  epics?: string[];
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
  /** nur in diesen Ausprägungen (OpenAPI `oneOf`) — fehlt: in allen */
  variants?: string[];
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
  group?: string;         // z. B. `globex-crm`
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
  /** `@description(clientKeyDescr)` — der Ausdruck, wenn er kein reiner Text ist (siehe Field.descriptionExpr) */
  descriptionExpr?: string;
  /** der Wert im `lazy val example = X(…)` des Companions — wie er dort steht, z. B. `Some(CardHolder.example)` */
  example?: string;
  [key: string]: unknown;
}

/**
 * Ein Beispielwert aus der Domain: `val defaultClientKey: Long = 74854564837991L`
 * auf oberster Ebene eines Pakets. Heisst ein Feld `clientKey`, nimmt das
 * `example` diesen Wert — wie es die Projekte von Hand tun.
 */
export interface DomainDefault {
  /** `defaultClientKey` */
  name: string;
  /** `valiant.orchescala.domain` */
  pkg: string;
  /** angegeben oder aus dem Literal abgeleitet (`Long`) — ohne Typ wird der Wert nicht verwendet */
  type?: string;
  /** aus dem generierten Katalog — gehört nicht in die model.json */
  generated?: boolean;
}

export interface DomainType {
  /** voll qualifiziert, z. B. `globex.crm.domain.account.v1.GetAccount.Out` */
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
  /** Felder — bei einem enum die gemeinsamen (`def x: T` im Rumpf) */
  fields?: DomainField[];
  values?: string[];
  /** bei einem enum mit Parametern (ADT): die Felder je Fall */
  cases?: Array<{ name: string; fields?: DomainField[] }>;
  /**
   * Bei einem einfachen enum: die Fälle, für die es Givens für den Singleton-Typ
   * (`X.fall.type`) gibt — nur sie taugen als fester Fall. Fehlt die Angabe, wird nicht geprüft.
   */
  fixedCases?: string[];
  descr?: string;
  /**
   * `val processName` eines Prozess-Objekts, z. B. `globex-ordercard`.
   * Damit findet ein BPMN-Prozess seine Domain, ohne dass Paket und
   * Objektname aus der ID geraten werden müssen.
   */
  processName?: string;
  /** `override def processLabels: ProcessLabels = ProcessLabels("…", "…")` des Prozess-Objekts */
  processLabels?: ProcessLabels;
  /** `val topicName` eines Worker-Objekts — dasselbe für Service-Tasks */
  topicName?: string;
  /** Art des Objekts laut DSL: `Process`, `UserTask`, `CustomTask`, `SignalEvent`, `MessageEvent`, `Decision` … */
  dsl?: string;
  /** Schlüssel des Objekts: `name` (Benutzeraufgabe), `messageName`, `decisionId` — und sein Wert */
  keyName?: string;
  key?: string;
  /** Entscheidung: die Form des Ergebnisses laut `lazy val example = singleResult(…)` */
  decisionResult?: DecisionResult;
  /** `val descr` des umschliessenden Objekts */
  ownerDescr?: string;
  /** `val descr` als Scala-Ausdruck, wenn er kein reiner Text ist (`s"…${X}…"`) */
  ownerDescrExpr?: string;
  /** bei `alias`: der Zielausdruck, z. B. `Int :| any.In[(11, 15)]` oder `AdjustOrderUT.In` */
  target?: string;
  /**
   * Abweichende Werte im Beispiel des Objekts: `lazy val example =
   * userTask(OrderCardUT.In.example.copy(clientKeyIsIdentityOk = false), …)` —
   * je Mitglied (In, Out) die Felder mit ihrem Scala-Ausdruck
   */
  exampleCopies?: { In?: Record<string, string>; Out?: Record<string, string> };
  /** Herkunft (Datei) — nur zur Nachvollziehbarkeit */
  source?: string;
  /**
   * Die Imports der Datei (`valiant.vollmacht.domain.loadPoas.v1.LoadPoas`,
   * `a.b.*`) — ein Feldtyp wird zuerst über sie aufgelöst, wie in Scala
   */
  imports?: string[];
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
  /** Ordnername, z. B. `initech-core-banking` */
  name: string;
  /**
   * absoluter Pfad — nur das CLI kennt ihn. Im Browser gibt der Ordnerwähler
   * keinen Pfad heraus; dort führt der gemerkte Zugriff zum Ordner zurück.
   */
  path?: string;
  /**
   * Name des Ordners **über** den Projekten, aus dem dieses Projekt kam
   * (`projects`). Sein Zugriff wird einmal gemerkt und einmal bestätigt —
   * die Projektordner darunter erben ihn, statt je einen Dialog zu brauchen.
   */
  root?: string;
  /** Zahl der Typen aus diesem Projekt beim letzten Aufbau */
  types?: number;
  /**
   * Farbe des Projekts (`#rrggbb`) — wie `ProjectConfig.color` in Orchescala.
   * Ein Worker oder Teilprozess aus diesem Projekt bekommt sie im Diagramm.
   */
  color?: string;
  [key: string]: unknown;
}

/**
 * Ein Epic — eine Klammer über mehrere Prozesse, z. B. ein Change. Anlegen
 * darf nur ein Admin; zuordnen, wer bearbeitet. Die Übersicht filtert danach.
 */
export interface EpicDef {
  /** stabil — steht in den Spezifikationen; ein Umbenennen ändert nur `name` */
  id: string;
  name: string;
  description?: string;
  /** Link, z. B. auf das Epic im Ticketsystem */
  url?: string;
  /** abgeschlossen: nicht mehr zuweisbar, bleibt aber am Prozess und im Filter */
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
  /** Name des Kunden — steht links in der Kopfzeile */
  company?: string;
  /**
   * Logo des Kunden als Data-URI. Es liegt in der `model.json`, damit es
   * überall mitkommt — im geteilten Ordner wie in SharePoint, ohne zweite
   * Datei und ohne Adresse, die von aussen erreichbar sein müsste.
   */
  logo?: string;
  auth?: AuthSettings;
  /** Benachrichtigungen zu Kommentaren */
  notifications?: { teams?: TeamsNotifySettings };
  /** Service-Katalog mit vorbereitetem Mapping */
  services: ServiceDef[];
  /** Domain-Katalog: die Typen der Service-Projekte */
  domainTypes?: DomainType[];
  /** Beispielwerte der Domain (`defaultClientKey` …) — in der Reihenfolge des Vorrangs */
  domainDefaults?: DomainDefault[];
  /** zuletzt eingelesene Quellordner — als Gedächtnisstütze im Admin */
  domainSources?: string[];
  /**
   * Die Projekt-Ordner des Domain-Katalogs — **die Reihenfolge ist der
   * Vorrang**. Liegt dasselbe Paket in mehreren Projekten
   * (`initech.core.banking.domain.client` und `globex.core.banking.domain.client`),
   * gilt das weiter oben stehende; das andere wird verworfen.
   */
  projects?: ProjectFolder[];
  /** Pattern, die die Spezifikationen an ihren Elementen wählen können */
  patterns?: PatternDef[];
  /** Epics, denen sich Prozesse zuordnen lassen — die Reihenfolge gilt auch im Filter */
  epics?: EpicDef[];
  /**
   * Projektfarben aus dem generierten Katalog (`prepareDocs`, `ProjectConfig.color`) —
   * nur im Speicher, nie in der model.json. Eine Farbe am Projekt-Ordner geht vor.
   */
  projectColors?: Record<string, string>;
  [key: string]: unknown;
}
