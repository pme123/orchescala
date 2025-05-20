package orchescala.worker.c8

import orchescala.worker.{WorkerDsl, WorkerRegistry}
import io.camunda.zeebe.client.ZeebeClient
import zio.ZIO.*
import zio.{Console, *}

class C8WorkerRegistry(client: C8WorkerClient)
    extends WorkerRegistry:

  protected def registerWorkers(workers: Set[WorkerDsl[?, ?]]): ZIO[Any, Any, Any] =
    Console.printLine(s"Starting C8 Worker Client") *>
      acquireReleaseWith(client.client)(_.closeClient()): client =>
        for
          server   <- ZIO.never.forever.fork
          c8Workers = workers.collect { case w: C8Worker[?, ?] => w }
          _        <- foreachParDiscard(c8Workers)(w => registerWorker(w, client))
          _        <- server.join
        yield ()

  private def registerWorker(worker: C8Worker[?, ?], client: ZeebeClient) =
    attempt(client
      .newWorker()
      .jobType(worker.topic)
      .handler(worker)
      .timeout(worker.timeout.toMillis)
      .open()) *>
      logInfo("Registered C8 Worker: " + worker.topic)

  extension (client: ZeebeClient)
    private def closeClient(): UIO[Unit] =
      logInfo("Closing C7 Worker Client").as(if client != null then client.close() else ())

end C8WorkerRegistry
