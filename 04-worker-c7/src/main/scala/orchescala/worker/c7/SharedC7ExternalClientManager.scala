package orchescala.worker.c7

import orchescala.engine.EngineRuntime
import org.camunda.bpm.client.ExternalTaskClient
import zio.*
import zio.Unsafe

/** Provides a shared HTTP connection manager for Camunda C7 ExternalTaskClient to avoid creating new connections
  * for each client
  */
object SharedC7ExternalClientManager:
  
  private lazy val clientRef: Ref[Option[ExternalTaskClient]] =
    Unsafe.unsafe(implicit unsafe => EngineRuntime.zioRuntime.unsafe.run(Ref.make(None)).getOrThrowFiberFailure())

  private lazy val semaphore: Semaphore =
    Unsafe.unsafe(implicit unsafe => EngineRuntime.zioRuntime.unsafe.run(Semaphore.make(1)).getOrThrowFiberFailure())
  
  def getOrCreateClient(clientFactory: () => ZIO[Any, Throwable, ExternalTaskClient]): ZIO[Any, Throwable, ExternalTaskClient] =
    semaphore.withPermit:
      clientRef.get.flatMap:
        case Some(client) =>
          ZIO.logInfo("Reusing existing shared C7 ExternalTaskClient") *>
          ZIO.succeed(client)
        case None =>
          ZIO.logInfo("Creating shared C7 ExternalTaskClient") *>
          clientFactory().flatMap: client =>
            clientRef.set(Some(client)).as(client)

  lazy val engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any] = ZIO
    .addFinalizer:
      semaphore.withPermit:
        clientRef.get.flatMap:
          case Some(client) =>
            ZIO.attempt(client.stop()).catchAll: ex =>
              ZIO.logError(s"Error closing shared C7 ExternalTaskClient: ${ex.getMessage}")
            .zipLeft(clientRef.set(None))
          case None => ZIO.unit
      .zipLeft(ZIO.logInfo("Shared C7 ExternalTaskClient closed successfully"))
    .uninterruptible
end SharedC7ExternalClientManager
