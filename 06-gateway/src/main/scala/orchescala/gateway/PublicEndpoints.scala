package orchescala.gateway

import orchescala.domain.*
import orchescala.engine.PathUtils.*
import orchescala.engine.domain.{MessageCorrelationResult, ProcessInfo}
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.tapir.*
import sttp.tapir.json.circe.*

/** The calls without a Bearer token - only what [[PublicAccess]] lists (see [[PublicRoutes]]). */
object PublicEndpoints:

  private val apiGroup = "Public"

  /** The body as it is sent - [[PublicGuard]] parses it after the rate limit, so broken bodies are
    * counted as well.
    */
  private def body[T](description: String)(using schema: Schema[T]) =
    stringJsonBody.schema(schema.as[String]).description(description)

  // no default (the protected endpoints have one for the test client)
  private val businessKey =
    query[Option[String]]("businessKey").description("Business Key of the new process instance.")

  /** The address of the client - the remote address, or the header of [[PublicAccess.clientIpHeader]]. */
  private val clientIn =
    extractFromRequest(_.connectionInfo.remote.map(_.getAddress.getHostAddress))
      .and(headers)

  lazy val worker: PublicEndpoint[(String, String, Option[String], List[sttp.model.Header]), ServiceRequestError, Option[Json], Any] =
    EndpointsUtil.publicBaseEndpoint
      .post
      .in("public" / "worker")
      .in(workerTopicNamePath)
      .in(body[Json]("Variables to send to the worker as a JSON object"))
      .in(clientIn)
      .out(WorkerEndpoints.triggerWorker.output)
      .name("Public: Forward to Worker")
      .summary("Calls a public worker - without a token")
      .description("Only the workers of `PublicAccess.workers`; the gateway calls them with its own token.")
      .tag(apiGroup)

  lazy val startProcess: PublicEndpoint[
    (String, Option[String], String, Option[String], List[sttp.model.Header]),
    ServiceRequestError,
    ProcessInfo,
    Any
  ] =
    EndpointsUtil.publicBaseEndpoint
      .post
      .in("public" / "process")
      .in(processDefinitionKeyPath)
      .in("async")
      .in(businessKey)
      .in(body[JsonObject]("Request body with process variables as a JSON object"))
      .in(clientIn)
      .out(jsonBody[ProcessInfo].example(ProcessInfo.example))
      .name("Public: Start Process Async")
      .summary("Starts a public process - without a token")
      .description(
        "Only the processes of `PublicAccess.processStarts`; the gateway starts them with its own token " +
          "(the process runs with that identity)."
      )
      .tag(apiGroup)

  lazy val message: PublicEndpoint[
    (String, String, String, Option[String], List[sttp.model.Header]),
    ServiceRequestError,
    MessageCorrelationResult,
    Any
  ] =
    EndpointsUtil.publicBaseEndpoint
      .post
      .in("public" / "message")
      .in(signalOrMessageNamePath)
      .in(query[String]("businessKey").description("Business Key of the process instance - required."))
      .in(body[Option[JsonObject]]("Variables to send with the message as a JSON object"))
      .in(clientIn)
      .out(jsonBody[MessageCorrelationResult])
      .name("Public: Send Message")
      .summary("Sends a public message - without a token")
      .description("Only the messages of `PublicAccess.messages`, correlated by the business key.")
      .tag(apiGroup)

end PublicEndpoints
