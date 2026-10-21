package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.domain.MessageCorrelationResult
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.tapir.*
import sttp.tapir.json.circe.*
import orchescala.engine.PathUtils.*

object MessageEndpoints:

  val sendMessage: Endpoint[String, (String, Option[String], Option[Int], Option[String], Option[String], Option[JsonObject]), ServiceRequestError, MessageCorrelationResult, Any] =
    EndpointsUtil.baseEndpoint
      .post
      .in("message")
      .in(signalOrMessageNamePath)
      .in(tenantIdQuery)
      .in(timeToLiveInSecQuery)
      .in(businessKeyQuery)
      .in(processInstanceIdQuery)
      .in(jsonBody[Option[JsonObject]]
        .description("Variables to send with the message as a JSON object")
        .example(Some(sendMessageRequestExample)))
      .out(statusCode(StatusCode.Ok))
      .out(jsonBody[MessageCorrelationResult]
        .description("Message correlation result"))
      .name("Send Message")
      .summary("Send a message to correlate with process instances")
      .description(
        """Sends a message that can be received by process instances waiting for this message.
          |
          |The message is correlated - the same for all engines:
          |1. to the `processInstanceId` if set - it wins, a `businessKey` is then ignored.
          |2. else to the `businessKey` if set.
          |3. else to nothing - only for start events.
          |
          |In C8 the BPMN decides with the correlation key of the message (`zeebe:subscription`):
          |`correlationKey="=processInstanceKey"` for the `processInstanceId` (set by the InitWorker),
          |`correlationKey="=businessKey"` for the `businessKey` - or any variable whose value you send as `businessKey`.
          |""".stripMargin
      )
      .tag("Message")

  // Example request body for sending a message
  private lazy val sendMessageRequestExample = 
    Json.obj(
      "orderId" -> Json.fromString("12345"),
      "amount" -> Json.fromDoubleOrNull(99.99),
      "approved" -> Json.fromBoolean(true)
    ).asObject.get
    
end MessageEndpoints

