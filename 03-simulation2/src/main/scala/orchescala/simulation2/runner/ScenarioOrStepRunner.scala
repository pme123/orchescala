package orchescala.simulation2
package runner

import orchescala.engine.ProcessEngine
import orchescala.engine.domain.Incident
import zio.*

trait ScenarioOrStepRunner:
  def step: ScenarioOrStep
  def config: SimulationConfig
  def engine: ProcessEngine

  private lazy val incidentService = engine.incidentService

  protected def tryOrFail(
      scenarioData: ScenarioData,
      funct: ScenarioData => ResultType
  ): ResultType =
    val count = scenarioData.context.requestCount
    if count < config.maxCount then
      for
        _             <- ZIO.sleep(1.second)
        scenarioData1 <-
          if !step.isInstanceOf[IsIncidentScenario] then
            checkIfIncidentOccurred(scenarioData)
          else
            ZIO.succeed(scenarioData)
        scenarioData2 <- funct(
                           scenarioData
                             .withRequestCount(count + 1)
                             .info(
                               s"Waiting for ${step.name} (${step.typeName} - count: $count)"
                             )
                         )
      yield scenarioData1
    else
      ZIO.fail(
        SimulationError.WaitingError(
          scenarioData
            .error(
              s"Expected ${step.name} (${step.typeName}) was not found! Tried $count times."
            )
        )
      )
    end if
  end tryOrFail

  private def checkIfIncidentOccurred(data: ScenarioData): ResultType =
    handleIncident(data): (incidents, data) =>
      if incidents.isEmpty then
        ZIO.succeed(data
          .debug(
            s"No incident so far for ${step.name}."
          ))
      else
        ZIO.fail(
          SimulationError.ProcessError(
            data.error(
              s"There is a NON-EXPECTED error occurred: ${
                  incidents.headOption
                    .flatMap(_.incidentMessage)
                    .getOrElse("No incident message")
                }!"
            )
          )
        )

  private def handleIncident(
      data: ScenarioData,
      rootIncidentId: Option[String] = None
  )(
      handleBody: (Seq[Incident], ScenarioData) => ResultType
  ): ResultType =
    val processInstanceId = rootIncidentId.orElse(Some(data.context.processInstanceId))
    incidentService
      .getIncidents(
        processInstanceId = processInstanceId,
        incidentId = rootIncidentId
      ).mapError: err =>
        SimulationError.ProcessError(
          data.error(
            s"Problem getting Incidents: ${err.errorMsg}"
          )
        )
      .flatMap: incidents =>
        handleBody(incidents, data)

  end handleIncident

end ScenarioOrStepRunner
