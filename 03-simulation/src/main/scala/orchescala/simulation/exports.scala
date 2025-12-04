package orchescala.simulation

import orchescala.domain.IdentityCorrelation
import zio.IO

type ResultType = ScenarioData ?=> IO[SimulationError, ScenarioData]

lazy val testIdentityCorrelation = IdentityCorrelation(
  username = "admin",
  secret = Some("testSecret"),
  email = Some("admin@orchescala.ch"),
  impersonateProcessValue = Some("1234567890")
)