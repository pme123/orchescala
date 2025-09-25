package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.response.PublishMessageResponse
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
      tenantId: Option[String] = None,
      withoutTenantId: Option[Boolean] = None,
      timeToLiveInSec: Option[Int] = None,
      businessKey: Option[String] = None,
      processInstanceId: Option[String] = None,
      variables: Option[Map[String, CamundaVariable]] = None
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
      resp          <-
        ZIO
          .attempt :
            val command = camundaClient.newCorrelateMessageCommand()
              .messageName(name)

            val withCorrelationKey = businessKey.orElse(
              processInstanceId
            ) match // if set take the businessKey or processInstanceId if not set
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
              s"Problem sending Message '$name' (processInstanceId: ${processInstanceId.getOrElse("-")} / businessKey: ${businessKey.getOrElse("-")}): ${err.getMessage}"
            )
      _             <- logInfo(s"Message '$name' sent successfully.")
      // TODO Zeebe doesn't return correlation results directly
      result        <- ZIO.attempt(MessageCorrelationResult.ProcessInstance(
                         resp.getMessageKey.toString,
                         resp.getMessageKey.toString,
                         EngineType.C8
                       ))
                         .mapError: err =>
                           EngineError.ProcessError(
                             s"Problem mapping MessageCorrelationResult: ${err.getMessage}"
                           )
    yield result
end C8MessageService
