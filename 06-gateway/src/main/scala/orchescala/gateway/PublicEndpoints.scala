package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.PathUtils.*
import orchescala.engine.domain.{MessageCorrelationResult, ProcessInfo}
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.model.Header
import sttp.tapir.*
import sttp.tapir.json.circe.*

/** The calls without a Bearer token - only what [[PublicAccess]] lists (see [[PublicRoutes]]).
  *
  * The name and the client are security inputs: they are checked (rate limit, allow list) before
  * the body is read - so oversized or broken bodies count as well.
  */
object PublicEndpoints:

  private val apiGroup = "Public"

  /** The body as it is sent - [[PublicGuard]] parses it. */
  private def body[T](description: String)(using schema: Schema[T]) =
    stringJsonBody.schema(schema.as[String]).description(description)

  // no default (the protected endpoints have one for the test client)
  private val businessKey =
    query[Option[String]]("businessKey").description("Business Key of the new process instance.")

  /** The address of the client - the remote address, or the header of [[PublicAccess.clientIpHeader]]. */
  private val clientIn =
    extractFromRequest(_.connectionInfo.remote.map(_.getAddress.getHostAddress))
      .and(headers)

  /** The name (topic, process key or message) and the client. */
  type Admission = (String, Option[String], List[Header])

  lazy val worker: Endpoint[Admission, String, ServiceRequestError, Option[Json], Any] =
    EndpointsUtil.publicBaseEndpoint
      .post
      .securityIn("public" / "worker")
      .securityIn(workerTopicNamePath)
      .securityIn(clientIn)
      .in(body[Json]("Variables to send to the worker as a JSON object"))
      .out(WorkerEndpoints.triggerWorker.output)
      .name("Public: Forward to Worker")
      .summary("Calls a public worker - without a token")
      .description("Only the workers of `PublicAccess.workers`; the gateway calls them with its own token.")
      .tag(apiGroup)

  lazy val startProcess: Endpoint[Admission, (Option[String], String), ServiceRequestError, ProcessInfo, Any] =
    EndpointsUtil.publicBaseEndpoint
      .post
      .securityIn("public" / "process")
      .securityIn(processDefinitionKeyPath)
      .securityIn("async")
      .securityIn(clientIn)
      .in(businessKey)
      .in(body[JsonObject]("Request body with process variables as a JSON object"))
      .out(jsonBody[ProcessInfo].example(ProcessInfo.example))
      .name("Public: Start Process Async")
      .summary("Starts a public process - without a token")
      .description(
        "Only the processes of `PublicAccess.processStarts`; the gateway starts them with its own token " +
          "(the process runs with that identity)."
      )
      .tag(apiGroup)

  lazy val message: Endpoint[Admission, (String, String), ServiceRequestError, MessageCorrelationResult, Any] =
    EndpointsUtil.publicBaseEndpoint
      .post
      .securityIn("public" / "message")
      .securityIn(signalOrMessageNamePath)
      .securityIn(clientIn)
      .in(query[String]("businessKey").description("Business Key of the process instance - required."))
      .in(body[Option[JsonObject]]("Variables to send with the message as a JSON object"))
      .out(jsonBody[MessageCorrelationResult])
      .name("Public: Send Message")
      .summary("Sends a public message - without a token")
      .description("Only the messages of `PublicAccess.messages`, correlated by the business key.")
      .tag(apiGroup)

end PublicEndpoints
