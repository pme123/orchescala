package orchescala.simulation2
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

  private lazy val processInstanceService = engine.jProcessInstanceService

  private[simulation2] def startProcess: ResultType =
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
              s"Process '${scenario.process.processName}' started (check ${config.cockpitUrl}/#/process-instance/${engineProcessInfo.processInstanceId})"
            )
    yield summon[ScenarioData]
  end startProcess

  private[simulation2] def sendMessage: ResultType =
    ZIO.succeed(summon[ScenarioData].info("Sending message"))
end IsProcessScenarioRunner
