package orchescala.gateway

import io.circe.parser.*
import orchescala.domain.*
import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.tapir.*
import sttp.tapir.json.circe.*
import orchescala.engine.PathUtils.*

object WorkerEndpoints:
  
  lazy val triggerWorker
      : Endpoint[String, (String, Json), ServiceRequestError, Option[Json], Any] =
    EndpointsUtil.baseEndpoint
      .post
      .in("worker")
      .in(workerTopicNamePath)
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
      .name("Forward to Worker")
      .summary("Forward to a worker execution")
      .description(
        """Forwards to the WorkerApp to trigger a worker executing with the provided variables.
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

  // Example request body for triggering a worker
  private lazy val triggerWorkerRequestExample =
    Json.obj(
      "orderId" -> Json.fromString("12345"),
      "customerId" -> Json.fromString("CUST-789"),
      "amount" -> Json.fromDoubleOrNull(150.00)
    )

end WorkerEndpoints
