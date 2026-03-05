package orchescala.worker.w4s

import orchescala.worker.{WorkerConfig, WorkerDsl, WorkerRegistry}
import zio.{ZIO, ZLayer}
import zio.ZIO.*

/** Registry for W4S workers.
  *
  * Unlike C7/C8/Op registries that connect to external engines,
  * the W4S registry manages workers that run in-process with the
  * W4S workflow engine.
  */
class W4SWorkerRegistry
    extends WorkerRegistry:

  // Provide the SharedW4SEngineManager layer required by W4S workers
  override def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
    Seq(SharedW4SEngineManager.layer)

  protected def registerWorkers[R](workers: Set[WorkerDsl[?, ?]])(using
      config: WorkerConfig
  ): ZIO[R, Any, Any] =
    for
      _          <- logInfo(
                      s"Starting W4S Worker Registry - ${workers.size} workers"
                    )
      w4sWorkers  = workers.collect { case w: W4SWorker[?, ?] => w }
      _          <- foreachDiscard(w4sWorkers)(w => registerWorker(w))
      _          <- logInfo(s"W4S Worker Registry started - registered ${w4sWorkers.size} workers")
      _          <- ZIO.never // keep the worker running
    yield ()

  private def registerWorker(worker: W4SWorker[?, ?]) =
    logInfo(s"Registered W4S Worker: ${worker.topic}")

end W4SWorkerRegistry

