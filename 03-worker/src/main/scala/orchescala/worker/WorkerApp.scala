package orchescala.worker

import orchescala.BuildInfo
import zio.ZIO.*
import zio.{Trace, UIO, ZIO, ZIOAppArgs, ZIOAppDefault, ZLayer}

import java.lang.management.ManagementFactory
import scala.jdk.CollectionConverters.*

trait WorkerApp extends ZIOAppDefault:
  def applicationName: String = getClass.getName.split('.').take(2).mkString("-")

  // a list of registries for each worker implementation
  def workerRegistries: Seq[WorkerRegistry]
  // list all the workers you want to register
  def workers(dWorkers: (WorkerDsl[?, ?] | Seq[WorkerDsl[?, ?]])*): Unit =
    theWorkers = dWorkers
      .flatMap:
        case d: WorkerDsl[?, ?] => Seq(d)
        case s: Seq[?]          => s.collect { case d: WorkerDsl[?, ?] => d }
      .toSet

  def dependencies(workerApps: WorkerApp*): Unit =
    theDependencies = workerApps

  protected var theWorkers: Set[WorkerDsl[?, ?]] = Set.empty
  protected var theDependencies: Seq[WorkerApp]  = Seq.empty

  override val bootstrap: ZLayer[ZIOAppArgs, Any, Any] = ZioLogger.logger

  override def run: ZIO[Any, Any, Any] =
    ZIO
      .scoped:
        for
          _ <- WorkerRuntime.finalizer
          _ <- logInfo(banner)
          _ <- printJvmInfologInfo
          _ <- MemoryMonitor(logTech).start
          _ <- foreachParDiscard(workerRegistries): registry =>
                 registry.register((theDependencies :+ this).flatMap(_.theWorkers).toSet)
        yield ()
      .provideLayer(WorkerRuntime.sharedExecutorLayer)

  private lazy val banner =
    s"""
       |
       |..#######..########...######..##.....##.########..######...######.....###....##..........###...
       |.##.....##.##.....##.##....##.##.....##.##.......##....##.##....##...##.##...##.........##.##..
       |.##.....##.##.....##.##.......##.....##.##.......##.......##........##...##..##........##...##.
       |.##.....##.########..##.......#########.######....######..##.......##.....##.##.......##.....##
       |.##.....##.##...##...##.......##.....##.##.............##.##.......#########.##.......#########
       |.##.....##.##....##..##....##.##.....##.##.......##....##.##....##.##.....##.##.......##.....##
       |..#######..##.....##..######..##.....##.########..######...######..##.....##.########.##.....##
       |
       |                                                        >>> DOMAIN DRIVEN PROCESS ORCHESTRATION
       |  $applicationName
       |
       |  Orchescala: ${BuildInfo.version}
       |  Scala: ${BuildInfo.scalaVersion}
       |""".stripMargin

  protected def logTech: String => UIO[Unit] = logDebug

  private def printJvmInfologInfo(using Trace): ZIO[Any, Nothing, Unit] =
    // Print JVM arguments at startup
    val runtimeMxBean = ManagementFactory.getRuntimeMXBean
    val jvmArgs = runtimeMxBean.getInputArguments.asScala.mkString("\n  ")
    logTech(s"JVM Arguments:\n  $jvmArgs") *>
      logTech(s"JAVA_OPTS Environment Variable: ${sys.env.getOrElse("JAVA_OPTS", "Not set")}") *>
      logTech(s"Memory Settings: Max=${java.lang.Runtime.getRuntime.maxMemory() / 1024 / 1024}MB, Total=${java.lang.Runtime.getRuntime.totalMemory() / 1024 / 1024}MB, Free=${java.lang.Runtime.getRuntime.freeMemory() / 1024 / 1024}MB")
end WorkerApp
