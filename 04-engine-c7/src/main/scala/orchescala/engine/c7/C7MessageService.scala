package orchescala.engine.c7

import orchescala.domain.CamundaVariable
import orchescala.engine.domain.{EngineError, MessageCorrelationResult}
import orchescala.engine.services.MessageService
import orchescala.engine.EngineConfig
import org.camunda.community.rest.client.api.MessageApi
import org.camunda.community.rest.client.dto.{CorrelationMessageDto, MessageCorrelationResultWithVariableDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.logInfo
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

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
  ): IO[EngineError, MessageCorrelationResult] =
    val theBusinessKey       = if processInstanceId.isDefined then None else businessKey
    val theTenantId          = if processInstanceId.isDefined then None else tenantId

    for
      apiClient <- apiClientZIO
      _         <-
        logInfo(
          s"""Correlate Message:
             |- msgName: $name
             |- processInstanceId: ${processInstanceId.getOrElse("-")}
             |- businessKey: ${theBusinessKey.getOrElse("-")}
             |- tenantId: ${theTenantId.getOrElse("-")}
             |""".stripMargin
        )
      response  <-
        ZIO
          .attempt:
            new MessageApi(apiClient)
              .deliverMessage(CorrelationMessageDto()
                .messageName(name)
                .tenantId(theTenantId.orNull)
                .withoutTenantId(withoutTenantId.getOrElse(false))
                .businessKey(theBusinessKey.orNull)
                .processInstanceId(processInstanceId.orNull)
                .processVariables(mapToC7Variables(variables))
                .resultEnabled(true))
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem sending Message '$name' (processInstanceId: ${processInstanceId.getOrElse("-")} / businessKey: ${theBusinessKey.getOrElse("-")}): ${err.getMessage}"
            )
      _         <- logInfo(s"Message '$name' sent successfully: $response.")
      result    <- mapToMessageCorrelationResult(Option(response).map(_.asScala).toSeq.flatten)
    yield result

  private def mapToMessageCorrelationResult(
      response: Seq[MessageCorrelationResultWithVariableDto]
  ): IO[EngineError, MessageCorrelationResult] =
    response.headOption
      .flatMap:
        case result if result.getResultType.getValue == "Execution"         =>
          Some:
            MessageCorrelationResult.Execution(result.getExecution.getId)
        case result if result.getResultType.getValue == "ProcessDefinition" =>
          Some:
            MessageCorrelationResult.ProcessInstance(
              result.getProcessInstance.getId,
              MessageCorrelationResult.ResultType.ProcessInstance
            )
        case _                                                              =>
          None
      .map:
        ZIO.succeed
      .getOrElse:
        ZIO.logInfo(s"No valid MessageCorrelationResult found: $response") *>
          ZIO.fail(EngineError.ProcessError(s"No valid MessageCorrelationResult found: $response"))
end C7MessageService
