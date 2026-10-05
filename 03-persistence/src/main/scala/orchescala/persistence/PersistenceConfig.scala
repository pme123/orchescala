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
    maximumPoolSize: Int = 5
):
  require(EntityDef.isValidTable(schema), s"Invalid schema name '$schema'")

  override def toString: String =
    s"PersistenceConfig($jdbcUrl, user $username, schema $schema, pool $maximumPoolSize)"
end PersistenceConfig

object PersistenceConfig:

  /** Reads `{prefix}_URL`, `{prefix}_USER`, `{prefix}_PASSWORD` and optionally `{prefix}_SCHEMA`,
    * `{prefix}_POOL_SIZE` - e.g. `PersistenceConfig.fromEnv("MYAPP_DB")`.
    */
  def fromEnv(prefix: String, env: Map[String, String] = sys.env): PersistenceConfig =
    def required(name: String) =
      env.getOrElse(s"${prefix}_$name", throw IllegalArgumentException(s"${prefix}_$name is not set"))
    PersistenceConfig(
      jdbcUrl = required("URL"),
      username = required("USER"),
      password = required("PASSWORD"),
      schema = env.getOrElse(s"${prefix}_SCHEMA", "public"),
      maximumPoolSize = env.get(s"${prefix}_POOL_SIZE").flatMap(_.toIntOption).getOrElse(5)
    )
  end fromEnv
end PersistenceConfig
