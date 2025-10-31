package orchescala.gateway

import io.circe.parser.*
import orchescala.domain.*
import orchescala.engine.domain.ProcessInfo
import sttp.tapir.*
import sttp.tapir.json.circe.*

object ProcessInstanceEndpoints:

  private val baseEndpoint = endpoint
    .in("process")
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

  // Example JSON for request body
  private val startProcessRequestExample = parse("""{
    "customerName": "John Doe",
    "orderAmount": 1250.50,
    "orderDate": "2025-10-26",
    "priority": "high",
    "items": [
      {"productId": "PROD-001", "quantity": 2},
      {"productId": "PROD-042", "quantity": 1}
    ]
  }""").getOrElse(io.circe.Json.Null)

  val startProcessAsync: Endpoint[String, (String, Option[String], Option[String], Json), ErrorResponse, ProcessInfo, Any] =
    securedBaseEndpoint
      .post
      .in(path[String]("processDefId")
        .description("Process definition ID or key")
        .example("order-process"))
      .in("async")
      .in(query[Option[String]]("businessKey")
        .description("Business Key, be aware that this is not supported in Camunda 8.")
        .example(Some("ORDER-2025-12345")))
      .in(query[Option[String]]("tenantId")
        .description("If you have a multi tenant setup, you must specify the Tenant ID.")
        .example(Some("tenant1")))
      .in(jsonBody[Json]
        .description("Request body with process variables as a JSON object")
        .example(startProcessRequestExample))
      .out(statusCode(StatusCode.Ok))
      .out(jsonBody[ProcessInfo]
        .description("Information about the started process instance")
        .example(ProcessInfo.example))
      .name("Start Process Async")
      .summary("Start a process instance asynchronously")
      .description(
        """Starts a new process instance asynchronously using the Gateway.
          |""".stripMargin
      )
      .tag("Process Instance")

end ProcessInstanceEndpoints

