package orchescala.engine

import izumi.reflect.Tag
import zio.*

/** Generic trait for managing shared clients to avoid creating new connections for each operation */
trait SharedClientManager[Client, Error]:
  def getOrCreateClient(clientFactory: ZIO[Any, Error, Client]): ZIO[Any, Error, Client]

/** Generic implementation of SharedClientManager using ZIO Ref and Semaphore */
final case class SharedClientManagerLive[Client, Error](
    clientRef: Ref[Option[Client]],
    semaphore: Semaphore,
    clientTypeName: String
) extends SharedClientManager[Client, Error]:

  def getOrCreateClient(clientFactory: ZIO[Any, Error, Client]): ZIO[Any, Error, Client] =
    semaphore.withPermit:
      for
        client <- clientRef.get.flatMap:
          case Some(client) =>
            ZIO.logDebug(s"Reusing existing shared $clientTypeName client").as(client)
          case None =>
            ZIO.logInfo(s"Creating shared $clientTypeName client") *>
              clientFactory.tap(client => clientRef.set(Some(client)))
      yield client

object SharedClientManager:

  /** Generic method to create a ZLayer for any SharedClientManager */
  def createLayer[Client: Tag, Error: Tag](
      clientTypeName: String,
      closeClient: Client => ZIO[Any, Nothing, Unit]
  ): ZLayer[Any, Nothing, SharedClientManager[Client, Error]] =
    ZLayer.scoped:
      for
        clientRef <- Ref.make(Option.empty[Client])
        semaphore <- Semaphore.make(1)
        service: SharedClientManagerLive[Client, Error] = SharedClientManagerLive(clientRef, semaphore, clientTypeName)
        _ <- ZIO.addFinalizer:
               semaphore.withPermit:
                 clientRef.get.flatMap:
                   case Some(client) =>
                     ZIO.logInfo(s"Closing shared $clientTypeName client") *>
                       closeClient(client)
                         .zipLeft(clientRef.set(None))
                   case None => ZIO.unit
               .zipLeft(ZIO.logInfo(s"Shared $clientTypeName client closed successfully"))
               .uninterruptible
      yield service

  /** Convenience method to access the service */
  def getOrCreateClient[Client: Tag, Error: Tag](
      clientFactory: ZIO[Any, Error, Client]
  ): ZIO[SharedClientManager[Client, Error], Error, Client] =
    ZIO.serviceWithZIO[SharedClientManager[Client, Error]](_.getOrCreateClient(clientFactory))
