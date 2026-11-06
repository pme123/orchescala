package orchescala.worker.c8

import io.circe.{Json, JsonObject}
import orchescala.domain.*
import orchescala.engine.{DefaultEngineConfig, EngineConfig}
import orchescala.engine.c8.*
import orchescala.engine.domain.*
import orchescala.worker.*
import zio.*
import zio.test.*

/** The own process instance in FEEL is `camunda.processInstance.key` (Camunda 8.10) - the InitWorker
  * does not set a variable `processInstanceId`. Only if `C8_REST_IT` is set (and `C8_GRPC_IT`,
  * default `http://localhost:26500`), e.g. a local c8run 8.10:
  * {{{
  * C8_REST_IT=http://localhost:8181 sbt "workerC8/testOnly orchescala.worker.c8.C8ProcessInstanceKeyIntegrationTest"
  * }}}
  */
object C8ProcessInstanceKeyIntegrationTest extends ZIOSpecDefault:

  private val processId = "orchescala-it-process-instance-key"

  private val bpmn =
    s"""<?xml version="1.0" encoding="UTF-8"?>
       |<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
       |  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="defs"
       |  targetNamespace="http://bpmn.io/schema/bpmn">
       |  <bpmn:process id="$processId" isExecutable="true">
       |    <bpmn:startEvent id="start"/>
       |    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="init"/>
       |    <bpmn:serviceTask id="init">
       |      <bpmn:extensionElements><zeebe:taskDefinition type="$processId" retries="1"/></bpmn:extensionElements>
       |    </bpmn:serviceTask>
       |    <bpmn:sequenceFlow id="f2" sourceRef="init" targetRef="key"/>
       |    <bpmn:scriptTask id="key">
       |      <bpmn:extensionElements><zeebe:script expression="=string(camunda.processInstance.key)" resultVariable="ownKey"/></bpmn:extensionElements>
       |    </bpmn:scriptTask>
       |    <bpmn:sequenceFlow id="f3" sourceRef="key" targetRef="end"/>
       |    <bpmn:endEvent id="end"/>
       |  </bpmn:process>
       |</bpmn:definitions>""".stripMargin

  private object InitKeyWorker
      extends C8Worker[NoInput, NoOutput], InitWorkerDsl[NoInput, NoOutput, NoInput, NoInput]:
    lazy val c8Context: C8Context = new C8Context:
      lazy val engineConfig: EngineConfig = DefaultEngineConfig()
      lazy val workerConfig: WorkerConfig =
        DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
    protected def inOutExample: Process[NoInput, NoOutput, NoInput] =
      Process(InOutDescr(processId, NoInput(), NoOutput(), None), NoInput(), ProcessLabels.none)
    override protected def customInit(in: NoInput): NoInput = NoInput()
  end InitKeyWorker

  /** Starts the process and returns its key and its variables once completed. */
  private def run(variables: JsonObject): ZIO[Scope, Throwable, (String, Map[String, Option[Json]])] =
    val restAddress = sys.env("C8_REST_IT")
    val grpcAddress = sys.env.getOrElse("C8_GRPC_IT", "http://localhost:26500")
    given C8RestClient = C8RestClient(restAddress, C8RestAuth.NoAuth)
    given EngineConfig = DefaultEngineConfig()
    given WorkerConfig = DefaultWorkerConfig(DefaultEngineConfig(), identityVerification = false)
    val engine         = C8ProcessEngine()
    for
      _        <- engine.deploymentService.deploy(
                    "it-process-instance-key",
                    Seq(DeploymentResource(s"$processId.bpmn", bpmn.getBytes, DeploymentResourceType.Bpmn)),
                    Some(EngineType.C8)
                  )
      _        <- C8WorkerRegistry(C8DefaultNoAuthClient(grpcAddress, restAddress))
                    .register(Set(InitKeyWorker))
                    .provideLayer(SharedC8ClientManager.layer)
                    .forkScoped
      started  <- engine.processInstanceService.startProcessAsync(processId, variables, None, None, None)
      _        <- engine.historicProcessInstanceService
                    .getProcessInstance(started.processInstanceId)
                    .filterOrFail(_.state == HistoricProcessInstance.ProcessState.COMPLETED)(
                      EngineError.ProcessError("not yet completed")
                    )
                    .retry(Schedule.spaced(2.seconds) && Schedule.recurs(30))
      vars     <- engine.historicVariableService
                    .getVariables(None, Some(started.processInstanceId), None)
                    .filterOrFail(_.exists(_.name == "ownKey"))(EngineError.ProcessError("no ownKey yet"))
                    .retry(Schedule.spaced(2.seconds) && Schedule.recurs(15))
    yield started.processInstanceId -> vars.map(v => v.name -> v.value).toMap
    end for
  end run

  def spec = suite("C8 own process instance against a real cluster")(
    test("FEEL has the own key - camunda.processInstance.key, a number made a String") {
      for (key, vars) <- run(JsonObject())
      yield assertTrue(vars.get("ownKey").flatten.contains(Json.fromString(key)))
    },
    test("the InitWorker sets no processInstanceId - one from outside stays as it is") {
      for
        (_, without) <- run(JsonObject())
        (_, outside) <- run(JsonObject("processInstanceId" -> Json.fromString("outside-id")))
      yield assertTrue(
        !without.contains("processInstanceId"),
        outside.get("processInstanceId").flatten.contains(Json.fromString("outside-id"))
      )
    }
  ) @@ TestAspect.sequential @@ TestAspect.ifEnvSet("C8_REST_IT") @@ TestAspect.withLiveClock @@
    TestAspect.timeout(3.minutes)
end C8ProcessInstanceKeyIntegrationTest
