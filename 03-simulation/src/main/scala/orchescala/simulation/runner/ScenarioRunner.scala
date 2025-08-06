package orchescala.simulation.runner

import orchescala.simulation.*
import zio.{IO, ZIO}

import java.util.concurrent.TimeUnit

class ScenarioRunner(scenario: SScenario)(using
    val config: SimulationConfig
):

  def logScenario(body: ScenarioData => IO[SimulationError, ScenarioData])
      : IO[SimulationError, ScenarioData] =
    for
      clock        <- ZIO.clock
      startTime    <- clock.currentTime(TimeUnit.MILLISECONDS)
      scenarioData <-
        if scenario.isIgnored then
          ZIO.succeed:
            ScenarioData(scenario.name)
              .warn(
                s"${Console.MAGENTA}${"#" * 7} Scenario '${scenario.name}'  IGNORED ${"#" * 7}${Console.RESET}"
              )
        else
          val data = ScenarioData(scenario.name)
            .info(s"${"#" * 7} Scenario '${scenario.name}' ${"#" * 7}")
          body(data)
            .fold(
              err =>
                err.printStackTrace()
                err.scenarioData
              ,
              sd => sd
            )
            .map:
              case sd if sd.maxLevel == LogLevel.ERROR =>
                sd.error(
                  s"${Console.RED}${"*" * 4} Scenario '${scenario.name}' FAILED in ${
                      System
                        .currentTimeMillis() - startTime
                    } ms ${"*" * 6}${Console.RESET}"
                )
              case sd                                  =>
                sd.info(
                  s"${Console.GREEN}${"*" * 4} Scenario '${scenario.name}' SUCCEEDED in ${
                      System
                        .currentTimeMillis() - startTime
                    } ms ${"*" * 4}${Console.RESET}"
                )
        end if
    yield scenarioData
end ScenarioRunner
