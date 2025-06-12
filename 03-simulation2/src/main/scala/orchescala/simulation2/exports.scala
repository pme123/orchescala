package orchescala.simulation2

import zio.IO

type ResultType = ScenarioData ?=> IO[SimulationError, ScenarioData]
