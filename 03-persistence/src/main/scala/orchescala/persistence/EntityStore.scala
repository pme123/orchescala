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
      expectedVersion: Option[Long]
  ): IO[PersistenceError, Unit]

end EntityStore

object EntityStore:

  def postgres(config: PersistenceConfig): EntityStore = PostgresEntityStore(config)

end EntityStore

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
    withConnection(entity): con =>
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
      Using.resource(con.prepareStatement(sql)): stmt =>
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
    .flatMap:
      case Some(stored) => ZIO.fromEither(stored)
      case None         => // nothing written: someone else was faster
        currentVersion(entity, id).flatMap: actual =>
          ZIO.fail(PersistenceError.VersionConflict(entity.table, id, expectedVersion, actual))
  end save

  def delete[E](
      entity: EntityDef[E],
      id: String,
      expectedVersion: Option[Long]
  ): IO[PersistenceError, Unit] =
    withConnection(entity): con =>
      val sql = s"DELETE FROM ${table(entity)} WHERE id = ?" +
        expectedVersion.fold("")(_ => " AND version = ?")
      Using.resource(con.prepareStatement(sql)): stmt =>
        stmt.setString(1, id)
        expectedVersion.foreach(stmt.setLong(2, _))
        stmt.executeUpdate()
    .flatMap:
      case 0 =>
        currentVersion(entity, id).flatMap:
          case None   => ZIO.fail(PersistenceError.NotFound(entity.table, id))
          case actual => ZIO.fail(PersistenceError.VersionConflict(entity.table, id, expectedVersion, actual))
      case _ => ZIO.unit

  private def currentVersion[E](entity: EntityDef[E], id: String): IO[PersistenceError, Option[Long]] =
    withConnection(entity): con =>
      Using.resource(con.prepareStatement(s"SELECT version FROM ${table(entity)} WHERE id = ?")):
        stmt =>
          stmt.setString(1, id)
          Using.resource(stmt.executeQuery())(rs => if rs.next() then Some(rs.getLong(1)) else None)

  private def table(entity: EntityDef[?]) = s"${config.schema}.${entity.table}"

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

  /** Runs blocking JDBC work - the table of the entity exists afterwards. */
  private def withConnection[E, A](entity: EntityDef[E])(work: Connection => A): IO[PersistenceError, A] =
    ZIO
      .attemptBlocking:
        Using.resource(dataSource.getConnection()): con =>
          ensureTable(con, entity.table)
          work(con)
      .tapError(err => ZIO.logError(s"Database error on ${entity.table}: ${err.getMessage}"))
      .mapError(err => PersistenceError.StoreError(s"Database error on ${entity.table}: ${err.getMessage}"))

  private def ensureTable(con: Connection, name: String): Unit =
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
      createdTables.add(name)

end PostgresEntityStore
