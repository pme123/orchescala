package orchescala.gateway

import io.circe.parser.*
import orchescala.domain.*
import sttp.tapir.*
import sttp.tapir.json.circe.*

object SignalEndpoints:

  private val baseEndpoint = endpoint
    .in("signal")
    .errorOut(
      oneOf[ErrorResponse](
        oneOfVariantValueMatcher(statusCode(StatusCode.Unauthorized)
          .and(jsonBody[ErrorResponse]
            .example(ErrorResponse.unauthorized))) { case e: ErrorResponse if e.httpStatus == 401 => true },
        oneOfVariantValueMatcher(statusCode(StatusCode.BadRequest)
          .and(jsonBody[ErrorResponse]
            .example(ErrorResponse.badRequest))) { case e: ErrorResponse if e.httpStatus == 400 => true },
        oneOfVariantValueMatcher(statusCode(StatusCode.NotFound)
          .and(jsonBody[ErrorResponse]
            .example(ErrorResponse.notFound))) { case e: ErrorResponse if e.httpStatus == 404 => true },
        oneOfVariantValueMatcher(statusCode(StatusCode.InternalServerError)
          .and(jsonBody[ErrorResponse]
            .example(ErrorResponse.internalError))) { case e: ErrorResponse if e.httpStatus >= 500 => true },
        oneOfDefaultVariant(jsonBody[ErrorResponse])
      )
    )

  // Secured base endpoint with Bearer token authentication
  private val securedBaseEndpoint = baseEndpoint
    .securityIn(auth.bearer[String]())

  // Example JSON for send signal request body
  private val sendSignalRequestExample = parse("""{
    "orderStatus": "canceled",
    "cancelReason": "No response from the customer."
  }""").getOrElse(io.circe.Json.Null)

  val sendSignal: Endpoint[String, (String, Option[String], Json), ErrorResponse, Unit, Any] =
    securedBaseEndpoint
      .post
      .in(path[String]("signalName")
        .description("Signal name")
        .example("order-completed-signal"))
      .in(query[Option[String]]("tenantId")
        .description("If you have a multi tenant setup, you must specify the Tenant ID.")
        .example(Some("tenant1")))
      .in(jsonBody[Json]
        .description("Variables to send with the signal as a JSON object")
        .example(sendSignalRequestExample))
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

end SignalEndpoints

