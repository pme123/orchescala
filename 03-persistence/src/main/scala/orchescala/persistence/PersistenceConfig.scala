package orchescala.persistence

/** Connection of a worker app to its database.
  *
  * Each worker app has its own schema - no database is shared between apps, and the data of the
  * process engine is separate.
  */
case class PersistenceConfig(
    jdbcUrl: String,
    username: String,
    password: String,
    schema: String = "public",
    maximumPoolSize: Int = 5,
    /** Create schema and tables on first use. Set it to false if the database user of the app has
      * no DDL rights (e.g. only `INSERT, SELECT` on the history tables) - the tables are then
      * created by the DBA with the statements of `PostgresEntityStore`.
      */
    createTables: Boolean = true
):
  require(EntityDef.isValidTable(schema), s"Invalid schema name '$schema'")

  override def toString: String =
    s"PersistenceConfig($jdbcUrl, user $username, schema $schema, pool $maximumPoolSize, createTables $createTables)"
end PersistenceConfig

object PersistenceConfig:

  /** Reads `{prefix}_URL`, `{prefix}_USER`, `{prefix}_PASSWORD` and optionally `{prefix}_SCHEMA`,
    * `{prefix}_POOL_SIZE`, `{prefix}_CREATE_TABLES` - e.g. `PersistenceConfig.fromEnv("MYAPP_DB")`.
    * A set but invalid value is an error, like a missing required one.
    */
  def fromEnv(prefix: String, env: Map[String, String] = sys.env): PersistenceConfig =
    def name(key: String) = s"${prefix}_$key"
    def required(key: String) =
      env.getOrElse(name(key), throw IllegalArgumentException(s"${name(key)} is not set"))
    def optional[A](key: String, default: A)(parse: String => Option[A]) =
      env.get(name(key)).fold(default): value =>
        parse(value).getOrElse(throw IllegalArgumentException(s"${name(key)} is invalid: '$value'"))
    PersistenceConfig(
      jdbcUrl = required("URL"),
      username = required("USER"),
      password = required("PASSWORD"),
      schema = env.getOrElse(name("SCHEMA"), "public"),
      maximumPoolSize = optional("POOL_SIZE", 5)(_.toIntOption.filter(_ > 0)),
      createTables = optional("CREATE_TABLES", true)(_.toBooleanOption)
    )
  end fromEnv
end PersistenceConfig
