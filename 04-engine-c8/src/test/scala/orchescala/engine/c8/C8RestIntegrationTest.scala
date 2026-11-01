package orchescala.engine.c8

import io.circe.{Json, JsonObject}
import orchescala.engine.{DefaultEngineConfig, EngineConfig}
import orchescala.engine.domain.*
import zio.*
import zio.test.*

/** Runs the C8 engine services against a real cluster - only if `C8_REST_IT` is set to its REST
  * address (no auth), e.g. a local c8run:
  * {{{
  * C8_REST_IT=http://localhost:8181 sbt "engineC8/testOnly orchescala.engine.c8.C8RestIntegrationTest"
  * }}}
  */
object C8RestIntegrationTest extends ZIOSpecDefault:

  private val processId   = "orchescala-rest-it"
  private val messageName = "orchescala-it-msg"

  private val bpmn =
    s"""<?xml version="1.0" encoding="UTF-8"?>
       |<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
       |  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="defs"
       |  targetNamespace="http://bpmn.io/schema/bpmn">
       |  <bpmn:process id="$processId" isExecutable="true">
       |    <bpmn:startEvent id="start"/>
       |    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="task1"/>
       |    <bpmn:userTask id="task1" name="Task 1">
       |      <bpmn:extensionElements><zeebe:userTask/></bpmn:extensionElements>
       |    </bpmn:userTask>
       |    <bpmn:sequenceFlow id="f2" sourceRef="task1" targetRef="waitMsg"/>
       |    <bpmn:intermediateCatchEvent id="waitMsg">
       |      <bpmn:messageEventDefinition messageRef="msg"/>
       |    </bpmn:intermediateCatchEvent>
       |    <bpmn:sequenceFlow id="f3" sourceRef="waitMsg" targetRef="end"/>
       |    <bpmn:endEvent id="end"/>
       |  </bpmn:process>
       |  <bpmn:message id="msg" name="$messageName">
       |    <bpmn:extensionElements><zeebe:subscription correlationKey="=businessKey"/></bpmn:extensionElements>
       |  </bpmn:message>
       |</bpmn:definitions>""".stripMargin

  private val msgStartProcessId = "orchescala-rest-it-msgstart"
  private val startMessageName  = "orchescala-it-start"

  // started by a message; the user task keeps the instance alive to set the correlation
  private val msgStartBpmn =
    s"""<?xml version="1.0" encoding="UTF-8"?>
       |<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
       |  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="defs2"
       |  targetNamespace="http://bpmn.io/schema/bpmn">
       |  <bpmn:process id="$msgStartProcessId" isExecutable="true">
       |    <bpmn:startEvent id="start"><bpmn:messageEventDefinition messageRef="startMsg"/></bpmn:startEvent>
       |    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="task1"/>
       |    <bpmn:userTask id="task1" name="Task 1">
       |      <bpmn:extensionElements><zeebe:userTask/></bpmn:extensionElements>
       |    </bpmn:userTask>
       |    <bpmn:sequenceFlow id="f2" sourceRef="task1" targetRef="end"/>
       |    <bpmn:endEvent id="end"/>
       |  </bpmn:process>
       |  <bpmn:message id="startMsg" name="$startMessageName"/>
       |</bpmn:definitions>""".stripMargin


  private val uniqueProcessId   = "orchescala-rest-it-unique"
  private val uniqueMessageName = "orchescala-it-unique-start"

  // «Einmalige Ausführung»: a second start message with the businessKey lands in the event subprocess
  private val uniqueBpmn =
    s"""<?xml version="1.0" encoding="UTF-8"?>
       |<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
       |  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="defs3"
       |  targetNamespace="http://bpmn.io/schema/bpmn">
       |  <bpmn:process id="$uniqueProcessId" isExecutable="true">
       |    <bpmn:startEvent id="start"><bpmn:messageEventDefinition messageRef="startMsg"/></bpmn:startEvent>
       |    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="task1"/>
       |    <bpmn:userTask id="task1" name="Task 1">
       |      <bpmn:extensionElements><zeebe:userTask/></bpmn:extensionElements>
       |    </bpmn:userTask>
       |    <bpmn:sequenceFlow id="f2" sourceRef="task1" targetRef="end"/>
       |    <bpmn:endEvent id="end"/>
       |    <bpmn:subProcess id="alreadyRunning" triggeredByEvent="true">
       |      <bpmn:startEvent id="again" isInterrupting="false">
       |        <bpmn:messageEventDefinition messageRef="startMsg"/>
       |      </bpmn:startEvent>
       |      <bpmn:sequenceFlow id="f3" sourceRef="again" targetRef="againEnd"/>
       |      <bpmn:endEvent id="againEnd"/>
       |    </bpmn:subProcess>
       |  </bpmn:process>
       |  <bpmn:message id="startMsg" name="$uniqueMessageName">
       |    <bpmn:extensionElements><zeebe:subscription correlationKey="=businessKey"/></bpmn:extensionElements>
       |  </bpmn:message>
       |</bpmn:definitions>""".stripMargin

  // search results are eventually consistent (exported asynchronously)
  private def eventually[A](effect: IO[EngineError, A])(done: A => Boolean): IO[EngineError, A] =
    effect
      .filterOrElseWith(done)(a => ZIO.fail(EngineError.ProcessError(s"not yet: $a")))
      .retry(Schedule.spaced(500.millis) && Schedule.recurs(60))

  def spec = suite("C8 REST services against a real cluster")(
    test("deploy, start, variables, user task, message, deployments, errors") {
      val restAddress = sys.env("C8_REST_IT")
      given C8RestClient  = C8RestClient(restAddress, C8RestAuth.NoAuth)
      given EngineConfig  = DefaultEngineConfig()
      val engine          = C8ProcessEngine()
      val businessKey     = s"bk-${java.util.UUID.randomUUID()}"
      // longer than the ~8KB the API truncates to by default
      val bigValue        = "x" * 20000
      for
        deployed  <- engine.deploymentService.deploy(
                       "it",
                       Seq(DeploymentResource(s"$processId.bpmn", bpmn.getBytes, DeploymentResourceType.Bpmn)),
                       Some(EngineType.C8)
                     )
        started   <- engine.processInstanceService.startProcessAsync(
                       processId,
                       JsonObject("count" -> Json.fromInt(5), "big" -> Json.fromString(bigValue)),
                       Some(businessKey),
                       None,
                       None
                     )
        pid        = started.processInstanceId
        variables <- eventually(
                       engine.historicVariableService.getVariables(None, Some(pid), Some(Seq("count", "big", "businessKey")))
                     )(_.size == 3)
        instance  <- eventually(engine.historicProcessInstanceService.getProcessInstance(pid))(_ => true)
        task      <- eventually(engine.userTaskService.getUserTask(pid, "task1"))(_.isDefined)
        _         <- engine.userTaskService.complete(task.get.id, JsonObject("approved" -> Json.True), None)
        _         <- eventually(
                       engine.messageService.sendMessage(messageName, None, None, Some(businessKey), None, None)
                     )(_ => true)
        completed <- eventually(engine.historicProcessInstanceService.getProcessInstance(pid))(
                       _.state == HistoricProcessInstance.ProcessState.COMPLETED
                     )
        allVars   <- eventually(engine.historicVariableService.getVariables(None, Some(pid), None))(
                       _.exists(_.name == "approved")
                     )
        _         <- engine.signalService.sendSignal("orchescala-it-signal-without-subscriber")
        infos     <- eventually(engine.deploymentService.getDeployments(Some(EngineType.C8)))(
                       _.exists(_.name == processId)
                     )
        incidents <- engine.incidentService.getIncidents(None, Some(pid))
        notFound  <- engine.historicProcessInstanceService.getProcessInstance("1").flip
      yield
        val byName = variables.map(v => v.name -> v.value).toMap
        assertTrue(
          deployed.deployedProcesses.exists(_.key == processId),
          byName("count").contains(Json.fromInt(5)),
          byName("big").contains(Json.fromString(bigValue)), // not truncated
          byName("businessKey").contains(Json.fromString(businessKey)),
          instance.processDefinitionId == processId,
          task.get.taskDefinitionKey.contains("task1"), // the user task's BPMN id, like C7
          completed.state == HistoricProcessInstance.ProcessState.COMPLETED,
          allVars.exists(v => v.name == "approved" && v.value.contains(Json.True)),
          infos.exists(i => i.name == processId && i.engineType.contains(EngineType.C8)),
          incidents.isEmpty,
          notFound match
            case EngineError.ServiceRequestError(404, _) => true
            case _                                        => false
        )
      end for
    },
    test("start by message with identity correlation: signed with the started instance") {
      val restAddress = sys.env("C8_REST_IT")
      given C8RestClient = C8RestClient(restAddress, C8RestAuth.NoAuth)
      given EngineConfig = DefaultEngineConfig(identitySigningKey = Some("it-signing-key"))
      val engine         = C8ProcessEngine()
      for
        _         <- engine.deploymentService.deploy(
                       "it-msgstart",
                       Seq(DeploymentResource(s"$msgStartProcessId.bpmn", msgStartBpmn.getBytes, DeploymentResourceType.Bpmn)),
                       Some(EngineType.C8)
                     )
        started   <- eventually( // the message subscription of a fresh deployment may need a moment
                       engine.processInstanceService.startProcessByMessage(
                         startMessageName,
                         businessKey = Some(s"bk-${java.util.UUID.randomUUID()}"),
                         identityCorrelation = Some(orchescala.domain.IdentityCorrelation("alice", Some("alice@example.com")))
                       )
                     )(_ => true)
        pid        = started.processInstanceId
        instance  <- eventually(engine.historicProcessInstanceService.getProcessInstance(pid))(_ => true)
        variables <- eventually(
                       engine.historicVariableService.getVariables(None, Some(pid), Some(Seq("_identityCorrelation")))
                     )(_.nonEmpty)
      yield
        val signed = variables.head.value.flatMap(_.as[orchescala.domain.IdentityCorrelation].toOption)
        assertTrue(
          instance.processDefinitionId == msgStartProcessId, // a real process instance key
          signed.flatMap(_.processInstanceId).contains(pid),
          signed.exists(c =>
            orchescala.domain.IdentityCorrelationSigner.verify(c, pid, c.signature.get, "it-signing-key")
          )
        )
      end for
    },
    test("start by message with a businessKey: with the pattern a second start is a 409 - also at the same time; without, a new instance") {
      val restAddress = sys.env("C8_REST_IT")
      given C8RestClient = C8RestClient(restAddress, C8RestAuth.NoAuth)
      given EngineConfig = DefaultEngineConfig(identitySigningKey = Some("it-signing-key"))
      val engine         = C8ProcessEngine()
      val service        = engine.processInstanceService
      def bk             = s"bk-${java.util.UUID.randomUUID()}"
      def conflict(exit: Exit[EngineError, ProcessInfo]) = exit match
        case Exit.Failure(cause) =>
          cause.failureOption.exists:
            case EngineError.ServiceRequestError(409, _) => true
            case _                                       => false
        case _                   => false
      for
        _         <- engine.deploymentService.deploy(
                       "it-unique",
                       Seq(
                         DeploymentResource(s"$uniqueProcessId.bpmn", uniqueBpmn.getBytes, DeploymentResourceType.Bpmn),
                         DeploymentResource(s"$msgStartProcessId.bpmn", msgStartBpmn.getBytes, DeploymentResourceType.Bpmn)
                       ),
                       Some(EngineType.C8)
                     )
        // with the pattern: one after the other - the second with an identity, which must not stay there
        uniqueBk   = bk
        first     <- eventually(service.startProcessByMessage(uniqueMessageName, businessKey = Some(uniqueBk)))(_ => true)
        second    <- service.startProcessByMessage(
                       uniqueMessageName,
                       businessKey = Some(uniqueBk),
                       identityCorrelation = Some(orchescala.domain.IdentityCorrelation("bob", None))
                     ).exit
        pending   <- eventually(
                       engine.historicVariableService.getVariables(None, Some(first.processInstanceId), Some(Seq("_identityCorrelationPending")))
                     )(_.exists(_.value.contains(Json.False)))
        // with the pattern: two at the same time - one starts
        parallelBk = bk
        parallel  <- ZIO.collectAllPar(
                       Seq.fill(2)(service.startProcessByMessage(uniqueMessageName, businessKey = Some(parallelBk)).exit)
                     )
        // without the pattern: a new instance each time
        plainBk    = bk
        plain1    <- service.startProcessByMessage(startMessageName, businessKey = Some(plainBk))
        plain2    <- service.startProcessByMessage(startMessageName, businessKey = Some(plainBk))
      yield assertTrue(
        conflict(second),
        pending.nonEmpty,
        parallel.count(_.isSuccess) == 1,
        parallel.count(conflict) == 1,
        plain1.processInstanceId != plain2.processInstanceId
      )
      end for
    }
  ) @@ TestAspect.ifEnvSet("C8_REST_IT") @@ TestAspect.withLiveClock @@ TestAspect.timeout(2.minutes)
end C8RestIntegrationTest
