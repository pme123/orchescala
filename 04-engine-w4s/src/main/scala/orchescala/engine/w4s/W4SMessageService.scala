package orchescala.engine.w4s

import orchescala.domain.*
import orchescala.engine.EngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.MessageService
import zio.{IO, ZIO}

class W4SMessageService(using
    engineConfig: EngineConfig
) extends MessageService, W4SService:

  def sendMessage(
      name: String,
      tenantId: Option[String] = None,
      timeToLiveInSec: Option[Int] = None,
      businessKey: Option[String] = None,
      processInstanceId: Option[String] = None,
      variables: Option[JsonObject] = None
  ): IO[EngineError, MessageCorrelationResult] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine does not support message correlation via REST API. Use the W4S workflow signal mechanism."
    ))

end W4SMessageService

