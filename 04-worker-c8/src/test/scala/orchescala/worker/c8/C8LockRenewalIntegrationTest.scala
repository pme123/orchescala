package orchescala.worker.c8

import io.circe.{Json, JsonObject}
import orchescala.domain.*
import orchescala.engine.{DefaultEngineConfig, EngineConfig}
import orchescala.engine.c8.*
import orchescala.engine.domain.*
import orchescala.worker.*
import zio.*
import zio.test.*

import java.util.concurrent.ConcurrentHashMap

/** Runs a job longer than its lock (1 minute) on a real cluster - only if `C8_REST_IT` is set
  * (and `C8_GRPC_IT`, default `http://localhost:26500`), e.g. a local c8run:
  * {{{
  * C8_REST_IT=http://localhost:8181 sbt "workerC8/testOnly orchescala.worker.c8.C8LockRenewalIntegrationTest"
  * }}}
  */
object C8LockRenewalIntegrationTest extends ZIOSpecDefault:

  private val jobType   = "orchescala-it-long-job"
  private val processId = "orchescala-it-long-job-process"
  // executions per process instance - instances left over from earlier runs are executed too
  private val executions = ConcurrentHashMap[String, Int]()

  private val bpmn =
    s"""<?xml version="1.0" encoding="UTF-8"?>
       |<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
       |  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="defs"
       |  targetNamespace="http://bpmn.io/schema/bpmn">
       |  <bpmn:process id="$processId" isExecutable="true">
       |    <bpmn:startEvent id="start"/>
       |    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="longJob"/>
       |    <bpmn:serviceTask id="longJob">
       |      <bpmn:extensionElements><zeebe:taskDefinition type="$jobType" retries="1"/></bpmn:extensionElements>
       |    </bpmn:serviceTask>
       |    <bpmn:sequenceFlow id="f2" sourceRef="longJob" targetRef="end"/>
       |    <bpmn:endEvent id="end"/>
       |  </bpmn:process>
       |</bpmn:definitions>""".stripMargin

  private val defectJobType    = "orchescala-it-defect-job"
  private val defectProcessId  = "orchescala-it-defect-job-process"
  private val defectExecutions = ConcurrentHashMap[String, Int]()
  private val defectBpmn       = bpmn.replace(processId, defectProcessId).replace(jobType, defectJobType)

  /** A bug in the worker's code: an exception, not a WorkerError (a defect). */
  private object DefectJobWorker extends C8Worker[NoInput, NoOutput], CustomWorkerDsl[NoInput, NoOutput]:
    protected def c8Context: C8Context = LongJobWorker.c8Context
    protected def customTask: CustomTask[NoInput, NoOutput] =
      CustomTask(InOutDescr(defectJobType, NoInput(), NoOutput(), None))
    override protected def runWorkZIO(in: NoInput): RunWorkZIOOutput[NoOutput] =
      val processInstanceId = summon[EngineRunContext].processInstance.map(_.id).getOrElse("-")
      ZIO.succeed(defectExecutions.merge(processInstanceId, 1, _ + _)) *>
        ZIO.succeed(throw IllegalStateException("bug in the worker code"))
  end DefectJobWorker

  private val identityJobType    = "orchescala-it-identity-job"
  private val identityProcessId  = "orchescala-it-identity-job-process"
  private val identityBpmn       = bpmn
    .replace(processId, identityProcessId)
    .replace(jobType, identityJobType)
    .replace("retries=\"1\"", "retries=\"3\"")
  // per process instance: executions, and whether the identity was there
  private val identityExecutions = ConcurrentHashMap[String, Int]()
  private val identitySeen       = ConcurrentHashMap[String, Boolean]()

  private object IdentityJobWorker extends C8Worker[NoInput, NoOutput], CustomWorkerDsl[NoInput, NoOutput]:
    protected def c8Context: C8Context = LongJobWorker.c8Context
    protected def customTask: CustomTask[NoInput, NoOutput] =
      CustomTask(InOutDescr(identityJobType, NoInput(), NoOutput(), None))
    override protected def runWorkZIO(in: NoInput): RunWorkZIOOutput[NoOutput] =
      val context           = summon[EngineRunContext]
      val processInstanceId = context.processInstance.map(_.id).getOrElse("-")
      ZIO.succeed:
        identityExecutions.merge(processInstanceId, 1, _ + _)
        identitySeen.put(processInstanceId, context.generalVariables._identityCorrelation.isDefined)
      .as(NoOutput())
  end IdentityJobWorker

  /** C8's REST API directly - to set the variables the engine service sets (and filters). */
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

  /** Runs 75s - longer than its lock of 1 minute, which it renews every 30s. */
  private object LongJobWorker extends C8Worker[NoInput, NoOutput], CustomWorkerDsl[NoInput, NoOutput]:
    lazy val c8Context: C8Context = new C8Context:
      lazy val engineConfig: EngineConfig = DefaultEngineConfig()
      lazy val workerConfig: WorkerConfig =
        DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
    protected def customTask: CustomTask[NoInput, NoOutput] =
      CustomTask(InOutDescr(jobType, NoInput(), NoOutput(), None))
    override protected def runWorkZIO(in: NoInput): RunWorkZIOOutput[NoOutput] =
      val processInstanceId = summon[EngineRunContext].processInstance.map(_.id).getOrElse("-")
      ZIO.succeed(executions.merge(processInstanceId, 1, _ + _)) *>
        ZIO.sleep(75.seconds).as(NoOutput())
  end LongJobWorker

  def spec = suite("C8 lock renewal against a real cluster")(
    test("a job running longer than its lock is executed once and completes") {
      val restAddress = sys.env("C8_REST_IT")
      val grpcAddress = sys.env.getOrElse("C8_GRPC_IT", "http://localhost:26500")
      given C8RestClient = C8RestClient(restAddress, C8RestAuth.NoAuth)
      given EngineConfig = DefaultEngineConfig()
      given WorkerConfig = DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
      val engine         = C8ProcessEngine()
      for
        _        <- engine.deploymentService.deploy(
                      "it-long-job",
                      Seq(DeploymentResource(s"$processId.bpmn", bpmn.getBytes, DeploymentResourceType.Bpmn)),
                      Some(EngineType.C8)
                    )
        _        <- C8WorkerRegistry(C8DefaultNoAuthClient(grpcAddress, restAddress))
                      .register(Set(LongJobWorker))
                      .provideLayer(SharedC8ClientManager.layer)
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
        executions.get(started.processInstanceId) == 1 // before (lock 1 min, no renewal): handed out again after a minute
      )
    }
    ,
    test("an exception of the worker's code fails the job - it is not handed out again and again") {
      val restAddress = sys.env("C8_REST_IT")
      val grpcAddress = sys.env.getOrElse("C8_GRPC_IT", "http://localhost:26500")
      given C8RestClient = C8RestClient(restAddress, C8RestAuth.NoAuth)
      given EngineConfig = DefaultEngineConfig()
      given WorkerConfig = DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
      val engine         = C8ProcessEngine()
      for
        _         <- engine.deploymentService.deploy(
                       "it-defect-job",
                       Seq(DeploymentResource(s"$defectProcessId.bpmn", defectBpmn.getBytes, DeploymentResourceType.Bpmn)),
                       Some(EngineType.C8)
                     )
        _         <- C8WorkerRegistry(C8DefaultNoAuthClient(grpcAddress, restAddress))
                       .register(Set(DefectJobWorker))
                       .provideLayer(SharedC8ClientManager.layer)
                       .forkScoped
        started   <- engine.processInstanceService.startProcessAsync(defectProcessId, JsonObject(), None, None, None)
        // retries="1": failed once -> incident. Before: the client did not catch ZIO's FiberFailure
        // (no Exception) - the job stayed activated until its timeout, then again
        incidents <- engine.incidentService.getIncidents(None, Some(started.processInstanceId))
                       .filterOrFail(_.nonEmpty)(EngineError.ProcessError("no incident yet"))
                       .retry(Schedule.spaced(2.seconds) && Schedule.recurs(20))
      yield assertTrue(
        incidents.exists(_.incidentMessage.exists(_.contains("bug in the worker code"))),
        defectExecutions.get(started.processInstanceId) == 1
      )
    }
    ,
    test("a job activated before the identity of its start is set waits for it - then runs once, with it") {
      val restAddress = sys.env("C8_REST_IT")
      val grpcAddress = sys.env.getOrElse("C8_GRPC_IT", "http://localhost:26500")
      given C8RestClient = C8RestClient(restAddress, C8RestAuth.NoAuth)
      given EngineConfig = DefaultEngineConfig()
      given WorkerConfig = DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
      val engine         = C8ProcessEngine()
      val correlation    = IdentityCorrelation("alice").asJson.deepDropNullValues.noSpaces
      for
        _         <- engine.deploymentService.deploy(
                       "it-identity-job",
                       Seq(DeploymentResource(s"$identityProcessId.bpmn", identityBpmn.getBytes, DeploymentResourceType.Bpmn)),
                       Some(EngineType.C8)
                     )
        _         <- C8WorkerRegistry(C8DefaultNoAuthClient(grpcAddress, restAddress))
                       .register(Set(IdentityJobWorker))
                       .provideLayer(SharedC8ClientManager.layer)
                       .forkScoped
        // step 1 of a start with an identity: marked pending - the worker gets the job at once
        started   <- rest(
                       restAddress,
                       "POST",
                       "/v2/process-instances",
                       s"""{"processDefinitionId":"$identityProcessId","variables":{"_identityCorrelationPending":true}}"""
                     )
        pid       <- ZIO.fromEither(io.circe.parser.parse(started).flatMap(_.hcursor.get[String]("processInstanceKey")))
        // step 3, late: the correlation (not verified by this custom worker), the marker cleared
        _         <- ZIO.sleep(3.seconds)
        _         <- rest(
                       restAddress,
                       "PUT",
                       s"/v2/element-instances/$pid/variables",
                       s"""{"variables":{"_identityCorrelation":$correlation,"_identityCorrelationPending":false}}"""
                     )
        finished  <- engine.historicProcessInstanceService
                       .getProcessInstance(pid)
                       .filterOrFail(_.state == HistoricProcessInstance.ProcessState.COMPLETED)(
                         EngineError.ProcessError("not yet completed")
                       )
                       .retry(Schedule.spaced(1.second) && Schedule.recurs(40))
        incidents <- engine.incidentService.getIncidents(None, Some(pid))
      yield assertTrue(
        finished.state == HistoricProcessInstance.ProcessState.COMPLETED,
        incidents.isEmpty,
        identityExecutions.get(pid) == 1,
        identitySeen.get(pid) // before: it ran at once, without the identity
      )
    }
  ) @@ TestAspect.ifEnvSet("C8_REST_IT") @@ TestAspect.withLiveClock @@ TestAspect.timeout(4.minutes)
end C8LockRenewalIntegrationTest
