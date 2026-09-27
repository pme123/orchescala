package orchescala.engine.c8

import orchescala.engine.*
import orchescala.engine.domain.{EngineError, EngineType, MessageCorrelationResult}
import orchescala.engine.services.MessageService
import zio.ZIO.logInfo
import zio.{IO, ZIO}

class C8MessageService(using
    rest: C8RestClient,
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
    ZIO.foreach(variables)(withoutCallerIdentityCorrelation).flatMap: variables =>
      val correlationKey = businessKey.orElse(processInstanceId)
      val variablesJson  = variables.fold(Json.obj())(Json.fromJsonObject)
      for
        _      <-
          logInfo(
            s"""Correlate Message:
               |- msgName: $name
               |- processInstanceId: ${processInstanceId.getOrElse("-")}
               |- timeToLiveInSec: ${timeToLiveInSec.getOrElse("-")}
               |- businessKey: ${businessKey.getOrElse("-")}
               |- tenantId: ${tenantId.getOrElse("-")}
               |""".stripMargin
          )
        result <- timeToLiveInSec
                    .map: ttl =>
                      publishMessage(name, tenantId, correlationKey, ttl, variablesJson)
                    .getOrElse:
                      correlateMessage(name, tenantId, correlationKey, variablesJson)
        _      <- logInfo(s"Message '$name' sent successfully.")
      yield result
      end for
  end sendMessage

  /** Correlates the message to exactly one waiting subscription (or start event) - fails if there
    * is none.
    */
  private def correlateMessage(
      name: String,
      tenantId: Option[String],
      correlationKey: Option[String],
      variables: Json
  ): IO[EngineError, MessageCorrelationResult] =
    rest
      .post[C8RestModel.MessageCorrelationResult](
        Seq("messages", "correlation"),
        Json.obj(
          "name"           -> name.asJson,
          // without a correlation key only a message start event can be triggered
          "correlationKey" -> correlationKey.asJson,
          "variables"      -> variables,
          "tenantId"       -> tenantId.asJson
        )
      )
      .mapError(withContext(
        s"Problem sending Message '$name' (correlationKey: ${correlationKey.getOrElse("-")})"
      ))
      .map: resp =>
        val processInstanceId = resp.processInstanceKey.getOrElse(resp.messageKey)
        MessageCorrelationResult.ProcessInstance(processInstanceId, processInstanceId, EngineType.C8)

  /** Publishes the message, buffered for `timeToLiveInSec` - no instance needs to wait yet. */
  private def publishMessage(
      name: String,
      tenantId: Option[String],
      correlationKey: Option[String],
      timeToLiveInSec: Int,
      variables: Json
  ): IO[EngineError, MessageCorrelationResult] =
    rest
      .post[C8RestModel.MessagePublicationResult](
        Seq("messages", "publication"),
        Json.obj(
          "name"           -> name.asJson,
          "correlationKey" -> correlationKey.getOrElse("").asJson, // "" = no correlation key
          "timeToLive"     -> (timeToLiveInSec.toLong * 1000).asJson,
          "variables"      -> variables,
          "tenantId"       -> tenantId.asJson
        )
      )
      .mapError(withContext(
        s"Problem publishing Message '$name' (correlationKey: ${correlationKey.getOrElse("-")})"
      ))
      .map: resp =>
        MessageCorrelationResult.ProcessInstance(resp.messageKey, resp.messageKey, EngineType.C8)
end C8MessageService
