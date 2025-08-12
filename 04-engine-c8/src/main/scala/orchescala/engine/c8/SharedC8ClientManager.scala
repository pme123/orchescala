package orchescala.engine.c8

import io.camunda.client.CamundaClient
import orchescala.engine.{EngineError, EngineRuntime}
import zio.*
import zio.Unsafe

/** Provides a shared Camunda C8 client to avoid creating new connections for each operation during
  * simulations
  */
object SharedC8ClientManager:

  private lazy val clientRef: Ref[Option[CamundaClient]] =
    Unsafe.unsafe(implicit unsafe => EngineRuntime.zioRuntime.unsafe.run(Ref.make(None)).getOrThrowFiberFailure())

  private lazy val semaphore: Semaphore =
    Unsafe.unsafe(implicit unsafe => EngineRuntime.zioRuntime.unsafe.run(Semaphore.make(1)).getOrThrowFiberFailure())

  def getOrCreateClient(clientFactory: ZIO[Any, EngineError, CamundaClient])
      : ZIO[Any, EngineError, CamundaClient] =
    semaphore.withPermit:
      clientRef.get.flatMap:
        case Some(client) =>
          ZIO.logDebug("Reusing existing shared C8 client") *>
          ZIO.succeed(client)
        case None =>
          ZIO.logInfo("Creating shared C8 client") *>
          clientFactory.flatMap: client =>
            clientRef.set(Some(client)).as(client)

  /** ZIO finalizer to properly close the shared client This should be added to your application's
    * shutdown sequence
    */
  lazy val engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any] = ZIO
    .addFinalizer:
      semaphore.withPermit:
        clientRef.get.flatMap:
          case Some(client) =>
            ZIO.attempt(client.close()).catchAll: ex =>
              ZIO.logError(s"Error closing shared C8 client: ${ex.getMessage}")
            .zipLeft(clientRef.set(None))
          case None => ZIO.unit
      .zipLeft(ZIO.logInfo("Shared C8 client closed successfully"))
    .uninterruptible

end SharedC8ClientManager
