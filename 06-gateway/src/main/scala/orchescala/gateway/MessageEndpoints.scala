package orchescala.gateway

import io.circe.parser.*
import orchescala.domain.*
import orchescala.engine.domain.MessageCorrelationResult
import sttp.tapir.*
import sttp.tapir.json.circe.*

object MessageEndpoints:

  private val baseEndpoint = endpoint
    .in("message")
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

  // Example request body for sending a message
  private val sendMessageRequestExample = parse("""
    {
      "orderId": "12345",
      "amount": 99.99,
      "approved": true
    }
  """).toOption.flatMap(_.asObject).get

  val sendMessage: Endpoint[String, (String, Option[String], Option[Int], Option[String], Option[String], JsonObject), ErrorResponse, MessageCorrelationResult, Any] =
    securedBaseEndpoint
      .post
      .in(path[String]("messageName")
        .description("Message name")
        .example("order-received"))
      .in(query[Option[String]]("tenantId")
        .description("If you have a multi tenant setup, you must specify the Tenant ID.")
        .example(Some("{{tenantId}}")))
      .in(query[Option[Int]]("timeToLiveInSec")
        .description("The time in seconds the message is buffered, waiting for correlation. The default value is 0 seconds (no buffering). " +
          "Only supported in C8 - BE AWARE that if set, it is fire and forget: Camunda will just try to correlate for the configured time.")
        .example(Some(60)))
      .in(query[Option[String]]("businessKey")
        .description("Business key to correlate the message to a specific process instance.")
        .example(Some("Started by Test Client")))
      .in(query[Option[String]]("processInstanceId")
        .description("Process instance ID to correlate the message to a specific process instance.")
        .example(Some("f150c3f1-13f5-11ec-936e-0242ac1d0007")))
      .in(jsonBody[JsonObject]
        .description("Variables to send with the message as a JSON object")
        .example(sendMessageRequestExample))
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

end MessageEndpoints

