package orchescala.worker

import zio.{Scope, ZIO}
import zio.ZIO.*

trait WorkerRegistry:

  final def register(workers: Set[WorkerDsl[?, ?]]): ZIO[Any, Any, Any] =
    logInfo(s"Registering Workers for ${getClass.getSimpleName}") *>
      registerWorkers(workers)

  def engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any]

  protected def registerWorkers(workers: Set[WorkerDsl[?, ?]]): ZIO[Any, Any, Any]

end WorkerRegistry
