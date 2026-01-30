package orchescala.gateway

import io.circe.parser.*
import orchescala.domain.*
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.tapir.*
import sttp.tapir.json.circe.*
import orchescala.engine.PathUtils.*

object SignalEndpoints:
  
  lazy val sendSignal: Endpoint[String, (String, Option[String], Option[JsonObject]), ServiceRequestError, Unit, Any] =
    EndpointsUtil.baseEndpoint
      .post
      .in("signal")
      .in(signalOrMessageNamePath)
      .in(tenantIdQuery)
      .in(jsonBody[Option[JsonObject]]
        .description("Variables to send with the signal as a JSON object")
        .example(Some(sendSignalRequestExample)))
      .out(statusCode(StatusCode.NoContent))
      .name("Send Signal")
      .summary("Send a signal to process instances")
      .description(
        """Sends a signal that can be received by process instances subscribed to this signal.
          |The signal is broadcasted to all subscribed handlers across all engines (C7/C8).
          |It is fire and forget.
          |""".stripMargin
      )
      .tag("Signal")
      
  // Example JSON for send signal request body
  private val sendSignalRequestExample = 
    Json.obj(
      "orderStatus" -> Json.fromString("canceled"),
      "cancelReason" -> Json.fromString("No response from the customer.")
    ).asObject.get

end SignalEndpoints

