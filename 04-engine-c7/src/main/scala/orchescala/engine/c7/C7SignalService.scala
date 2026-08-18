package orchescala.engine.c7

import orchescala.domain.CamundaVariable
import orchescala.engine.EngineConfig
import orchescala.engine.domain.EngineError
import orchescala.engine.services.SignalService
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
      variables: Option[JsonObject] = None
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
                .tenantId(tenantId.orElse(engineConfig.tenantId).orNull)
                .withoutTenantId(withoutTenantId.getOrElse(false))
                .variables(mapToC7Variables(variables)))
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem sending Signal '$name': $err"
            )
    yield ()
end C7SignalService
