package orchescala.engine.w4s

import cats.MonoidK.ops.toAllMonoidKOps
import cats.effect.unsafe.{IORuntime, IORuntimeConfig, Scheduler}
import cats.effect.{IO, Resource}
import cats.syntax.all.catsSyntaxApplicativeId
import com.comcast.ip4s.{Port, ipv4}
import io.circe.Encoder
import org.http4s.HttpRoutes
import org.http4s.dsl.io.*
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.server.middleware.CORS
import sttp.tapir.server.http4s.Http4sServerInterpreter
import workflows4s.runtime.instanceengine.WorkflowInstanceEngine
import workflows4s.runtime.registry.InMemoryWorkflowRegistry
import workflows4s.runtime.wakeup.SleepingKnockerUpper
import workflows4s.ui.bundle.UiEndpoints
import workflows4s.web.api.model.UIConfig
import workflows4s.web.api.server.{WorkflowEntry, WorkflowServerEndpoints}
import zio.{Task, ZIO}

import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.ExecutionContext

object W4SServer:
  /** JVM-static holder for the engine created during [[W4SServer.w4SWorkflowApi]] startup.
    * Stored in the companion object so it is a true static field — a `private val` in a trait
    * compiles to an abstract accessor that breaks binary compatibility with older class files.
    */
  private[w4s] val engineHolder: AtomicReference[Option[WorkflowInstanceEngine]] =
    new AtomicReference(None)

  /** Dedicated Cats Effect IORuntime for the W4S http4s server.
    *
    * Stored in the companion object (not the trait) to avoid AbstractMethodError: a `private val`
    * in a trait compiles to an abstract accessor on the JVM interface, breaking already-compiled
    * subclasses. As a companion-object val it becomes a true JVM static field.
    *
    * Uses separate daemon-thread pools for compute and blocking so that Ember's blocking I/O calls
    * never starve CE fibers. All threads are daemons so they do not prevent JVM shutdown.
    */
  private[w4s] lazy val ceIORuntime: IORuntime =
    def daemonFactory(prefix: String): java.util.concurrent.ThreadFactory =
      var idx = 0
      r =>
        idx += 1
        val t = new Thread(r, s"$prefix-$idx")
        t.setDaemon(true)
        t
    val nThreads  = math.max(2, Runtime.getRuntime.availableProcessors())
    val compute   = Executors.newFixedThreadPool(nThreads, daemonFactory("w4s-ce-compute"))
    val blocking  = Executors.newCachedThreadPool(daemonFactory("w4s-ce-blocking"))
    val scheduler = Executors.newSingleThreadScheduledExecutor(daemonFactory("w4s-ce-scheduler"))
    IORuntime(
      compute   = ExecutionContext.fromExecutor(compute),
      blocking  = ExecutionContext.fromExecutor(blocking),
      scheduler = Scheduler.fromScheduledExecutor(scheduler),
      shutdown  = () => { compute.shutdown(); blocking.shutdown(); scheduler.shutdown() },
      config    = IORuntimeConfig()
    )

trait W4SServer:
  def w4SConfig: W4SConfig

  /** Override to provide the list of workflow entries for this server.
    *
    * Use [[w4SEngine]] to access the engine — it safely returns the engine
    * that was already created in the current startup chain, without starting
    * a new one.
    *
    * Example:
    * {{{
    *   override protected def workflowEntries: Resource[IO, List[WorkflowEntry[IO, ?]]] =
    *     Workflows.workflows(w4SEngine)
    * }}}
    */
  protected def workflowEntries: Resource[cats.effect.IO, List[WorkflowEntry[cats.effect.IO, ?]]]

  /** Override to disable search functionality in the server (e.g. for testing the search-disabled
    * UI).
    */
  protected def includeSearch: Boolean = true

  /** Starts the W4S UI server as a ZIO Task.
    *
    * Converts the Cats Effect based http4s server to a ZIO effect so it can be forked alongside a
    * ZIO-based [[orchescala.worker.WorkerApp]]. The returned task runs indefinitely (until the
    * fiber is interrupted).
    *
    * Example usage in a WorkerApp subclass:
    * {{{
    *   override protected def additionalServices: ZIO[Any, Any, Any] =
    *     serverWithUiZIO(uiPort, apiUrl)
    * }}}
    */
  lazy val serverWithUiZIO: Task[Nothing] =
    ZIO.logInfo(s"Starting W4S UI Server on port ${w4SConfig.port} (API: ${w4SConfig.effectiveApiUrl}) ...") *>
      ZIO.asyncInterrupt[Any, Throwable, Nothing] { cb =>
        given IORuntime = W4SServer.ceIORuntime
        // handleErrorWith propagates server errors to the ZIO fiber;
        // normal completion never happens (IO.never), only cancellation.
        val cancel = serverWithUi
          .use(_ =>
            IO(println(
              s"W4S UI Server ready ► http://localhost:${w4SConfig.port}/ui/"
            )) *> IO.never
          )
          .handleErrorWith(err => IO(cb(ZIO.fail(err))))
          .unsafeRunCancelable()
        Left(ZIO.fromFuture(_ => cancel()).zipLeft(ZIO.logInfo("W4S Server stopped"))
          .orDie)
      }.tapError(err => ZIO.logError(s"W4S UI Server failed to start: ${err.getMessage}"))

  /** Provides the [[WorkflowInstanceEngine]] created by this server's startup chain.
    *
    * Safe to call from inside [[workflowEntries]]: it reads the engine stored in
    * [[engineHolder]], which is set immediately before [[workflowEntries]] is called,
    * so no second resource chain is started.
    */
  protected lazy val w4SEngine: Resource[IO, WorkflowInstanceEngine] =
    Resource.eval(IO(W4SServer.engineHolder.get()).flatMap {
      case Some(engine) => IO.pure(engine)
      case None         => IO.raiseError(new IllegalStateException(
        "w4SEngine was accessed before the engine was initialized. " +
          "Only use w4SEngine inside workflowEntries."
      ))
    })

  /** Creates the API routes with CORS enabled. */
  protected lazy val w4SWorkflowApi: Resource[IO, (WorkflowInstanceEngine, HttpRoutes[IO])] =
    for
      _            <- Resource.eval(IO(println("[W4S] Initializing KnockerUpper...")))
      knockerUpper <- SleepingKnockerUpper.create()
      _            <- Resource.eval(IO(println("[W4S] Initializing Registry...")))
      registry     <- InMemoryWorkflowRegistry().toResource
      engine        = WorkflowInstanceEngine.default(knockerUpper, registry)
      // Store the engine BEFORE calling workflowEntries so w4SEngine can read it safely
      _            <- Resource.eval(IO(W4SServer.engineHolder.set(Some(engine))))
      _            <- Resource.eval(IO(println("[W4S] Loading workflow entries...")))
      wEntries     <- workflowEntries
      _            <- Resource.eval(IO(println(s"[W4S] Compiling routes (${wEntries.size} workflow entries)...")))
      routes        =
        Http4sServerInterpreter[IO]()
          .toRoutes(WorkflowServerEndpoints.get[IO](wEntries, Option.when(includeSearch)(registry)))
      _            <- Resource.eval(IO(println("[W4S] Routes compiled.")))
    yield (engine, CORS.policy.withAllowOriginAll(routes))

  protected lazy val serverWithUi: Resource[IO, org.http4s.server.Server] =
    for
      (_, api) <- w4SWorkflowApi
      uiRoutes  = Http4sServerInterpreter[IO]()
                    .toRoutes(UiEndpoints.get(
                      UIConfig(sttp.model.Uri.unsafeParse(w4SConfig.effectiveApiUrl), true)
                    ))
      redirect  = org.http4s.HttpRoutes.of[IO] {
                    case req @ org.http4s.Method.GET -> Root / "ui" =>
                      org.http4s
                        .Response[IO](org.http4s.Status.PermanentRedirect)
                        .putHeaders(org.http4s.headers.Location(req.uri / ""))
                        .pure[IO]
                    case org.http4s.Method.GET -> Root              =>
                      org.http4s
                        .Response[IO](org.http4s.Status.PermanentRedirect)
                        .putHeaders(
                          org.http4s.headers.Location(org.http4s.Uri.unsafeFromString("/ui/"))
                        )
                        .pure[IO]
                  }
      allRoutes = api <+> redirect <+> uiRoutes
      _        <- Resource.eval(IO(println(s"[W4S] Binding EmberServer to port ${w4SConfig.port}...")))
      server   <- EmberServerBuilder
                    .default[IO]
                    .withHost(ipv4"0.0.0.0")
                    .withPort(Port.fromInt(w4SConfig.port).get)
                    .withHttpApp(allRoutes.orNotFound)
                    .build
    yield server

end W4SServer
