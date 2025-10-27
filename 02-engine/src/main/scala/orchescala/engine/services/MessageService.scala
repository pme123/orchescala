package orchescala.engine.services

import orchescala.domain.*
import orchescala.engine.domain.*
import zio.IO

trait MessageService extends EngineService:

  def sendMessage(
      name: String,
      tenantId: Option[String] = None,
      @description(
        """
          |The time in seconds the message is buffered, waiting for correlation.
          |The default value is 0 seconds, that means no buffering at all.
          |
          |Only supported in _C8_.
          |""".stripMargin
      )
      timeToLiveInSec: Option[Int] = None,
      businessKey: Option[String] = None,
      processInstanceId: Option[String] = None,
      variables: Option[Map[String, CamundaVariable]] = None
  ): IO[EngineError, MessageCorrelationResult]
end MessageService
