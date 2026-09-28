package orchescala.worker.op

import io.circe.JsonObject
import orchescala.domain.*
import orchescala.engine.{DefaultEngineConfig, EngineConfig, ProcessEngine}
import orchescala.engine.domain.*
import orchescala.engine.op.{OpLocalClient, OpProcessEngine, SharedOpClientManager}
import orchescala.worker.*
import org.operaton.bpm.client.ExternalTaskClient
import zio.*
import zio.test.*

import java.util.concurrent.ConcurrentHashMap

/** Runs an external task longer than its lock (1 minute) on a real Operaton - only if `OP_REST_IT`
  * is set to its REST address (no auth), e.g.:
  * {{{
  * OP_REST_IT=http://localhost:8282/engine-rest sbt "workerOp/testOnly orchescala.worker.op.OpLockRenewalIntegrationTest"
  * }}}
  */
object OpLockRenewalIntegrationTest extends ZIOSpecDefault:

  private val longTaskTopic = "orchescala-it-long-task"
  private val processId  = "orchescala-it-long-task-process"
  // executions per process instance - instances left over from earlier runs are executed too
  private val executions = ConcurrentHashMap[String, Int]()

  private val bpmn =
    s"""<?xml version="1.0" encoding="UTF-8"?>
       |<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
       |  xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="defs"
       |  targetNamespace="http://bpmn.io/schema/bpmn">
       |  <bpmn:process id="$processId" isExecutable="true" camunda:historyTimeToLive="1">
       |    <bpmn:startEvent id="start"/>
       |    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="longTask"/>
       |    <bpmn:serviceTask id="longTask" camunda:type="external" camunda:topic="$longTaskTopic"/>
       |    <bpmn:sequenceFlow id="f2" sourceRef="longTask" targetRef="end"/>
       |    <bpmn:endEvent id="end"/>
       |  </bpmn:process>
       |</bpmn:definitions>""".stripMargin

  private val fastTaskTopic = "orchescala-it-fast-task"
  private val fastExecutions = ConcurrentHashMap[String, Int]()
  private val fastProcessId = "orchescala-it-fast-task-process"
  private val fastBpmn      = bpmn
    .replace(processId, fastProcessId)
    .replace(longTaskTopic, fastTaskTopic)

  private val defectTaskTopic  = "orchescala-it-defect-task"
  private val defectExecutions = ConcurrentHashMap[String, Int]()
  private val defectProcessId  = "orchescala-it-defect-task-process"
  private val defectBpmn       = bpmn
    .replace(processId, defectProcessId)
    .replace(longTaskTopic, defectTaskTopic)

  /** A bug in the worker's code: an exception, not a WorkerError (a defect). */
  private object DefectTaskWorker extends OpWorker[NoInput, NoOutput], CustomWorkerDsl[NoInput, NoOutput]:
    protected def operatonContext: OpContext = LongTaskWorker.context
    protected def customTask: CustomTask[NoInput, NoOutput] =
      CustomTask(InOutDescr(defectTaskTopic, NoInput(), NoOutput(), None))
    override protected def runWorkZIO(in: NoInput): RunWorkZIOOutput[NoOutput] =
      val processInstanceId = summon[EngineRunContext].processInstance.map(_.id).getOrElse("-")
      ZIO.succeed(defectExecutions.merge(processInstanceId, 1, _ + _)) *>
        ZIO.succeed(throw IllegalStateException("bug in the worker code"))
  end DefectTaskWorker

  private val identityTaskTopic  = "orchescala-it-identity-task"
  private val identityProcessId  = "orchescala-it-identity-task-process"
  private val identityBpmn       = bpmn
    .replace(processId, identityProcessId)
    .replace(longTaskTopic, identityTaskTopic)
  // per process instance: executions, and whether the identity was there
  private val identityExecutions = ConcurrentHashMap[String, Int]()
  private val identitySeen       = ConcurrentHashMap[String, Boolean]()

  private object IdentityTaskWorker extends OpWorker[NoInput, NoOutput], CustomWorkerDsl[NoInput, NoOutput]:
    protected def operatonContext: OpContext = LongTaskWorker.context
    protected def customTask: CustomTask[NoInput, NoOutput] =
      CustomTask(InOutDescr(identityTaskTopic, NoInput(), NoOutput(), None))
    override protected def runWorkZIO(in: NoInput): RunWorkZIOOutput[NoOutput] =
      val context           = summon[EngineRunContext]
      val processInstanceId = context.processInstance.map(_.id).getOrElse("-")
      ZIO.succeed:
        identityExecutions.merge(processInstanceId, 1, _ + _)
        identitySeen.put(processInstanceId, context.generalVariables._identityCorrelation.isDefined)
      .as(NoOutput())
  end IdentityTaskWorker

  /** Operaton's REST API directly - to set the variables the engine service sets (and filters). */
  private def rest(restUrl: String, method: String, path: String, body: String): Task[String] =
    ZIO.attemptBlocking:
      val request  = java.net.http.HttpRequest.newBuilder(java.net.URI.create(s"$restUrl$path"))
        .header("Content-Type", "application/json")
        .method(method, java.net.http.HttpRequest.BodyPublishers.ofString(body))
        .build()
      val response = java.net.http.HttpClient.newHttpClient()
        .send(request, java.net.http.HttpResponse.BodyHandlers.ofString())
      if response.statusCode() >= 300 then
        throw RuntimeException(s"$method $path: ${response.statusCode()} ${response.body()}")
      response.body()

  /** Done at once - completes while a lock renewal could still run. */
  private object FastTaskWorker extends OpWorker[NoInput, NoOutput], CustomWorkerDsl[NoInput, NoOutput]:
    protected def operatonContext: OpContext = LongTaskWorker.context
    protected def customTask: CustomTask[NoInput, NoOutput] =
      CustomTask(InOutDescr(fastTaskTopic, NoInput(), NoOutput(), None))
    override protected def runWorkZIO(in: NoInput): RunWorkZIOOutput[NoOutput] =
      val processInstanceId = summon[EngineRunContext].processInstance.map(_.id).getOrElse("-")
      ZIO.succeed(fastExecutions.merge(processInstanceId, 1, _ + _)).as(NoOutput())
  end FastTaskWorker

  /** Runs 75s - longer than its lock of 1 minute, which it renews every 30s. */
  private object LongTaskWorker extends OpWorker[NoInput, NoOutput], CustomWorkerDsl[NoInput, NoOutput]:
    protected def operatonContext: OpContext = context
    lazy val context: OpContext              = new OpContext:
      lazy val engineConfig: EngineConfig = DefaultEngineConfig()
      lazy val workerConfig: WorkerConfig =
        DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
    protected def customTask: CustomTask[NoInput, NoOutput] =
      CustomTask(InOutDescr(longTaskTopic, NoInput(), NoOutput(), None))
    override protected def runWorkZIO(in: NoInput): RunWorkZIOOutput[NoOutput] =
      val processInstanceId = summon[EngineRunContext].processInstance.map(_.id).getOrElse("-")
      ZIO.succeed(executions.merge(processInstanceId, 1, _ + _)) *>
        ZIO.sleep(75.seconds).as(NoOutput())
  end LongTaskWorker

  def spec = suite("Operaton lock renewal against a real engine")(
    test("a task running longer than its lock is executed once and completes") {
      val restUrl         = sys.env("OP_REST_IT")
      given EngineConfig  = DefaultEngineConfig()
      given WorkerConfig  = DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
      val engineClient    = new OpLocalClient:
        protected def operatonRestUrl: String = restUrl
      val workerClient    = new OpWorkerClient:
        protected def operatonRestUrl: String = restUrl
        def client: ZIO[SharedOpExternalClientManager, Throwable, ExternalTaskClient] =
          SharedOpExternalClientManager.getOrCreateClient(ZIO.attempt(externalClient.build()))
      for
        engine   <- OpProcessEngine.withClient(engineClient).provideLayer(SharedOpClientManager.layer)
        _        <- engine.deploymentService.deploy(
                      "it-long-task",
                      Seq(DeploymentResource(s"$processId.bpmn", bpmn.getBytes, DeploymentResourceType.Bpmn)),
                      Some(EngineType.Op)
                    )
        _        <- OpWorkerRegistry(workerClient)
                      .register(Set(LongTaskWorker))
                      .provideLayer(SharedOpExternalClientManager.layer)
                      .tapErrorCause(cause => ZIO.logError(s"Worker registration failed: ${cause.prettyPrint}"))
                      .forkScoped // stops the client at the end of the test - a daemon one kept fetching (and locking) tasks of later runs
        started  <- engine.processInstanceService.startProcessAsync(processId, JsonObject(), None, None, None)
        finished <- engine.historicProcessInstanceService
                      .getProcessInstance(started.processInstanceId)
                      .filterOrFail(_.state == HistoricProcessInstance.ProcessState.COMPLETED)(
                        EngineError.ProcessError("not yet completed")
                      )
                      .retry(Schedule.spaced(2.seconds) && Schedule.recurs(80))
      yield assertTrue(
        finished.state == HistoricProcessInstance.ProcessState.COMPLETED,
        executions.get(started.processInstanceId) == 1 // without renewal: handed out again after a minute
      )
    },
    test("fast tasks complete without lock conflicts (renewal vs. completion)") {
      val restUrl         = sys.env("OP_REST_IT")
      given EngineConfig  = DefaultEngineConfig()
      given WorkerConfig  = DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
      val engineClient    = new OpLocalClient:
        protected def operatonRestUrl: String = restUrl
      val workerClient    = new OpWorkerClient:
        protected def operatonRestUrl: String = restUrl
        def client: ZIO[SharedOpExternalClientManager, Throwable, ExternalTaskClient] =
          SharedOpExternalClientManager.getOrCreateClient(ZIO.attempt(externalClient.build()))
      for
        engine    <- OpProcessEngine.withClient(engineClient).provideLayer(SharedOpClientManager.layer)
        _         <- engine.deploymentService.deploy(
                       "it-fast-task",
                       Seq(DeploymentResource(s"$fastProcessId.bpmn", fastBpmn.getBytes, DeploymentResourceType.Bpmn)),
                       Some(EngineType.Op)
                     )
        _         <- OpWorkerRegistry(workerClient)
                       .register(Set(FastTaskWorker))
                       .provideLayer(SharedOpExternalClientManager.layer)
                       .forkScoped // stops the client at the end of the test - a daemon one kept fetching (and locking) tasks of later runs
        started   <- ZIO.foreach(1 to 30)(_ =>
                       engine.processInstanceService.startProcessAsync(fastProcessId, JsonObject(), None, None, None)
                     )
        states    <- ZIO.foreach(started): info =>
                       engine.historicProcessInstanceService
                         .getProcessInstance(info.processInstanceId)
                         .filterOrFail(_.state == HistoricProcessInstance.ProcessState.COMPLETED)(
                           EngineError.ProcessError("not yet completed")
                         )
                         .retry(Schedule.spaced(1.second) && Schedule.recurs(30))
                         .map(_.state)
        incidents <- ZIO.foreach(started)(info => engine.incidentService.getIncidents(None, Some(info.processInstanceId)))
      yield assertTrue(
        states.forall(_ == HistoricProcessInstance.ProcessState.COMPLETED),
        incidents.forall(_.isEmpty),
        // a failed completion ("updated by another transaction concurrently") ran it again
        started.forall(info => fastExecutions.get(info.processInstanceId) == 1)
      )
    }
    ,
    test("an exception of the worker's code ends in an incident - not fetched again and again") {
      val restUrl         = sys.env("OP_REST_IT")
      given EngineConfig  = DefaultEngineConfig()
      given WorkerConfig  = DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
      val engineClient    = new OpLocalClient:
        protected def operatonRestUrl: String = restUrl
      val workerClient    = new OpWorkerClient:
        protected def operatonRestUrl: String = restUrl
        def client: ZIO[SharedOpExternalClientManager, Throwable, ExternalTaskClient] =
          SharedOpExternalClientManager.getOrCreateClient(ZIO.attempt(externalClient.build()))
      for
        engine    <- OpProcessEngine.withClient(engineClient).provideLayer(SharedOpClientManager.layer)
        _         <- engine.deploymentService.deploy(
                       "it-defect-task",
                       Seq(DeploymentResource(s"$defectProcessId.bpmn", defectBpmn.getBytes, DeploymentResourceType.Bpmn)),
                       Some(EngineType.Op)
                     )
        _         <- OpWorkerRegistry(workerClient)
                       .register(Set(DefectTaskWorker))
                       .provideLayer(SharedOpExternalClientManager.layer)
                       .forkScoped // stops the client at the end of the test
        started   <- engine.processInstanceService.startProcessAsync(defectProcessId, JsonObject(), None, None, None)
        // before: no incident - the task was fetched again once its lock (1 minute) ran out
        incidents <- engine.incidentService.getIncidents(None, Some(started.processInstanceId))
                       .filterOrFail(_.nonEmpty)(EngineError.ProcessError("no incident yet"))
                       .retry(Schedule.spaced(1.second) && Schedule.recurs(30))
      yield assertTrue(
        incidents.exists(_.incidentMessage.exists(_.contains("bug in the worker code"))),
        defectExecutions.get(started.processInstanceId) == 1
      )
    }
    ,
    test("a task fetched before the identity of its start is set waits for it - then runs once, with it") {
      val restUrl         = sys.env("OP_REST_IT")
      given EngineConfig  = DefaultEngineConfig()
      given WorkerConfig  = DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
      val engineClient    = new OpLocalClient:
        protected def operatonRestUrl: String = restUrl
      val workerClient    = new OpWorkerClient:
        protected def operatonRestUrl: String = restUrl
        def client: ZIO[SharedOpExternalClientManager, Throwable, ExternalTaskClient] =
          SharedOpExternalClientManager.getOrCreateClient(ZIO.attempt(externalClient.build()))
      // a JSON variable: its value is the JSON as string
      val correlation     = io.circe.Json.fromString(IdentityCorrelation("alice").asJson.deepDropNullValues.noSpaces).noSpaces
      for
        engine    <- OpProcessEngine.withClient(engineClient).provideLayer(SharedOpClientManager.layer)
        _         <- engine.deploymentService.deploy(
                       "it-identity-task",
                       Seq(DeploymentResource(s"$identityProcessId.bpmn", identityBpmn.getBytes, DeploymentResourceType.Bpmn)),
                       Some(EngineType.Op)
                     )
        _         <- OpWorkerRegistry(workerClient)
                       .register(Set(IdentityTaskWorker))
                       .provideLayer(SharedOpExternalClientManager.layer)
                       .forkScoped
        // step 1 of a start with an identity: marked pending - the worker gets the task at once
        started   <- rest(
                       restUrl,
                       "POST",
                       s"/process-definition/key/$identityProcessId/start",
                       """{"variables":{"_identityCorrelationPending":{"value":true,"type":"Boolean"}}}"""
                     )
        pid       <- ZIO.fromEither(io.circe.parser.parse(started).flatMap(_.hcursor.get[String]("id")))
        // step 3, late: the correlation (not verified by this custom worker), the marker removed
        _         <- ZIO.sleep(3.seconds)
        _         <- rest(
                       restUrl,
                       "POST",
                       s"/process-instance/$pid/variables",
                       s"""{"modifications":{"_identityCorrelation":{"value":$correlation,"type":"Json"}},"deletions":["_identityCorrelationPending"]}"""
                     )
        finished  <- engine.historicProcessInstanceService
                       .getProcessInstance(pid)
                       .filterOrFail(_.state == HistoricProcessInstance.ProcessState.COMPLETED)(
                         EngineError.ProcessError("not yet completed")
                       )
                       .retry(Schedule.spaced(1.second) && Schedule.recurs(30))
        incidents <- engine.incidentService.getIncidents(None, Some(pid))
      yield assertTrue(
        finished.state == HistoricProcessInstance.ProcessState.COMPLETED,
        incidents.isEmpty,
        identityExecutions.get(pid) == 1,
        identitySeen.get(pid) // before: it ran at once, without the identity
      )
    }
    ,
    test("a start with an identity through the engine: the worker gets it, the marker is removed") {
      val restUrl         = sys.env("OP_REST_IT")
      given EngineConfig  = DefaultEngineConfig(identitySigningKey = Some("it-signing-key"))
      given WorkerConfig  = DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
      val engineClient    = new OpLocalClient:
        protected def operatonRestUrl: String = restUrl
      val workerClient    = new OpWorkerClient:
        protected def operatonRestUrl: String = restUrl
        def client: ZIO[SharedOpExternalClientManager, Throwable, ExternalTaskClient] =
          SharedOpExternalClientManager.getOrCreateClient(ZIO.attempt(externalClient.build()))
      for
        engine    <- OpProcessEngine.withClient(engineClient).provideLayer(SharedOpClientManager.layer)
        _         <- engine.deploymentService.deploy(
                       "it-identity-task",
                       Seq(DeploymentResource(s"$identityProcessId.bpmn", identityBpmn.getBytes, DeploymentResourceType.Bpmn)),
                       Some(EngineType.Op)
                     )
        _         <- OpWorkerRegistry(workerClient)
                       .register(Set(IdentityTaskWorker))
                       .provideLayer(SharedOpExternalClientManager.layer)
                       .forkScoped
        started   <- engine.processInstanceService.startProcessAsync(
                       identityProcessId, JsonObject(), None, None, Some(IdentityCorrelation("alice"))
                     )
        pid        = started.processInstanceId
        finished  <- engine.historicProcessInstanceService
                       .getProcessInstance(pid)
                       .filterOrFail(_.state == HistoricProcessInstance.ProcessState.COMPLETED)(
                         EngineError.ProcessError("not yet completed")
                       )
                       .retry(Schedule.spaced(1.second) && Schedule.recurs(30))
        marker    <- rest(restUrl, "GET", s"/history/variable-instance?processInstanceId=$pid&variableName=_identityCorrelationPending", "")
      yield assertTrue(
        finished.state == HistoricProcessInstance.ProcessState.COMPLETED,
        identityExecutions.get(pid) == 1,
        identitySeen.get(pid),
        // removed with the correlation (C7 / Operaton delete it) - history keeps deleted ones as DELETED
        !marker.contains("\"state\":\"CREATED\"")
      )
    }
  ) @@ TestAspect.ifEnvSet("OP_REST_IT") @@ TestAspect.withLiveClock @@ TestAspect.timeout(4.minutes)
end OpLockRenewalIntegrationTest
