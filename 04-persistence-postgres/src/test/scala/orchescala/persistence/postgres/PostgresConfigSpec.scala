package orchescala.persistence.postgres

import orchescala.worker.persistence.EntityDef

import io.circe.Codec
import zio.test.*

object PostgresConfigSpec extends ZIOSpecDefault:

  case class X(id: String) derives Codec

  def spec = suite("PostgresConfig / EntityDef")(
    test("fromEnv reads the connection with the given prefix") {
      val config = PostgresConfig.fromEnv(
        "MYAPP_DB",
        Map(
          "MYAPP_DB_URL"      -> "jdbc:postgresql://db:5432/app",
          "MYAPP_DB_USER"     -> "app",
          "MYAPP_DB_PASSWORD" -> "secret",
          "MYAPP_DB_SCHEMA"   -> "my_app"
        )
      )
      assertTrue(
        config.jdbcUrl == "jdbc:postgresql://db:5432/app",
        config.schema == "my_app",
        config.maximumPoolSize == 5,
        !config.toString.contains("secret")
      )
    },
    test("toString shows neither the password nor the query of the URL") {
      val config =
        PostgresConfig("jdbc:postgresql://db:5432/app?user=x&password=geheim", "app", "secret")
      assertTrue(
        config.toString.contains("jdbc:postgresql://db:5432/app"),
        !config.toString.contains("geheim"),
        !config.toString.contains("secret")
      )
    },
    test("a missing variable names itself") {
      val error = scala.util.Try(PostgresConfig.fromEnv("MYAPP_DB", Map.empty)).failed.get
      assertTrue(error.getMessage.contains("MYAPP_DB_URL"))
    },
    test("an invalid optional variable is an error, not silently the default") {
      val base = Map("X_URL" -> "jdbc:x", "X_USER" -> "u", "X_PASSWORD" -> "p")
      val pool =
        scala.util.Try(PostgresConfig.fromEnv("X", base + ("X_POOL_SIZE" -> "viele"))).failed.get
      val zero = scala.util.Try(PostgresConfig.fromEnv("X", base + ("X_POOL_SIZE" -> "0")))
      val ddl  = PostgresConfig.fromEnv("X", base + ("X_CREATE_TABLES" -> "false"))
      val lock = PostgresConfig.fromEnv(
        "X",
        base + ("X_LOCK_TIMEOUT_MILLIS" -> "250") + ("X_CONNECTION_TIMEOUT_MILLIS" -> "1000")
      )
      val tiny = scala.util.Try(
        PostgresConfig.fromEnv("X", base + ("X_CONNECTION_TIMEOUT_MILLIS" -> "100"))
      )
      assertTrue(
        pool.getMessage.contains("X_POOL_SIZE"),
        zero.isFailure,
        !ddl.createTables,
        lock.lockTimeoutMillis == 250,
        lock.connectionTimeoutMillis == 1000,
        tiny.isFailure // Hikari needs at least 250 ms
      )
    },
    test("table and schema names must be plain identifiers - they go into the SQL") {
      assertTrue(
        scala.util.Try(EntityDef[X]("notiz_v2", _.id)).isSuccess,
        scala.util.Try(EntityDef[X]("notiz; drop table x", _.id)).isFailure,
        scala.util.Try(EntityDef[X]("Notiz", _.id)).isFailure,
        scala.util.Try(EntityDef[X]("a" * 54, _.id)).isSuccess,
        scala.util.Try(EntityDef[X]("a" * 55, _.id)).isFailure,        // + "_history" > 63
        scala.util.Try(EntityDef[X]("notiz_history", _.id)).isFailure, // reserved for the audit log
        scala.util.Try(PostgresConfig("jdbc:x", "u", "p", schema = "a.b")).isFailure
      )
    }
  )
end PostgresConfigSpec
