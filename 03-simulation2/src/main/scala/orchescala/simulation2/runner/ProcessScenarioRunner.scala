package orchescala.simulation2
package runner

import orchescala.domain.{InOutDecoder, InOutEncoder}
import orchescala.engine.EngineError
import orchescala.engine.ProcessEngine
import zio.{IO, ZIO}
import zio.ZIO.*

import scala.reflect.ClassTag

class ProcessScenarioRunner(val scenario: ProcessScenario)(using
    engine: ProcessEngine,
    val config: SimulationConfig
) extends ScenarioRunner:
  private lazy val processInstanceService = engine.jProcessInstanceService

  def run: IO[SimulationError, ScenarioData] =
    for
      _    <- ZIO.logInfo(s"Running ProcessScenario: ${scenario.name}")
      data <-
        logScenario: (data: ScenarioData) =>
          given ScenarioData = data
          if scenario.process == null then
            ZIO.succeed:
              data.error(
                "The process is null! Check if your variable is LAZY (`lazy val myProcess = ...`)."
              )
          else
            (for
              given ScenarioData <- scenario.startType match
                                 case ProcessStartType.START   => startProcess
                                 case ProcessStartType.MESSAGE => sendMessage
              given ScenarioData <- ProcessStepsRunner(scenario).runSteps
              given ScenarioData <- ProcessStepsRunner(scenario).check
            yield summon[ScenarioData]).fold(
              err =>
                err.scenarioData,
              scenData => scenData
            )
    yield data

  private[simulation2] def startProcess: ResultType =
    logDebug(s"Starting process: ${scenario.process.processName} - ${scenario.process.camundaInBody.asJson}") *>
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
            s"Process '${scenario.process.processName}' started (check $cockpitUrl/#/process-instance/${engineProcessInfo.processInstanceId})"
          )

  private def sendMessage: ResultType =
    ZIO.succeed(summon[ScenarioData].info("Sending message"))
end ProcessScenarioRunner
