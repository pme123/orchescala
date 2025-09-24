package orchescala.engine.gateway

import orchescala.domain.CamundaVariable
import orchescala.engine.services.SignalService
import orchescala.engine.{EngineConfig, EngineError}
import org.camunda.community.rest.client.api.SignalApi
import org.camunda.community.rest.client.dto.{SignalDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.logInfo
import zio.{IO, ZIO}

class GSignalService(using
    services: Seq[SignalService]
) extends SignalService:

  def sendSignal(
      name: String,
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      executionId: Option[String] = None,
      variables: Option[Map[String, CamundaVariable]] = None
  ): IO[EngineError, Unit] =
    tryServicesWithErrorCollection[SignalService, Unit](
      _.sendSignal(name, tenantId, withoutTenantId, executionId, variables),
      "sendSignal"
    )
end GSignalService
