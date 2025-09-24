package orchescala.simulation
package runner

import orchescala.domain.{InOutDecoder, InOutEncoder}
import orchescala.engine.{EngineError, ProcessEngine}
import zio.ZIO.*
import zio.{IO, ZIO}

import scala.reflect.ClassTag

class IsProcessScenarioRunner(scenario: IsProcessScenario)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
):

  private lazy val processInstanceService = engine.processInstanceService
  private lazy val messageService         = engine.messageService
  private lazy val scenarioOrStepRunner = ScenarioOrStepRunner(scenario)

  private[simulation] def startProcess: ResultType =
    for
      _                  <-
        logDebug(
          s"Starting process: ${scenario.process.processName} - ${scenario.process.camundaInBody.asJson}"
        )
      given ScenarioData <-
        processInstanceService.startProcessAsync(
          scenario.process.processName,
          scenario.process.camundaInBody,
          Some(scenario.name)
        ).mapError: err =>
          SimulationError.ProcessError(
            summon[ScenarioData].error(
              s"Problem starting Process '${scenario.process.processName}': ${err.errorMsg}"
            )
          )
        .map: engineProcessInfo =>
          summon[ScenarioData].withProcessInstanceId(engineProcessInfo.processInstanceId)
            .info(
              s"Process '${scenario.process.processName}' started (check ${config.cockpitUrl(engineProcessInfo.processInstanceId)})"
            )
    yield summon[ScenarioData]
  end startProcess

  private[simulation] def sendMessage: ResultType =
    def correlate: ResultType =
      val msgName           = scenario.inOut.id
      val businessKey       = Some(scenario.name)
      val tenantId          = config.tenantId
      for
        given ScenarioData <- messageService
                                .sendMessage(
                                  name = msgName,
                                  tenantId = tenantId,
                                  businessKey = businessKey,
                                  variables = Some(scenario.inOut.camundaInMap)
                                )
                                .map: result =>
                                  summon[ScenarioData]
                                    .withProcessInstanceId(result.id)
                                    .info(
                                      s"Process '${scenario.process.processName}' started (check ${config.cockpitUrl(result.id)})"
                                    )
                                .mapError: err =>
                                  SimulationError.ProcessError(
                                    summon[ScenarioData].error(
                                      err.errorMsg
                                    )
                                  )
        _                  <- logInfo(s"Start Message ${summon[ScenarioData].context.taskId} sent")
      yield summon[ScenarioData]
      end for
    end correlate

    logInfo(
      s"Sending message: ${scenario.name}: ${summon[ScenarioData].context.processInstanceId}"
    ) *>
      correlate(using summon[ScenarioData].withRequestCount(0))
  end sendMessage

end IsProcessScenarioRunner
