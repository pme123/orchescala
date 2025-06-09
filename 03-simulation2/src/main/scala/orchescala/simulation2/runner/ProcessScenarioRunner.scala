package orchescala.simulation2
package runner

import orchescala.domain.{InOutDecoder, InOutEncoder}
import orchescala.engine.EngineError
import orchescala.engine.ProcessEngine
import zio.{IO, ZIO}

import scala.reflect.ClassTag

class ProcessScenarioRunner(val scenario: ProcessScenario)(using
    engine: ProcessEngine,
    val config: SimulationConfig
) extends ScenarioRunner:
  private lazy val processInstanceService = engine.processInstanceService

  def run: IO[SimulationError, ScenarioData] =
    for
      _    <- ZIO.logInfo(s"Running ProcessScenario: ${scenario.name} / ${scenario.process.inAsJson}")
      data <-
        logScenario: (data: ScenarioData) =>
          if scenario.process == null then
            ZIO.succeed:
              data.error(
                "The process is null! Check if your variable is LAZY (`lazy val myProcess = ...`)."
              )
          else
            (for
              scenarioData1 <- scenario.startType match
                                 case ProcessStartType.START   => startProcess(data)
                                 case ProcessStartType.MESSAGE => sendMessage(data)
              scenarioData2 <- ProcessStepsRunner(scenario).runSteps(scenarioData1)
              scenarioData3 <- ProcessStepsRunner(scenario).check(scenarioData2)
            yield scenarioData3).fold(
              (err: SimulationError) => err.scenarioData,
              data => data
            )
    yield data

  private[simulation2] def startProcess(data: ScenarioData): IO[SimulationError, ScenarioData] =
    ZIO.logInfo(s"Starting process: ${scenario.process.processName}") *>
      processInstanceService.startProcessAsync(
        scenario.process.processName,
        scenario.process.inAsJson,
        Some(scenario.name)
      ).mapError: err =>
        SimulationError.ProcessError(
          data.error(
            s"Problem starting Process '${scenario.process.processName}': ${err.errorMsg}"
          )
        )
      .map: engineProcessInfo =>
        data.withProcessInstanceId(engineProcessInfo.processInstanceId)
          .info(
            s"Process '${scenario.process.processName}' started (check $cockpitUrl/#/process-instance/${engineProcessInfo.processInstanceId})"
          )

  private def sendMessage(data: ScenarioData): IO[SimulationError, ScenarioData] =
    ZIO.succeed(data.info("Sending message"))
end ProcessScenarioRunner
