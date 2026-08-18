package orchescala.dmntester.server

/** How a project runs the tester - see `DmnTesterStarter`. */
case class DmnTesterServerConfig(
    // where the *.conf test definitions are (relative to the working directory)
    configPaths: Seq[String],
    // the port the DMN Tester is served on - e.g. http://localhost:8883
    port: Int = 8883,
    // which app started the tester - shown on /info, so a second project
    // notices that the port is taken by someone else
    startingApp: String = "DMN Tester"
)

object DmnTesterServerConfig:

  /** the fallback for a standalone start: `TESTER_CONFIG_PATHS` */
  lazy val fromEnv: DmnTesterServerConfig =
    val paths = sys.props
      .get("TESTER_CONFIG_PATHS")
      .orElse(sys.env.get("TESTER_CONFIG_PATHS"))
      .map(_.split(",").map(_.trim).filter(_.nonEmpty).toSeq)
      .getOrElse(Seq("dmnConfigs"))
    DmnTesterServerConfig(
      configPaths = paths,
      startingApp = sys.env.getOrElse("STARTING_APP", "DMN Tester")
    )
