package orchescala.engine.gateway

import orchescala.domain.CamundaVariable
import orchescala.engine.domain.{EngineError, MessageCorrelationResult}
import orchescala.engine.services.MessageService
import zio.IO

class GMessageService(using
    services: Seq[MessageService]
) extends MessageService, GEventService:

  def sendMessage(
                   name: String,
                   tenantId: Option[String] = None,
                   withoutTenantId: Option[Boolean] = None,
                   businessKey: Option[String] = None,
                   processInstanceId: Option[String] = None,
                   variables: Option[Map[String, CamundaVariable]] = None
                 ): IO[EngineError, MessageCorrelationResult] =
    tryServicesWithErrorCollection[MessageService, MessageCorrelationResult](
      _.sendMessage(name, tenantId, withoutTenantId, businessKey, processInstanceId, variables),
      "correlateMessage",
      processInstanceId.orElse(businessKey),
      Some((result: MessageCorrelationResult) => result.id)
    )
end GMessageService
