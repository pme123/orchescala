package orchescala.simulation2

import orchescala.engine.ProcessEngine
import orchescala.simulation2.*
import orchescala.simulation2.runner.ProcessScenarioRunner
import zio.{IO, ZIO}

import scala.compiletime.uninitialized

abstract class SimulationRunner
    extends SimulationDsl[IO[SimulationError, Seq[(LogLevel, Seq[ScenarioResult])]]],
      TestOverrideExtensions,
      Logging:

  def engine: ProcessEngine

  def config: SimulationConfig =
    SimulationConfig()

  // needed that it can be called from the Test Framework and check the result
  var simulation: IO[SimulationError, Seq[(LogLevel, Seq[ScenarioResult])]] = uninitialized

  protected def run(sim: SSimulation): IO[SimulationError, Seq[(LogLevel, Seq[ScenarioResult])]] =
    given ProcessEngine = engine
    given SimulationConfig = config
    simulation = ZIO
      .foreachPar(sim.scenarios):
        case scen: ProcessScenario =>
          ProcessScenarioRunner(scen).run
        case scen                  =>
          ZIO.logInfo(s"NOTHING to RUN: ${scen.name}")
            .as(ScenarioData(scen.name))
      /*    case scen: ExternalTaskScenario => scen.run()
        case scen: IsIncidentScenario   => scen.run()
        case scen: DmnScenario          => scen.run()
        case scen: BadScenario          => scen.run()*/
      .map: results =>
        println(s"SimulationRunner results ${results}")
        results
          .map { (resultData: ScenarioData) =>
            val log =
              resultData.logEntries
                .filter(_.logLevel >= config.logLevel)
                .map(_.toString)
                .mkString("\n")
            ScenarioResult(resultData.scenarioName, resultData.logEntries.maxLevel, log)
          }
          .groupBy(_.maxLevel)
          .toSeq
          .sortBy(_._1)
    simulation
  end run
end SimulationRunner

object SimulationRunner
