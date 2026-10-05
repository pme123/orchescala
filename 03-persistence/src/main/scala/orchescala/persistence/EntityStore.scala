package orchescala.persistence

import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.circe.parser
import io.circe.syntax.*
import zio.*

import java.sql.{Connection, ResultSet}
import java.util.concurrent.ConcurrentHashMap
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
  * The tables are created on first use. Changes use optimistic locking: `save` with the version
  * the caller read, a concurrent change is a [[PersistenceError.VersionConflict]].
  */
trait EntityStore:

  def get[E](entity: EntityDef[E], id: String): IO[PersistenceError, Option[Stored[E]]]

  /** All entities whose key fields contain `keys` - newest change first. */
  def query[E](
      entity: EntityDef[E],
      keys: Map[String, String] = Map.empty,
      limit: Int = 100
  ): IO[PersistenceError, Seq[Stored[E]]]

  /** Creates the entity (`expectedVersion = None`) or updates the given version of it. */
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

  /** The audit log of an entity - all changes, oldest first. Also for deleted entities. */
  def history[E](entity: EntityDef[E], id: String): IO[PersistenceError, Seq[Change[E]]]

end EntityStore

object EntityStore:

  def postgres(config: PersistenceConfig): EntityStore = PostgresEntityStore(config)

end EntityStore

/** [[EntityStore]] on Postgres.
  *
  * The audit log `{table}_history` is append-only for the store. To make it tamper-proof against
  * the app itself, give its database user only `INSERT, SELECT` on the history tables.
  */
class PostgresEntityStore(config: PersistenceConfig) extends EntityStore:

  private lazy val dataSource: HikariDataSource =
    val hikari = HikariConfig()
    hikari.setJdbcUrl(config.jdbcUrl)
    hikari.setUsername(config.username)
    hikari.setPassword(config.password)
    hikari.setMaximumPoolSize(config.maximumPoolSize)
    hikari.setPoolName(s"orchescala-${config.schema}")
    HikariDataSource(hikari)

  private val createdTables = ConcurrentHashMap.newKeySet[String]()

  private val columns =
    "id, version, payload::text, created_at, created_by, updated_at, updated_by"

  def get[E](entity: EntityDef[E], id: String): IO[PersistenceError, Option[Stored[E]]] =
    withConnection(entity): con =>
      Using.resource(con.prepareStatement(s"SELECT $columns FROM ${table(entity)} WHERE id = ?")):
        stmt =>
          stmt.setString(1, id)
          Using.resource(stmt.executeQuery())(rs => if rs.next() then Some(read(entity, rs)) else None)
    .flatMap(decodeOpt)

  def query[E](
      entity: EntityDef[E],
      keys: Map[String, String],
      limit: Int
  ): IO[PersistenceError, Seq[Stored[E]]] =
    withConnection(entity): con =>
      Using.resource(con.prepareStatement(
        s"SELECT $columns FROM ${table(entity)} WHERE keys @> ?::jsonb ORDER BY updated_at DESC LIMIT ?"
      )): stmt =>
        stmt.setString(1, keys.asJson.noSpaces)
        stmt.setInt(2, limit)
        Using.resource(stmt.executeQuery()): rs =>
          val rows = ListBuffer.empty[Either[PersistenceError, Stored[E]]]
          while rs.next() do rows += read(entity, rs)
          rows.toSeq
    .flatMap(rows => ZIO.foreach(rows)(ZIO.fromEither(_)))

  def save[E](
      entity: EntityDef[E],
      value: E,
      expectedVersion: Option[Long],
      user: Option[String]
  ): IO[PersistenceError, Stored[E]] =
    val id      = entity.id(value)
    val keys    = entity.keys(value).asJson.noSpaces
    val payload = value.asJson(using entity.codec).noSpaces
    withTransaction(entity): con =>
      val sql = expectedVersion match
        case None    =>
          s"""INSERT INTO ${table(entity)}
             |  (id, version, keys, payload, created_at, created_by, updated_at, updated_by)
             |VALUES (?, 1, ?::jsonb, ?::jsonb, now(), ?, now(), ?)
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
            stmt.setString(2, keys)
            stmt.setString(3, payload)
            stmt.setString(4, user.orNull)
            stmt.setString(5, user.orNull)
          case Some(version) =>
            stmt.setString(1, keys)
            stmt.setString(2, payload)
            stmt.setString(3, user.orNull)
            stmt.setString(4, id)
            stmt.setLong(5, version)
        Using.resource(stmt.executeQuery())(rs => if rs.next() then Some(read(entity, rs)) else None)
      written.foreach:
        case Right(stored) =>
          val operation = if expectedVersion.isEmpty then Operation.Created else Operation.Updated
          appendHistory(con, entity, id, stored.version, operation, payload, user)
        case Left(_)       => ()
      written
    .flatMap:
      case Some(stored) => ZIO.fromEither(stored)
      case None         => // nothing written: someone else was faster
        currentVersion(entity, id).flatMap: actual =>
          ZIO.fail(PersistenceError.VersionConflict(entity.table, id, expectedVersion, actual))
  end save

  def delete[E](
      entity: EntityDef[E],
      id: String,
      expectedVersion: Option[Long],
      user: Option[String]
  ): IO[PersistenceError, Unit] =
    withTransaction(entity): con =>
      val sql = s"DELETE FROM ${table(entity)} WHERE id = ?" +
        expectedVersion.fold("")(_ => " AND version = ?") +
        " RETURNING version, payload::text"
      val deleted = Using.resource(con.prepareStatement(sql)): stmt =>
        stmt.setString(1, id)
        expectedVersion.foreach(stmt.setLong(2, _))
        Using.resource(stmt.executeQuery()): rs =>
          if rs.next() then Some(rs.getLong(1) -> rs.getString(2)) else None
      // the deletion is the next version - the log keeps the last state
      deleted.foreach: (version, payload) =>
        appendHistory(con, entity, id, version + 1, Operation.Deleted, payload, user)
      deleted.isDefined
    .flatMap:
      case false =>
        currentVersion(entity, id).flatMap:
          case None   => ZIO.fail(PersistenceError.NotFound(entity.table, id))
          case actual => ZIO.fail(PersistenceError.VersionConflict(entity.table, id, expectedVersion, actual))
      case true  => ZIO.unit

  def history[E](entity: EntityDef[E], id: String): IO[PersistenceError, Seq[Change[E]]] =
    withConnection(entity): con =>
      Using.resource(con.prepareStatement(
        s"""SELECT version, operation, payload::text, changed_at, changed_by
           |FROM ${historyTable(entity)} WHERE id = ? ORDER BY history_id""".stripMargin
      )): stmt =>
        stmt.setString(1, id)
        Using.resource(stmt.executeQuery()): rs =>
          val rows = ListBuffer.empty[Either[PersistenceError, Change[E]]]
          while rs.next() do
            rows += parser.decode[E](rs.getString(3))(using entity.codec)
              .left.map(err =>
                PersistenceError.StoreError(
                  s"History of ${entity.table} '$id' cannot be read: ${err.getMessage}"
                )
              )
              .map: value =>
                Change(
                  id = id,
                  version = rs.getLong(1),
                  operation = Operation.fromDb(rs.getString(2)),
                  entity = value,
                  changedAt = rs.getTimestamp(4).toInstant,
                  changedBy = Option(rs.getString(5))
                )
          end while
          rows.toSeq
    .flatMap(rows => ZIO.foreach(rows)(ZIO.fromEither(_)))

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
      s"""INSERT INTO ${historyTable(entity)} (id, version, operation, payload, changed_at, changed_by)
         |VALUES (?, ?, ?, ?::jsonb, now(), ?)""".stripMargin
    )): stmt =>
      stmt.setString(1, id)
      stmt.setLong(2, version)
      stmt.setString(3, operation.dbValue)
      stmt.setString(4, payload)
      stmt.setString(5, user.orNull)
      stmt.executeUpdate()
  end appendHistory

  private def currentVersion[E](entity: EntityDef[E], id: String): IO[PersistenceError, Option[Long]] =
    withConnection(entity): con =>
      Using.resource(con.prepareStatement(s"SELECT version FROM ${table(entity)} WHERE id = ?")):
        stmt =>
          stmt.setString(1, id)
          Using.resource(stmt.executeQuery())(rs => if rs.next() then Some(rs.getLong(1)) else None)

  private def table(entity: EntityDef[?])        = s"${config.schema}.${entity.table}"
  private def historyTable(entity: EntityDef[?]) = s"${config.schema}.${entity.table}_history"

  private def read[E](entity: EntityDef[E], rs: ResultSet): Either[PersistenceError, Stored[E]] =
    val id = rs.getString(1)
    parser.decode[E](rs.getString(3))(using entity.codec)
      .left.map(err => PersistenceError.StoreError(s"${entity.table} '$id' cannot be read: ${err.getMessage}"))
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
  private def withConnection[E, A](entity: EntityDef[E])(work: Connection => A): IO[PersistenceError, A] =
    ZIO
      .attemptBlocking:
        Using.resource(dataSource.getConnection()): con =>
          ensureTables(con, entity.table)
          work(con)
      .tapError(err => ZIO.logError(s"Database error on ${entity.table}: ${err.getMessage}"))
      .mapError(err => PersistenceError.StoreError(s"Database error on ${entity.table}: ${err.getMessage}"))

  /** Like [[withConnection]], but all statements in one transaction - change and audit log are
    * written together or not at all.
    */
  private def withTransaction[E, A](entity: EntityDef[E])(work: Connection => A): IO[PersistenceError, A] =
    withConnection(entity): con =>
      con.setAutoCommit(false)
      try
        val result = work(con)
        con.commit()
        result
      catch
        case err: Throwable =>
          con.rollback()
          throw err
      finally con.setAutoCommit(true)

  private def ensureTables(con: Connection, name: String): Unit =
    if !createdTables.contains(name) then
      val t = s"${config.schema}.$name"
      Using.resource(con.createStatement()): stmt =>
        stmt.execute(s"CREATE SCHEMA IF NOT EXISTS ${config.schema}")
        stmt.execute(
          s"""CREATE TABLE IF NOT EXISTS $t (
             |  id         text        PRIMARY KEY,
             |  version    bigint      NOT NULL,
             |  keys       jsonb       NOT NULL DEFAULT '{}',
             |  payload    jsonb       NOT NULL,
             |  created_at timestamptz NOT NULL,
             |  created_by text,
             |  updated_at timestamptz NOT NULL,
             |  updated_by text
             |)""".stripMargin
        )
        stmt.execute(s"CREATE INDEX IF NOT EXISTS ${name}_keys_idx ON $t USING gin (keys)")
        stmt.execute(
          s"""CREATE TABLE IF NOT EXISTS ${t}_history (
             |  history_id bigserial   PRIMARY KEY,
             |  id         text        NOT NULL,
             |  version    bigint      NOT NULL,
             |  operation  text        NOT NULL,
             |  payload    jsonb       NOT NULL,
             |  changed_at timestamptz NOT NULL,
             |  changed_by text
             |)""".stripMargin
        )
        stmt.execute(s"CREATE INDEX IF NOT EXISTS ${name}_history_id_idx ON ${t}_history (id)")
      createdTables.add(name)

end PostgresEntityStore
