package orchescala
package worker

import orchescala.domain.*
import orchescala.engine.rest.SttpClientBackend
import orchescala.worker.WorkerError.*
import zio.{IO, ZIO}

import scala.concurrent.duration.*
import scala.reflect.ClassTag

trait WorkerDsl[In <: Product: InOutCodec, Out <: Product: InOutCodec]:

  // needed that it can be called from CSubscriptionPostProcessor
  def worker: Worker[In, Out, ?]
  def topic: String     = worker.topic
  def timeout: Duration = 10.seconds

  protected def regexMatchesAll(
      errorHandled: Boolean,
      error: WorkerError,
      regexHandledErrors: Seq[String]
  ) =
    val errorMsg = error.errorMsg.replace("\n", "")
    errorHandled && regexHandledErrors.forall(regex =>
      errorMsg.matches(s".*$regex.*")
    )
  end regexMatchesAll

  protected def filteredOutput(
      outputVariables: Seq[String],
      allOutputs: Map[String, Any]
  ): Map[String, Any] =
    outputVariables match
      case filter if filter.isEmpty => allOutputs
      case filter                   =>
        allOutputs
          .filter:
            case k -> _ => filter.contains(k)

  end filteredOutput

  extension [T](option: Option[T])
    def toEither[E <: WorkerError](
        error: E
    ): Either[E, T] =
      option
        .map(Right(_))
        .getOrElse(
          Left(error)
        )

    def toIO[E <: WorkerError](
        error: E
    ): IO[E, T] =
      option
        .map(ZIO.succeed(_))
        .getOrElse(
          ZIO.fail(error)
        )
  end extension // Option

end WorkerDsl

trait InitWorkerDsl[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec,
    InitIn <: Product: InOutCodec,
    InConfig <: Product: InOutCodec
] extends InitProcessDsl[In, Out, InitIn, InConfig]:

  protected def inOutExample: Process[In, Out, InitIn]

  lazy val worker: InitWorker[In, Out, InitIn] =
    InitWorker(inOutExample, ValidationHandler(validate))
      .initProcess(InitProcessHandler(initProcessZIO, inOutExample.processLabels))

end InitWorkerDsl

trait ValidationWorkerDsl[
    In <: Product: InOutCodec
] extends WorkerDsl[In, NoOutput],
      ValidateDsl[In]:

  protected def inOutExample: ReceiveEvent[In, ?]

  lazy val worker: InitWorker[In, NoOutput, In] =
    InitWorker(inOutExample, ValidationHandler(validate))

end ValidationWorkerDsl

trait CustomWorkerDsl[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec
] extends WorkerDsl[In, Out],
      ValidateDsl[In],
      RunWorkDsl[In, Out]:

  protected def customTask: CustomTask[In, Out]

  lazy val worker: CustomWorker[In, Out] =
    CustomWorker(customTask, ValidationHandler(validate))
      .runWork(CustomHandler(runWorkZIO))

end CustomWorkerDsl

trait ServiceWorkerDsl[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec,
    ServiceIn: InOutEncoder,
    ServiceOut: {InOutDecoder, ClassTag}
] extends WorkerDsl[In, Out],
      ValidateDsl[In],
      RunWorkDsl[In, Out]:

  lazy val worker: ServiceWorker[In, Out, ServiceIn, ServiceOut] =
    ServiceWorker[In, Out, ServiceIn, ServiceOut](serviceTask, ValidationHandler(validate))
      .runWork(
        ServiceHandler(
          method,
          apiUri,
          querySegments,
          inputMapper,
          inputHeaders,
          outputMapper,
          serviceTask.defaultServiceOutMock,
          serviceTask.dynamicServiceOutMock,
          serviceTask.serviceInExample
        )
      )

  // required
  protected def serviceTask: ServiceTask[In, Out, ServiceIn, ServiceOut]
  protected def apiUri(in: In): Uri // input must be valid - so no errors
  // optional
  protected def method: Method                                  = Method.GET
  protected def querySegments(in: In): Seq[QuerySegmentOrParam] =
    Seq.empty // input must be valid - so no errors
    // mocking out from outService and headers
  protected def inputMapper(in: In): Option[ServiceIn]          = None // input must be valid - so no errors
  protected def inputHeaders(in: In): Map[String, String]       =
    Map.empty // input must be valid - so no errors
  protected def outputMapper(
      serviceOut: ServiceResponse[ServiceOut],
      in: In
  ): Either[ServiceMappingError, Out] = defaultOutMapper(serviceOut, in)

  /** Run the Work is done by the handler. If you want a different behavior, you need to use the
    * CustomWorkerDsl
    */
  override final def runWork(
      inputObject: In
  ): Either[CustomError, Out] = Right(serviceTask.out)

  private def defaultOutMapper(
      serviceResponse: ServiceResponse[ServiceOut],
      in: In
  ): Either[ServiceMappingError, Out] =
    serviceResponse.outputBody match
      case _: NoOutput       => Right(serviceTask.out)
      case Some(_: NoOutput) => Right(serviceTask.out)
      case None              => Right(serviceTask.out)
      case _                 =>
        Left(ServiceMappingError(s"There is an outputMapper missing for '${getClass.getName}'."))
  end defaultOutMapper

  protected def queryKeys(ks: String*): Seq[QuerySegmentOrParam] =
    ks.map(QuerySegmentOrParam.Key(_))

  protected def queryKeyValues(kvs: (String, Any)*): Seq[QuerySegmentOrParam] =
    kvs.map { case k -> v => QuerySegmentOrParam.KeyValue(k, s"$v") }

  protected def queryValues(vs: Any*): Seq[QuerySegmentOrParam] =
    vs.map(v => QuerySegmentOrParam.Value(s"$v"))

end ServiceWorkerDsl

private trait ValidateDsl[
    In <: Product: InOutCodec
]:

  def validate(in: In): Either[ValidatorError, In] = Right(in)

end ValidateDsl

private trait InitProcessDsl[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec,
    InitIn <: Product: InOutCodec,
    InConfig <: Product: InOutCodec
] extends ValidateDsl[In], WorkerDsl[In, Out]:

  /** Execute with full WorkerExecutor functionality including mocking and inConfig merging */
  def initWorkFromService(json: Json)(using
                                      context: EngineRunContext
  ): ZIO[SttpClientBackend, WorkerError, Json] =
    for
      in                <- mergeInConfig(json)
      validatedInput    <- ZIO.fromEither(worker.validationHandler.validate(in))
      allOutputs: Json  <-
        customInitZIO(validatedInput)
          .map:
            mergeOutputs(validatedInput, _)
    yield allOutputs

  private def mergeInConfig(json: Json): ZIO[Any, WorkerError, In] =
    ZIO.fromEither(json.as[In])
      .mapError: err =>
        WorkerError.ValidatorError(s"Problem parsing input Json to ${nameOfType[In]}: $err")
      .flatMap:
        case i: WithConfig[?] =>
          val jsonObj                = json.asObject.get
          val inputVariables         = jsonObj.toMap
          val configJson: JsonObject =
            inputVariables.getOrElse("inConfig", i.defaultConfigAsJson).asObject.get
          val newJsonConfig          = worker.inConfigVariableNames
            .foldLeft(configJson): (configJson, n) =>
              if jsonObj.contains(n)
              then configJson.add(n, jsonObj(n).get)
              else configJson
          val newJsonObj             = jsonObj.add("inConfig", newJsonConfig.asJson)
          ZIO.fromEither(newJsonObj.asJson.as[In])
            .mapError: err =>
              WorkerError.ValidatorError(
                s"Problem parsing merged inConfig Json to ${nameOfType[In]}: $err"
              )
        case in               =>
          ZIO.succeed(in)

  private def mockOutput(validatedInput: In)(using
      context: EngineRunContext
  ): IO[MockerError, Option[InitIn]] =
    (
      context.generalVariables.isMockedWorker(worker.topic),
      context.generalVariables._outputMock
    ) match
      case (_, Some(outputMock)) =>
        ZIO.fromEither(outputMock.as[InitIn])
          .map(Some(_))
          .mapError: error =>
            MockerError(errorMsg = s"$error:\n- $outputMock")
      case (true, None)          =>
        // For init workers, use the Out mock as InitIn (they should be compatible)
        worker.defaultMock(validatedInput).map(_.asInstanceOf[InitIn]).map(Some(_))
      case (_, None)             =>
        ZIO.none

  private def mergeOutputs(
      initializedInput: In,
      output: InitIn
  )(using context: EngineRunContext): Json =
    val generalVarsJson = context.generalVariables.asJson.deepDropNullValues
    val inJson = initializedInput.asJson.deepDropNullValues
    val outJson = output.asJson.deepDropNullValues
    generalVarsJson
      .deepMerge(inJson)
      .deepMerge(outJson)
  end mergeOutputs

  private def filterOutput(
      allOutputs: Json,
      outputVariables: Seq[String]
  ): Json =
    if outputVariables.isEmpty then
      allOutputs
    else
      allOutputs
        .asObject.get.toMap
        .filter:
          case k -> _ => outputVariables.contains(k)
        .filterNot:
          case k -> _ =>
            k == "inConfig" // Remove inConfig as it's only used for input merging, not output
        .asJson

  private def jsonToEngineValue(json: Json): Any =
    json match
      case j if j.isNull    => null
      case j if j.isNumber  =>
        j.asNumber.get.toBigDecimal.get match
          case n if n.isValidInt  => n.toInt
          case n if n.isValidLong => n.toLong
          case n                  => n.toDouble
      case j if j.isBoolean => j.asBoolean.get
      case j if j.isString  => j.asString.get
      case j if j.isArray   =>
        j.asArray.get.map(jsonToEngineValue)
      case j                =>
        j.asObject.get.toMap
          .map { case (k, v) => k -> jsonToEngineValue(v) }

  private def mapToJson(map: Map[String, Any]): Json =
    Json.obj(
      map.map { case k -> v =>
        k -> (v match
          case j: Json      => j
          case null         => Json.Null
          case s: String    => Json.fromString(s)
          case n: Number    => Json.fromJsonNumber(JsonNumber.fromDecimalStringUnsafe(n.toString))
          case b: Boolean   => Json.fromBoolean(b)
          case m: Map[?, ?] => mapToJson(m.asInstanceOf[Map[String, Any]])
          case seq: Seq[?]  => Json.arr(seq.map {
              case j: Json    => j
              case null       => Json.Null
              case s: String  => Json.fromString(s)
              case n: Number  => Json.fromJsonNumber(JsonNumber.fromDecimalStringUnsafe(n.toString))
              case b: Boolean => Json.fromBoolean(b)
              case other      => Json.fromString(other.toString)
            }*)
          case other        => Json.fromString(other.toString))
      }.toSeq*
    )

  def runWorkFromWorker(in: In)(using
      EngineRunContext
  ): ZIO[SttpClientBackend, WorkerError, InitIn] =
    for
      validatedInput <- ZIO.fromEither(
                          worker.validationHandler.validate(in)
                        )
      out            <-
        customInitZIO(validatedInput)
    yield out

  protected def customInitZIO(
      inputObject: In
  ): InitProcessZIOOutput[InitIn] =
    ZIO
      .attempt(customInit(inputObject))
      .mapError: err =>
        InitProcessError(s"Error initializing InitIn ${inputObject}: $err")

  protected def customInit(in: In): InitIn = ??? // this must be implemented if customInitZIO isn't

  // by default the InConfig is initialized
  final def initProcessZIO(in: In): EngineRunContext ?=> IO[InitProcessError, Map[String, Any]] =
    given EngineContext = summon[EngineRunContext].engineContext
    val inConfigZIO     = in match
      case i: WithConfig[?] =>
        ZIO
          .attempt:
            initConfig(
              i.inConfig.asInstanceOf[Option[InConfig]],
              i.defaultConfig.asInstanceOf[InConfig]
            )
          .mapError: err =>
            InitProcessError(s"Error initializing InConfig: $err")
      case _                => ZIO.succeed(Map.empty)
    for
      initIn   <- customInitZIO(in)
      inConfig <- inConfigZIO
    yield inConfig ++ summon[EngineRunContext].toEngineObject(initIn)

  end initProcessZIO

  /** initialize the config of the form of:
    *
    * ```
    * case class InConfig(
    *   timerIdentificationNotReceived: Option[String :| Iso8601Duration],
    *   timerEBankingContractCheckOpened: Option[String :| CronExpr] =
    *   ...
    * )
    * ```
    */
  private def initConfig(
      optConfig: Option[InConfig],
      defaultConfig: InConfig
  )(using engineContext: EngineContext): Map[String, Any] =
    val defaultJson = defaultConfig.asJson
    val r           = optConfig.map {
      config =>
        val json = config.asJson
        config.productElementNames
          .map(k =>
            k -> (
              json.hcursor
                .downField(k).focus,
              defaultJson.hcursor
                .downField(k).focus
            )
          ).collect {
            case k -> (Some(j), Some(dj)) if j.isNull =>
              k -> dj
            case k -> (Some(j), _)                    =>
              k -> j
            case k -> (_, dj)                         =>
              k -> dj.getOrElse(Json.Null)
          }
          .toMap
    }.getOrElse { // get all defaults
      defaultConfig.productElementNames
        .map(k =>
          k -> defaultJson.hcursor
            .downField(k).focus
        ).collect {
          case k -> Some(j) =>
            k -> j
        }
        .toMap
    }
    engineContext.toEngineObject(r)
  end initConfig

end InitProcessDsl

private trait RunWorkDsl[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec
] extends ValidateDsl[In], WorkerDsl[In, Out]:
  type RunWorkOutput =
    Either[CustomError, Out]

  def runWorkFromService(json: Json)(using
                                     EngineRunContext
  ): ZIO[SttpClientBackend, WorkerError, Option[Json]] =
    ZIO.fromEither(json.as[In])
      .mapError: err =>
        WorkerError.ValidatorError(s"Problem parsing input Json to ${nameOfType[In]}: $err")
      .flatMap(runWorkFromWorker)
      .map:
        case NoOutput() => None
        case out        => Some(out.asInstanceOf[Out].asJson.deepDropNullValues)

  def runWorkFromWorker(in: In)(using
      context: EngineRunContext
  ): ZIO[SttpClientBackend, WorkerError, Out | NoOutput] =
    for
      validatedInput            <- ZIO.fromEither(
                                     worker.validationHandler.validate(in)
                                   )
      mockedOutput: Option[Out] <-
        OutMocker(worker, context.generalVariables).mockedOutput(validatedInput)
      out                       <-
        if mockedOutput.isEmpty then WorkRunner(worker).run(validatedInput)
        else ZIO.logInfo(s"Mocked output used: ${mockedOutput.get.asJson}").as(mockedOutput.get)
    yield out

  /*
    Only call this if it is NOT an InitWorker
   */
  def runWorkFromWorkerUnsafe(in: In)(using EngineRunContext): IO[WorkerError, Out] =
    runWorkFromWorker(in)
      .asInstanceOf[IO[RunWorkError, Out]] // only if you are sure that there is a handler
      .catchAllDefect: defect =>
        ZIO.logError(s"DEFECT runWorkFromWorkerUnsafe: ${defect.toString}") *>
          ZIO.fail(UnexpectedRunError(
            s"Unexpected error runWorkFromWorkerUnsafe. Defect: ${defect.getMessage}"
          ))

  protected def runWorkZIO(
      inputObject: In
  ): RunWorkZIOOutput[Out] =
    ZIO.fromEither(runWork(inputObject))

  protected def runWork(
      inputObject: In
  ): Either[CustomError, Out] =
    Left(CustomError(
      "Worker is not implemented. Be aware you have either to override runWork or runWorkZIO."
    ))

end RunWorkDsl
