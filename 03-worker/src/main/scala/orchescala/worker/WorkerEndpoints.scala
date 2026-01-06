package orchescala.worker

import io.circe.parser.*
import orchescala.domain.*
import sttp.tapir.*
import sttp.tapir.json.circe.*

object WorkerEndpoints:

  private val baseEndpoint = endpoint
    .in("worker")
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

  // Example request body for triggering a worker
  private val triggerWorkerRequestExample = parse("""
    {
      "orderId": "12345",
      "customerId": "CUST-789",
      "amount": 150.00
    }
  """).getOrElse(io.circe.Json.Null)


  val triggerWorker: Endpoint[String, (String, Json), ErrorResponse, Option[Json], Any] =
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
          oneOfVariantValueMatcher(statusCode(StatusCode.Ok).and(jsonBody[Json].map(Some(_))(_.get))) {
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

