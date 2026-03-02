package orchescala.worker.op

import orchescala.domain.GeneralVariables
import orchescala.engine.DefaultEngineConfig
import orchescala.worker.{WorkerConfig, WorkerDsl, WorkerRegistry}
import org.operaton.bpm.client.ExternalTaskClient
import zio.{Scope, UIO, ZIO, ZLayer}
import zio.ZIO.*

class OpWorkerRegistry(client: OpWorkerClient)
    extends WorkerRegistry:

  // Provide the SharedOpExternalClientManager layer required by Op workers
  override def requiredLayers: Seq[ZLayer[Any, Nothing, Any]] =
    Seq(SharedOpExternalClientManager.layer)

  protected def registerWorkers[R](workers: Set[WorkerDsl[?, ?]])(using
      config: WorkerConfig
  ): ZIO[R, Any, Any] =
    // Cast to Any to match the generic signature, but this will only work if R includes SharedOpExternalClientManager
    client.client.asInstanceOf[ZIO[R, Any, ExternalTaskClient]].flatMap { client =>
      acquireReleaseWith(ZIO.succeed(client))(_.closeClient()): client =>
        for
          _                                   <-
            logInfo(
              s"Starting Op Worker Client - Available Processors: ${Runtime.getRuntime.availableProcessors()}"
            )
          operatonWorkers: Set[OpWorker[?, ?]] = workers.collect { case w: OpWorker[?, ?] => w }
          _                                   <- foreachParDiscard(operatonWorkers)(w => registerWorker(w, client))
                                                   .withParallelism(config.engineConfig.parallelism)
          _                                   <- logInfo(s"Op Worker Client started - registered ${operatonWorkers.size} workers")
          _                                   <- ZIO.never // keep the worker running
        yield ()
    }.mapError(_.asInstanceOf[Any])

  private def registerWorker(worker: OpWorker[?, ?], client: ExternalTaskClient) =
    logDebug(s"""Registering Op Worker subscription for topic: '${worker.topic}'
                | - Worker class: ${worker.getClass.getName}
                | - Timeout: ${worker.timeout}""".stripMargin) *>
      attempt(client
        .subscribe(worker.topic)
        .handler(worker)
        .variables(
          (worker.worker.variableNames ++ GeneralVariables.variableNames :+ "businessKey")*
        )
        .open())
        .tap(_ => logInfo(s"Subscription opened successfully for topic: '${worker.topic}'"))
        .tapError(err =>
          logError(s"Failed to open subscription for topic '${worker.topic}': $err")
        )

  extension (client: ExternalTaskClient)
    private def closeClient(): UIO[Unit] =
      logDebug("Closing Op Worker Client and all subscriptions") *>
        ZIO.attempt(if client != null then client.stop() else ())
          .tap(_ => logInfo("Op Worker Client closed successfully"))
          .tapError(err => logError(s"Error closing Op Worker Client: $err"))
          .ignore
  end extension

  lazy val engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any] = ZIO.unit
end OpWorkerRegistry
