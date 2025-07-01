package orchescala.simulation
package runner

import orchescala.domain.{InOutDecoder, InOutEncoder}
import orchescala.engine.{EngineError, ProcessEngine}
import orchescala.simulation.{
  IncidentScenario,
  ProcessStartType,
  ScenarioData,
  SimulationConfig,
  SimulationError
}
import zio.ZIO.*
import zio.{IO, ZIO}

import scala.reflect.ClassTag

class IncidentScenarioRunner(incidentScenario: IncidentScenario)(using
                                                                     val engine: ProcessEngine,
                                                                     val config: SimulationConfig
):
  private lazy val processInstanceService = engine.jProcessInstanceService
  private lazy val scenarioRunner       = ScenarioRunner(incidentScenario)
  private lazy val isProcessScenarioRunner = IsProcessScenarioRunner(incidentScenario)
  private lazy val scenarioOrStepRunner = ScenarioOrStepRunner(incidentScenario)

  def run: IO[SimulationError, ScenarioData] =
    for
      _    <- ZIO.logInfo(s"Running IncidentScenario: ${incidentScenario.scenarioName}")
      data <-
        scenarioRunner.logScenario: (data: ScenarioData) =>
          given ScenarioData = data
          if incidentScenario.process == null then
            ZIO.succeed:
              data.error(
                "The process is null! Check if your variable is LAZY (`lazy val myProcess = ...`)."
              )
          else
            (for
              given ScenarioData <- incidentScenario.startType match
                                      case ProcessStartType.START   => isProcessScenarioRunner.startProcess
                                      case ProcessStartType.MESSAGE => isProcessScenarioRunner.sendMessage
              given ScenarioData <- ProcessStepsRunner(incidentScenario).runSteps
              given ScenarioData <- checkIncident()(using
                                      summon[ScenarioData].withRequestCount(0)
                                    )
            yield summon[ScenarioData]).fold(
              err =>
                err.scenarioData,
              scenData => scenData
            )
          end if
    yield data

  def checkIncident(
      rootIncidentId: Option[String] = None
  ): ResultType =
    scenarioOrStepRunner.handleIncident(rootIncidentId): incidents =>
      if incidents.isEmpty then
        scenarioOrStepRunner.tryOrFail(checkIncident(rootIncidentId))
      else
        val incident = incidents.head
        (incident.incidentMessage, incident.id, incident.rootCauseIncidentId) match
          case (Some(incidentMessage), _, _) if incidentMessage.contains(incidentScenario.incidentMsg) =>
            ZIO.succeed:
              summon[ScenarioData]
                .info(
                  s"Process ${incidentScenario.scenarioName} has finished with incident (as expected)."
                )
          case (Some(incidentMessage), _, _)                                                   =>
            ZIO.fail:
              SimulationError.ProcessError(
                summon[ScenarioData].error(
                  "The Incident contains not the expected message." +
                    s"\nExpected: ${incidentScenario.incidentMsg}\nActual Message: $incidentMessage"
                )
              )
          case (None, id, rootCauseIncidentId) if !rootCauseIncidentId.contains(id)            =>
            checkIncident(rootCauseIncidentId)(using
              summon[ScenarioData].info(
                s"Incident Message only in Root incident $rootCauseIncidentId"
              )
            )
          case _                                                                               =>
            ZIO.fail:
              SimulationError.ProcessError(
                summon[ScenarioData]
                  .error(
                    "The Incident does not contain any incidentMessage."
                  )
              )
        end match

  end checkIncident
end IncidentScenarioRunner
