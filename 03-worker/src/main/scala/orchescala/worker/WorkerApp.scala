package orchescala.worker

import orchescala.engine.rest.HttpClientProvider
import orchescala.engine.{EngineRuntime, banner}
import zio.ZIO.*
import zio.http.Server
import zio.{EnvironmentTag, Trace, ZIO, ZIOApp, ZIOAppArgs, ZIOAppDefault, ZLayer}

import java.lang.management.ManagementFactory
import scala.jdk.CollectionConverters.*

trait WorkerApp extends ZIOAppDefault:

  def workerConfig: WorkerConfig
  def port: Int               = workerConfig.workerAppPort
  def applicationName: String = getClass.getName.split('.').take(2).mkString("-")
  def engineContext: EngineContext
  // a list of registries for each worker implementation
  def workerRegistries: Seq[WorkerRegistry]

  // Automatically detect and provide required engine layers
  private def requiredEngineLayers: ZLayer[Any, Nothing, Any] =
    // Collect all required layers from worker registries
    val allLayers = workerRegistries.flatMap(_.requiredLayers)

    // Combine all layers into one
    allLayers.foldLeft(ZLayer.empty: ZLayer[Any, Nothing, Any])(_ ++ _)
  end requiredEngineLayers

  /** Optional additional ZIO services to run in parallel with the worker registries.
    *
    * Override this in your concrete app to start extra services (e.g. the W4S UI server):
    * {{{
    *   override protected def additionalServices: ZIO[Any, Any, Any] =
    *     serverWithUiZIO(uiPort, apiUrl)
    * }}}
    * The effect is forked as a daemon fiber and runs until the application is interrupted.
    */
  protected def additionalServices: ZIO[Any, Any, Any] = ZIO.unit

  // list all the workers you want to register
  def workers(dWorkers: (WorkerDsl[?, ?] | Seq[WorkerDsl[?, ?]])*): Unit =
    theWorkers = dWorkers
      .flatMap:
        case d: WorkerDsl[?, ?] => Seq(d)
        case s: Seq[?]          => s.collect { case d: WorkerDsl[?, ?] => d }
      .toSet

  def dependencies(workerApps: WorkerApp*): Unit =
    theDependencies = workerApps

  private[orchescala] var theWorkers: Set[WorkerDsl[?, ?]] = Set.empty
  protected var theDependencies: Seq[WorkerApp]            = Seq.empty

  override val bootstrap: ZLayer[ZIOAppArgs, Any, Any] = EngineRuntime.logger

  override def run: ZIO[Any, Any, Any]                                 =
    ZIO.scoped:
      for
        _           <- logInfo(banner(applicationName))
        _           <- printJvmInfologInfo
        _           <- MemoryMonitor.start
        _           <- additionalServices
                         .tapError(err => ZIO.logError(s"Additional service crashed: $err"))
                         .forkDaemon
        workersFork <- foreachParDiscard(workerRegistries) { registry =>
                         registry.register(workerApps(this).flatMap(_.theWorkers).toSet)(using workerConfig)
                       }.withParallelism(engineContext.engineConfig.parallelism).fork
        // Start HTTP server
        workerRoutes = WorkerRoutes(engineContext).routes(workerApps(this).flatMap(_.theWorkers).toSet)
        docsRoutes   = OpenApiRoutes.routes
        _           <- ZIO.logInfo(s"Server ready at http://localhost:$port")
        _           <- ZIO.logInfo(s"API Documentation available at http://localhost:$port/docs")
        _           <- Server.serve(workerRoutes ++ docsRoutes).forever
        _           <- ZIO.logInfo("Http Server is stopping.")
        _           <- workersFork.join
      yield ()
    .provideLayer(
      EngineRuntime.sharedExecutorLayer ++
        HttpClientProvider.live ++
        requiredEngineLayers ++
        Server.defaultWithPort(port)
    )
  private[worker] def workerApps(workerApp: WorkerApp): Seq[WorkerApp] =
    workerApp.theDependencies match
      case Nil => Seq(workerApp)
      case _   => workerApp +:
          workerApp.theDependencies.flatMap(workerApps)

  private def printJvmInfologInfo(using Trace): ZIO[Any, Nothing, Unit] =
    val runtimeMxBean = ManagementFactory.getRuntimeMXBean
    val jvmArgs       = runtimeMxBean.getInputArguments.asScala.mkString("\n  ")
    val rt            = java.lang.Runtime.getRuntime
    ZIO.logInfo(
      s"JVM Heap: Max=${rt.maxMemory() / 1024 / 1024}MB  Total=${rt.totalMemory() / 1024 / 1024}MB  Free=${rt.freeMemory() / 1024 / 1024}MB"
    ) *>
      ZIO.logDebug(s"JVM Arguments:\n  $jvmArgs")
  end printJvmInfologInfo
end WorkerApp
