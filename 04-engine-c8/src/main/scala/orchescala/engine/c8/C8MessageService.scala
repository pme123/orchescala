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
      variables: Option[Map[String, CamundaVariable]]
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
      variablesMap  <- ZIO.succeed(mapToC8Variables(variables))
      correlationKey = businessKey.orElse(processInstanceId)
      result        <- timeToLiveInSec
                         .map: ttl =>
                           publishMessage(
                             camundaClient,
                             name,
                             tenantId,
                             correlationKey,
                             ttl,
                             variablesMap
                           )
                         .getOrElse:
                           correlateMessage(
                             camundaClient,
                             name,
                             tenantId,
                             correlationKey,
                             variablesMap
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
      .attempt:
        val command = camundaClient.newCorrelateMessageCommand()
          .messageName(name)

        val withCorrelationKey = correlationKey match // if set take the businessKey or processInstanceId if not set
          case Some(pid) =>
            command.correlationKey(pid)
          case None      =>
            command.withoutCorrelationKey()

        withCorrelationKey
          .tenantId(tenantId.orNull)
          .variables(variablesMap)
          .send().join()
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem sending Message '$name' (correlationKey: ${correlationKey.getOrElse("-")}): ${err.getMessage}"
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
              s"Problem mapping MessageCorrelationResult: ${err.getMessage}"
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
      .attempt:
        val command = camundaClient.newPublishMessageCommand()
          .messageName(name)

        val withCorrelationKey = correlationKey match
          case Some(key) =>
            command.correlationKey(key)
          case None      =>
            command.correlationKey("") // empty string for no correlation key

        withCorrelationKey
          .timeToLive(java.time.Duration.ofSeconds(timeToLiveInSec))
          .tenantId(tenantId.orNull)
          .variables(variablesMap)
          .send().join()
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem publishing Message '$name' (correlationKey: ${correlationKey.getOrElse("-")}): ${err.getMessage}"
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
              s"Problem mapping MessageCorrelationResult: ${err.getMessage}"
            )
end C8MessageService
