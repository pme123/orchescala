package orchescala.engine.c7

import org.camunda.community.rest.client.invoker.ApiClient
import orchescala.engine.EngineError
import zio.{Ref, Scope, Semaphore, UIO, ZIO}

/** Provides a shared Camunda C7 REST API client to avoid creating new connections for each operation
  */
object SharedC7ClientManager:

  private val clientRef: UIO[Ref[Option[ApiClient]]] =
    Ref.make(None)

  private val semaphore: UIO[Semaphore] =
    Semaphore.make(1)

  def getOrCreateClient(clientFactory: ZIO[Any, EngineError, ApiClient]): ZIO[Any, EngineError, ApiClient] =
    for
      ref    <- clientRef
      sem    <- semaphore
      client <- sem.withPermit:
                  ref.get.flatMap:
                    case Some(client) =>
                      ZIO.logDebug("Reusing existing shared C7 API client") *>
                      ZIO.succeed(client)
                    case None =>
                      ZIO.logInfo("Creating shared C7 API client") *>
                      clientFactory.flatMap: client =>
                        ref.set(Some(client)).as(client)
    yield client

  lazy val engineConnectionManagerFinalizer: ZIO[Scope, Nothing, Any] = ZIO
    .addFinalizer:
      for
        ref <- clientRef
        sem <- semaphore
        _   <- sem.withPermit:
                 ref.get.flatMap:
                   case Some(client) =>
                     ZIO.attempt(()).catchAll: ex =>
                       ZIO.logError(s"Error closing shared C7 API client: ${ex.getMessage}")
                     .zipLeft(ref.set(None))
                   case None => ZIO.unit
        _   <- ZIO.logInfo("Shared C7 API client closed successfully")
      yield ()
    .uninterruptible
end SharedC7ClientManager