package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.response.PublishMessageResponse
import orchescala.domain.CamundaVariable
import orchescala.engine.*
import orchescala.engine.domain.{EngineError, MessageCorrelationResult}
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
      businessKey: Option[String] = None,
      processInstanceId: Option[String] = None,
      variables: Option[Map[String, CamundaVariable]] = None
  ): IO[EngineError, MessageCorrelationResult] =
    
    for
      camundaClient <- camundaClientZIO
      _           <-
        logInfo(
          s"""Correlate Message:
             |- msgName: $name
             |- processInstanceId: ${processInstanceId.getOrElse("-")}
             |- businessKey: ${businessKey.getOrElse("-")}
             |- tenantId: ${tenantId.getOrElse("-")}
             |""".stripMargin
        )
      variablesMap <- ZIO.succeed(mapToC8Variables(variables))
      resp  <-
        ZIO
          .attempt {
            val command = camundaClient.newPublishMessageCommand()
              .messageName(name)
              
            val withCorrelationKey = businessKey.orElse(processInstanceId) match // if set take the businessKey or processInstanceId if not set
              case Some(pid) => command.correlationKey(pid) 
              case None => 
                 command.withoutCorrelationKey()

            withCorrelationKey
              .messageId(UUID.randomUUID().toString)
              .variables(variablesMap)
              .send().join()
          }
          .mapError : err =>
            EngineError.ProcessError(
              s"Problem sending Message '$name' (processInstanceId: ${processInstanceId.getOrElse("-")} / businessKey: ${businessKey.getOrElse("-")}): ${err.getMessage}"
            )
      _           <- logInfo(s"Message '$name' sent successfully.")
      //TODO Zeebe doesn't return correlation results directly
      result      <- ZIO.attempt(MessageCorrelationResult.ProcessInstance(resp.getMessageKey.toString))
        .mapError: err =>
          EngineError.ProcessError(
            s"Problem mapping MessageCorrelationResult: ${err.getMessage}"
          )
    yield result