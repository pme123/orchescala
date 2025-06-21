package orchescala.simulation

import zio.IO

type ResultType = ScenarioData ?=> IO[SimulationError, ScenarioData]
