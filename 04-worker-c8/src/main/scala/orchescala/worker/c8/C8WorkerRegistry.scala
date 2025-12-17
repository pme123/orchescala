package orchescala.worker.c8

import io.camunda.client.CamundaClient
import orchescala.domain.GeneralVariables
import orchescala.engine.c8.{C8Client, SharedC8ClientManager}
import orchescala.worker.{WorkerDsl, WorkerRegistry}
import zio.*
import zio.ZIO.*

import scala.jdk.CollectionConverters.*

class C8WorkerRegistry(c8Client: C8Client)
    extends WorkerRegistry:

  // Provide the SharedC8ClientManager layer required by C8 workers
  override def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
    Seq(SharedC8ClientManager.layer)

  protected def registerWorkers[R](workers: Set[WorkerDsl[?, ?]]): ZIO[R, Any, Any] =
    // Cast to Any to match the generic signature, but this will only work if R includes SharedC8ClientManager
    c8Client.client.asInstanceOf[ZIO[R, Any, CamundaClient]].flatMap { client =>
      acquireReleaseWith(ZIO.succeed(client))(_.closeClient()): client =>
        for
          _        <- logInfo(s"Starting C8 Worker Client - ${workers.size} workers.")
          c8Workers = workers.collect { case w: C8Worker[?, ?] => w }
          _        <- foreachParDiscard(c8Workers)(w => registerWorker(w, client))
          _        <- logInfo(s"C8 Worker Client started - registered ${c8Workers.size} workers")
          _        <- ZIO.never // keep the worker running
        yield ()
    }.mapError(_.asInstanceOf[Any])

  private def registerWorker(worker: C8Worker[?, ?], client: CamundaClient) =
    logDebug(s"Registering C8 Worker: ${worker.topic}") *>
      attempt(client
        .newWorker()
        .jobType(worker.topic)
        .handler(worker)
        .fetchVariables((worker.worker.inVariableNames ++ GeneralVariables.variableNames :+ "businessKey").asJava)
        .timeout(worker.timeout.toMillis)
        .open()) *>
      logInfo("Registered C8 Worker: " + worker.topic)

  extension (client: CamundaClient)
    private def closeClient(): UIO[Unit] =
      logInfo("Closing C8 Worker Client").as(if client != null then client.close() else ())

  // no connection manager to close
  lazy val engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any] = ZIO.unit
end C8WorkerRegistry
