package orchescala.gateway

import io.circe.parser.*
import orchescala.domain.*
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.tapir.*
import sttp.tapir.json.circe.*

object UserTaskEndpoints:
  
  lazy val getUserTaskVariables: Endpoint[String, (String, String, Option[String], Option[Int]), ServiceRequestError, (String, Json), Any] =
    EndpointsUtil.baseEndpoint
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

  lazy val completeUserTask: Endpoint[String, (String, JsonObject), ServiceRequestError, Unit, Any] =
    EndpointsUtil.baseEndpoint
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

  val completeUserTaskForApi: Endpoint[String, (String, String, JsonObject), ServiceRequestError, Unit, Any] =
    EndpointsUtil.baseEndpoint
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

  // Example JSON for user task variables response
  private lazy val userTaskVariablesExample =
    Json.obj(
      "customerName" -> Json.fromString("John Doe"),
      "orderAmount" -> Json.fromDoubleOrNull(1250.50),
      "orderDate" -> Json.fromString("2025-10-26"),
      "priority" -> Json.fromString("high"),
      "approvalRequired" -> Json.fromBoolean(true),
      "assignedTo" -> Json.fromString("manager@example.com"),
      "items" -> Json.arr(
        Json.obj(
          "productId" -> Json.fromString("PROD-001"),
          "quantity" -> Json.fromInt(2),
          "price" -> Json.fromDoubleOrNull(500.25)
        ),
        Json.obj(
          "productId" -> Json.fromString("PROD-042"),
          "quantity" -> Json.fromInt(1),
          "price" -> Json.fromDoubleOrNull(250.00)
        )
      )
    )

  // Example filtered variables response
  private lazy val userTaskVariablesFilteredExample = 
    Json.obj(
      "customerName" -> Json.fromString("John Doe"),
      "orderAmount" -> Json.fromDoubleOrNull(1250.50)
    ).asObject.get

  // Example JSON for complete user task request body
  private lazy val completeUserTaskRequestExample = 
    Json.obj(
      "approved" -> Json.fromBoolean(true),
      "approverComment" -> Json.fromString("Order approved - customer has good credit rating"),
      "approvalDate" -> Json.fromString("2025-10-26T14:30:00Z"),
      "nextStep" -> Json.fromString("shipping")
    ).asObject.get

end UserTaskEndpoints

