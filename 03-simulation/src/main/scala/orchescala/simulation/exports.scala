package orchescala.simulation

import orchescala.domain.IdentityCorrelation
import zio.IO

type ResultType = ScenarioData ?=> IO[SimulationError, ScenarioData]

lazy val testIdentityCorrelation = IdentityCorrelation(
  username = "admin",
  email = Some("admin@orchescala.ch"),
  impersonateProcessValue = Some("1234567890")
)

/** A second test identity - to complete a user task or send a message as another person than the
  * one who started the process: `MyUT.actingAs(testActorIdentityCorrelation)`.
  */
lazy val testActorIdentityCorrelation = IdentityCorrelation(
  username = "actor",
  email = Some("actor@orchescala.ch")
)