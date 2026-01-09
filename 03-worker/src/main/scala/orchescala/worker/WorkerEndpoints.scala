package orchescala.worker

import io.circe.parser.*
import orchescala.domain.*
import orchescala.worker.WorkerError.*
import sttp.tapir.*
import sttp.tapir.json.circe.*

object WorkerEndpoints:

  private val baseEndpoint = endpoint
    .in("worker")
    .errorOut(
      oneOf[ServiceRequestError](
        oneOfVariantValueMatcher(statusCode(StatusCode.Unauthorized)
          .and(jsonBody[ServiceRequestError]
            .example(
              ServiceRequestError(ServiceAuthError("Problem authenticating request: error"))
            ))) { case e: ServiceRequestError if e.errorCode == 401 => true },
        oneOfVariantValueMatcher(statusCode(StatusCode.BadRequest)
          .and(jsonBody[ServiceRequestError]
            .example(ServiceRequestError(ServiceBadBodyError(
              "There is no body in the response and the ServiceOut is neither NoOutput nor Option (Class is class java.lang.String)."
            ))))) { case e: ServiceRequestError if e.errorCode == 400 => true },
        oneOfVariantValueMatcher(statusCode(StatusCode.NotFound)
          .and(jsonBody[ServiceRequestError]
            .example(ServiceRequestError(404, "Not Found")))) {
          case e: ServiceRequestError if e.errorCode == 404 => true
        },
        oneOfVariantValueMatcher(statusCode(StatusCode.InternalServerError)
          .and(jsonBody[ServiceRequestError]
            .example(ServiceRequestError(500, "Internal Server Error")))) {
          case e: ServiceRequestError if e.errorCode >= 500 => true
        },
        oneOfDefaultVariant(jsonBody[ServiceRequestError])
      )
    )

  // Secured base endpoint with Bearer token authentication
  private val securedBaseEndpoint = baseEndpoint
    .securityIn(auth.bearer[String]())

  // Example request body for triggering a worker
  private val triggerWorkerRequestExample = parse("""
    {
      "orderId": "12345",
      "customerId": "CUST-789",
      "amount": 150.00
    }
  """).getOrElse(io.circe.Json.Null)

  val triggerWorker: Endpoint[String, (String, Json), ServiceRequestError, Option[Json], Any] =
    securedBaseEndpoint
      .post
      .in(path[String]("topicName")
        .description("Worker definition ID (worker topic name)")
        .example("process-order-worker"))
      .in(jsonBody[Json]
        .description("Variables to send to the worker as a JSON object")
        .example(triggerWorkerRequestExample))
      .out(
        oneOf[Option[Json]](
          oneOfVariantValueMatcher(statusCode(StatusCode.NoContent).and(emptyOutputAs(None))) {
            case None => true
          },
          oneOfVariantValueMatcher(
            statusCode(StatusCode.Ok).and(jsonBody[Json].map(Some(_))(_.get))
          ) {
            case Some(_) => true
          }
        )
      )
      .name("Trigger Worker")
      .summary("Trigger a worker execution")
      .description(
        """Triggers a worker to execute with the provided variables.
          |
          |This endpoint allows you to manually trigger a worker execution, which can be useful for:
          |- Testing worker implementations
          |- Debugging worker behavior
          |- Manually processing tasks outside of normal process flow
          |
          |The worker will receive the provided variables as input and execute its logic accordingly.
          |If the worker returns output variables, they will be returned with status 200 OK.
          |If the worker returns no output (NoOutput), status 204 No Content will be returned.
          |""".stripMargin
      ).tag("Worker")

end WorkerEndpoints
