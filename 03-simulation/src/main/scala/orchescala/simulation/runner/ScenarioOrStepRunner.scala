package orchescala.simulation
package runner

import orchescala.engine.ProcessEngine
import orchescala.engine.domain.Incident
import zio.*

class ScenarioOrStepRunner(scenarioOrStep: ScenarioOrStep)(using
    engine: ProcessEngine,
    config: SimulationConfig
):

  private lazy val incidentService = engine.incidentService

  def tryOrFail(
      funct: => ResultType
  ): ResultType =
    val count = summon[ScenarioData].context.requestCount
    if count < config.maxCount then
      for
        _                  <- ZIO.sleep(1.second)
        given ScenarioData <-
          if !scenarioOrStep.isInstanceOf[IncidentScenario] then
            checkIfIncidentOccurred
          else
            ZIO.succeed(summon[ScenarioData])
        _                  <- ZIO.logDebug(
                                s"Waiting for ${scenarioOrStep.scenarioName} (${scenarioOrStep.typeName} - count: $count)"
                              )
        given ScenarioData <-
          funct(
            using
            summon[ScenarioData]
              .withRequestCount(count + 1)
              .info(
                s"Waiting for ${scenarioOrStep.scenarioName} (${scenarioOrStep.typeName} - count: $count)"
              )
          )
      yield summon[ScenarioData]
    else
      ZIO.fail(
        SimulationError.WaitingError(
          summon[ScenarioData]
            .error(
              s"Expected ${scenarioOrStep.scenarioName} (${scenarioOrStep.typeName}) was not found! Tried $count times."
            )
        )
      )
    end if
  end tryOrFail

  def waitFor(
      seconds: Int
  ): ResultType =
    ZIO.sleep(Duration.fromSeconds(seconds.toLong))
      .as(summon[ScenarioData].info(s"Waited for $seconds second(s)."))
  end waitFor

  protected def checkIfIncidentOccurred: ResultType =
    handleIncident(): incidents =>
      if incidents.isEmpty then
        ZIO.succeed(summon[ScenarioData]
          .debug(
            s"No incident so far for ${scenarioOrStep.scenarioName}."
          ))
      else
        ZIO.fail(
          SimulationError.ProcessError(
            summon[ScenarioData].error(
              s"There is a NON-EXPECTED error occurred: ${
                  incidents.headOption
                    .flatMap(_.incidentMessage)
                    .getOrElse("No incident message")
                }!"
            )
          )
        )

  def handleIncident(
      rootIncidentId: Option[String] = None
  )(
      handleBody: Seq[Incident] => ResultType
  ): ResultType =
    val processInstanceId =
      rootIncidentId.orElse(Some(summon[ScenarioData].context.processInstanceId))
    incidentService
      .getIncidents(
        processInstanceId = processInstanceId,
        incidentId = rootIncidentId
      ).mapError: err =>
        SimulationError.ProcessError(
          summon[ScenarioData].error(
            s"Problem getting Incidents: ${err.errorMsg}"
          )
        )
      .flatMap: incidents =>
        handleBody(incidents)

  end handleIncident

end ScenarioOrStepRunner
