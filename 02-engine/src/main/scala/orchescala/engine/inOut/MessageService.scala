package orchescala.engine.inOut

import orchescala.domain.*
import orchescala.engine.EngineError
import orchescala.engine.domain.MessageCorrelationResult
import zio.IO

trait MessageService:

  def sendMessage(
                   name: String,
                   tenantId: Option[String] = None,
                   withoutTenantId: Option[Boolean] = None,
                   businessKey: Option[String] = None,
                   processInstanceId: Option[String] = None,
                   variables: Option[Map[String, CamundaVariable]] = None
                ): IO[EngineError, MessageCorrelationResult]
end MessageService
