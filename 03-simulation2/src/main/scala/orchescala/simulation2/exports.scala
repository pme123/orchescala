package orchescala.simulation2

import zio.IO

type ResultType = IO[SimulationError, ScenarioData]
