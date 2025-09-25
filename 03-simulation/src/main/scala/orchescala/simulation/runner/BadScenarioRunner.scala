package orchescala.simulation.runner

import orchescala.engine.ProcessEngine
import orchescala.simulation.*
import zio.{IO, ZIO}

class BadScenarioRunner(badScenario: BadScenario)(using
                                                            val engine: ProcessEngine,
                                                            val config: SimulationConfig
):
  private lazy val processInstanceService = engine.processInstanceService
  private lazy val scenarioRunner       = ScenarioRunner(badScenario)
  private lazy val isProcessScenarioRunner = IsProcessScenarioRunner(badScenario)
  private lazy val scenarioOrStepRunner = ScenarioOrStepRunner(badScenario)

  def run: IO[SimulationError, ScenarioData] =
    given ScenarioData = ScenarioData(badScenario.scenarioName)
    scenarioRunner.logScenario: (data: ScenarioData) =>
      given ScenarioData = data
      for
        _    <- ZIO.logInfo(s"Running BadScenario: ${badScenario.scenarioName}")
        given ScenarioData <-
          processInstanceService.startProcessAsync(
            badScenario.process.processName,
            badScenario.process.camundaInBody,
            Some(badScenario.scenarioName)
          ).foldZIO (
              err =>
                if err.errorMsg.contains(badScenario.errorMsg) then
                  ZIO.succeed:
                    summon[ScenarioData].info(
                      s"Expected error occurred: ${badScenario.errorMsg} >>> ${err.errorMsg}"
                    )
                else
                  ZIO.fail:
                    SimulationError.ProcessError(
                    summon[ScenarioData].error(s"Error Message not found in Body.")
                      .info(s"- expected msg: ${badScenario.errorMsg}")
                      .info(s"- result msg: ${err.errorMsg}")
                    )
                ,
             engineProcessInfo =>
                ZIO.succeed:
                  summon[ScenarioData].withProcessInstanceId(engineProcessInfo.processInstanceId)
                    .info(
                      s"Process '${badScenario.process.processName}' started (check ${config.cockpitUrl(engineProcessInfo)})"
                    )
          )
      yield summon[ScenarioData]
end BadScenarioRunner
