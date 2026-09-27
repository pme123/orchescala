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

  /** Runs 75s - longer than its lock of 1 minute, which it renews every 30s. */
  private object LongJobWorker extends C8Worker[NoInput, NoOutput], CustomWorkerDsl[NoInput, NoOutput]:
    protected def c8Context: C8Context = new C8Context:
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
  ) @@ TestAspect.ifEnvSet("C8_REST_IT") @@ TestAspect.withLiveClock @@ TestAspect.timeout(4.minutes)
end C8LockRenewalIntegrationTest
