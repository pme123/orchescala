package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.response.{CorrelateMessageResponse, PublishMessageResponse}
import orchescala.domain.CamundaVariable
import orchescala.engine.*
import orchescala.engine.domain.{EngineError, EngineType, MessageCorrelationResult}
import orchescala.engine.services.MessageService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import java.util.UUID
import scala.jdk.CollectionConverters.*

class C8MessageService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends MessageService with C8EventService:

  def sendMessage(
      name: String,
      tenantId: Option[String],
      timeToLiveInSec: Option[Int],
      businessKey: Option[String],
      processInstanceId: Option[String],
      variables: Option[JsonObject]
  ): IO[EngineError, MessageCorrelationResult] =

    for
      camundaClient <- camundaClientZIO
      _             <-
        logInfo(
          s"""Correlate Message:
             |- msgName: $name
             |- processInstanceId: ${processInstanceId.getOrElse("-")}
             |- timeToLiveInSec: ${timeToLiveInSec.getOrElse("-")}
             |- businessKey: ${businessKey.getOrElse("-")}
             |- tenantId: ${tenantId.getOrElse("-")}
             |""".stripMargin
        )
      variablesMap  = variables.map(_.toVariablesMap).getOrElse(Map.empty)
      correlationKey = businessKey.orElse(processInstanceId)
      result        <- timeToLiveInSec
                         .map: ttl =>
                           publishMessage(
                             camundaClient,
                             name,
                             tenantId,
                             correlationKey,
                             ttl,
                             variablesMap.asJava
                           )
                         .getOrElse:
                           correlateMessage(
                             camundaClient,
                             name,
                             tenantId,
                             correlationKey,
                             variablesMap.asJava
                           )
      _             <- logInfo(s"Message '$name' sent successfully.")
    yield result

  private def correlateMessage(
      camundaClient: CamundaClient,
      name: String,
      tenantId: Option[String],
      correlationKey: Option[String],
      variablesMap: java.util.Map[String, Any]
  ): IO[EngineError, MessageCorrelationResult] =
    ZIO
      .fromFutureJava:
        val command = camundaClient.newCorrelateMessageCommand()
          .messageName(name)

        val withCorrelationKey =
          correlationKey match // if set take the businessKey or processInstanceId if not set
            case Some(pid) =>
              command.correlationKey(pid)
            case None      =>
              command.withoutCorrelationKey()

        withCorrelationKey
          .tenantId(tenantId.orNull)
          .variables(variablesMap)
          .send()
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem sending Message '$name' (correlationKey: ${correlationKey.getOrElse("-")}): $err"
        )
      .flatMap: resp =>
        ZIO
          .attempt:
            MessageCorrelationResult.ProcessInstance(
              resp.getMessageKey.toString,
              resp.getMessageKey.toString,
              EngineType.C8
            )
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem mapping MessageCorrelationResult: $err"
            )

  private def publishMessage(
      camundaClient: CamundaClient,
      name: String,
      tenantId: Option[String],
      correlationKey: Option[String],
      timeToLiveInSec: Int,
      variablesMap: java.util.Map[String, Any]
  ): IO[EngineError, MessageCorrelationResult] =
    ZIO
      .fromFutureJava:
        val command = camundaClient.newPublishMessageCommand()
          .messageName(name)

        val withCorrelationKey =
          correlationKey
            .map: key =>
              command.correlationKey(key)
            .getOrElse:
              command.correlationKey("") // empty string for no correlation key

        val withTenantId =
          tenantId
            .map: tenantId =>
              withCorrelationKey.tenantId(tenantId)
            .getOrElse(withCorrelationKey)

        withTenantId
          .timeToLive(java.time.Duration.ofSeconds(timeToLiveInSec))
          .variables(variablesMap)
          .send()
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem publishing Message '$name' (correlationKey: ${correlationKey.getOrElse("-")}): $err"
        )
      .flatMap: resp =>
        ZIO
          .attempt:
            MessageCorrelationResult.ProcessInstance(
              resp.getMessageKey.toString,
              resp.getMessageKey.toString,
              EngineType.C8
            )
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem mapping MessageCorrelationResult: $err"
            )
end C8MessageService
