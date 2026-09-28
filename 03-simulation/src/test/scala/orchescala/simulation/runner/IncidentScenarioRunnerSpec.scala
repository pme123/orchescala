package orchescala.simulation
package runner

import orchescala.engine.ProcessEngine
import orchescala.engine.domain.{EngineError, Incident}
import orchescala.engine.services.IncidentService
import zio.*
import zio.test.*

import java.time.OffsetDateTime
import java.util.concurrent.atomic.AtomicInteger

object IncidentScenarioRunnerSpec extends ZIOSpecDefault:

  /** An engine with just incidents - every query counted. */
  private final class IncidentEngine(incidents: Map[Option[String], List[Incident]]) extends ProcessEngine:
    val queries = AtomicInteger(0)
    val incidentService: IncidentService = new IncidentService:
      def engineType                                                                     = orchescala.engine.domain.EngineType.C8
      def getIncidents(incidentId: Option[String], processInstanceId: Option[String]) =
        ZIO.succeed:
          queries.incrementAndGet()
          incidents.getOrElse(incidentId, Nil)
    def processInstanceService         = ???
    def historicProcessInstanceService = ???
    def historicVariableService        = ???
    def jobService                     = ???
    def messageService                 = ???
    def signalService                  = ???
    def userTaskService                = ???
    def deploymentService              = ???
  end IncidentEngine

  private def incident(id: String, message: Option[String], rootCause: Option[String]) =
    Incident(
      id = id,
      incidentTimestamp = OffsetDateTime.now(),
      incidentType = "JOB_NO_RETRIES",
      incidentMessage = message,
      rootCauseIncidentId = rootCause
    )

  private def check(engine: IncidentEngine) =
    given ProcessEngine    = engine
    given SimulationConfig = DefaultSimulationConfig()
    given ScenarioData     = ScenarioData("incident", ContextData(processInstanceId = "pi-1"))
    IncidentScenarioRunner(IncidentScenario("incident", null, incidentMsg = "expected")).checkIncident()

  def spec = suite("Checking the expected incident")(
    test("an incident without message and without root incident (C8): failed at once") {
      val engine = IncidentEngine(Map(None -> List(incident("i-1", None, None))))
      for exit <- check(engine).exit.timeout(5.seconds)
      yield assertTrue(
        exit.exists(_.isFailure), // before: the same incident queried again and again, no pause
        engine.queries.get == 1
      )
    } @@ TestAspect.withLiveClock,
    test("the message of the root incident (C7, e.g. a called process)") {
      val engine = IncidentEngine(Map(
        None       -> List(incident("i-1", None, Some("root-1"))),
        Some("root-1") -> List(incident("root-1", Some("the expected error"), Some("root-1")))
      ))
      for data <- check(engine)
      yield assertTrue(engine.queries.get == 2, data.logEntries.nonEmpty)
    },
    test("a root incident without message either: failed") {
      val engine = IncidentEngine(Map(
        None           -> List(incident("i-1", None, Some("root-1"))),
        Some("root-1") -> List(incident("root-1", None, Some("root-1")))
      ))
      for exit <- check(engine).exit
      yield assertTrue(exit.isFailure, engine.queries.get == 2)
    }
  )
end IncidentScenarioRunnerSpec
