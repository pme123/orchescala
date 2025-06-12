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
) extends ScenarioOrStepRunner, ResultChecker:
  lazy val step                                   = hasProcessSteps
  private lazy val historicProcessInstanceService = engine.historicProcessInstanceService
  private lazy val historicVariableService        = engine.historicVariableService

  def runSteps: ResultType =
    ZIO.foldLeft(hasProcessSteps.steps)(summon[ScenarioData]): (data, step) =>
      runStep(step)(using data)

  private def runStep(step: SStep): ResultType =
    ZIO.logInfo("Running Step: " + step.name) *>
      (step match
          case ut: SUserTask      =>
            ZIO.logInfo(s"Running UserTask: ${ut.name}") *>
              UserTaskRunner(ut).getAndComplete
          case e: SMessageEvent   =>
            ZIO.succeed(summon[ScenarioData].info(s"Running MessageEvent: ${e.name}"))
          // e.sendMessage()
          case e: SSignalEvent    =>
            ZIO.succeed(summon[ScenarioData].info(s"Running SignalEvent: ${e.name}"))
          // e.sendSignal()
          case e: STimerEvent     =>
            ZIO.succeed(summon[ScenarioData].info(s"Running TimerEvent: ${e.name}"))
          // e.getAndExecute()
          case SWaitTime(seconds) =>
            ZIO.succeed(summon[ScenarioData].info(s"Running WaitTime: ${seconds}"))
            // step.waitFor(seconds)
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
                                tryOrFail(checkFinished)
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
        checkProps(
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
        JsonProperty(v.name, v.value.getOrElse(Json.Null))
end ProcessStepsRunner
