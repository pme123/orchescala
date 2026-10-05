package orchescala.persistence.postgres

import orchescala.worker.persistence.*
import orchescala.worker.persistence.EntityStoreContract.{Notiz, notiz}

import io.circe.Codec
import org.testcontainers.DockerClientFactory
import org.testcontainers.containers.PostgreSQLContainer
import zio.*
import zio.test.*

import scala.util.{Try, Using}

/** Runs the [[EntityStoreContract]] and the Postgres specifics against a real Postgres
  * (Testcontainers). Ignored locally where there is no Docker - on CI (`CI` is set) it fails
  * instead, so the real-database tests cannot be skipped silently.
  */
object PostgresEntityStoreSpec extends ZIOSpecDefault:

  private lazy val runTests =
    val run =
      sys.env.contains("CI") || Try(
        DockerClientFactory.instance().isDockerAvailable
      ).getOrElse(false)
    if !run then
      println(
        "\n*** PostgresEntityStoreSpec IGNORED - no Docker. The store tests against Postgres did " +
          "not run; on CI (CI set) they fail instead. ***\n"
      )
    end if
    run
  end runTests

  private val postgres: ZLayer[Any, Throwable, PostgresConfig & EntityStore] =
    val config = ZLayer.scoped:
      ZIO
        .acquireRelease(ZIO.attemptBlocking:
          val container = PostgreSQLContainer("postgres:17-alpine")
          container.start()
          container)(container => ZIO.attemptBlocking(container.stop()).orDie)
        .map: container =>
          PostgresConfig(
            jdbcUrl = container.getJdbcUrl,
            username = container.getUsername,
            password = container.getPassword,
            schema = "test_app"
          )
    config >+> ZLayer.scoped(ZIO.serviceWithZIO[PostgresConfig](PostgresEntityStore.scoped))
  end postgres

  private def store = ZIO.service[EntityStore]

  def spec = suite("PostgresEntityStore")(
    EntityStoreContract.tests,
    test("postgres gives one store per configuration") {
      ZIO.serviceWith[PostgresConfig]: config =>
        assertTrue(PostgresEntityStore.app(config) eq PostgresEntityStore.app(config))
    },
    test("a change waiting longer than lockTimeoutMillis for the same entity is Busy") {
      for
        config <- ZIO.service[PostgresConfig]
        busy   <- ZIO.scoped:
                    for
                      fast  <- PostgresEntityStore.scoped(config.copy(lockTimeoutMillis = 200))
                      _     <- fast.save(notiz, Notiz("busy1", "1700", "x"), None, None)
                      // someone else holds the lock of this entity in an open transaction
                      other <- ZIO.acquireRelease(ZIO.attemptBlocking:
                                 val con = java.sql.DriverManager.getConnection(
                                   config.jdbcUrl,
                                   config.username,
                                   config.password
                                 )
                                 con.setAutoCommit(false)
                                 Using.resource(con.prepareStatement(
                                   "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))"
                                 )): stmt =>
                                   stmt.setString(1, "orchescala-persistence:test_app.notiz:busy1")
                                   stmt.execute()
                                 con)(con =>
                                 ZIO.attemptBlocking { con.rollback(); con.close() }.orDie
                               )
                      error <- fast.save(notiz, Notiz("busy1", "1700", "y"), Some(1L), None).flip
                    yield error
        after  <- store.flatMap(_.get(notiz, "busy1"))
      yield assertTrue(
        busy == PersistenceError.Busy("notiz", "busy1"),
        after.map(_.version).contains(1L)
      )
    },
    test("checkConnection reports a wrong password at once") {
      for
        config <- ZIO.service[PostgresConfig]
        ok     <- store.flatMap(_.checkConnection).either
        wrong  <-
          ZIO.scoped(
            PostgresEntityStore.scoped(config.copy(password = "wrong")).flatMap(_.checkConnection)
          ).either
      yield assertTrue(ok.isRight, wrong.left.exists(_.isInstanceOf[PersistenceError.StoreError]))
    },
    test(
      "with createTables = false the store runs no DDL - the tables come from PostgresEntityStore.ddl"
    ) {
      for
        config <- ZIO.service[PostgresConfig]
        noDdl   = config.copy(schema = "no_ddl_app", createTables = false)
        result <- ZIO.scoped:
                    PostgresEntityStore.scoped(noDdl).flatMap: s =>
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
        config  <- ZIO.service[PostgresConfig]
        results <- ZIO.scoped:
                     PostgresEntityStore.scoped(config.copy(schema = "parallel_app")).flatMap:
                       fresh =>
                         val parallel = EntityDef[Notiz]("parallel_notiz", _.id)(using notiz.codec)
                         ZIO.foreachPar(1 to 8)(i =>
                           fresh.save(parallel, Notiz(s"f$i", "1", "x"), None, None).either
                         )
      yield assertTrue(results.forall(_.isRight))
    },
    test("schema and table names that are keywords work - they are quoted") {
      for
        config <- ZIO.service[PostgresConfig]
        loaded <- ZIO.scoped:
                    PostgresEntityStore.scoped(config.copy(schema = "user")).flatMap: keyword =>
                      val order = EntityDef[Notiz]("order", _.id)(using notiz.codec)
                      keyword.save(order, Notiz("o1", "1", "x"), None, None) *> keyword.get(
                        order,
                        "o1"
                      )
      yield assertTrue(loaded.map(_.entity.text).contains("x"))
    }
  ).provideShared(postgres.orDie) @@ TestAspect.sequential @@
    (if runTests then TestAspect.identity else TestAspect.ignore)

end PostgresEntityStoreSpec
