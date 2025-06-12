package orchescala.simulation2
package runner

import orchescala.domain.{CamundaProperty, CamundaVariable, JsonProperty}
import orchescala.engine.ProcessEngine
import orchescala.engine.domain.HistoricVariable
import zio.*

class ProcessStepsRunner(hasProcessSteps: HasProcessSteps)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
) extends ScenarioOrStepRunner, ResultChecker:
  lazy val step                                   = hasProcessSteps
  private lazy val historicProcessInstanceService = engine.historicProcessInstanceService
  private lazy val historicVariableService        = engine.historicVariableService

  def runSteps(data: ScenarioData): ResultType =
    ZIO.foldLeft(hasProcessSteps.steps)(data): (data, step) =>
      runStep(step, data)

  private def runStep(step: SStep, data: ScenarioData): ResultType =
    ZIO.logInfo("Running Step: " + step.name) *>
      (step match
          case ut: SUserTask      =>
            ZIO.logInfo(s"Running UserTask: ${ut.name}") *>
              UserTaskRunner(ut).getAndComplete(data)
          case e: SMessageEvent   =>
            ZIO.succeed(data.info(s"Running MessageEvent: ${e.name}"))
          // e.sendMessage()
          case e: SSignalEvent    =>
            ZIO.succeed(data.info(s"Running SignalEvent: ${e.name}"))
          // e.sendSignal()
          case e: STimerEvent     =>
            ZIO.succeed(data.info(s"Running TimerEvent: ${e.name}"))
          // e.getAndExecute()
          case SWaitTime(seconds) =>
            ZIO.succeed(data.info(s"Running WaitTime: ${seconds}"))
            // step.waitFor(seconds)
      )

  def check(
      data: ScenarioData
  ): ResultType =
    for scenarioData1 <- checkFinished(data.withRequestCount(0))
    // scenarioData2 <- checkVars(scenarioData1)
    yield scenarioData1
  end check

  def checkFinished(data: ScenarioData): ResultType =
    import orchescala.engine.domain.HistoricProcessInstance.ProcessState
    val processInstanceId = data.context.processInstanceId
    for
      instance      <-
        historicProcessInstanceService
          .getProcessInstance(
            processInstanceId
          ).mapError: err =>
            SimulationError.ProcessError(
              data.error(err.errorMsg)
            )
      scenarioData1 <- instance.state match
                         case ProcessState.COMPLETED | ProcessState.TERMINATED =>
                           ZIO.succeed(
                             data
                               .info(s"Process ${hasProcessSteps.name} has finished.")
                           )
                         case state                                            =>
                           val scenData =
                             data.debug(s"State for ${hasProcessSteps.name} is $state")
                           tryOrFail(scenData, checkFinished)
    yield scenarioData1
    end for
  end checkFinished

  private def checkVars(scenarioData: ScenarioData): ResultType =
    val processInstanceId = scenarioData.context.processInstanceId
    for
      variableDtos <-
        historicVariableService
          .getVariables(
            variableName = None,
            processInstanceId = Some(processInstanceId)
          ).mapError: err =>
            SimulationError.ProcessError(
              scenarioData.error(err.errorMsg)
            )
    yield checkProps(
      hasProcessSteps.asInstanceOf[WithTestOverrides[?]],
      mapVariablesToJsonProperties(variableDtos, scenarioData),
      scenarioData
    )
    end for

  end checkVars

  private def mapVariablesToJsonProperties(
      variables: List[HistoricVariable],
      data: ScenarioData
  ): Seq[JsonProperty] =
    variables
      .map: v =>
        JsonProperty(v.name, v.value)
end ProcessStepsRunner
