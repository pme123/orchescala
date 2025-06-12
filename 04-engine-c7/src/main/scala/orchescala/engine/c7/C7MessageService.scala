package orchescala.engine.c7

import orchescala.domain.CamundaVariable
import orchescala.engine.inOut.MessageService
import orchescala.engine.{EngineConfig, EngineError}
import org.camunda.community.rest.client.api.MessageApi
import org.camunda.community.rest.client.dto.{CorrelationMessageDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.logInfo
import zio.{IO, ZIO}

class C7MessageService(using
                       apiClientZIO: IO[EngineError, ApiClient],
                       engineConfig: EngineConfig
                      ) extends MessageService, C7EventService:

  def sendMessage(
                   name: String,
                   tenantId: Option[String] = None,
                   withoutTenantId: Option[Boolean] = None,
                   businessKey: Option[String] = None,
                   processInstanceId: Option[String] = None,
                   variables: Option[Map[String, CamundaVariable]] = None
                ): IO[EngineError, Unit] =
    for
      apiClient <- apiClientZIO
      _ <- logInfo(s"Sending Message '$name' (processInstanceId: ${processInstanceId.getOrElse("-")} / businessKey: ${businessKey.getOrElse("-")}).")
      _ <-
        ZIO
          .attempt:
            new MessageApi(apiClient)
              .deliverMessage(CorrelationMessageDto()
                .messageName(name)
                .tenantId(tenantId.orNull)
                .withoutTenantId(withoutTenantId.getOrElse(false))
                .businessKey(businessKey.orNull)
                .processInstanceId(processInstanceId.orNull)
                .processVariables(mapToC7Variables(variables)))
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem sending Message '$name' (processInstanceId: ${processInstanceId.getOrElse("-")} / businessKey: ${businessKey.getOrElse("-")}): ${err.getMessage}"
            )
    yield ()


end C7MessageService
