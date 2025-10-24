package orchescala.engine.gateway.http

import orchescala.domain.*
import orchescala.engine.domain.ProcessInfo
import sttp.tapir.*
import sttp.tapir.json.circe.*
import sttp.tapir.generic.auto.*

object GatewayEndpoints:

  private val baseEndpoint = endpoint
    .in("process")
    .errorOut(
      oneOf[ErrorResponse](
        oneOfVariant(statusCode(StatusCode.Unauthorized).and(jsonBody[ErrorResponse])),
        oneOfVariant(statusCode(StatusCode.BadRequest).and(jsonBody[ErrorResponse])),
        oneOfVariant(statusCode(StatusCode.InternalServerError).and(jsonBody[ErrorResponse]))
      )
    )

  // Secured base endpoint with Bearer token authentication
  private val securedBaseEndpoint = baseEndpoint
    .securityIn(auth.bearer[String]())

  val startProcessAsync: Endpoint[String, (String, Option[String], Json), ErrorResponse, ProcessInfo, Any] =
    securedBaseEndpoint
      .post
      .in(path[String]("processDefId").description("Process definition ID or key"))
      .in("async")
      .in(query[Option[String]]("businessKey").description("Business Key, be aware that this is not supported in Camunda 8."))
      .in(jsonBody[Json].description("Request body with variables and optional business key"))
      .out(statusCode(StatusCode.Ok))
      .out(jsonBody[ProcessInfo].description("Information about the started process instance"))
      .name("Start Process Async")
      .summary("Start a process instance asynchronously")
      .description(
        """Starts a new process instance asynchronously using the Gateway.
          |
          |The Gateway will automatically route the request to the appropriate engine (C7 or C8)
          |based on the process definition and configured engines.
          |
          |**Authentication:**
          |Requires a Bearer token in the Authorization header: `Authorization: Bearer <token>`
          |
          |**Request Body:**
          |- `variables`: JSON object containing process variables
          |- `businessKey`: Optional business key to identify the process instance
          |
          |**Response:**
          |Returns information about the started process instance including:
          |- Process instance ID
          |- Business key (if provided)
          |- Process status
          |- Engine type that executed the process (C7, C8, or Gateway)
          |
          |**Error Responses:**
          |- `401 Unauthorized`: Missing or invalid authentication token
          |- `400 Bad Request`: Invalid request parameters or process definition not found
          |- `500 Internal Server Error`: Error occurred while starting the process
          |""".stripMargin
      )
      .tag("Process Instance")

end GatewayEndpoints

