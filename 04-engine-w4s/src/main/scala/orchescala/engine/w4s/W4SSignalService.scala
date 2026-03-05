package orchescala.engine.w4s

import orchescala.domain.*
import orchescala.engine.EngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.SignalService
import zio.{IO, ZIO}

class W4SSignalService(using
    engineConfig: EngineConfig
) extends SignalService, W4SService:

  def sendSignal(
      name: String,
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      variables: Option[JsonObject] = None
  ): IO[EngineError, Unit] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine does not support signal broadcasting via REST API. Use the W4S workflow signal mechanism."
    ))

end W4SSignalService

