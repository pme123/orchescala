package orchescala.engine.c7

import orchescala.domain.CamundaVariable
import orchescala.engine.services.SignalService
import orchescala.engine.{EngineConfig, EngineError}
import org.camunda.community.rest.client.api.SignalApi
import org.camunda.community.rest.client.dto.{SignalDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.logInfo
import zio.{IO, ZIO}

class C7SignalService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends SignalService, C7EventService:

  def sendSignal(
      name: String,
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      executionId: Option[String] = None,
      variables: Option[Map[String, CamundaVariable]] = None
  ): IO[EngineError, Unit] =
    for
      apiClient <- apiClientZIO
      _         <- logInfo(s"Sending Signal '$name'.")
      _         <-
        ZIO
          .attempt:
            new SignalApi(apiClient)
              .throwSignal(SignalDto()
                .name(name)
                .tenantId(tenantId.orNull)
                .withoutTenantId(withoutTenantId.getOrElse(false))
                .executionId(executionId.orNull)
                .variables(mapToC7Variables(variables)))
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem sending Signal '$name': ${err.getMessage}"
            )
    yield ()
end C7SignalService
