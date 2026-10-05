package orchescala.persistence.postgres

import orchescala.worker.persistence.EntityDef

/** Connection of a worker app to its database.
  *
  * Each worker app has its own schema - no database is shared between apps, and the data of the
  * process engine is separate.
  */
case class PostgresConfig(
    jdbcUrl: String,
    username: String,
    password: String,
    schema: String = "public",
    maximumPoolSize: Int = 5,
    /** Create schema and tables on first use. Set it to false if the database user of the app has
      * no DDL rights (e.g. only `INSERT, SELECT` on the history tables) - the tables are then
      * created by the DBA with the statements of `PostgresEntityStore`.
      */
    createTables: Boolean = true,
    /** How long a change waits for another change of the same entity - then it fails with
      * [[PersistenceError.Busy]] instead of holding a pooled connection for longer.
      */
    lockTimeoutMillis: Int = 5000,
    /** How long a request waits for a connection of the pool - a full pool or an unreachable
      * database fails after this, not after Hikari's 30 s.
      */
    connectionTimeoutMillis: Int = 3000
):
  require(EntityDef.isValidTable(schema), s"Invalid schema name '$schema'")

  // without the query of the URL - it may carry a password (`?password=…`)
  override def toString: String =
    s"PostgresConfig(${jdbcUrl.takeWhile(_ != '?')}, user $username, schema $schema, " +
      s"pool $maximumPoolSize, createTables $createTables)"
end PostgresConfig

object PostgresConfig:

  /** Reads `{prefix}_URL`, `{prefix}_USER`, `{prefix}_PASSWORD` and optionally `{prefix}_SCHEMA`,
    * `{prefix}_POOL_SIZE`, `{prefix}_CREATE_TABLES`, `{prefix}_LOCK_TIMEOUT_MILLIS` - e.g.
    * `PostgresConfig.fromEnv("MYAPP_DB")`. A set but invalid value is an error, like a missing
    * required one.
    */
  def fromEnv(prefix: String, env: Map[String, String] = sys.env): PostgresConfig =
    def name(key: String)                                                = s"${prefix}_$key"
    def required(key: String)                                            =
      env.getOrElse(name(key), throw IllegalArgumentException(s"${name(key)} is not set"))
    def optional[A](key: String, default: A)(parse: String => Option[A]) =
      env.get(name(key)).fold(default): value =>
        parse(value).getOrElse(throw IllegalArgumentException(s"${name(key)} is invalid: '$value'"))
    PostgresConfig(
      jdbcUrl = required("URL"),
      username = required("USER"),
      password = required("PASSWORD"),
      schema = env.getOrElse(name("SCHEMA"), "public"),
      maximumPoolSize = optional("POOL_SIZE", 5)(_.toIntOption.filter(_ > 0)),
      createTables = optional("CREATE_TABLES", true)(_.toBooleanOption),
      lockTimeoutMillis = optional("LOCK_TIMEOUT_MILLIS", 5000)(_.toIntOption.filter(_ > 0)),
      // Hikari needs at least 250 ms
      connectionTimeoutMillis =
        optional("CONNECTION_TIMEOUT_MILLIS", 3000)(_.toIntOption.filter(_ >= 250))
    )
  end fromEnv
end PostgresConfig
