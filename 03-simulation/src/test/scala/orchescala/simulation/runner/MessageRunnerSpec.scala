package orchescala.simulation
package runner

import orchescala.domain.{InOutDescr, MessageEvent, NoInput}
import orchescala.engine.ProcessEngine
import orchescala.engine.domain.{EngineError, MessageCorrelationResult}
import orchescala.engine.services.MessageService
import zio.*
import zio.test.*

object MessageRunnerSpec extends ZIOSpecDefault:

  /** An engine whose message service always refuses the message. */
  private object RefusingEngine extends ProcessEngine:
    val messageService: MessageService = new MessageService:
      def engineType = orchescala.engine.domain.EngineType.C7
      def sendMessage(
          name: String,
          tenantId: Option[String],
          timeToLiveInSec: Option[Int],
          businessKey: Option[String],
          processInstanceId: Option[String],
          variables: Option[io.circe.JsonObject],
          identityCorrelation: Option[orchescala.domain.IdentityCorrelation]
      ): IO[EngineError, MessageCorrelationResult] =
        ZIO.fail(EngineError.ServiceRequestError(400, "variable 'amount' has a wrong type"))
    def processInstanceService         = ???
    def historicProcessInstanceService = ???
    def historicVariableService        = ???
    // no incidents - checked between the tries
    val incidentService: orchescala.engine.services.IncidentService = new orchescala.engine.services.IncidentService:
      def engineType                                                                  = orchescala.engine.domain.EngineType.C7
      def getIncidents(incidentId: Option[String], processInstanceId: Option[String]) = ZIO.succeed(Nil)
    def jobService                     = ???
    def signalService                  = ???
    def userTaskService                = ???
    def deploymentService              = ???
  end RefusingEngine

  /** An engine that accepts every message - records what it got. */
  private class RecordingEngine extends ProcessEngine:
    val sent = java.util.concurrent.ConcurrentLinkedQueue[(Option[String], Option[orchescala.domain.IdentityCorrelation])]()
    val messageService: MessageService = new MessageService:
      def engineType = orchescala.engine.domain.EngineType.C7
      def sendMessage(
          name: String,
          tenantId: Option[String],
          timeToLiveInSec: Option[Int],
          businessKey: Option[String],
          processInstanceId: Option[String],
          variables: Option[io.circe.JsonObject],
          identityCorrelation: Option[orchescala.domain.IdentityCorrelation]
      ): IO[EngineError, MessageCorrelationResult] =
        ZIO.succeed(sent.add(processInstanceId -> identityCorrelation))
          .as(MessageCorrelationResult.ProcessInstance("pi-1", "pi-1", orchescala.engine.domain.EngineType.C7))
    def processInstanceService         = ???
    def historicProcessInstanceService = ???
    def historicVariableService        = ???
    def incidentService                = ???
    def jobService                     = ???
    def signalService                  = ???
    def userTaskService                = ???
    def deploymentService              = ???
  end RecordingEngine

  def spec = suite("Sending a message in a simulation")(
    test("a refused message fails with its error - it was only 'was not found'") {
      given ProcessEngine    = RefusingEngine
      given SimulationConfig = DefaultSimulationConfig(maxCount = 2)
      given ScenarioData     = ScenarioData("message", ContextData(processInstanceId = "pi-1"))
      val event              = SMessageEvent("message", MessageEvent("my-message", InOutDescr("my-message", NoInput())))
      for error <- MessageRunner(event).sendMessage.flip
      yield
        val logged = error match
          case SimulationError.WaitingError(data) => data.logEntries.map(_.toString).mkString("\n")
          case other                              => other.toString
        assertTrue(logged.contains("variable 'amount' has a wrong type"), logged.contains("Last error"))
    } @@ TestAspect.withLiveClock,
    test("a message to the process instance carries the test identity - the engine signs it as actor") {
      val engine             = RecordingEngine()
      given ProcessEngine    = engine
      given SimulationConfig = DefaultSimulationConfig()
      given ScenarioData     = ScenarioData("message", ContextData(processInstanceId = "pi-1"))
      val event              = SMessageEvent("message", MessageEvent("my-message", InOutDescr("my-message", NoInput())))
      for _ <- MessageRunner(event).sendMessage
      yield
        import scala.jdk.CollectionConverters.*
        assertTrue(engine.sent.asScala.toSeq == Seq(Some("pi-1") -> Some(testIdentityCorrelation)))
    }
  )
end MessageRunnerSpec
