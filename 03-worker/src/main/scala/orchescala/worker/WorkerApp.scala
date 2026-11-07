package orchescala.worker

import orchescala.engine.auth.TokenValidation
import orchescala.engine.rest.{HttpClientProvider, SttpClientBackend}
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
        workersFork <- foreachParDiscard(workerRegistries) { registry =>
                         registry.register(workerApps(this).flatMap(_.theWorkers).toSet)(using workerConfig)
                       }.withParallelism(engineContext.engineConfig.parallelism).fork
        _           <- deployOnStart.fork
        // Start HTTP server
        workerRoutes = WorkerRoutes(engineContext).routes(workerApps(this).flatMap(_.theWorkers).toSet)
        docsRoutes   = OpenApiRoutes.routes
        _           <- workerConfig.tokenValidation match
                         case TokenValidation.PresenceOnly =>
                           ZIO.logWarning(
                             "/worker does NOT verify Bearer tokens (TokenValidation.PresenceOnly) - " +
                               "configure TokenValidation.Jwt / AnyOf in the WorkerConfig."
                           )
                         case verified                     =>
                           ZIO.logInfo(s"/worker verifies Bearer tokens: ${verified.description}")
        _           <- ZIO.when(
                         !workerConfig.tokenValidation.verifies &&
                           workerApps(this).flatMap(_.theWorkers).exists(_.requiredRoles.nonEmpty)
                       )(ZIO.logWarning(
                         "Workers require roles, but /worker does NOT verify Bearer tokens " +
                           "(TokenValidation.PresenceOnly) - they refuse every call until TokenValidation.Jwt / AnyOf is configured."
                       ))
        _           <- ZIO.logInfo(s"Server ready at http://localhost:$port")
        _           <- ZIO.logInfo(s"API Documentation available at http://localhost:$port/docs/")
        _           <- Server.serve(
                         workerRoutes ++ docsRoutes ++ UiRoutes.routesWith(workerConfig.uiMaxFileSize)
                       ).forever
        _           <- ZIO.logInfo("Http Server is stopping.")
        _           <- workersFork.join
      yield ()
    .provideLayer(
      EngineRuntime.sharedExecutorLayer ++
        HttpClientProvider.live ++
        requiredEngineLayers ++
        Server.defaultWithPort(port)
    )
  /** The BPMN/DMN of this app's project to the engines of its registries - if configured
    * (`WorkerConfig.deployOnStart`). Not those of its dependencies: they deploy themselves.
    */
  private def deployOnStart: ZIO[SttpClientBackend, Nothing, Unit] =
    workerConfig.deployOnStart match
      case None         => ZIO.unit
      case Some(config) =>
        config.entry.orElse(DeployOnStart.entryOf(applicationName, implementationVersion)) match
          case Some(entry) => DeployOnStart.run(config, entry, workerRegistries.map(_.engineType))
          case None        =>
            ZIO.logWarning(
              s"Deploy on start: no version of $applicationName (the app does not run from a jar) - nothing deployed; set DeployOnStart.entry to deploy anyway."
            )

  // the version of the jar of this app (its manifest) - None outside a jar
  private def implementationVersion: Option[String] =
    Option(getClass.getPackage).flatMap(p => Option(p.getImplementationVersion))

  private[worker] def workerApps(workerApp: WorkerApp): Seq[WorkerApp] =
    workerApp.theDependencies match
      case Nil => Seq(workerApp)
      case _   => workerApp +:
          workerApp.theDependencies.flatMap(workerApps)

  private def printJvmInfologInfo(using Trace): ZIO[Any, Nothing, Unit] =
    // Print JVM arguments at startup
    val runtimeMxBean = ManagementFactory.getRuntimeMXBean
    val jvmArgs       = runtimeMxBean.getInputArguments.asScala.mkString("\n  ")
    ZIO.logDebug(s"JVM Arguments:\n  $jvmArgs") *>
      ZIO.logDebug(
        s"Memory Settings: Max=${java.lang.Runtime.getRuntime.maxMemory() / 1024 / 1024}MB, Total=${java.lang.Runtime.getRuntime.totalMemory() / 1024 / 1024}MB, Free=${java.lang.Runtime.getRuntime.freeMemory() / 1024 / 1024}MB"
      )
  end printJvmInfologInfo
end WorkerApp
