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
          |The message will be correlated to:
          |1. the `businessKey` if set (in C8 you can use this for any variable you specified the correlationKey in the bpmn)
          |2. `processInstanceId` if set
          |3. Nothing - only for start events.
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

