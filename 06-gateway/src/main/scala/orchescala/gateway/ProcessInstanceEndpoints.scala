package orchescala.gateway

import io.circe.parser.*
import orchescala.domain.*
import orchescala.engine.domain.ProcessInfo
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.tapir.*
import sttp.tapir.json.circe.*

object ProcessInstanceEndpoints:

  lazy val startProcessAsync: Endpoint[
    String,
    (String, Option[String], Option[String], JsonObject),
    ServiceRequestError,
    ProcessInfo,
    Any
  ] =
    EndpointsUtil.baseEndpoint
      .post
      .in("process")
      .in(path[String]("processDefinitionKey")
        .description("Process definition ID or key")
        .example("order-process"))
      .in("async")
      .in(query[Option[String]]("businessKey")
        .description("Business Key, be aware that this is not supported in Camunda 8.")
        .example(Some("Started by Test Client")))
      .in(query[Option[String]]("tenantId")
        .description("If you have a multi tenant setup, you must specify the Tenant ID.")
        .example(Some("{{tenantId}}")))
      .in(jsonBody[JsonObject]
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
      .tag(apiGroup)

  lazy val startProcessByMessage: Endpoint[
    String,
    (String, Option[String], Option[String], JsonObject),
    ServiceRequestError,
    ProcessInfo,
    Any
  ] =
    EndpointsUtil.baseEndpoint
      .post
      .in("process")
      .in(path[String]("messageName")
        .description("Message name that triggers a Message Start Event")
        .example("order-received"))
      .in("message")
      .in(query[Option[String]]("businessKey")
        .description("Business Key, be aware that this is not supported in Camunda 8.")
        .example(Some("order-12345")))
      .in(query[Option[String]]("tenantId")
        .description("If you have a multi tenant setup, you must specify the Tenant ID.")
        .example(Some("{{tenantId}}")))
      .in(jsonBody[JsonObject]
        .description("Request body with process variables as a JSON object")
        .example(startProcessRequestExample))
      .out(statusCode(StatusCode.Ok))
      .out(jsonBody[ProcessInfo]
        .description("Information about the started process instance")
        .example(ProcessInfo.example))
      .name("Start Process By Message")
      .summary("Start a process instance via Message Start Event")
      .description(
        """Starts a new process instance by sending a message to a Message Start Event.
          |This is used when a process is triggered by a message rather than being started directly.
          |
          |Note: In Camunda 8, identity correlation signing is not supported for message-started processes
          |because the message correlation response doesn't include the processInstanceId.
          |""".stripMargin
      )
      .tag(apiGroup)

  lazy val getProcessVariables
      : Endpoint[String, (String, Option[String]), ServiceRequestError, Json, Any] =
    EndpointsUtil.baseEndpoint
      .get
      .in("process")
      .in(path[String]("processInstanceId")
        .description("Process instance ID")
        .example("{{processInstanceId}}"))
      .in("variables")
      .in(query[Option[String]]("variableFilter")
        .description(
          "Comma-separated list of variable names to filter. If not provided, all variables are returned."
        )
        .example(Some("customerName,orderAmount")))
      .out(statusCode(StatusCode.Ok))
      .out(jsonBody[Json]
        .description("Process instance variables as a JSON object")
        .example(processVariablesExample))
      .name("Get Process Variables")
      .summary("Get variables of a process instance")
      .description(
        """Retrieves all variables or a filtered set of variables for a specific process instance.
          |""".stripMargin
      )
      .tag(apiGroup)

  lazy val getProcessVariablesForApi
      : Endpoint[String, (String, String, Option[String]), ServiceRequestError, Json, Any] =
    EndpointsUtil.baseEndpoint
      .get
      .in("process")
      .in(path[String]("processDefinitionKey")
        .description("Process definition ID or key")
        .example("order-process"))
      .in(path[String]("processInstanceId")
        .description("Process instance ID")
        .example("{{processInstanceId}}"))
      .in("variables")
      .in(query[Option[String]]("variableFilter")
        .description(
          "Comma-separated list of variable names to filter. If not provided, all variables are returned."
        )
        .example(Some("customerName,orderAmount")))
      .out(statusCode(StatusCode.Ok))
      .out(jsonBody[Json]
        .description("Process instance variables as a JSON object")
        .example(processVariablesExample))
      .name("Get Process Variables for API")
      .summary("Get variables of a process instance for API Documentation")
      .description(
        """Retrieves all variables or a filtered set of variables for a specific process instance.
          |""".stripMargin
      )
      .tag(apiGroup)

  private lazy val apiGroup = "Process Instance"

  // Extension method for process variables endpoint configuration
  extension [In](endpoint: Endpoint[String, In, ServiceRequestError, Unit, Any])
    private def withProcessVariablesConfig[Out]
        : Endpoint[String, Out, ServiceRequestError, Json, Any] =
      endpoint
        .in(path[String]("processInstanceId")
          .description("Process instance ID")
          .example("{{processInstanceId}}"))
        .in("variables")
        .in(query[Option[String]]("variableFilter")
          .description(
            "Comma-separated list of variable names to filter. If not provided, all variables are returned."
          )
          .example(Some("customerName,orderAmount")))
        .out(statusCode(StatusCode.Ok))
        .out(jsonBody[Json]
          .description("Process instance variables as a JSON object")
          .example(processVariablesExample))
        .description(
          """Retrieves all variables or a filtered set of variables for a specific process instance.
            |""".stripMargin
        )
        .tag(apiGroup)
        .asInstanceOf[Endpoint[String, Out, ServiceRequestError, Json, Any]]
  end extension

  // Example JSON for request body
  private lazy val startProcessRequestExample =
    Json.obj(
      "customerName" -> Json.fromString("John Doe"),
      "orderAmount"  -> Json.fromDoubleOrNull(1250.50),
      "orderDate"    -> Json.fromString("2025-10-26"),
      "priority"     -> Json.fromString("high"),
      "items"        -> Json.arr(
        Json.obj(
          "productId" -> Json.fromString("PROD-001"),
          "quantity"  -> Json.fromInt(2)
        ),
        Json.obj(
          "productId" -> Json.fromString("PROD-042"),
          "quantity"  -> Json.fromInt(1)
        )
      )
    ).asObject.get

  // Example JSON for process variables response
  private lazy val processVariablesExample =
    Json.obj(
      "customerName" -> Json.fromString("John Doe"),
      "orderAmount"  -> Json.fromDoubleOrNull(1250.50),
      "orderDate"    -> Json.fromString("2025-10-26"),
      "priority"     -> Json.fromString("high"),
      "items"        -> Json.arr(
        Json.obj(
          "productId" -> Json.fromString("PROD-001"),
          "quantity"  -> Json.fromInt(2)
        ),
        Json.obj(
          "productId" -> Json.fromString("PROD-042"),
          "quantity"  -> Json.fromInt(1)
        )
      )
    )

end ProcessInstanceEndpoints
