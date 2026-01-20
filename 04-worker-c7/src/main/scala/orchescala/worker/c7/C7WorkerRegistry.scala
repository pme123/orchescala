package orchescala.worker.c7

import orchescala.domain.GeneralVariables
import orchescala.engine.DefaultEngineConfig
import orchescala.worker.{WorkerConfig, WorkerDsl, WorkerRegistry}
import org.camunda.bpm.client.ExternalTaskClient
import zio.{Scope, UIO, ZIO, ZLayer}
import zio.ZIO.*

class C7WorkerRegistry(client: C7WorkerClient)
    extends WorkerRegistry:

  // Provide the SharedC7ExternalClientManager layer required by C7 workers
  override def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
    Seq(SharedC7ExternalClientManager.layer)

  protected def registerWorkers[R](workers: Set[WorkerDsl[?, ?]])(using config: WorkerConfig): ZIO[R, Any, Any] =
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
                                            .withParallelism(config.engineConfig.parallelism)
          _                             <- logInfo(s"C7 Worker Client started - registered ${c7Workers.size} workers")
          _                             <- ZIO.never // keep the worker running
        yield ()
    }.mapError(_.asInstanceOf[Any])

  private def registerWorker(worker: C7Worker[?, ?], client: ExternalTaskClient) =
    logDebug(s"""Registering C7 Worker subscription for topic: '${worker.topic}'
                | - Worker class: ${worker.getClass.getName}
                | - Timeout: ${worker.timeout}""".stripMargin) *>
      attempt(client
        .subscribe(worker.topic)
        .handler(worker)
        .variables((worker.worker.variableNames ++ GeneralVariables.variableNames :+ "businessKey")*)
        .open())
        .tap(_ => logInfo(s"Subscription opened successfully for topic: '${worker.topic}'"))
        .tapError(err =>
          logError(s"Failed to open subscription for topic '${worker.topic}': $err")
        )


  extension (client: ExternalTaskClient)
    private def closeClient(): UIO[Unit] =
      logDebug("Closing C7 Worker Client and all subscriptions") *>
        ZIO.attempt(if client != null then client.stop() else ())
          .tap(_ => logInfo("C7 Worker Client closed successfully"))
          .tapError(err => logError(s"Error closing C7 Worker Client: $err"))
          .ignore
  end extension

  lazy val engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any] = ZIO.unit
end C7WorkerRegistry
