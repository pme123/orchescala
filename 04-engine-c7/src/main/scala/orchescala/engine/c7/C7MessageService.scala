package orchescala.engine.c7

import orchescala.domain.CamundaVariable
import orchescala.engine.domain.{EngineError, EngineType, MessageCorrelationResult}
import orchescala.engine.services.MessageService
import orchescala.engine.EngineConfig
import org.camunda.community.rest.client.api.MessageApi
import org.camunda.community.rest.client.dto.{
  CorrelationMessageDto,
  MessageCorrelationResultWithVariableDto,
  VariableValueDto
}
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
      tenantId: Option[String],
      timeToLiveInSec: Option[Int],
      businessKey: Option[String],
      processInstanceId: Option[String],
      variables: Option[JsonObject]
  ): IO[EngineError, MessageCorrelationResult] =
    val theBusinessKey = if processInstanceId.isDefined then None else businessKey
    val theTenantId    = if processInstanceId.isDefined then None else tenantId

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
                .businessKey(theBusinessKey.orNull)
                .processInstanceId(processInstanceId.orNull)
                .processVariables(mapToC7Variables(variables))
                .resultEnabled(true))
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem sending Message '$name' (processInstanceId: ${processInstanceId.getOrElse("-")} / businessKey: ${theBusinessKey.getOrElse("-")}): $err"
            )
      _         <- logInfo(s"Message '$name' sent successfully: $response.")
      result    <- mapToMessageCorrelationResult(Option(response).map(_.asScala).toSeq.flatten)
    yield result
    end for
  end sendMessage

  private def mapToMessageCorrelationResult(
      response: Seq[MessageCorrelationResultWithVariableDto]
  ): IO[EngineError, MessageCorrelationResult] =
    response.headOption
      .flatMap:
        case result if result.getResultType.getValue == "Execution"         =>
          Some:
            MessageCorrelationResult.Execution(
              result.getExecution.getId,
              result.getExecution.getProcessInstanceId,
              EngineType.C7
            )
        case result if result.getResultType.getValue == "ProcessDefinition" =>
          Some:
            MessageCorrelationResult.ProcessInstance(
              result.getProcessInstance.getId,
              result.getProcessInstance.getId,
              EngineType.C7
            )
        case _                                                              =>
          None
      .map:
        ZIO.succeed
      .getOrElse:
        ZIO.logInfo(s"No valid MessageCorrelationResult found: $response") *>
          ZIO.fail(EngineError.ProcessError(s"No valid MessageCorrelationResult found: $response"))
end C7MessageService
