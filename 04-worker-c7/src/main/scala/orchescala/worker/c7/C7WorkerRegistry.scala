package orchescala.worker.c7

import orchescala.worker.{WorkerDsl, WorkerRegistry}
import org.camunda.bpm.client.ExternalTaskClient
import zio.{UIO, ZIO}
import zio.ZIO.*

class C7WorkerRegistry(client: C7WorkerClient)
    extends WorkerRegistry:

  protected def registerWorkers(workers: Set[WorkerDsl[?, ?]]): ZIO[Any, Any, Any] = {
    ZIO.scoped:
      acquireReleaseWith(client.client)(_.closeClient()): client =>
        for
          _                             <-
            logInfo(
              s"Starting C7 Worker Client - Available Processors: ${Runtime.getRuntime.availableProcessors()}"
            )
          c7Workers: Set[C7Worker[?, ?]] = workers.collect { case w: C7Worker[?, ?] => w }
          _                             <- ZIO.scoped:
                                             foreachParDiscard(c7Workers)(w => registerWorker(w, client))
          _                             <- logInfo(s"C7 Worker Client started - registered ${workers.size} workers")
          _                             <- ZIO.never // keep the worker running
        yield ()
  }

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
end C7WorkerRegistry
