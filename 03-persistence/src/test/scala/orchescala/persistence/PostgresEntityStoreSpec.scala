package orchescala.persistence

import io.circe.{Codec, Decoder, Encoder}
import org.testcontainers.DockerClientFactory
import org.testcontainers.containers.PostgreSQLContainer
import zio.*
import zio.test.*

import scala.util.{Try, Using}

/** Runs against a real Postgres (Testcontainers). Ignored locally where there is no Docker - on CI
  * (`CI` is set) it fails instead, so the real-database tests cannot be skipped silently.
  */
object PostgresEntityStoreSpec extends ZIOSpecDefault:

  case class Notiz(id: String, kundenNr: String, text: String) derives Codec

  private val notiz = EntityDef[Notiz]("notiz", _.id, n => Map("kundenNr" -> n.kundenNr))

  private lazy val runTests =
    sys.env.contains("CI") || Try(DockerClientFactory.instance().isDockerAvailable).getOrElse(false)

  private val postgres: ZLayer[Any, Throwable, PersistenceConfig & EntityStore] =
    val config = ZLayer.scoped:
      ZIO
        .acquireRelease(ZIO.attemptBlocking:
          val container = PostgreSQLContainer("postgres:17-alpine")
          container.start()
          container)(container => ZIO.attemptBlocking(container.stop()).orDie)
        .map: container =>
          PersistenceConfig(
            jdbcUrl = container.getJdbcUrl,
            username = container.getUsername,
            password = container.getPassword,
            schema = "test_app"
          )
    config >+> ZLayer.scoped(ZIO.serviceWithZIO[PersistenceConfig](EntityStore.postgresScoped))
  end postgres

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
        s     <- store
        _     <- s.save(notiz, Notiz("q1", "300", "a"), None, None)
        _     <- s.save(notiz, Notiz("q2", "300", "b"), None, None)
        _     <- s.save(notiz, Notiz("q3", "400", "c"), None, None)
        of300 <- s.query(notiz, Map("kundenNr" -> "300"))
        of400 <- s.query(notiz, Map("kundenNr" -> "400"))
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
        changes.map(c => (c.version, c.operation, c.entity.map(_.text), c.changedBy)) == Seq(
          (1L, Operation.Created, Some("erste"), Some("anna")),
          (2L, Operation.Updated, Some("zweite"), Some("beat")),
          (3L, Operation.Deleted, Some("zweite"), Some("carla"))
        ),
        changes.head.changedAt == v1.createdAt,
        changes(1).changedAt == v2.updatedAt
      )
    },
    test("a rejected change leaves no trace in the audit log") {
      for
        s       <- store
        v1      <- s.save(notiz, Notiz("h2", "900", "a"), None, Some("anna"))
        _       <- s.save(notiz, Notiz("h2", "900", "b"), Some(v1.version + 5), Some("x")).flip
        _       <- s.save(notiz, Notiz("h2", "900", "c"), None, Some("x")).flip
        _       <- s.delete(notiz, "h2", Some(v1.version + 5), Some("x")).flip
        changes <- s.history(notiz, "h2")
      yield assertTrue(changes.map(_.version) == Seq(1L))
    },
    test("an entity created again after deletion continues its versions and audit log") {
      for
        s       <- store
        v1      <- s.save(notiz, Notiz("h3", "950", "alt"), None, Some("anna"))
        _       <- s.delete(notiz, "h3", Some(v1.version), Some("anna"))
        again   <- s.save(notiz, Notiz("h3", "950", "neu"), None, Some("beat"))
        // a client still holding version 1 from before the deletion must not win
        stale   <- s.save(notiz, Notiz("h3", "950", "veraltet"), Some(v1.version), None).flip
        changes <- s.history(notiz, "h3")
      yield assertTrue(
        again.version == 3L,
        stale == PersistenceError.VersionConflict("notiz", "h3", Some(1L), Some(3L)),
        changes.map(c => (c.version, c.operation, c.entity.map(_.text))) == Seq(
          (1L, Operation.Created, Some("alt")),
          (2L, Operation.Deleted, Some("alt")),
          (3L, Operation.Created, Some("neu"))
        )
      )
    },
    test(
      "an entity whose JSON cannot be read back is not written - neither entity nor audit entry"
    ) {
      // the encoder writes JSON the decoder rejects
      given Codec[Notiz] =
        Codec.from(Decoder.failedWithMessage("broken"), Encoder[Notiz](using notiz.codec))
      val broken         = EntityDef[Notiz]("broken_notiz", _.id)
      for
        s       <- store
        error   <- s.save(broken, Notiz("b1", "1", "x"), None, Some("anna")).flip
        stored  <- s.get(notiz.copy(table = "broken_notiz")(using notiz.codec), "b1")
        changes <- s.history(notiz.copy(table = "broken_notiz")(using notiz.codec), "b1")
      yield assertTrue(
        error.isInstanceOf[PersistenceError.StoreError],
        stored.isEmpty,
        changes.isEmpty
      )
      end for
    },
    test("of parallel saves with the same version exactly one wins") {
      for
        s       <- store
        v1      <- s.save(notiz, Notiz("p1", "1000", "start"), None, None)
        results <- ZIO.foreachPar(1 to 8)(i =>
                     s.save(
                       notiz,
                       Notiz("p1", "1000", s"Änderung $i"),
                       Some(v1.version),
                       Some(s"u$i")
                     ).either
                   )
        changes <- s.history(notiz, "p1")
      yield assertTrue(
        results.count(_.isRight) == 1,
        results.collect { case Left(e: PersistenceError.VersionConflict) => e }.size == 7,
        changes.map(_.version) == Seq(1L, 2L)
      )
    },
    test("of parallel creates after a deletion exactly one wins, with the next version") {
      for
        s       <- store
        v1      <- s.save(notiz, Notiz("pc1", "1200", "alt"), None, None)
        _       <- s.delete(notiz, "pc1", Some(v1.version), None)
        results <- ZIO.foreachPar(1 to 8)(i =>
                     s.save(notiz, Notiz("pc1", "1200", s"neu $i"), None, None).either
                   )
        changes <- s.history(notiz, "pc1")
      yield assertTrue(
        results.collect { case Right(stored) => stored.version } == Seq(3L),
        results.collect { case Left(e: PersistenceError.VersionConflict) => e.actual }.toSet == Set(
          Some(3L)
        ),
        changes.map(_.version) == Seq(1L, 2L, 3L)
      )
    },
    test("a delete racing a re-create never duplicates a version in the audit log") {
      for
        s      <- store
        rounds <- ZIO.foreach(1 to 15): round =>
                    val id = s"race$round"
                    for
                      v1      <- s.save(notiz, Notiz(id, "1400", "eins"), None, None)
                      v2      <- s.save(notiz, Notiz(id, "1400", "zwei"), Some(v1.version), None)
                      _       <- s.delete(notiz, id, Some(v2.version), None) <&>
                                   s.save(notiz, Notiz(id, "1400", "neu"), None, None).either
                      changes <- s.history(notiz, id)
                    yield changes.map(_.version)
                    end for
      yield assertTrue(rounds.forall(versions => versions == versions.distinct.sorted))
    },
    test("history returns the newest entries, oldest first") {
      for
        s      <- store
        v1     <- s.save(notiz, Notiz("hl1", "1500", "1"), None, None)
        v2     <- s.save(notiz, Notiz("hl1", "1500", "2"), Some(v1.version), None)
        _      <- s.save(notiz, Notiz("hl1", "1500", "3"), Some(v2.version), None)
        newest <- s.history(notiz, "hl1", limit = 2)
      yield assertTrue(newest.map(_.version) == Seq(2L, 3L))
    },
    test("postgres gives one store per configuration") {
      ZIO.serviceWith[PersistenceConfig]: config =>
        assertTrue(EntityStore.postgres(config) eq EntityStore.postgres(config))
    },
    test("query leaves out a row that no longer decodes - the others are found") {
      case class NotizV2(id: String, kundenNr: String, text: String, prioritaet: Int) derives Codec
      val notizV2 = EntityDef[NotizV2]("notiz", _.id, n => Map("kundenNr" -> n.kundenNr))
      for
        s     <- store
        _     <- s.save(notiz, Notiz("qv1", "1600", "altes Format"), None, None)
        _     <- s.save(notizV2, NotizV2("qv2", "1600", "neues Format", 1), None, None)
        found <- s.query(notizV2, Map("kundenNr" -> "1600"))
        old   <- s.get(notizV2, "qv1").flip
      yield assertTrue(
        found.map(_.id) == Seq("qv2"),
        old.isInstanceOf[PersistenceError.StoreError]
      )
      end for
    },
    test("an old audit entry that no longer decodes stays readable as JSON") {
      // a changed entity: the old entries lack the new required field
      case class NotizV2(id: String, kundenNr: String, text: String, prioritaet: Int) derives Codec
      val notizV2 = EntityDef[NotizV2]("notiz", _.id)
      for
        s       <- store
        _       <- s.save(notiz, Notiz("old1", "1300", "vor der Änderung"), None, None)
        changes <- s.history(notizV2, "old1")
      yield assertTrue(
        changes.size == 1,
        changes.head.entity.isEmpty,
        changes.head.payload.hcursor.get[String]("text").contains("vor der Änderung")
      )
      end for
    },
    test(
      "with createTables = false the store runs no DDL - the tables come from PostgresEntityStore.ddl"
    ) {
      for
        config <- ZIO.service[PersistenceConfig]
        noDdl   = config.copy(schema = "no_ddl_app", createTables = false)
        result <- ZIO.scoped:
                    EntityStore.postgresScoped(noDdl).flatMap: s =>
                      for
                        missing <- s.save(notiz, Notiz("n1", "1", "x"), None, None).flip
                        _       <-
                          ZIO.attemptBlocking: // what the DBA runs
                            Using.resource(java.sql.DriverManager.getConnection(
                              config.jdbcUrl,
                              config.username,
                              config.password
                            )): con =>
                              Using.resource(con.createStatement()): stmt =>
                                PostgresEntityStore.ddl("no_ddl_app", "notiz").foreach(stmt.execute)
                          .orDie
                        saved   <- s.save(notiz, Notiz("n1", "1", "x"), None, None)
                      yield (missing, saved)
      yield assertTrue(
        result._1.isInstanceOf[PersistenceError.StoreError],
        result._2.version == 1L
      )
    },
    test("parallel first use of a new table creates it once, without errors") {
      for
        config  <- ZIO.service[PersistenceConfig]
        results <- ZIO.scoped:
                     EntityStore.postgresScoped(config.copy(schema = "parallel_app")).flatMap:
                       fresh =>
                         val parallel = EntityDef[Notiz]("parallel_notiz", _.id)(using notiz.codec)
                         ZIO.foreachPar(1 to 8)(i =>
                           fresh.save(parallel, Notiz(s"f$i", "1", "x"), None, None).either
                         )
      yield assertTrue(results.forall(_.isRight))
    },
    test("schema and table names that are keywords work - they are quoted") {
      for
        config <- ZIO.service[PersistenceConfig]
        loaded <- ZIO.scoped:
                    EntityStore.postgresScoped(config.copy(schema = "user")).flatMap: keyword =>
                      val order = EntityDef[Notiz]("order", _.id)(using notiz.codec)
                      keyword.save(order, Notiz("o1", "1", "x"), None, None) *> keyword.get(
                        order,
                        "o1"
                      )
      yield assertTrue(loaded.map(_.entity.text).contains("x"))
    },
    test("query limits the result to the given limit, at most 1000") {
      for
        s    <- store
        _    <- ZIO.foreachDiscard(1 to 3)(i => s.save(notiz, Notiz(s"l$i", "1100", "x"), None, None))
        one  <- s.query(notiz, Map("kundenNr" -> "1100"), limit = 1)
        none <- s.query(notiz, Map("kundenNr" -> "1100"), limit = 0) // at least 1
      yield assertTrue(one.size == 1, none.size == 1)
    },
    test("an unknown id has an empty audit log") {
      store.flatMap(_.history(notiz, "nie-da")).map(changes => assertTrue(changes.isEmpty))
    }
  ).provideShared(postgres.orDie) @@ TestAspect.sequential @@
    (if runTests then TestAspect.identity else TestAspect.ignore)

end PostgresEntityStoreSpec
