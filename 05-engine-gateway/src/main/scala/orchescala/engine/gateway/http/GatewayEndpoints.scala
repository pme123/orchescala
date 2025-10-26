package orchescala.engine.gateway.http

import orchescala.domain.*
import orchescala.engine.domain.ProcessInfo
import sttp.tapir.*
import sttp.tapir.json.circe.*
import sttp.tapir.generic.auto.*
import io.circe.syntax.*

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

  val getUserTaskVariables: Endpoint[String, (String, String, Option[String], Option[Int]), ErrorResponse, (String, Json), Any] =
    securedBaseEndpoint
      .get
      .in(path[String]("processInstanceId").description("Process instance ID"))
      .in("userTask")
      .in(path[String]("userTaskDefId").description("User task definition ID (task definition key in the BPMN)"))
      .in("variables")
      .in(query[Option[String]]("variableFilter").description("A comma-separated String of variable names. E.g. `name,firstName`"))
      .in(query[Option[Int]]("timeoutInSec").description("Maximum number of seconds to wait for the user task to become active. If not provided, it will wait 10 seconds."))
      .out(statusCode(StatusCode.Ok))
      .out(header[String]("userTaskId").description("The ID of the user task"))
      .out(jsonBody[Json].description("Variables for the current user task as JSON object"))
      .name("Get User Task Variables")
      .summary("Get variables for a user task")
      .description(
        """Returns the variables for the current user task in a process instance.
          |
          |The Gateway will automatically route the request to the appropriate engine (C7 or C8)
          |based on the process instance.
          |
          |**Authentication:**
          |Requires a Bearer token in the Authorization header: `Authorization: Bearer <token>`
          |
          |**Path Parameters:**
          |- `processInstanceId`: The ID of the process instance
          |- `userTaskDefId`: The task definition key from the BPMN (used for API path differentiation in OpenAPI)
          |
          |**Response:**
          |Returns a JSON object containing all variables accessible to the user task.
          |
          |**Error Responses:**
          |- `401 Unauthorized`: Missing or invalid authentication token
          |- `400 Bad Request`: Invalid request parameters or user task not found
          |- `500 Internal Server Error`: Error occurred while retrieving variables
          |""".stripMargin
      )
      .tag("User Task")

end GatewayEndpoints

