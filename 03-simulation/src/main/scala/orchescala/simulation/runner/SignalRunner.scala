package orchescala.simulation.runner

import orchescala.domain.SignalEvent
import orchescala.engine.ProcessEngine
import orchescala.simulation.*
import zio.ZIO
import zio.ZIO.{logDebug, logInfo}

class SignalRunner(val signalScenario: SSignalEvent)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
):
  lazy val scenarioOrStep                   = signalScenario
  lazy val signalService          = engine.signalService
  lazy val processInstanceService = engine.jProcessInstanceService

  def sendSignal: ResultType =
    for
      given ScenarioData <- EventRunner(signalScenario).loadVariable
      given ScenarioData <- sndSgnl
    yield summon[ScenarioData]

  private def sndSgnl: ResultType =

    for
      given ScenarioData <- signalService
                              .sendSignal(
                                name = signalScenario.inOut.messageName.replace(
                                  SignalEvent.Dynamic_ProcessInstance,
                                  summon[ScenarioData].context.processInstanceId
                                ),
                                tenantId = config.tenantId,
                                variables = Some(signalScenario.inOut.camundaInMap)
                              )
                              .as:
                                summon[ScenarioData]
                                  .info(
                                    s"Signal '${signalScenario.scenarioName}' sent successfully."
                                  )
                              .mapError: err =>
                                SimulationError.ProcessError(
                                  summon[ScenarioData].error(
                                    err.errorMsg
                                  )
                                )
      _                  <- logInfo(s"Signal ${summon[ScenarioData].context.taskId} sent")
    yield summon[ScenarioData]
  end sndSgnl

end SignalRunner
