package orchescala.simulation2
package runner

import orchescala.domain.{CamundaProperty, CamundaVariable, JsonProperty}
import orchescala.engine.ProcessEngine
import orchescala.engine.domain.HistoricVariable
import zio.*
import zio.ZIO.logInfo

class ProcessStepsRunner(hasProcessSteps: HasProcessSteps)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
):
  private lazy val historicProcessInstanceService = engine.historicProcessInstanceService
  private lazy val historicVariableService        = engine.historicVariableService
  private lazy val scenarioOrStepRunner = ScenarioOrStepRunner(hasProcessSteps)

  def runSteps: ResultType =
    ZIO.foldLeft(hasProcessSteps.steps)(summon[ScenarioData]): (data, step) =>
      runStep(step)(using data)

  private def runStep(step: SStep): ResultType =
    ZIO.logInfo("Running Step: " + step.name) *>
      (step match
          case ut: SUserTask      =>
            UserTaskRunner(ut).getAndComplete
          case e: SMessageEvent   =>
            MessageRunner(e).sendMessage
          case e: SSignalEvent    =>
            SignalRunner(e).sendSignal
          case e: STimerEvent     =>
             TimerRunner(e).getAndExecute
          case SWaitTime(seconds) =>
            scenarioOrStepRunner.waitFor(seconds)
      )

  def check: ResultType =
    for
      given ScenarioData <- ZIO.succeed(summon[ScenarioData].info(s"Checking Process: ${hasProcessSteps.name}"))
      given ScenarioData <- checkFinished(using summon[ScenarioData].withRequestCount(0))
      given ScenarioData <- checkVars
    yield summon[ScenarioData]
  end check

  def checkFinished: ResultType =
    import orchescala.engine.domain.HistoricProcessInstance.ProcessState
    val processInstanceId = summon[ScenarioData].context.processInstanceId
    for
      instance           <-
        historicProcessInstanceService
          .getProcessInstance(
            processInstanceId
          ).mapError: err =>
            SimulationError.ProcessError(
              summon[ScenarioData].error(err.errorMsg)
            )
      given ScenarioData <- instance.state match
                              case ProcessState.COMPLETED | ProcessState.TERMINATED =>
                                ZIO.succeed(
                                  summon[ScenarioData]
                                    .info(s"Process ${hasProcessSteps.name} has finished.")
                                )
                              case state                                            =>
                                given ScenarioData =
                                  summon[ScenarioData].debug(
                                    s"State for ${hasProcessSteps.name} is $state"
                                  )
                                scenarioOrStepRunner.tryOrFail(checkFinished)
    yield summon[ScenarioData]
    end for
  end checkFinished

  private def checkVars: ResultType =
    val processInstanceId = summon[ScenarioData].context.processInstanceId
    for
      _                  <- ZIO.logInfo(s"Fetching Variables for ${hasProcessSteps.name}")
      variableDtos       <-
        historicVariableService
          .getVariables(
            variableName = None,
            processInstanceId = Some(processInstanceId)
          ).mapError: err =>
            err.printStackTrace()
            SimulationError.ProcessError(
              summon[ScenarioData].error(err.errorMsg)
            )
      _                  <- ZIO.logInfo(s"Variables fetched for ${hasProcessSteps.name}: $variableDtos")
      given ScenarioData <-
        ResultChecker.checkProps(
          hasProcessSteps.asInstanceOf[WithTestOverrides[?]],
          mapVariablesToJsonProperties(variableDtos, summon[ScenarioData])
        )
    yield summon[ScenarioData]

  end checkVars

  private def mapVariablesToJsonProperties(
      variables: List[HistoricVariable],
      data: ScenarioData
  ): Seq[JsonProperty] =
    variables
      .map: v =>
        JsonProperty(v.name, v.value.map(_.toJson).getOrElse(Json.Null))
end ProcessStepsRunner
