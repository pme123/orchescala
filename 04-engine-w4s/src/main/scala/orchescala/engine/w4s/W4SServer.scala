package orchescala.engine.w4s

import cats.MonoidK.ops.toAllMonoidKOps
import cats.effect.{IO, Resource}
import cats.syntax.all.catsSyntaxApplicativeId
import com.comcast.ip4s.{Port, ipv4}
import io.circe.Encoder
import org.http4s.HttpRoutes
import org.http4s.dsl.io.*
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.server.middleware.CORS
import sttp.tapir.server.http4s.Http4sServerInterpreter
import workflows4s.runtime.InMemoryRuntime
import workflows4s.runtime.instanceengine.WorkflowInstanceEngine
import workflows4s.runtime.registry.InMemoryWorkflowRegistry
import workflows4s.runtime.wakeup.SleepingKnockerUpper
import workflows4s.ui.bundle.UiEndpoints
import workflows4s.web.api.model.UIConfig
import workflows4s.web.api.server.{SignalSupport, WorkflowEntry, WorkflowServerEndpoints}

trait W4SServer:
  protected def workflowEntries: List[WorkflowEntry[IO, ?]]
  /** Override to disable search functionality in the server (e.g. for testing the search-disabled UI). */
  protected def includeSearch: Boolean = true

  /** Creates the API routes with CORS enabled
   */
  protected def apiRoutes: Resource[IO, HttpRoutes[IO]] = {
    for {
      knockerUpper <- SleepingKnockerUpper.create()
      registry <- InMemoryWorkflowRegistry().toResource
      engine = WorkflowInstanceEngine.default(knockerUpper, registry)
      routes = Http4sServerInterpreter[IO]().toRoutes(WorkflowServerEndpoints.get[IO](workflowEntries, Option.when(includeSearch)(registry)))
    } yield CORS.policy.withAllowOriginAll(routes)
  }

  protected def serverWithUi(port: Int, apiUrl: String): Resource[IO, org.http4s.server.Server] = {
    for {
      api <- apiRoutes
      uiRoutes = Http4sServerInterpreter[IO]().toRoutes(UiEndpoints.get(UIConfig(sttp.model.Uri.unsafeParse(apiUrl), true)))
      redirect = org.http4s.HttpRoutes.of[IO] {
        case req@org.http4s.Method.GET -> Root / "ui" =>
          org.http4s
            .Response[IO](org.http4s.Status.PermanentRedirect)
            .putHeaders(org.http4s.headers.Location(req.uri / ""))
            .pure[IO]
        case org.http4s.Method.GET -> Root =>
          org.http4s
            .Response[IO](org.http4s.Status.PermanentRedirect)
            .putHeaders(org.http4s.headers.Location(org.http4s.Uri.unsafeFromString("/ui/")))
            .pure[IO]
      }
      allRoutes = api <+> redirect <+> uiRoutes
      server <- EmberServerBuilder
        .default[IO]
        .withHost(ipv4"0.0.0.0")
        .withPort(Port.fromInt(port).get)
        .withHttpApp(allRoutes.orNotFound)
        .build
    } yield server
  }
