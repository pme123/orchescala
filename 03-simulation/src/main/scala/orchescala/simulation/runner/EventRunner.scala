package orchescala.simulation
package runner

import orchescala.engine.ProcessEngine
import zio.ZIO
import zio.ZIO.logInfo

class EventRunner(sEvent: SEvent)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
):
  private lazy val scenOrStepRunner = ScenarioOrStepRunner(sEvent)
  private lazy val historicVariableService = engine.historicVariableService

  def loadVariable: ResultType =
    val variableName      = sEvent.readyVariable
    val readyValue        = sEvent.readyValue
    val processInstanceId = summon[ScenarioData].context.processInstanceId
    for
      _                  <- logInfo(s"Fetching Variable for ${sEvent.inOut.id}: $processInstanceId - $variableName -> $readyValue")
      variables          <-
        historicVariableService
          .getVariables(
            variableName = Some(variableName),
            processInstanceId = Some(processInstanceId),
            variableFilter = Some(variableName)
          ).mapError: err =>
            SimulationError.ProcessError(
              summon[ScenarioData].error(err.errorMsg)
            )
      _                  <- logInfo(s"Variables fetched for ${sEvent.inOut.id}: $variables")
      given ScenarioData <-
        if variables.nonEmpty && variables.head.value.exists(_.value == readyValue) then
          ZIO.succeed(summon[ScenarioData]
            .info(
              s"Variable for '${sEvent.name}' ready ($variableName = '$readyValue')"
            ))
        else
          scenOrStepRunner.tryOrFail(loadVariable)
    yield summon[ScenarioData]
    end for
  end loadVariable
end EventRunner
