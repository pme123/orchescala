package orchescala.worker.c8

import orchescala.worker.{WorkerDsl, WorkerRegistry}
import io.camunda.zeebe.client.ZeebeClient
import zio.ZIO.*
import zio.{Console, *}

class C8WorkerRegistry(client: C8WorkerClient)
    extends WorkerRegistry:

  protected def registerWorkers(workers: Set[WorkerDsl[?, ?]]): ZIO[Any, Any, Any] =
    acquireReleaseWith(client.client)(_.closeClient()): client =>
      for
        _        <- logInfo(s"Starting C8 Worker Client - ${workers.size} workers.")
        c8Workers = workers.collect { case w: C8Worker[?, ?] => w }
        _        <- foreachParDiscard(c8Workers)(w => registerWorker(w, client))
        _        <- logInfo(s"C8 Worker Client started - registered ${c8Workers.size} workers")
        _        <- ZIO.never // keep the worker running
      yield ()

  private def registerWorker(worker: C8Worker[?, ?], client: ZeebeClient) =
    logInfo(s"Registering C8 Worker: ${worker.topic}") *>
      attempt(client
        .newWorker()
        .jobType(worker.topic)
        .handler(worker)
        .timeout(worker.timeout.toMillis)
        .open()) *>
      logInfo("Registered C8 Worker: " + worker.topic)

  extension (client: ZeebeClient)
    private def closeClient(): UIO[Unit] =
      logInfo("Closing C8 Worker Client").as(if client != null then client.close() else ())

  // no connection manager to close
  lazy val engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any] = ZIO.unit
end C8WorkerRegistry
