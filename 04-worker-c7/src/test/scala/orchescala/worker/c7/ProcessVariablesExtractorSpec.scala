package orchescala.worker.c7

import munit.FunSuite
import orchescala.domain.*
import orchescala.worker.WorkerError.BadVariableError
import org.camunda.bpm.client.task.ExternalTask
import org.camunda.bpm.client.task.impl.ExternalTaskImpl
import org.camunda.bpm.engine.variable.`type`.{PrimitiveValueType, ValueType}
import org.camunda.bpm.engine.variable.value.TypedValue
import scala.annotation.nowarn
import zio.{IO, Runtime, Unsafe, ZIO}

@nowarn("cat=deprecation")
class ProcessVariablesExtractorSpec extends FunSuite:

  val runtime: Runtime[Any] = Runtime.default

  def runZIO[E, A](zio: ZIO[Any, E, A]): Either[E, A] =
    Unsafe.unsafe { implicit unsafe =>
      runtime.unsafe.run(zio.either).getOrThrowFiberFailure()
    }

  /** Runs each IO in the result of extract independently, returning a list of Either. */
  def runExtract(
      task: ExternalTask,
      variableNames: Seq[String]
  ): Seq[Either[BadVariableError, (String, Option[Json])]] =
    given ExternalTask = task
    ProcessVariablesExtractor.extract(variableNames)
      .map(effect => runZIO(effect))

  def runExtractGeneral(
      task: ExternalTask,
      generalVariablesFromError: Option[GeneralVariables] = None
  ): Either[BadVariableError, GeneralVariables] =
    given ExternalTask = task
    runZIO(ProcessVariablesExtractor.extractGeneral(generalVariablesFromError))

  // --- Test doubles ---

  /** Minimal ExternalTask stub that controls getVariableTyped and getActivityInstanceId. */
  class TestExternalTask(
      variables: Map[String, TypedValue] = Map.empty,
      instanceId: String = "test-activity-instance-id"
  ) extends ExternalTaskImpl:
    override def getVariableTyped[T <: TypedValue](variableName: String): T =
      variables.get(variableName).map(_.asInstanceOf[T]).getOrElse(null.asInstanceOf[T])
    override def getVariableTyped[T <: TypedValue](variableName: String, deserialize: Boolean): T =
      getVariableTyped(variableName)
    override def getActivityInstanceId(): String = instanceId

  /** A TypedValue whose type is ValueType.NULL – triggers the `k -> None` branch in extract. */
  val nullTypedValue: TypedValue = new TypedValue:
    def getType: ValueType   = ValueType.NULL
    def getValue: AnyRef     = null
    def isTransient: Boolean = false

  /** A TypedValue whose type is the "json" PrimitiveValueType – triggers JSON parsing in extractValue. */
  def jsonTypedValue(jsonStr: String): TypedValue =
    val jsonType: PrimitiveValueType = new PrimitiveValueType:
      def getName: String                                                       = "json"
      def getJavaType: Class[?]                                                 = classOf[String]
      def isPrimitiveValueType: Boolean                                         = true
      def isAbstract: Boolean                                                   = false
      def getValueInfo(tv: TypedValue): java.util.Map[String, Object]           = java.util.Collections.emptyMap()
      def createValue(v: Object, info: java.util.Map[String, Object]): TypedValue = ???
      def getParent: ValueType                                                  = null
      def canConvertFromTypedValue(tv: TypedValue): Boolean                     = false
      def convertFromTypedValue(tv: TypedValue): TypedValue                     = ???
    new TypedValue:
      def getType: ValueType   = jsonType
      def getValue: AnyRef     = jsonStr
      def isTransient: Boolean = false

  val idempotentKey: String = InputParams._idempotentId.toString

  // -------------------------------------------------------------------------
  // variable extraction tests (context / regression)
  // -------------------------------------------------------------------------

  test("regular variable – not set: returns (key -> None)"):
    val Right(key -> valueOpt) = runExtract(TestExternalTask(), Seq("myVar")).head: @unchecked
    assertEquals(key, "myVar")
    assertEquals(valueOpt, None)

  test("regular variable – NULL type: returns (key -> None)"):
    val task = TestExternalTask(variables = Map("myVar" -> nullTypedValue))
    val Right(key -> valueOpt) = runExtract(task, Seq("myVar")).head: @unchecked
    assertEquals(key, "myVar")
    assertEquals(valueOpt, None)

  test("regular variable – JSON value: extracts and parses it"):
    val task = TestExternalTask(variables = Map("myVar" -> jsonTypedValue("{\"answer\":42}")))
    val Right(key -> valueOpt) = runExtract(task, Seq("myVar")).head: @unchecked
    assertEquals(key, "myVar")
    assertEquals(valueOpt, Some(Json.obj("answer" -> Json.fromInt(42))))

  test("mixed variables: explicit idempotentId alongside set/null/missing vars"):
    val task = TestExternalTask(
      variables = Map(
        idempotentKey -> jsonTypedValue("\"act-789\""),
        "setVar" -> jsonTypedValue("true"),
        "nullVar" -> nullTypedValue
      ),
      instanceId = "act-789"
    )
    val asMap = runExtract(task, Seq(idempotentKey, "setVar", "nullVar", "missingVar"))
      .collect { case Right(k -> v) => k -> v }
      .toMap

    assertEquals(asMap.get(idempotentKey), Some(Some(Json.fromString("act-789"))))
    assertEquals(asMap.get("setVar"),       Some(Some(Json.fromBoolean(true))))
    assertEquals(asMap.get("nullVar"),      Some(None))
    assertEquals(asMap.get("missingVar"),   Some(None))

  // -------------------------------------------------------------------------
  // general variable extraction tests
  // -------------------------------------------------------------------------

  test("extractGeneral returns provided GeneralVariables unchanged"):
    val provided = GeneralVariables(
      _servicesMocked = Some(true),
      _mockedWorkers = Some(Seq("worker-a", "worker-b")),
      _outputMock = Some(Json.obj("answer" -> Json.fromInt(42))),
      _manualOutMapping = Some(true),
      _idempotentId = Some("provided-id")
    )

    val result = runExtractGeneral(
      TestExternalTask(instanceId = "should-not-be-used"),
      Some(provided)
    )

    assertEquals(result, Right(provided))

  test("extractGeneral extracts underscore variables and falls back idempotentId to activity instance id"):
    val identity = IdentityCorrelation(
      username = "alice",
      email = Some("alice@example.com"),
      impersonateProcessValue = Some("customer-1"),
      issuedAt = 123L
    )
    val task = TestExternalTask(
      variables = Map(
        InputParams._servicesMocked.toString -> jsonTypedValue("true"),
        InputParams._mockedWorkers.toString -> jsonTypedValue("[\"worker-a\", \" worker-b \", \"\"]"),
        InputParams._outputMock.toString -> jsonTypedValue("{\"answer\":42}"),
        InputParams._outputServiceMock.toString -> jsonTypedValue("{\"service\":\"ok\"}"),
        InputParams._manualOutMapping.toString -> jsonTypedValue("true"),
        InputParams._outputVariables.toString -> jsonTypedValue("\"outA, outB ,,\""),
        InputParams._handledErrors.toString -> jsonTypedValue("[\"err-a\", \" err-b \", \"\"]"),
        InputParams._regexHandledErrors.toString -> jsonTypedValue("\"^err-.*$, ^warn-.*$\""),
        InputParams._identityCorrelation.toString -> jsonTypedValue(identity.asJson.noSpaces)
      ),
      instanceId = "activity-123"
    )

    val result = runExtractGeneral(task)

    val Right(generalVariables) = result: @unchecked

    assertEquals(generalVariables._servicesMocked, Some(true))
    assertEquals(generalVariables._mockedWorkers, Some(Seq("worker-a", "worker-b")))
    assertEquals(generalVariables._outputMock, Some(Json.obj("answer" -> Json.fromInt(42))))
    assertEquals(generalVariables._outputServiceMock, Some(Json.obj("service" -> Json.fromString("ok"))))
    assertEquals(generalVariables._manualOutMapping, Some(true))
    assertEquals(generalVariables._outputVariables, Some(Seq("outA", "outB")))
    assertEquals(generalVariables._handledErrors, Some(Seq("err-a", "err-b")))
    assertEquals(generalVariables._regexHandledErrors, Some(Seq("^err-.*$", "^warn-.*$")))
    assertEquals(generalVariables._identityCorrelation, Some(identity))
    assertEquals(generalVariables._idempotentId, Some("activity-123"))

  test("extractGeneral falls back to deprecated variable names when underscore variables are missing"):
    val task = TestExternalTask(
      variables = Map(
        "servicesMocked" -> jsonTypedValue("true"),
        "mockedWorkers" -> jsonTypedValue("\"legacy-a, legacy-b\""),
        "outputMock" -> jsonTypedValue("{\"legacy\":true}"),
        "outputServiceMock" -> jsonTypedValue("{\"source\":\"legacy\"}"),
        "manualOutMapping" -> jsonTypedValue("true"),
        "outputVariables" -> jsonTypedValue("[\"out-1\", \" out-2 \", \"\"]"),
        "handledErrors" -> jsonTypedValue("\"ERR_1, ERR_2\""),
        "regexHandledErrors" -> jsonTypedValue("[\"^legacy$\"]"),
        InputParams.impersonateUserId.toString -> jsonTypedValue("\"legacy-user\"")
      ),
      instanceId = "activity-legacy"
    )

    val Right(generalVariables) = runExtractGeneral(task): @unchecked

    assertEquals(generalVariables._servicesMocked, Some(true))
    assertEquals(generalVariables._mockedWorkers, Some(Seq("legacy-a", "legacy-b")))
    assertEquals(generalVariables._outputMock, Some(Json.obj("legacy" -> Json.fromBoolean(true))))
    assertEquals(generalVariables._outputServiceMock, Some(Json.obj("source" -> Json.fromString("legacy"))))
    assertEquals(generalVariables._manualOutMapping, Some(true))
    assertEquals(generalVariables._outputVariables, Some(Seq("out-1", "out-2")))
    assertEquals(generalVariables._handledErrors, Some(Seq("ERR_1", "ERR_2")))
    assertEquals(generalVariables._regexHandledErrors, Some(Seq("^legacy$")))
    assertEquals(generalVariables.impersonateUserId, Some("legacy-user"))
    assertEquals(generalVariables._idempotentId, Some("activity-legacy"))

  test("extractGeneral prefers underscore variables over deprecated duplicates"):
    val task = TestExternalTask(
      variables = Map(
        InputParams._servicesMocked.toString -> jsonTypedValue("false"),
        "servicesMocked" -> jsonTypedValue("true"),
        InputParams._mockedWorkers.toString -> jsonTypedValue("[\"new-worker\"]"),
        "mockedWorkers" -> jsonTypedValue("\"old-worker\""),
        InputParams._outputMock.toString -> jsonTypedValue("{\"source\":\"new\"}"),
        "outputMock" -> jsonTypedValue("{\"source\":\"old\"}"),
        InputParams._manualOutMapping.toString -> jsonTypedValue("false"),
        "manualOutMapping" -> jsonTypedValue("true"),
        InputParams._outputVariables.toString -> jsonTypedValue("\"new-1, new-2\""),
        "outputVariables" -> jsonTypedValue("\"old-1\""),
        InputParams._handledErrors.toString -> jsonTypedValue("[\"NEW_ERR\"]"),
        "handledErrors" -> jsonTypedValue("[\"OLD_ERR\"]"),
        InputParams._regexHandledErrors.toString -> jsonTypedValue("\"^new$\""),
        "regexHandledErrors" -> jsonTypedValue("\"^old$\""),
        InputParams._idempotentId.toString -> jsonTypedValue("\"custom-id\"")
      ),
      instanceId = "activity-ignored"
    )

    val Right(generalVariables) = runExtractGeneral(task): @unchecked

    assertEquals(generalVariables._servicesMocked, Some(false))
    assertEquals(generalVariables._mockedWorkers, Some(Seq("new-worker")))
    assertEquals(generalVariables._outputMock, Some(Json.obj("source" -> Json.fromString("new"))))
    assertEquals(generalVariables._manualOutMapping, Some(false))
    assertEquals(generalVariables._outputVariables, Some(Seq("new-1", "new-2")))
    assertEquals(generalVariables._handledErrors, Some(Seq("NEW_ERR")))
    assertEquals(generalVariables._regexHandledErrors, Some(Seq("^new$")))
    assertEquals(generalVariables._idempotentId, Some("custom-id"))

end ProcessVariablesExtractorSpec
