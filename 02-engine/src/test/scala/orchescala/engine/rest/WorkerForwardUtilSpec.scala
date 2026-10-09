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

  private final class WorkerApp(answer: Task[Response[String]] = ZIO.succeed(Response("{}", StatusCode.Ok))):
    val requests = ConcurrentLinkedQueue[Request[?, ?]]()
    val layer: ULayer[SttpClientBackend] = ZLayer.succeed(
      AsyncHttpClientZioBackend.stub.whenAnyRequest.thenRespondF: request =>
        requests.add(request)
        answer
    )

  private def answering(status: StatusCode, body: String) = WorkerApp(ZIO.succeed(Response(body, status)))

  // as on a server (not localhost): the worker host comes from the topic name
  private given DefaultEngineConfig =
    DefaultEngineConfig(workerAppUrl = DefaultEngineConfig.defaultWorkerAppUrl(_, isLocalhost = false))

  private def forward(topic: String, app: WorkerApp) =
    WorkerForwardUtil.forwardWorkerRequest(topic, Json.obj(), "token").provideLayer(app.layer).exit

  private val refusedLine = "Worker app refused the request:"
  private val errorLine   = "Error forwarding request to worker app:"

  /** A call to `app` - its failure and its log lines. */
  private def called(app: WorkerApp) =
    for
      exit   <- forward("mycompany-myproject-reserveSlot", app)
      output <- ZTestLogger.logOutput
    yield (exit.causeOption.flatMap(_.failureOption), output.map(l => l.logLevel -> l.message()))

  /** How many lines of `level` start with `prefix` - exactly one is logged per call. */
  private def count(lines: Seq[(LogLevel, String)], level: LogLevel, prefix: String) =
    lines.count((l, line) => l == level && line.startsWith(prefix))

  /** An error, logged once - and no refusal. */
  private def loggedAsError(lines: Seq[(LogLevel, String)]) =
    count(lines, LogLevel.Error, errorLine) == 1 && !lines.exists(_._2.startsWith(refusedLine))

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
          for (failure, lines) <- called(answering(status, s"""{"errorCode":$code,"errorMsg":"$msg"}"""))
          yield assertTrue(
            failure.exists:
              case EngineError.ServiceRequestError(`code`, `msg`) => true
              case _                                            => false
            ,
            count(lines, LogLevel.Info, refusedLine) == 1,
            count(lines, LogLevel.Error, errorLine) == 0
          )
        }
      }*
    ),
    suite("everything else is logged as an error - no refusal")(
      Seq(
        "a 404 without an answer of the worker app (no such route)" -> (StatusCode.NotFound, "Not Found"),
        "a 401 - the token was rejected"                           -> (StatusCode.Unauthorized, """{"errorCode":401,"errorMsg":"Invalid token"}"""),
        "a 403 - an auth status, even with its answer"             -> (StatusCode.Forbidden, """{"errorCode":403,"errorMsg":"Forbidden"}"""),
        "a 407 - an auth status, even with its answer"             -> (StatusCode.ProxyAuthenticationRequired, """{"errorCode":407,"errorMsg":"Proxy auth"}"""),
        "a 404 whose body claims a 409 - status and answer differ" -> (StatusCode.NotFound, """{"errorCode":409,"errorMsg":"taken"}"""),
        "a 429 of a proxy"                                         -> (StatusCode.TooManyRequests, "<html>Too Many Requests</html>"),
        "a 500 whose body claims a 409 - the status decides"       -> (StatusCode.InternalServerError, """{"errorCode":409,"errorMsg":"taken"}"""),
        "a 500"                                                    -> (StatusCode.InternalServerError, """{"errorCode":500,"errorMsg":"boom"}""")
      ).map { case (name, (status, body)) =>
        test(name) {
          for (failure, lines) <- called(answering(status, body))
          yield assertTrue(failure.isDefined, loggedAsError(lines))
        }
      }*
    ),
    suite("no answer is logged as an error")(
      test("the worker app cannot be reached - 503") {
        for (failure, lines) <- called(WorkerApp(ZIO.fail(java.net.ConnectException("Connection refused"))))
        yield assertTrue(
          failure.exists:
            case EngineError.ServiceRequestError(503, _) => true
            case _                                       => false
          ,
          loggedAsError(lines)
        )
      },
      test("a 2xx whose body is no JSON") {
        for (failure, lines) <- called(answering(StatusCode.Ok, "<html>ok</html>"))
        yield assertTrue(failure.isDefined, loggedAsError(lines))
      }
    )
  )
end WorkerForwardUtilSpec
