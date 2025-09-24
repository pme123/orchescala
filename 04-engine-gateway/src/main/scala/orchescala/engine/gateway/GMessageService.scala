package orchescala.engine.gateway

import orchescala.domain.CamundaVariable
import orchescala.engine.domain.MessageCorrelationResult
import orchescala.engine.services.MessageService
import orchescala.engine.{EngineConfig, EngineError}
import org.camunda.community.rest.client.api.MessageApi
import org.camunda.community.rest.client.dto.{CorrelationMessageDto, MessageCorrelationResultWithVariableDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.logInfo
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class GMessageService(using
    services: Seq[MessageService]
) extends MessageService:

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
      "correlateMessage"
    )
end GMessageService
