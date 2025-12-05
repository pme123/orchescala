package orchescala.gateway

import io.circe.parser.*
import orchescala.domain.*
import sttp.tapir.*
import sttp.tapir.json.circe.*

object UserTaskEndpoints:

  private val baseEndpoint = endpoint
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
  }""").map(_.asObject.get).getOrElse(JsonObject())

  val getUserTaskVariables: Endpoint[String, (String, String, Option[String], Option[Int]), ErrorResponse, (String, Json), Any] =
    securedBaseEndpoint
      .get
      .in("process")
      .in(path[String]("processInstanceId")
        .description("Process instance ID")
        .example("{{processInstanceId}}"))
      .in("userTask")
      .in(path[String]("taskDefinitionKey")
        .description("User task definition ID (task definition key in the BPMN)")
        .example("ApproveOrderUT"))
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

  val completeUserTask: Endpoint[String, (String, JsonObject), ErrorResponse, Unit, Any] =
    securedBaseEndpoint
      .post
      .in("userTask")
      .in(path[String]("userTaskInstanceId")
        .description("User task instance ID (obtained from getUserTaskVariables)")
        .example("{{userTaskInstanceId}}"))
      .in("complete")
      .in(jsonBody[JsonObject]
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

  val completeUserTaskForApi: Endpoint[String, (String, String, JsonObject), ErrorResponse, Unit, Any] =
    securedBaseEndpoint
      .post
      .in("userTask")
      .in(path[String]("userTaskDefinitionKey")
        .description(
          """User task definition ID (task definition key in the BPMN)
            |- This is used for API path differentiation in OpenAPI.
            |- We use this that you can have multiple UserTasks in one Project.
            |""".stripMargin)
        .example("ApproveOrderUT"))
      .in(path[String]("userTaskInstanceId")
        .description("User task instance ID (obtained from getUserTaskVariables)")
        .example("{{userTaskInstanceId}}"))
      .in("complete")
      .in(jsonBody[JsonObject]
        .description("Variables to set when completing the task as a JSON object")
        .example(completeUserTaskRequestExample))
      .out(statusCode(StatusCode.NoContent))
      .name("Complete User Task for API")
      .summary("Complete a user task for API documentation")
      .description(
        """Completes a user task in a process instance with the provided variables.
          |""".stripMargin
      )
      .tag("User Task")

end UserTaskEndpoints

