package orchescala.worker

import zio.{Scope, ZIO, ZLayer}
import zio.ZIO.*

trait WorkerRegistry:

  /** Each topic once: a worker registered twice (two instances of the same class, e.g. two
    * blocks in the WorkerApp) would be subscribed twice - the C7 client refuses the second
    * subscription, and the failed registration stops all workers.
    */
  final def register[R](workers: Set[WorkerDsl[?, ?]])(using WorkerConfig): ZIO[R, Any, Any] =
    val byTopic = workers.toSeq.groupBy(_.topic)
    val twice   = byTopic.collect { case (topic, ws) if ws.size > 1 => topic -> ws.size }.toSeq.sortBy(_._1)
    logInfo(s"Registering Workers for ${getClass.getSimpleName}") *>
      foreachDiscard(twice): (topic, n) =>
        logWarning(s"Worker for topic '$topic' is registered $n times - it is subscribed once. Remove the duplicate registration (WorkerApp).")
      *> registerWorkers(byTopic.values.map(_.head).toSet)
  
  protected def registerWorkers[R](workers: Set[WorkerDsl[?, ?]])(using config: WorkerConfig): ZIO[R, Any, Any]

  /** Override this to provide the ZIO layers required by this worker registry */
  def requiredLayers: Seq[ZLayer[Any, Nothing, Any]]

end WorkerRegistry
