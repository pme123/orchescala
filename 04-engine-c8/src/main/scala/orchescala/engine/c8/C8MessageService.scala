package orchescala.engine.c8

import io.camunda.zeebe.client.ZeebeClient
import io.camunda.zeebe.client.api.response.PublishMessageResponse
import orchescala.domain.CamundaVariable
import orchescala.engine.*
import orchescala.engine.domain.MessageCorrelationResult
import orchescala.engine.inOut.MessageService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8MessageService(using
    zeebeClientZIO: IO[EngineError, ZeebeClient],
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
      zeebeClient <- zeebeClientZIO
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
            val command = zeebeClient.newPublishMessageCommand()
              .messageName(name)
              
            val withCorrelationKey = businessKey match
              case Some(bk) => command.withoutCorrelationKey() //TODO business key is not supported in Zeebe??
              case None => 
                processInstanceId match
                  case Some(pid) => command.correlationKey(pid)
                  case None => command.withoutCorrelationKey()

            withCorrelationKey
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