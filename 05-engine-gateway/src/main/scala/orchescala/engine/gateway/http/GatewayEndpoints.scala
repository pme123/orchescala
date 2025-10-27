package orchescala.engine.gateway.http

import io.circe.parser.*
import orchescala.domain.*
import orchescala.engine.domain.ProcessInfo
import sttp.tapir.*
import sttp.tapir.json.circe.*

object GatewayEndpoints:

  // Example error responses
  private val errorResponseUnauthorized = ErrorResponse(
    message = "Invalid or missing authentication token",
    code = Some("UNAUTHORIZED")
  )

  private val errorResponseBadRequest = ErrorResponse(
    message = "Process definition 'invalid-process' not found",
    code = Some("PROCESS_NOT_FOUND")
  )

  private val errorResponseInternalError = ErrorResponse(
    message = "Failed to start process instance: Connection timeout",
    code = Some("ENGINE_ERROR")
  )

  private val errorResponseSignalError = ErrorResponse(
    message = "Failed to send signal: Signal not found or engine error",
    code = Some("SIGNAL_ERROR")
  )

  private val baseEndpoint = endpoint
    .in("process")
    .errorOut(
      oneOf[ErrorResponse](
        oneOfVariant(statusCode(StatusCode.Unauthorized)
          .and(jsonBody[ErrorResponse]
            .example(errorResponseUnauthorized))),
        oneOfVariant(statusCode(StatusCode.BadRequest)
          .and(jsonBody[ErrorResponse]
            .example(errorResponseBadRequest))),
        oneOfVariant(statusCode(StatusCode.InternalServerError)
          .and(jsonBody[ErrorResponse]
            .example(errorResponseInternalError)))
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

  // Example JSON for user task variables response
  private val userTaskVariablesExample = parse("""{
    "customerName": "John Doe",
    "orderAmount": 1250.50,
    "orderDate": "2025-10-26",
    "priority": "high",
    "approvalRequired": true,
    "assignedTo": "manager@example.com",
    "items": [
      {"productId": "PROD-001", "quantity": 2, "price": 500.25},
      {"productId": "PROD-042", "quantity": 1, "price": 250.00}
    ]
  }""").getOrElse(io.circe.Json.Null)

  // Example filtered variables response
  private val userTaskVariablesFilteredExample = parse("""{
    "customerName": "John Doe",
    "orderAmount": 1250.50
  }""").getOrElse(io.circe.Json.Null)

  private val errorResponseTaskNotFound = ErrorResponse(
    message = "User task 'approve-order' not found or not yet active in process instance",
    code = Some("TASK_NOT_FOUND")
  )

  // Example JSON for complete user task request body
  private val completeUserTaskRequestExample = parse("""{
    "approved": true,
    "approverComment": "Order approved - customer has good credit rating",
    "approvalDate": "2025-10-26T14:30:00Z",
    "nextStep": "shipping"
  }""").getOrElse(io.circe.Json.Null)

  private val errorResponseTaskComplete = ErrorResponse(
    message = "Failed to complete user task: Task not found or already completed",
    code = Some("TASK_COMPLETE_ERROR")
  )

  val getUserTaskVariables: Endpoint[String, (String, String, Option[String], Option[Int]), ErrorResponse, (String, Json), Any] =
    securedBaseEndpoint
      .get
      .in(path[String]("processInstanceId")
        .description("Process instance ID")
        .example("f150c3f1-13f5-11ec-936e-0242ac1d0007"))
      .in("userTask")
      .in(path[String]("userTaskDefId")
        .description("User task definition ID (task definition key in the BPMN)")
        .example("approve-order"))
      .in("variables")
      .in(query[Option[String]]("variableFilter")
        .description("A comma-separated String of variable names. E.g. `name,firstName`")
        .example(Some("customerName,orderAmount")))
      .in(query[Option[Int]]("timeoutInSec")
        .description("Maximum number of seconds to wait for the user task to become active. If not provided, it will wait 10 seconds.")
        .example(Some(30)))
      .out(statusCode(StatusCode.Ok))
      .out(header[String]("userTaskId")
        .description("The ID of the user task")
        .example("task-abc123-def456"))
      .out(jsonBody[Json]
        .description("Variables for the current user task as JSON object")
        .example(userTaskVariablesExample))
      .name("Get User Task Variables")
      .summary("Get variables for a user task")
      .description(
        """Returns the variables for the current user task in a process instance.
          |**At the moment only tested if there is only one active user task in the process instance.**
          |""".stripMargin
      )
      .tag("User Task")

  val completeUserTask: Endpoint[String, (String, String, String, Json), ErrorResponse, Unit, Any] =
    securedBaseEndpoint
      .post
      .in(path[String]("processInstanceId")
        .description("Process instance ID")
        .example("f150c3f1-13f5-11ec-936e-0242ac1d0007"))
      .in("userTask")
      .in(path[String]("userTaskDefId")
        .description("User task definition ID (task definition key in the BPMN)")
        .example("approve-order"))
      .in(path[String]("userTaskId")
        .description("User task instance ID (obtained from getUserTaskVariables)")
        .example("task-abc123-def456"))
      .in("complete")
      .in(jsonBody[Json]
        .description("Variables to set when completing the task as a JSON object")
        .example(completeUserTaskRequestExample))
      .out(statusCode(StatusCode.NoContent))
      .name("Complete User Task")
      .summary("Complete a user task with variables")
      .description(
        """Completes a user task in a process instance with the provided variables.
          |""".stripMargin
      )
      .tag("User Task")

  // Example JSON for send signal request body
  private val sendSignalRequestExample = parse("""{
    "orderStatus": "canceled",
    "cancelReason": "No response from the customer."
  }""").getOrElse(io.circe.Json.Null)

  private val signalBaseEndpoint = endpoint
    .in("signal")
    .errorOut(
      oneOf[ErrorResponse](
        oneOfVariant(statusCode(StatusCode.Unauthorized)
          .and(jsonBody[ErrorResponse]
            .example(errorResponseUnauthorized))),
        oneOfVariant(statusCode(StatusCode.BadRequest)
          .and(jsonBody[ErrorResponse]
            .example(errorResponseBadRequest))),
        oneOfVariant(statusCode(StatusCode.InternalServerError)
          .and(jsonBody[ErrorResponse]
            .example(errorResponseSignalError)))
      )
    )

  private val securedSignalBaseEndpoint = signalBaseEndpoint
    .securityIn(auth.bearer[String]())

  val sendSignal: Endpoint[String, (String, Option[String], Json), ErrorResponse, Unit, Any] =
    securedSignalBaseEndpoint
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

end GatewayEndpoints

