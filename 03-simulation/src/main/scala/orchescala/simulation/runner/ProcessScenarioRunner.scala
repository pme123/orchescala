package orchescala.simulation
package runner

import orchescala.domain.{InOutDecoder, InOutEncoder}
import orchescala.engine.EngineError
import orchescala.engine.ProcessEngine
import zio.{IO, ZIO}
import zio.ZIO.*

import scala.reflect.ClassTag

class ProcessScenarioRunner(processScenario: ProcessScenario)(using
                                                              val engine: ProcessEngine,
                                                              val config: SimulationConfig
):
  private lazy val processInstanceService = engine.jProcessInstanceService
  private lazy val scenarioRunner       = ScenarioRunner(processScenario)
  private lazy val isProcessScenarioRunner = IsProcessScenarioRunner(processScenario)

  def run: IO[SimulationError, ScenarioData] =
    for
      _    <- ZIO.logDebug(s"Running ProcessScenario: ${processScenario.name}")
      data <-
        scenarioRunner.logScenario: (data: ScenarioData) =>
          given ScenarioData = data
          if processScenario.process == null then
            ZIO.succeed:
              data.error(
                "The process is null! Check if your variable is LAZY (`lazy val myProcess = ...`)."
              )
          else
            (for
              given ScenarioData <- processScenario.startType match
                                 case ProcessStartType.START   => isProcessScenarioRunner.startProcess
                                 case ProcessStartType.MESSAGE => isProcessScenarioRunner.sendMessage
              given ScenarioData <- ProcessStepsRunner(processScenario).runSteps
              given ScenarioData <- ProcessStepsRunner(processScenario).check
            yield summon[ScenarioData]).fold(
              err =>
                err.scenarioData,
              scenData => scenData
            )
    yield data

end ProcessScenarioRunner
