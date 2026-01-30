package orchescala.worker

import zio.{Scope, ZIO, ZLayer}
import zio.ZIO.*

trait WorkerRegistry:

  final def register[R](workers: Set[WorkerDsl[?, ?]])(using WorkerConfig): ZIO[R, Any, Any] =
    logInfo(s"Registering Workers for ${getClass.getSimpleName}") *>
      registerWorkers(workers)

  def engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any]

  protected def registerWorkers[R](workers: Set[WorkerDsl[?, ?]])(using config: WorkerConfig): ZIO[R, Any, Any]

  /** Override this to provide the ZIO layers required by this worker registry */
  def requiredLayers: Seq[ZLayer[Any, Nothing, Any]]

end WorkerRegistry
