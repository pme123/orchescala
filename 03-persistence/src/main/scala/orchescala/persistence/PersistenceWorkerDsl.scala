package orchescala.persistence

import com.auth0.jwt.JWT
import orchescala.domain.InOutCodec
import orchescala.engine.AuthContext
import orchescala.worker.CustomWorkerDsl
import orchescala.worker.WorkerError.CustomError
import zio.*

import scala.util.Try

/** A worker that keeps its own data - a [[CustomWorkerDsl]] with access to the [[EntityStore]].
  *
  * The store comes from the base worker of the environment, the project worker only says what to
  * do:
  * {{{
  * trait CompanyPersistenceWorkerDsl[In <: Product: InOutCodec, Out <: Product: InOutCodec]
  *     extends PersistenceWorkerDsl[In, Out]:
  *   protected def entityStore: EntityStore = CompanyStore.store // PersistenceConfig.fromEnv(...)
  *
  * class NotizSpeichernWorker extends CompanyPersistenceWorkerDsl[In, Out]:
  *   lazy val customTask = example
  *   override def runWorkZIO(in: In): RunWorkZIOOutput[Out] =
  *     save(Notiz.entity, in.notiz, in.version).map(stored => Out(stored.id, stored.version))
  * }}}
  *
  * Like every worker it runs synchronously through the gateway (`/worker/{topic}`) and as a step in
  * a process. A call is one transaction; consistency across calls is the job of the process.
  * Changes are recorded with the user of the Bearer token (`preferred_username`), if there is one.
  */
trait PersistenceWorkerDsl[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec
] extends CustomWorkerDsl[In, Out]:

  /** The store of the environment - set in the base worker. */
  protected def entityStore: EntityStore

  protected def get[E](entity: EntityDef[E], id: String): IO[CustomError, Option[Stored[E]]] =
    entityStore.get(entity, id).mapError(toCustomError)

  /** Like [[get]], but a missing entity is an error. */
  protected def getExisting[E](entity: EntityDef[E], id: String): IO[CustomError, Stored[E]] =
    get(entity, id).someOrFail(toCustomError(PersistenceError.NotFound(entity.table, id)))

  protected def query[E](
      entity: EntityDef[E],
      keys: Map[String, String] = Map.empty,
      limit: Int = 100
  ): IO[CustomError, Seq[Stored[E]]] =
    entityStore.query(entity, keys, limit).mapError(toCustomError)

  /** Creates the entity (`expectedVersion = None`) or updates the version the caller read. */
  protected def save[E](
      entity: EntityDef[E],
      value: E,
      expectedVersion: Option[Long] = None
  ): IO[CustomError, Stored[E]] =
    currentUser.flatMap: user =>
      entityStore.save(entity, value, expectedVersion, user).mapError(toCustomError)

  protected def delete[E](
      entity: EntityDef[E],
      id: String,
      expectedVersion: Option[Long] = None
  ): IO[CustomError, Unit] =
    entityStore.delete(entity, id, expectedVersion).mapError(toCustomError)

  protected def toCustomError(error: PersistenceError): CustomError =
    CustomError(error.message)

  /** The user of the Bearer token - it was verified before the worker was called. */
  private def currentUser: UIO[Option[String]] =
    AuthContext.getBearerToken.map:
      _.flatMap: token =>
        Try(Option(JWT.decode(token).getClaim("preferred_username").asString())).toOption.flatten

end PersistenceWorkerDsl
