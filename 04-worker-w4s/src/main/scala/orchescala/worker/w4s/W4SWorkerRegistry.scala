package orchescala.worker.w4s

import orchescala.worker.{WorkerConfig, WorkerDsl, WorkerRegistry}
import zio.{UIO, ZIO, ZLayer}
import zio.ZIO.*

/** Registry for W4S workers.
  *
  * Unlike C7/C8/Op registries that connect to external engines,
  * the W4S registry starts the W4S engine in-process and manages
  * workers that run alongside it.
  */
class W4SWorkerRegistry(client: W4SWorkerClient)
    extends WorkerRegistry:

  // Provide the SharedW4SEngineManager layer required by W4S workers
  override def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
    Seq(SharedW4SEngineManager.layer)

  protected def registerWorkers[R](workers: Set[WorkerDsl[?, ?]])(using
      config: WorkerConfig
  ): ZIO[R, Any, Any] =
    // Use the W4SWorkerClient to get or create the engine runtime
    client.engine.asInstanceOf[ZIO[R, Any, W4SEngineRuntime]].flatMap { engine =>
      acquireReleaseWith(succeed(engine))(_.shutdownSafely): engine =>
        for
          _          <- logInfo(
                          s"Starting W4S Worker Registry - ${workers.size} workers, engine running: ${engine.isRunning}"
                        )
          w4sWorkers  = workers.collect { case w: W4SWorker[?, ?] => w }
          _          <- foreachDiscard(w4sWorkers)(w => registerWorker(w))
          _          <- logInfo(s"W4S Worker Registry started - registered ${w4sWorkers.size} workers")
          _          <- ZIO.never // keep the worker running
        yield ()
    }.mapError(_.asInstanceOf[Any])

  private def registerWorker(worker: W4SWorker[?, ?]) =
    logInfo(s"Registered W4S Worker: ${worker.topic}")

  extension (engine: W4SEngineRuntime)
    private def shutdownSafely: UIO[Unit] =
      logInfo("Shutting down W4S Engine Runtime") *>
        ZIO.attempt(engine.shutdown())
          .tap(_ => logInfo("W4S Engine Runtime shut down successfully"))
          .tapError(err => logError(s"Error shutting down W4S Engine Runtime: $err"))
          .ignore

end W4SWorkerRegistry

