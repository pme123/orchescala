package orchescala.simulation

import orchescala.engine.ProcessEngine
import orchescala.simulation.*
import orchescala.simulation.runner.*
import zio.{IO, Scope, ZIO, ZLayer}

import scala.compiletime.uninitialized

abstract class SimulationRunner
    extends SimulationDsl[IO[SimulationError, Seq[(LogLevel, Seq[ScenarioResult])]]],
      TestOverrideExtensions,
      Logging:

  // For traditional engines (C7, direct engines)
  def engine: ProcessEngine =
    throw new RuntimeException("Either override 'engine' or 'engineZIO' method")

  // For environment-based engines (C8 with SharedC8ClientManager, C7 with SharedC7ClientManager)
  def engineZIO: ZIO[Any, Nothing, ProcessEngine] =
    ZIO.succeed(engine)

  def config: SimulationConfig =
    SimulationConfig()

  // Override this to provide the ZIO layers required by this simulation
  def requiredLayers: Seq[ZLayer[Any, Nothing, Any]]

  // Automatically combine all required layers
  private def allRequiredLayers: ZLayer[Any, Nothing, Any] =
    val allLayers = requiredLayers
    allLayers.foldLeft(ZLayer.empty: ZLayer[Any, Nothing, Any])(_ ++ _)

  // needed that it can be called from the Test Framework and check the result
  var simulation: IO[SimulationError, Seq[(LogLevel, Seq[ScenarioResult])]] = uninitialized

  protected def run(sim: SSimulation): IO[SimulationError, Seq[(LogLevel, Seq[ScenarioResult])]] =
    simulation = (for {
      engine <- engineZIO
      given ProcessEngine    = engine
      given SimulationConfig = config
      results <- ZIO
        .foreachPar(sim.scenarios):
          case scen: ProcessScenario  =>
            ProcessScenarioRunner(scen).run
          case scen: IncidentScenario => IncidentScenarioRunner(scen).run
          case scen: BadScenario      => BadScenarioRunner(scen).run

        .map: results =>
          results
            .map { (resultData: ScenarioData) =>
              val log =
                resultData.logEntries
                  .filter(_.logLevel <= config.logLevel)
                  .map(_.toString)
                  .mkString("\n")
              ScenarioResult(resultData.scenarioName, resultData.logEntries.maxLevel, log)
            }
            .groupBy(_.maxLevel)
            .toSeq
            .sortBy(_._1)
    } yield results).provideLayer(allRequiredLayers)
    simulation
  end run

end SimulationRunner

object SimulationRunner
