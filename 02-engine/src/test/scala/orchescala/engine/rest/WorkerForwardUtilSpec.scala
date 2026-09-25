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

  private final class WorkerApp:
    val requests = ConcurrentLinkedQueue[Request[?, ?]]()
    val layer: ULayer[SttpClientBackend] = ZLayer.succeed(
      AsyncHttpClientZioBackend.stub.whenAnyRequest.thenRespondF: request =>
        requests.add(request)
        ZIO.succeed(Response("{}", StatusCode.Ok))
    )

  // as on a server (not localhost): the worker host comes from the topic name
  private given DefaultEngineConfig =
    DefaultEngineConfig(workerAppUrl = DefaultEngineConfig.defaultWorkerAppUrl(_, isLocalhost = false))

  private def forward(topic: String, app: WorkerApp) =
    WorkerForwardUtil.forwardWorkerRequest(topic, Json.obj(), "token").provideLayer(app.layer).exit

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
    }
  )
end WorkerForwardUtilSpec
