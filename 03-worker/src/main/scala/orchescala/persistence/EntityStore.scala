package orchescala.persistence

import zio.*

/** Stores entities as JSON - the interface of the PersistenceWorker. An implementation is e.g.
  * `orchescala.persistence.postgres.PostgresEntityStore` (module 04-persistence-postgres); every
  * implementation follows the rules of `EntityStoreContract` (tests of 03-worker).
  *
  * In the Postgres implementation: one table per entity, all tables with the same columns:
  *
  * {{{
  * id text PK · version bigint · keys jsonb (GIN index) · payload jsonb
  * created_at · created_by · updated_at · updated_by
  * }}}
  *
  * Every change is recorded in the audit log of the entity (`{table}_history`), in the same
  * transaction as the change itself - see [[history]].
  *
  * The tables are created on first use. Changes use optimistic locking: `save` with the version the
  * caller read, a concurrent change is a [[PersistenceError.VersionConflict]].
  */
trait EntityStore:

  def get[E](entity: EntityDef[E], id: String): IO[PersistenceError, Option[Stored[E]]]

  /** All entities whose key fields contain `keys` - newest change first, at most `limit` (1 to
    * [[EntityStore.maxLimit]]). A row that no longer decodes with the current codec (e.g. after a
    * change of the entity) is left out and logged - one old row does not break the whole query;
    * `get` of that id fails with a [[PersistenceError.StoreError]].
    */
  def query[E](
      entity: EntityDef[E],
      keys: Map[String, String] = Map.empty,
      limit: Int = 100
  ): IO[PersistenceError, Seq[Stored[E]]]

  /** Creates the entity (`expectedVersion = None`) or updates the given version of it.
    *
    * An entity created again after a deletion continues its versions (and its audit log): a client
    * still holding a version from before the deletion gets a [[PersistenceError.VersionConflict]].
    */
  def save[E](
      entity: EntityDef[E],
      value: E,
      expectedVersion: Option[Long],
      user: Option[String]
  ): IO[PersistenceError, Stored[E]]

  /** Deletes the entity - only the given version, if there is one. */
  def delete[E](
      entity: EntityDef[E],
      id: String,
      expectedVersion: Option[Long],
      user: Option[String]
  ): IO[PersistenceError, Unit]

  /** Opens a connection to the database - call it when the app starts, so a wrong URL or password
    * shows up then and not with the first request.
    */
  def checkConnection: IO[PersistenceError, Unit]

  /** The audit log of an entity - the newest `limit` changes (1 to [[EntityStore.maxLimit]]),
    * oldest first. Also for deleted entities.
    */
  def history[E](
      entity: EntityDef[E],
      id: String,
      limit: Int = EntityStore.maxLimit
  ): IO[PersistenceError, Seq[Change[E]]]

end EntityStore

object EntityStore:

  /** The most a query or the history returns at once. */
  val maxLimit = 1000

end EntityStore
