package orchescala.persistence

import io.circe.Codec
import org.testcontainers.containers.PostgreSQLContainer
import zio.*
import zio.test.*

/** Runs against a real Postgres (Testcontainers - needs Docker). */
object PostgresEntityStoreSpec extends ZIOSpecDefault:

  case class Notiz(id: String, kundenNr: String, text: String) derives Codec

  private val notiz = EntityDef[Notiz]("notiz", _.id, n => Map("kundenNr" -> n.kundenNr))

  private val postgres: ZLayer[Any, Throwable, EntityStore] =
    ZLayer.scoped:
      ZIO
        .acquireRelease(ZIO.attemptBlocking:
          val container = PostgreSQLContainer("postgres:17-alpine")
          container.start()
          container
        )(container => ZIO.attemptBlocking(container.stop()).orDie)
        .map: container =>
          EntityStore.postgres(PersistenceConfig(
            jdbcUrl = container.getJdbcUrl,
            username = container.getUsername,
            password = container.getPassword,
            schema = "test_app"
          ))

  private def store = ZIO.service[EntityStore]

  def spec = suite("PostgresEntityStore")(
    test("save creates version 1 with audit fields, get reads it") {
      for
        s      <- store
        saved  <- s.save(notiz, Notiz("n1", "100200", "Erste Notiz"), None, Some("anna"))
        loaded <- s.get(notiz, "n1")
      yield assertTrue(
        saved.version == 1L,
        saved.createdBy.contains("anna"),
        saved.updatedBy.contains("anna"),
        loaded.map(_.entity).contains(Notiz("n1", "100200", "Erste Notiz"))
      )
    },
    test("query finds the entities by key field") {
      for
        s      <- store
        _      <- s.save(notiz, Notiz("q1", "300", "a"), None, None)
        _      <- s.save(notiz, Notiz("q2", "300", "b"), None, None)
        _      <- s.save(notiz, Notiz("q3", "400", "c"), None, None)
        of300  <- s.query(notiz, Map("kundenNr" -> "300"))
        of400  <- s.query(notiz, Map("kundenNr" -> "400"))
      yield assertTrue(
        of300.map(_.id).toSet == Set("q1", "q2"),
        of400.map(_.id) == Seq("q3")
      )
    },
    test("update with the read version increments it, a stale version is a conflict") {
      for
        s        <- store
        v1       <- s.save(notiz, Notiz("u1", "500", "alt"), None, Some("anna"))
        v2       <- s.save(notiz, Notiz("u1", "500", "neu"), Some(v1.version), Some("beat"))
        conflict <- s.save(notiz, Notiz("u1", "500", "zu spät"), Some(v1.version), None).flip
      yield assertTrue(
        v2.version == 2L,
        v2.entity.text == "neu",
        v2.createdBy.contains("anna"),
        v2.updatedBy.contains("beat"),
        conflict == PersistenceError.VersionConflict("notiz", "u1", Some(1L), Some(2L))
      )
    },
    test("creating an existing entity is a conflict") {
      for
        s        <- store
        _        <- s.save(notiz, Notiz("c1", "600", "x"), None, None)
        conflict <- s.save(notiz, Notiz("c1", "600", "y"), None, None).flip
      yield assertTrue(conflict == PersistenceError.VersionConflict("notiz", "c1", None, Some(1L)))
    },
    test("delete checks the version and removes the entity") {
      for
        s        <- store
        v1       <- s.save(notiz, Notiz("d1", "700", "x"), None, None)
        conflict <- s.delete(notiz, "d1", Some(v1.version + 1), None).flip
        _        <- s.delete(notiz, "d1", Some(v1.version), None)
        gone     <- s.get(notiz, "d1")
        missing  <- s.delete(notiz, "d1", None, None).flip
      yield assertTrue(
        conflict == PersistenceError.VersionConflict("notiz", "d1", Some(2L), Some(1L)),
        gone.isEmpty,
        missing == PersistenceError.NotFound("notiz", "d1")
      )
    },
    test("the audit log records every change with user, also the deletion") {
      for
        s       <- store
        v1      <- s.save(notiz, Notiz("h1", "800", "erste"), None, Some("anna"))
        v2      <- s.save(notiz, Notiz("h1", "800", "zweite"), Some(v1.version), Some("beat"))
        _       <- s.delete(notiz, "h1", Some(v2.version), Some("carla"))
        changes <- s.history(notiz, "h1")
      yield assertTrue(
        changes.map(c => (c.version, c.operation, c.entity.text, c.changedBy)) == Seq(
          (1L, Operation.Created, "erste", Some("anna")),
          (2L, Operation.Updated, "zweite", Some("beat")),
          (3L, Operation.Deleted, "zweite", Some("carla"))
        ),
        changes.head.changedAt == v1.createdAt,
        changes(1).changedAt == v2.updatedAt
      )
    },
    test("a rejected change leaves no trace in the audit log") {
      for
        s         <- store
        v1        <- s.save(notiz, Notiz("h2", "900", "a"), None, Some("anna"))
        _         <- s.save(notiz, Notiz("h2", "900", "b"), Some(v1.version + 5), Some("x")).flip
        _         <- s.save(notiz, Notiz("h2", "900", "c"), None, Some("x")).flip
        _         <- s.delete(notiz, "h2", Some(v1.version + 5), Some("x")).flip
        changes   <- s.history(notiz, "h2")
      yield assertTrue(changes.map(_.version) == Seq(1L))
    },
    test("an entity created again after deletion continues its audit log") {
      for
        s       <- store
        v1      <- s.save(notiz, Notiz("h3", "950", "alt"), None, Some("anna"))
        _       <- s.delete(notiz, "h3", Some(v1.version), Some("anna"))
        _       <- s.save(notiz, Notiz("h3", "950", "neu"), None, Some("beat"))
        changes <- s.history(notiz, "h3")
      yield assertTrue(
        changes.map(c => (c.operation, c.entity.text)) == Seq(
          (Operation.Created, "alt"),
          (Operation.Deleted, "alt"),
          (Operation.Created, "neu")
        )
      )
    },
    test("an unknown id has an empty audit log") {
      store.flatMap(_.history(notiz, "nie-da")).map(changes => assertTrue(changes.isEmpty))
    }
  ).provideShared(postgres.orDie) @@ TestAspect.sequential

end PostgresEntityStoreSpec
