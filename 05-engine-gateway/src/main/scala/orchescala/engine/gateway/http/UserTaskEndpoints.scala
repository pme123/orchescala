package orchescala.engine.gateway.http

import io.circe.parser.*
import orchescala.domain.*
import sttp.tapir.*
import sttp.tapir.json.circe.*

object UserTaskEndpoints:

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

  private val errorResponseTaskNotFound = ErrorResponse(
    message = "User task 'approve-order' not found or not yet active in process instance",
    code = Some("TASK_NOT_FOUND")
  )

  private val errorResponseTaskComplete = ErrorResponse(
    message = "Failed to complete user task: Task not found or already completed",
    code = Some("TASK_COMPLETE_ERROR")
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

  // Example JSON for complete user task request body
  private val completeUserTaskRequestExample = parse("""{
    "approved": true,
    "approverComment": "Order approved - customer has good credit rating",
    "approvalDate": "2025-10-26T14:30:00Z",
    "nextStep": "shipping"
  }""").getOrElse(io.circe.Json.Null)

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

end UserTaskEndpoints

