package orchescala.engine.c7

import org.camunda.community.rest.client.invoker.ApiClient
import orchescala.engine.{EngineError, EngineRuntime}
import zio.{Ref, Scope, Semaphore, UIO, Unsafe, ZIO}

/** Provides a shared Camunda C7 REST API client to avoid creating new connections for each operation
  */
object SharedC7ClientManager:

  private lazy val clientRef: Ref[Option[ApiClient]] =
    Unsafe.unsafe(implicit unsafe => EngineRuntime.zioRuntime.unsafe.run(Ref.make(None)).getOrThrowFiberFailure())

  private lazy val semaphore: Semaphore =
    Unsafe.unsafe(implicit unsafe => EngineRuntime.zioRuntime.unsafe.run(Semaphore.make(1)).getOrThrowFiberFailure())

  def getOrCreateClient(clientFactory: ZIO[Any, EngineError, ApiClient]): ZIO[Any, EngineError, ApiClient] =
    semaphore.withPermit:
      clientRef.get.flatMap:
        case Some(client) =>
                      ZIO.logDebug("Reusing existing shared C7 API client") *>
                      ZIO.succeed(client)
        case None =>
          ZIO.logInfo(s"Creating shared C7 API client ${getClass.getName}") *>
            clientFactory.flatMap: client =>
              clientRef.set(Some(client)).as(client)

  lazy val engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any] = ZIO
    .addFinalizer:
      semaphore.withPermit:
        clientRef.get
          .flatMap:
                   case Some(client) =>
                     ZIO.attempt(client.getHttpClient.close()).catchAll: ex =>
                       ZIO.logError(s"Error closing shared C7 API client: ${ex.getMessage}")
                     .zipLeft(clientRef.set(None))
                   case None => ZIO.unit
      .zipLeft(ZIO.logInfo("Shared C7 client closed successfully"))
    .uninterruptible
end SharedC7ClientManager