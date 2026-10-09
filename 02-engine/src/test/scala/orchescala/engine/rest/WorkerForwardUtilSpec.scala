package orchescala.engine.rest

import io.circe.Json
import orchescala.engine.DefaultEngineConfig
import orchescala.engine.domain.EngineError
import sttp.client3.*
import sttp.client3.asynchttpclient.zio.AsyncHttpClientZioBackend
import sttp.model.StatusCode
import zio.*
import zio.test.*

import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*

object WorkerForwardUtilSpec extends ZIOSpecDefault:

  private final class WorkerApp(status: StatusCode = StatusCode.Ok, body: String = "{}"):
    val requests = ConcurrentLinkedQueue[Request[?, ?]]()
    val layer: ULayer[SttpClientBackend] = ZLayer.succeed(
      AsyncHttpClientZioBackend.stub.whenAnyRequest.thenRespondF: request =>
        requests.add(request)
        ZIO.succeed(Response(body, status))
    )

  // as on a server (not localhost): the worker host comes from the topic name
  private given DefaultEngineConfig =
    DefaultEngineConfig(workerAppUrl = DefaultEngineConfig.defaultWorkerAppUrl(_, isLocalhost = false))

  private def forward(topic: String, app: WorkerApp) =
    WorkerForwardUtil.forwardWorkerRequest(topic, Json.obj(), "token").provideLayer(app.layer).exit

  private val refusedLine = "Worker app refused the request:"
  private val errorLine   = "Error forwarding request to worker app:"

  /** A worker app answering `status` with `body` - the failure and the log lines of the call. */
  private def answered(status: StatusCode, body: String) =
    for
      exit   <- forward("mycompany-myproject-reserveSlot", WorkerApp(status, body))
      output <- ZTestLogger.logOutput
    yield (exit.causeOption.flatMap(_.failureOption), output.map(l => l.logLevel -> l.message()))

  def spec = suite("WorkerForwardUtil")(
    test("topic names that would reach another host are rejected - no request is sent") {
      val app = WorkerApp()
      for
        results <- ZIO.foreach(Seq(
                     "10.0.0.5:8080/admin#",  // host, port and path
                     "internal.host:8080",
                     "attacker.example",      // a host name without '-'
                     "mycompany-evil.example", // a dotted host part
                     "a-b/../../admin",
                     "user@attacker.example"
                   ))(forward(_, app))
      yield assertTrue(results.forall(_.isFailure), app.requests.isEmpty)
    },
    test("a valid topic goes to its worker app, as one path segment") {
      val app = WorkerApp()
      for _ <- forward("mycompany-myproject-myWorker.v2", app)
      yield
        val uri  = app.requests.asScala.head.uri
        val host = uri.host
        val port = uri.port
        val path = uri.path
        assertTrue(
          host.contains("mycompany-myproject"),
          port.contains(5555),
          path == Seq("worker", "mycompany-myproject-myWorker.v2")
        )
    },
    test("an invalid topic is answered with 400") {
      val app = WorkerApp()
      for exit <- forward("x:1/y", app)
      yield assertTrue(exit.causeOption.flatMap(_.failureOption).exists:
        case EngineError.ServiceRequestError(400, _) => true
        case _                                       => false)
    },
    suite("a refusal of the worker app - its own answer with a 4xx - is logged as info, not as an error")(
      Seq(
        "409 - the slot is taken"      -> (StatusCode.Conflict, 409, "Der Termin ist leider vergeben"),
        "404 - the link has expired"   -> (StatusCode.NotFound, 404, "No appointment for this link"),
        "400 - the input is not valid" -> (StatusCode.BadRequest, 400, "The slot is in the past")
      ).map { case (name, (status, code, msg)) =>
        test(name) {
          for (failure, lines) <- answered(status, s"""{"errorCode":$code,"errorMsg":"$msg"}""")
          yield assertTrue(
            failure.exists:
              case EngineError.ServiceRequestError(`code`, `msg`) => true
              case _                                            => false
            ,
            lines.exists((level, line) => level == LogLevel.Info && line.startsWith(refusedLine)),
            !lines.exists(_._1 == LogLevel.Error)
          )
        }
      }*
    ),
    suite("everything else is logged as an error - no refusal")(
      Seq(
        "a 404 without an answer of the worker app (no such route)" -> (StatusCode.NotFound, "Not Found"),
        "a 401 - the token was rejected"                           -> (StatusCode.Unauthorized, """{"errorCode":401,"errorMsg":"Invalid token"}"""),
        "a 429 of a proxy"                                         -> (StatusCode.TooManyRequests, "<html>Too Many Requests</html>"),
        "a 500 whose body claims a 409 - the status decides"       -> (StatusCode.InternalServerError, """{"errorCode":409,"errorMsg":"taken"}"""),
        "a 500"                                                    -> (StatusCode.InternalServerError, """{"errorCode":500,"errorMsg":"boom"}""")
      ).map { case (name, (status, body)) =>
        test(name) {
          for (failure, lines) <- answered(status, body)
          yield assertTrue(
            failure.isDefined,
            lines.exists((level, line) => level == LogLevel.Error && line.startsWith(errorLine)),
            !lines.exists(_._2.startsWith(refusedLine))
          )
        }
      }*
    )
  )
end WorkerForwardUtilSpec
