package orchescala.worker

import orchescala.engine.rest.HttpClientProvider
import orchescala.engine.{EngineRuntime, banner}
import zio.ZIO.*
import zio.{Trace, ZIO, ZIOAppArgs, ZIOAppDefault, ZLayer}

import java.lang.management.ManagementFactory
import scala.jdk.CollectionConverters.*

trait WorkerApp extends ZIOAppDefault:
  def applicationName: String = getClass.getName.split('.').take(2).mkString("-")

  // a list of registries for each worker implementation
  def workerRegistries: Seq[WorkerRegistry]

  // Automatically detect and provide required engine layers
  private def requiredEngineLayers: ZLayer[Any, Nothing, Any] =
    // Collect all required layers from worker registries
    val allLayers = workerRegistries.flatMap(_.requiredLayers)

    // Combine all layers into one
    allLayers.foldLeft(ZLayer.empty: ZLayer[Any, Nothing, Any])(_ ++ _)

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
  protected var theDependencies: Seq[WorkerApp]  = Seq.empty

  override val bootstrap: ZLayer[ZIOAppArgs, Any, Any] = EngineRuntime.logger

  override def run: ZIO[Any, Any, Any] =
    ZIO.scoped:
      for
        _ <- EngineRuntime.threadPoolFinalizer
        _ <- HttpClientProvider.threadPoolFinalizer
        _ <- foreachParDiscard(workerRegistries): registry =>
               registry.engineConnectionManagerFinalizer
        _ <- logInfo(banner(applicationName))
        _ <- printJvmInfologInfo
        _ <- MemoryMonitor.start
        _ <- foreachParDiscard(workerRegistries): registry =>
               registry.register(workerApps(this).flatMap(_.theWorkers).toSet)
      yield ()
    .provideLayer(
      EngineRuntime.sharedExecutorLayer ++
        HttpClientProvider.live ++
        requiredEngineLayers
    )
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
