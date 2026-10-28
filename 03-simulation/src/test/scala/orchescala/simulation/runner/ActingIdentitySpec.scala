package orchescala.simulation
package runner

import orchescala.domain.{IdentityCorrelation, InOutDescr, JsonProperty, MessageEvent, NoInput, NoOutput, SignalEvent, TimerEvent}
import orchescala.domain
import orchescala.engine.ProcessEngine
import orchescala.engine.domain.{EngineError, EngineType, MessageCorrelationResult}
import orchescala.engine.services.{MessageService, UserTaskService}
import zio.*
import zio.test.*

import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*
import scala.language.implicitConversions

/** A user task or message can act as another identity than the one that started the process -
  * so a simulation can show a take-over of the identity and its reset.
  */
object ActingIdentitySpec extends ZIOSpecDefault:

  private object Dsl extends SimulationDsl[Unit]:
    protected def run(sim: SSimulation): Unit = ()

    lazy val approveUT: domain.UserTask[NoInput, NoOutput] =
      domain.UserTask(InOutDescr("approve-ut", NoInput(), NoOutput()))
    lazy val resetMsg: MessageEvent[NoInput]               =
      MessageEvent("reset-msg", InOutDescr("reset-msg", NoInput()))

    lazy val `Approve as actor`: SUserTask        = approveUT.actingAs(testActorIdentityCorrelation)
    lazy val `Reset as actor`: SMessageEvent      = resetMsg.actingAs(testActorIdentityCorrelation)
    lazy val `Approve as starter`: SUserTask      = approveUT
    lazy val `Approve, then wait`: SUserTask      =
      approveUT.actingAs(testActorIdentityCorrelation).waitForSec(1)
    lazy val `Reset by key, ready`: SMessageEvent =
      resetMsg.actingAs(testActorIdentityCorrelation).withBusinessKey("bk-1").waitFor("ready")

    // waitFor / waitForSec after add: the check must survive
    lazy val approveChecked: SUserTask   =
      SUserTask("approve checked", approveUT).add(check).waitForSec(1)
    lazy val startChecked: SMessageEvent =
      SMessageEvent("start checked", resetMsg).start.add(check).waitFor("ready")
    lazy val signalChecked: SSignalEvent =
      SSignalEvent("signal checked", SignalEvent.init("sig")).add(check).waitFor("ready")
    lazy val timerChecked: STimerEvent   =
      STimerEvent("timer checked", TimerEvent.init("timer")).add(check).waitFor("ready")
  end Dsl

  private lazy val check = TestOverride(Some("approved"), TestOverrideType.Exists)

  /** An engine with a user task `t-1` and a message service - records the identity of each call. */
  private class RecordingEngine extends ProcessEngine:
    val completed = ConcurrentLinkedQueue[Option[IdentityCorrelation]]()
    // (processInstanceId, identity) of each message
    val sent      = ConcurrentLinkedQueue[(Option[String], Option[IdentityCorrelation])]()

    val userTaskService: UserTaskService = new UserTaskService:
      def engineType                                                     = EngineType.C7
      def getUserTask(processInstanceId: String, userTaskDefId: String) =
        ZIO.some(orchescala.engine.domain.UserTask(id = "t-1"))
      def complete(
          taskId: String,
          processVariables: io.circe.JsonObject,
          identityCorrelation: Option[IdentityCorrelation]
      ) =
        ZIO.succeed(completed.add(identityCorrelation)).unit
      def variables(taskId: String, processInstanceId: String, variableFilter: Option[Seq[String]]) =
        ZIO.succeed(Seq.empty[JsonProperty])

    val messageService: MessageService = new MessageService:
      def engineType = EngineType.C7
      def sendMessage(
          name: String,
          tenantId: Option[String],
          timeToLiveInSec: Option[Int],
          businessKey: Option[String],
          processInstanceId: Option[String],
          variables: Option[io.circe.JsonObject],
          identityCorrelation: Option[IdentityCorrelation]
      ): IO[EngineError, MessageCorrelationResult] =
        ZIO.succeed(sent.add(processInstanceId -> identityCorrelation))
          .as(MessageCorrelationResult.ProcessInstance("pi-1", "pi-1", EngineType.C7))

    def processInstanceService         = ???
    def historicProcessInstanceService = ???
    def historicVariableService        = ???
    def incidentService                = ???
    def jobService                     = ???
    def signalService                  = ???
    def deploymentService              = ???
  end RecordingEngine

  private given SimulationConfig = DefaultSimulationConfig()
  private given ScenarioData     = ScenarioData("identity", ContextData(processInstanceId = "pi-1"))

  def spec = suite("Acting as another identity")(
    test("actingAs: the step is named after its val and keeps the identity") {
      assertTrue(
        Dsl.`Approve as actor`.scenarioName == "Approve as actor",
        Dsl.`Approve as actor`.identityCorrelation == testActorIdentityCorrelation,
        Dsl.`Reset as actor`.scenarioName == "Reset as actor",
        Dsl.`Reset as actor`.identityCorrelation == testActorIdentityCorrelation,
        testActorIdentityCorrelation.username != testIdentityCorrelation.username
      )
    },
    test("without actingAs: the identity that started the process") {
      assertTrue(
        Dsl.`Approve as starter`.identity.isEmpty,
        Dsl.`Approve as starter`.identityCorrelation == testIdentityCorrelation
      )
    },
    test("waitForSec / waitFor keep the identity and the other settings of the step") {
      val msg = Dsl.`Reset by key, ready`
      assertTrue(
        Dsl.`Approve, then wait`.identityCorrelation == testActorIdentityCorrelation,
        Dsl.`Approve, then wait`.waitForSec.contains(1),
        msg.identityCorrelation == testActorIdentityCorrelation,
        msg.businessKey.contains("bk-1"),
        msg.optReadyVariable.contains("ready")
      )
    },
    test("waitFor / waitForSec keep the test overrides and .start") {
      val checked = Some(TestOverrides(Seq(check)))
      assertTrue(
        Dsl.approveChecked.testOverrides == checked,
        Dsl.approveChecked.waitForSec.contains(1),
        Dsl.startChecked.testOverrides == checked,
        !Dsl.startChecked.processInstanceId,
        Dsl.startChecked.optReadyVariable.contains("ready"),
        Dsl.signalChecked.testOverrides == checked,
        Dsl.signalChecked.readyVariable == "ready",
        Dsl.timerChecked.testOverrides == checked,
        Dsl.timerChecked.optReadyVariable.contains("ready")
      )
    },
    test("a user task is completed as its identity - the starter by default") {
      val engine          = RecordingEngine()
      given ProcessEngine = engine
      for
        _ <- UserTaskRunner(Dsl.`Approve as starter`).getAndComplete
        _ <- UserTaskRunner(Dsl.`Approve as actor`).getAndComplete
      yield assertTrue(
        engine.completed.asScala.toSeq == Seq(Some(testIdentityCorrelation), Some(testActorIdentityCorrelation))
      )
    },
    test("a message is sent as its identity") {
      val engine          = RecordingEngine()
      given ProcessEngine = engine
      for _ <- MessageRunner(Dsl.`Reset as actor`).sendMessage
      yield assertTrue(engine.sent.asScala.toSeq == Seq(Some("pi-1") -> Some(testActorIdentityCorrelation)))
    },
    // the engine adds the actor only to a known process instance (see C7ActorIdentityTest /
    // C8RestClientTest) - so a message that starts a process or goes by businessKey has none
    test("a message by .start or businessKey goes without a process instance") {
      val engine          = RecordingEngine()
      given ProcessEngine = engine
      for
        _ <- MessageRunner(
               SMessageEvent("start", Dsl.resetMsg).start.actingAs(testActorIdentityCorrelation)
             ).sendMessage
        _ <- MessageRunner(
               SMessageEvent("by key", Dsl.resetMsg).withBusinessKey("bk-1").actingAs(testActorIdentityCorrelation)
             ).sendMessage
      yield assertTrue(engine.sent.asScala.toSeq.map(_._1) == Seq(None, None))
    }
  )
end ActingIdentitySpec
