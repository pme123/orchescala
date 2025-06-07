package orchescala.simulation2

import orchescala.domain.{InOutDecoder, InOutEncoder}
import orchescala.engine.ProcessEngine
import zio.{IO, ZIO}

import scala.reflect.ClassTag

class ProcessScenarioRunner[
  In <: Product: {InOutEncoder, InOutDecoder},
  Out <: Product: {InOutEncoder, InOutDecoder, ClassTag}
](scenario: ProcessScenario[In, Out])(using engine: ProcessEngine)
  extends ScenarioRunner[In, Out]:
  
  def run: IO[SimulationError, ScenarioData] =
    for 
      _    <- ZIO.logInfo(s"Running ProcessScenario: ${scenario.name}")
      data <- logScenario : (data: ScenarioData) =>
        if scenario.process == null then
          ZIO.succeed:
            data.error(
              "The process is null! Check if your variable is LAZY (`lazy val myProcess = ...`)."
            )
        else
          for
            scenarioData <- scenario.startType match
              case ProcessStartType.START => startProcess(data)
              case ProcessStartType.MESSAGE => sendMessage(data)
           // given ScenarioData <- scenario.runSteps()
           // given ScenarioData <- scenario.check()
          yield scenarioData
        
    yield data

  private def startProcess(data: ScenarioData): IO[SimulationError, ScenarioData] = 
    ZIO.succeed(data.info("Starting process"))

  private def sendMessage(data: ScenarioData): IO[SimulationError, ScenarioData] = 
    ZIO.succeed(data.info("Sending message"))
end ProcessScenarioRunner
