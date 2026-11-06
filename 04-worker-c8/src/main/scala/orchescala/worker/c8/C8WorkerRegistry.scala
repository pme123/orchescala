package orchescala.worker.c8

import io.camunda.client.CamundaClient
import orchescala.domain.GeneralVariables
import orchescala.engine.c8.{C8Client, SharedC8ClientManager}
import orchescala.engine.DefaultEngineConfig
import orchescala.worker.{WorkerConfig, WorkerDsl, WorkerRegistry}
import zio.*
import zio.ZIO.*

import scala.jdk.CollectionConverters.*

class C8WorkerRegistry(c8Client: C8Client)
    extends WorkerRegistry:

  // Provide the SharedC8ClientManager layer required by C8 workers
  override def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
    Seq(SharedC8ClientManager.layer)

  protected def registerWorkers[R](workers: Set[WorkerDsl[?, ?]])(using config: WorkerConfig): ZIO[R, Any, Any] =
    // Cast to Any to match the generic signature, but this will only work if R includes SharedC8ClientManager
    c8Client.client.asInstanceOf[ZIO[R, Any, CamundaClient]].flatMap { client =>
      acquireReleaseWith(ZIO.succeed(client))(_.closeClient()): client =>
        for
          _        <- logInfo(s"Starting C8 Worker Client - ${workers.size} workers.")
          // a child of this fiber, which holds the client until it ends - and bounded to 5 s
          _        <- checkClusterVersion(client).fork
          c8Workers = workers.collect { case w: C8Worker[?, ?] => w }
          _        <- foreachParDiscard(c8Workers)(w => registerWorker(w, client))
                       .withParallelism(config.engineConfig.parallelism)
          _        <- logInfo(s"C8 Worker Client started - registered ${c8Workers.size} workers")
          _        <- ZIO.never // keep the worker running
        yield ()
    }.mapError(_.asInstanceOf[Any])

  // BPMNs take the own instance from camunda.processInstance.key and the business key from
  // camunda.processInstance.businessId - a cluster before 8.10 does not know them, every such
  // process stops with an incident: say so where it is started
  private def checkClusterVersion(client: CamundaClient): UIO[Unit] =
    attemptBlockingInterrupt(client.newTopologyRequest().send().join(5, java.util.concurrent.TimeUnit.SECONDS).getGatewayVersion)
      .flatMap: version =>
        if C8WorkerRegistry.before810(version) then
          logWarning(
            s"Camunda 8 cluster $version: Orchescala needs 8.10 - the BPMNs take the own process instance " +
              "from camunda.processInstance.key and the business key from camunda.processInstance.businessId, " +
              "before 8.10 a process using them stops with an incident."
          )
        else logDebug(s"Camunda 8 cluster $version")
      .catchAll(err =>
        logWarning(s"Camunda 8 cluster version could not be verified ($err) - Orchescala needs 8.10 (camunda.processInstance.key / businessId).")
      )

  private def registerWorker(worker: C8Worker[?, ?], client: CamundaClient) =
    logDebug(s"Registering C8 Worker: ${worker.topic}") *>
      attempt(client
        .newWorker()
        .jobType(worker.topic)
        .handler((jobClient, job) => worker.handleJob(jobClient, job, Some(client)))
        .fetchVariables(
          C8Worker.variablesToFetch(worker.worker).asJava
        )
        // short, so the job of a crashed worker app is handed out again soon - a running job
        // renews it (BaseWorker.lockTimeout)
        .timeout(worker.lockTimeout.toMillis)
        .open()) *>
      logInfo("Registered C8 Worker: " + worker.topic)

  extension (client: CamundaClient)
    private def closeClient(): UIO[Unit] =
      logInfo("Closing C8 Worker Client").as(if client != null then client.close() else ())
  
end C8WorkerRegistry

object C8WorkerRegistry:
  private val MajorMinor = """^(\d+)\.(\d+)""".r

  /** A version like `8.9.21` or `8.10.0-SNAPSHOT` before 8.10 - unknown (unparsable) is not. */
  def before810(version: String): Boolean =
    MajorMinor.findFirstMatchIn(Option(version).getOrElse("").trim) match
      case Some(m) =>
        (m.group(1).toIntOption, m.group(2).toIntOption) match
          case (Some(major), Some(minor)) => major < 8 || (major == 8 && minor < 10)
          case _                          => false
      case None    => false
end C8WorkerRegistry
