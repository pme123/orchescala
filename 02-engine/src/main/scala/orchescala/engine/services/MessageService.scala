package orchescala.engine.services

import orchescala.domain.*
import orchescala.engine.domain.*
import zio.IO

trait MessageService extends EngineService:

  def sendMessage(
                   name: String,
                   tenantId: Option[String] = None,
                   withoutTenantId: Option[Boolean] = None,
                   businessKey: Option[String] = None,
                   processInstanceId: Option[String] = None,
                   variables: Option[Map[String, CamundaVariable]] = None
                ): IO[EngineError, MessageCorrelationResult]
end MessageService
