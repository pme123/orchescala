package orchescala.worker.c7

import orchescala.worker.{WorkerDsl, WorkerRegistry}
import org.camunda.bpm.client.ExternalTaskClient
import zio.{Scope, UIO, ZIO, ZLayer}
import zio.ZIO.*

class C7WorkerRegistry(client: C7WorkerClient)
    extends WorkerRegistry:

  // Provide the SharedC7ExternalClientManager layer required by C7 workers
  override def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
    Seq(SharedC7ExternalClientManager.layer)

  protected def registerWorkers[R](workers: Set[WorkerDsl[?, ?]]): ZIO[R, Any, Any] =
    // Cast to Any to match the generic signature, but this will only work if R includes SharedC7ExternalClientManager
    client.client.asInstanceOf[ZIO[R, Any, ExternalTaskClient]].flatMap { client =>
      acquireReleaseWith(ZIO.succeed(client))(_.closeClient()): client =>
        for
          _                             <-
            logInfo(
              s"Starting C7 Worker Client - Available Processors: ${Runtime.getRuntime.availableProcessors()}"
            )
          c7Workers: Set[C7Worker[?, ?]] = workers.collect { case w: C7Worker[?, ?] => w }
          _                             <- foreachParDiscard(c7Workers)(w => registerWorker(w, client))
          _                             <- logInfo(s"C7 Worker Client started - registered ${c7Workers.size} workers")
          _                             <- ZIO.never // keep the worker running
        yield ()
    }.mapError(_.asInstanceOf[Any])

  private def registerWorker(worker: C7Worker[?, ?], client: ExternalTaskClient) =
    attempt(client
      .subscribe(worker.topic)
      .handler(worker)
      .open()) *>
      logInfo("Registered C7 Worker: " + worker.topic)

  extension (client: ExternalTaskClient)
    private def closeClient(): UIO[Unit] =
      logInfo("Closing C7 Worker Client")
        .as(if client != null then client.stop() else ())

  lazy val engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any] = ZIO.unit
end C7WorkerRegistry
