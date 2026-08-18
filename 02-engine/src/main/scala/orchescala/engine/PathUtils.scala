package orchescala.engine

import orchescala.domain.SignalEvent

object PathUtils:

  lazy val tenantIdQuery    = query[Option[String]]("tenantId").default(
    Some("{{tenantId}}")
  ).description("If you have a multi tenant setup, you must specify the Tenant ID.")
  lazy val businessKeyQuery = query[Option[String]]("businessKey").default(
    Some("From Test Client")
  ).description("Business Key, be aware that in Camunda 8 this is an additional process variable.")

  lazy val processInstanceIdQuery = query[Option[String]]("processInstanceId")
    .default(Some("{{processInstanceId}}"))
    .description("Process instance ID to correlate the message to a specific process instance.")

  def variableFilterQuery(out: Product | None.type = None) =
    val example = out match
      case None       => "name,firstName"
      case p: Product => p.productElementNames.mkString(",")
    query[Option[String]](
      "variableFilter"
    ).example(Some(example))
      .description("A comma-separated String of variable names. E.g. `name,firstName`")
  end variableFilterQuery

  lazy val timeoutInSecQuery    = query[Option[Int]]("timeoutInSec")
    .example(Some(10))
    .description(
      "The maximum number of seconds to wait for the user task to become active. If not provided, it will wait 10 seconds."
    )
  lazy val timeToLiveInSecQuery = query[Option[Int]]("timeToLiveInSec")
    .example(Some(10))
    .description(
      "The time in seconds the message is buffered, waiting for correlation. The default value is 0 seconds (no buffering). " +
        "Only supported in C8 - BE AWARE that if set, it is fire and forget: Camunda will just try to correlate for the configured time."
    )

  lazy val processDefinitionKeyPath =
    path[String](
      "processDefinitionKey"
    ).description("Process definition ID or key")
      .default("{{processDefinitionKey}}")
      .example("{{processDefinitionKey}}")

  lazy val processInstanceIdPath =
    path[String]("processInstanceId")
      .description(
        """The processInstanceId of the Process.
          |
          |> This is the result id of the `StartProcess`. And should automatically be set in Postman - see _Postman Instructions_.
          |
          |""".stripMargin
      )
      .default("{{processInstanceId}}")

  lazy val userTaskDefinitionKeyPath =
    path[String]("userTaskDefinitionKey")
      .description(
        """User task definition ID (task definition key in the BPMN)
          |- In `complete`: This is only used for API path differentiation in OpenAPI.
          |- We use this that you can have multiple UserTasks in one Project.
          |""".stripMargin
      )
      .example("ApproveOrderUT")

  end userTaskDefinitionKeyPath

  lazy val userTaskInstanceIdPath =
    path[String]("userTaskInstanceId")
      .description("User task instance ID (obtained from getUserTaskVariables)")
      .example("{{userTaskInstanceId}}")

  def signalOrMessageNamePath(messageName: String): EndpointInput[?] =
    if messageName.contains(SignalEvent.Dynamic_ProcessInstance) then
      val name = messageName.replace(
        SignalEvent.Dynamic_ProcessInstance,
        s"{${SignalEvent.Dynamic_ProcessInstance}}"
      )
      path[String]
        .name(messageName.split('-').drop(2).mkString("-").replace(
          SignalEvent.Dynamic_ProcessInstance,
          "processInstanceId"
        ).replace(".", "_"))
        .example(name)
    else
      messageName

  lazy val signalOrMessageNamePath =
    path[String]("messageName")
      .example("order-received")
      .description("The messageName of the Event (Signal or Message).")

  end signalOrMessageNamePath

  lazy val workerTopicNamePath =
    path[String]("workerTopicName")
      .description("Worker definition ID (worker topic name)")
      .example("process-order-worker")

end PathUtils
