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
          variables: Option[io.circe.JsonObject]
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
    } @@ TestAspect.withLiveClock
  )
end MessageRunnerSpec
