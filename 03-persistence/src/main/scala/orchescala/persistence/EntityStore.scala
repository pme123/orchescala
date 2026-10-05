package orchescala.persistence

import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.circe.parser
import io.circe.syntax.*
import zio.*

import java.sql.{Connection, ResultSet}
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import scala.collection.mutable.ListBuffer
import scala.util.Using

/** Stores entities as JSON - one table per entity, all tables with the same columns:
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

  val maxLimit = 1000

  /** A store for the lifetime of the app - its connection pool is closed when the JVM ends. One
    * store per configuration: call it with the same configuration (e.g. a `lazy val` next to the
    * base worker). A configuration that changes per call - another schema each time - would keep a
    * pool per configuration; use [[postgresScoped]] for anything shorter-lived.
    */
  def postgres(config: PersistenceConfig): EntityStore =
    appStores.computeIfAbsent(
      config,
      _ =>
        val store = PostgresEntityStore(config)
        java.lang.Runtime.getRuntime.addShutdownHook(Thread(() => store.close()))
        store
    )

  // one store (pool, shutdown hook) per configuration - also when postgres is called in a `def`
  private val appStores = ConcurrentHashMap[PersistenceConfig, PostgresEntityStore]()

  /** A store whose connection pool is closed with the scope - e.g. in tests or as a
    * `ZLayer.scoped`.
    */
  def postgresScoped(config: PersistenceConfig): ZIO[Scope, Nothing, EntityStore] =
    ZIO.acquireRelease(ZIO.succeed(PostgresEntityStore(config)))(store =>
      ZIO.attemptBlocking(store.close()).orDie
    )

end EntityStore

/** [[EntityStore]] on Postgres.
  *
  * The audit log `{table}_history` is append-only for the store. To make it tamper-proof against
  * the app itself, give its database user only `INSERT, SELECT` on the history tables - and create
  * the tables beforehand ([[PersistenceConfig.createTables]] = false, statements in
  * [[PostgresEntityStore.ddl]]).
  *
  * Errors of the database are logged with their details; the caller only gets a generic
  * [[PersistenceError.StoreError]] - no SQL, table or host details through `/worker`.
  */
class PostgresEntityStore(config: PersistenceConfig) extends EntityStore, AutoCloseable:

  // the pool is created on first use; after close() the store is no longer usable
  private val pool             = AtomicReference[Option[HikariDataSource]](None)
  @volatile private var closed = false

  private def dataSource: HikariDataSource =
    pool.get.getOrElse:
      synchronized:
        if closed then
          throw IllegalStateException(s"The store of schema ${config.schema} is closed")
        pool.get.getOrElse:
          val hikari  = HikariConfig()
          hikari.setJdbcUrl(config.jdbcUrl)
          hikari.setUsername(config.username)
          hikari.setPassword(config.password)
          hikari.setMaximumPoolSize(config.maximumPoolSize)
          hikari.setPoolName(s"orchescala-${config.schema}")
          val created = HikariDataSource(hikari) // a failed init leaves no state behind
          pool.set(Some(created))
          created

  private val createdTables = ConcurrentHashMap.newKeySet[String]()

  /** Closes the connection pool - idempotent. */
  def close(): Unit =
    synchronized:
      closed = true
      pool.getAndSet(None).foreach(_.close())

  private val columns =
    "id, version, payload::text, created_at, created_by, updated_at, updated_by"

  def get[E](entity: EntityDef[E], id: String): IO[PersistenceError, Option[Stored[E]]] =
    withConnection(entity): con =>
      Using.resource(con.prepareStatement(s"SELECT $columns FROM ${table(entity)} WHERE id = ?")):
        stmt =>
          stmt.setString(1, id)
          Using.resource(stmt.executeQuery())(rs =>
            if rs.next() then Some(read(entity, rs)) else None
          )
    .flatMap(decodeOpt)

  def query[E](
      entity: EntityDef[E],
      keys: Map[String, String],
      limit: Int
  ): IO[PersistenceError, Seq[Stored[E]]] =
    withConnection(entity): con =>
      Using.resource(con.prepareStatement(
        s"SELECT $columns FROM ${table(entity)} WHERE keys @> ?::jsonb ORDER BY updated_at DESC, id LIMIT ?"
      )): stmt =>
        stmt.setString(1, keys.asJson.noSpaces)
        stmt.setInt(2, limit.max(1).min(EntityStore.maxLimit))
        Using.resource(stmt.executeQuery()): rs =>
          val rows = ListBuffer.empty[Either[PersistenceError, Stored[E]]]
          while rs.next() do rows += read(entity, rs)
          rows.toSeq
    .flatMap: rows =>
      val unreadable = rows.collect { case Left(error) => error.message }
      ZIO
        .foreachDiscard(unreadable)(msg => ZIO.logWarning(s"Left out of the query: $msg"))
        .as(rows.collect { case Right(stored) => stored })

  def save[E](
      entity: EntityDef[E],
      value: E,
      expectedVersion: Option[Long],
      user: Option[String]
  ): IO[PersistenceError, Stored[E]] =
    val id   = entity.id(value)
    val keys = entity.keys(value).asJson.noSpaces
    val json = value.asJson(using entity.codec)
    // what cannot be read back must not be written - checked before the transaction
    json.as[E](using entity.codec) match
      case Left(err) =>
        ZIO.logError(
          s"${entity.table} '$id' cannot be read back with its codec: ${err.getMessage}"
        ) *>
          ZIO.fail(PersistenceError.StoreError(
            s"${entity.table} '$id' cannot be stored - its JSON cannot be read back"
          ))
      case Right(_)  => write(entity, id, keys, json.noSpaces, expectedVersion, user)
    end match
  end save

  private def write[E](
      entity: EntityDef[E],
      id: String,
      keys: String,
      payload: String,
      expectedVersion: Option[Long],
      user: Option[String]
  ): IO[PersistenceError, Stored[E]] =
    withTransaction(entity): con =>
      lockId(con, entity, id)
      val sql     = expectedVersion match
        case None    => // a new entity - or one created again: it continues its versions
          s"""INSERT INTO ${table(entity)}
             |  (id, version, keys, payload, created_at, created_by, updated_at, updated_by)
             |VALUES (
             |  ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM ${historyTable(entity)} WHERE id = ?),
             |  ?::jsonb, ?::jsonb, now(), ?, now(), ?
             |)
             |ON CONFLICT (id) DO NOTHING
             |RETURNING $columns""".stripMargin
        case Some(_) =>
          s"""UPDATE ${table(entity)}
             |SET version = version + 1, keys = ?::jsonb, payload = ?::jsonb,
             |    updated_at = now(), updated_by = ?
             |WHERE id = ? AND version = ?
             |RETURNING $columns""".stripMargin
      val written = Using.resource(con.prepareStatement(sql)): stmt =>
        expectedVersion match
          case None          =>
            stmt.setString(1, id)
            stmt.setString(2, id)
            stmt.setString(3, keys)
            stmt.setString(4, payload)
            stmt.setString(5, user.orNull)
            stmt.setString(6, user.orNull)
          case Some(version) =>
            stmt.setString(1, keys)
            stmt.setString(2, payload)
            stmt.setString(3, user.orNull)
            stmt.setString(4, id)
            stmt.setLong(5, version)
        end match
        Using.resource(stmt.executeQuery())(rs =>
          if rs.next() then Some(read(entity, rs)) else None
        )
      written match
        case Some(Right(stored)) =>
          val operation = if expectedVersion.isEmpty then Operation.Created else Operation.Updated
          appendHistory(con, entity, id, stored.version, operation, payload, user)
          Right(stored)
        case Some(Left(error))   => // never commit a change without its audit entry
          throw PersistenceFailure(error)
        case None                => // nothing written - the version now, under the lock of the id
          Left(versionIn(con, entity, id))
      end match
    .flatMap:
      case Right(stored) => ZIO.succeed(stored)
      case Left(actual)  =>
        ZIO.fail(PersistenceError.VersionConflict(entity.table, id, expectedVersion, actual))
  end write

  def delete[E](
      entity: EntityDef[E],
      id: String,
      expectedVersion: Option[Long],
      user: Option[String]
  ): IO[PersistenceError, Unit] =
    withTransaction(entity): con =>
      lockId(con, entity, id)
      val sql     = s"DELETE FROM ${table(entity)} WHERE id = ?" +
        expectedVersion.fold("")(_ => " AND version = ?") +
        " RETURNING version, payload::text"
      val deleted = Using.resource(con.prepareStatement(sql)): stmt =>
        stmt.setString(1, id)
        expectedVersion.foreach(stmt.setLong(2, _))
        Using.resource(stmt.executeQuery()): rs =>
          if rs.next() then Some(rs.getLong(1) -> rs.getString(2)) else None
      // the deletion is the next version - the log keeps the last state
      deleted match
        case Some((version, payload)) =>
          appendHistory(con, entity, id, version + 1, Operation.Deleted, payload, user)
          None
        case None                     => // nothing deleted - why, under the lock of the id
          Some(versionIn(con, entity, id))
      end match
    .flatMap:
      case None         => ZIO.unit
      case Some(None)   => ZIO.fail(PersistenceError.NotFound(entity.table, id))
      case Some(actual) =>
        ZIO.fail(PersistenceError.VersionConflict(entity.table, id, expectedVersion, actual))

  def history[E](
      entity: EntityDef[E],
      id: String,
      limit: Int
  ): IO[PersistenceError, Seq[Change[E]]] =
    withConnection(entity): con =>
      Using.resource(con.prepareStatement(
        s"""SELECT version, operation, payload::text, changed_at, changed_by FROM (
           |  SELECT * FROM ${historyTable(entity)} WHERE id = ? ORDER BY history_id DESC LIMIT ?
           |) newest ORDER BY history_id""".stripMargin
      )): stmt =>
        stmt.setString(1, id)
        stmt.setInt(2, limit.max(1).min(EntityStore.maxLimit))
        Using.resource(stmt.executeQuery()): rs =>
          val rows = ListBuffer.empty[Change[E]]
          while rs.next() do
            val version = rs.getLong(1)
            // jsonb is always valid JSON - a failure here is a corrupt row, not an old format
            val payload = parser.parse(rs.getString(3)).fold(
              err =>
                throw PersistenceFailure(PersistenceError.StoreError(
                  s"History of ${entity.table} '$id' version $version is corrupt: ${err.getMessage}"
                )),
              identity
            )
            rows += Change(
              id = id,
              version = version,
              operation = Operation.fromDb(rs.getString(2)),
              entity = payload.as[E](using entity.codec).toOption,
              payload = payload,
              changedAt = rs.getTimestamp(4).toInstant,
              changedBy = Option(rs.getString(5))
            )
          end while
          rows.toSeq
    .tap: changes =>
      val old = changes.filter(_.entity.isEmpty).map(_.version)
      ZIO.when(old.nonEmpty)(
        ZIO.logWarning(
          s"History of ${entity.table} '$id': versions ${old.mkString(", ")} no longer decode - returned as JSON only"
        )
      )

  /** Serializes the changes of one entity (create, update, delete) until the end of the transaction -
    * a re-create waits for a concurrent deletion and continues after its version.
    *
    * The key is `hashtext` - 32 bits: two ids with the same hash are serialized as well, which only
    * costs a little waiting, never correctness. The DDL lock of the schema uses the same key space
    * with its own text.
    */
  private def lockId(con: Connection, entity: EntityDef[?], id: String): Unit =
    // bounded: a busy entity must not hold pooled connections for long (55P03 → Busy)
    Using.resource(con.createStatement()):
      _.execute(s"SET LOCAL lock_timeout = '${config.lockTimeoutMillis}ms'")
    try lockAdvisory(con, entity, id)
    catch
      case err: java.sql.SQLException if err.getSQLState == "55P03" =>
        throw PersistenceFailure(PersistenceError.Busy(entity.table, id))
  end lockId

  private def lockAdvisory(con: Connection, entity: EntityDef[?], id: String): Unit =
    Using.resource(con.prepareStatement("SELECT pg_advisory_xact_lock(hashtext(?))")): stmt =>
      stmt.setString(1, s"orchescala-persistence:${config.schema}.${entity.table}:$id")
      stmt.execute()

  /** `now()` is the start of the transaction - the same time as in the entity table. */
  private def appendHistory(
      con: Connection,
      entity: EntityDef[?],
      id: String,
      version: Long,
      operation: Operation,
      payload: String,
      user: Option[String]
  ): Unit =
    Using.resource(con.prepareStatement(
      s"""INSERT INTO ${historyTable(
          entity
        )} (id, version, operation, payload, changed_at, changed_by)
         |VALUES (?, ?, ?, ?::jsonb, now(), ?)""".stripMargin
    )): stmt =>
      stmt.setString(1, id)
      stmt.setLong(2, version)
      stmt.setString(3, operation.dbValue)
      stmt.setString(4, payload)
      stmt.setString(5, user.orNull)
      stmt.executeUpdate()
  end appendHistory

  def checkConnection: IO[PersistenceError, Unit] =
    ZIO
      .attemptBlocking(Using.resource(dataSource.getConnection())(_.isValid(5)))
      .tapError(err =>
        ZIO.logError(s"Database of schema ${config.schema} not reachable: ${err.getMessage}")
      )
      .mapError(_ =>
        PersistenceError.StoreError(s"Database of schema ${config.schema} not reachable")
      )
      .filterOrFail(identity)(PersistenceError.StoreError(
        s"Database of schema ${config.schema} not reachable"
      ))
      .unit
      .zipLeft(ZIO.logInfo(s"Database reachable: ${config}"))

  /** The version in the store - read in the transaction that holds the lock of the id, so it is
    * exactly the one that made the change fail.
    */
  private def versionIn(con: Connection, entity: EntityDef[?], id: String): Option[Long] =
    Using.resource(con.prepareStatement(s"SELECT version FROM ${table(entity)} WHERE id = ?")):
      stmt =>
        stmt.setString(1, id)
        Using.resource(stmt.executeQuery())(rs => if rs.next() then Some(rs.getLong(1)) else None)

  // quoted - a valid name may still be a keyword (`user`, `order`)
  private def table(entity: EntityDef[?])        = PostgresEntityStore.table(config.schema, entity.table)
  private def historyTable(entity: EntityDef[?]) =
    PostgresEntityStore.table(config.schema, s"${entity.table}_history")

  private def read[E](entity: EntityDef[E], rs: ResultSet): Either[PersistenceError, Stored[E]] =
    val id = rs.getString(1)
    parser.decode[E](rs.getString(3))(using entity.codec)
      .left.map(err =>
        PersistenceError.StoreError(s"${entity.table} '$id' cannot be read: ${err.getMessage}")
      )
      .map: value =>
        Stored(
          entity = value,
          id = id,
          version = rs.getLong(2),
          createdAt = rs.getTimestamp(4).toInstant,
          createdBy = Option(rs.getString(5)),
          updatedAt = rs.getTimestamp(6).toInstant,
          updatedBy = Option(rs.getString(7))
        )
  end read

  private def decodeOpt[E](
      row: Option[Either[PersistenceError, Stored[E]]]
  ): IO[PersistenceError, Option[Stored[E]]] =
    ZIO.fromEither(row match
      case None        => Right(None)
      case Some(value) => value.map(Some(_)))

  /** Runs blocking JDBC work - the tables of the entity exist afterwards. */
  private def withConnection[E, A](entity: EntityDef[E])(work: Connection => A)
      : IO[PersistenceError, A] =
    ZIO
      .attemptBlocking:
        Using.resource(dataSource.getConnection()): con =>
          ensureTables(con, entity.table)
          work(con)
      .tapError:
        case failure: PersistenceFailure => // a deliberate abort, not a database error
          ZIO.logWarning(s"Aborted on ${entity.table}: ${failure.error.message}")
        case err                         =>
          ZIO.logError(s"Database error on ${entity.table}: ${err.getMessage}")
      .mapError:
        case failure: PersistenceFailure => failure.error
        case _                           =>
          PersistenceError.StoreError(
            s"Database error on ${entity.table} - see the log of the worker app"
          )

  /** Like [[withConnection]], but all statements in one transaction - change and audit log are
    * written together or not at all.
    */
  private def withTransaction[E, A](entity: EntityDef[E])(work: Connection => A)
      : IO[PersistenceError, A] =
    withConnection(entity)(con => inTransaction(con)(work(con)))

  private def inTransaction[A](con: Connection)(work: => A): A =
    val autoCommit = con.getAutoCommit
    con.setAutoCommit(false)
    try
      val result = work
      con.commit()
      result
    catch
      case err: Throwable =>
        try con.rollback()
        catch case rollbackErr: Throwable => err.addSuppressed(rollbackErr)
        throw err
    finally con.setAutoCommit(autoCommit)
    end try
  end inTransaction

  /** Creates schema and tables once per store. Under an advisory lock on the schema: several worker
    * apps (or fibers) starting at once do not run the DDL concurrently.
    */
  private def ensureTables(con: Connection, name: String): Unit =
    if config.createTables && !createdTables.contains(name) then
      inTransaction(con):
        Using.resource(con.prepareStatement("SELECT pg_advisory_xact_lock(hashtext(?))")): stmt =>
          stmt.setString(1, s"orchescala-persistence:${config.schema}")
          stmt.execute()
        Using.resource(con.createStatement()): stmt =>
          PostgresEntityStore.ddl(config.schema, name).foreach(stmt.execute)
      createdTables.add(name)

end PostgresEntityStore

object PostgresEntityStore:

  private[persistence] def quote(identifier: String): String = s"\"$identifier\""

  private[persistence] def table(schema: String, name: String): String =
    s"${quote(schema)}.${quote(name)}"

  /** The statements that create schema, entity table and audit log of an entity - for a DBA when
    * the app may not run DDL ([[PersistenceConfig.createTables]] = false). Index names have short
    * suffixes, so they stay within the 63 characters of Postgres for a table name of 54.
    */
  def ddl(schema: String, name: String): Seq[String] =
    val t = table(schema, name)
    val h = table(schema, s"${name}_history")
    Seq(
      s"CREATE SCHEMA IF NOT EXISTS ${quote(schema)}",
      s"""CREATE TABLE IF NOT EXISTS $t (
         |  id         text        PRIMARY KEY,
         |  version    bigint      NOT NULL,
         |  keys       jsonb       NOT NULL DEFAULT '{}',
         |  payload    jsonb       NOT NULL,
         |  created_at timestamptz NOT NULL,
         |  created_by text,
         |  updated_at timestamptz NOT NULL,
         |  updated_by text
         |)""".stripMargin,
      s"CREATE INDEX IF NOT EXISTS ${quote(s"${name}_keys_ix")} ON $t USING gin (keys)",
      s"CREATE INDEX IF NOT EXISTS ${quote(s"${name}_upd_ix")} ON $t (updated_at DESC, id)",
      s"""CREATE TABLE IF NOT EXISTS $h (
         |  history_id bigserial   PRIMARY KEY,
         |  id         text        NOT NULL,
         |  version    bigint      NOT NULL,
         |  operation  text        NOT NULL,
         |  payload    jsonb       NOT NULL,
         |  changed_at timestamptz NOT NULL,
         |  changed_by text
         |)""".stripMargin,
      // one entry per version - the last safeguard against a duplicate in the audit log
      s"CREATE UNIQUE INDEX IF NOT EXISTS ${quote(s"${name}_hist_ux")} ON $h (id, version)"
    )
  end ddl

end PostgresEntityStore

/** Ends a transaction with a [[PersistenceError]] - so it is rolled back.
  *
  * Thrown inside the synchronous JDBC block of `withTransaction`: that block is plain JDBC (one
  * connection, one thread), and an exception is how it aborts and rolls back. `withConnection`
  * turns it back into the typed error.
  */
private final class PersistenceFailure(val error: PersistenceError)
    extends RuntimeException(error.message, null, false, false)
