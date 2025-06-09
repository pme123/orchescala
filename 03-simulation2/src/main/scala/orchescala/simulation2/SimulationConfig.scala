package orchescala.simulation2

case class SimulationConfig(
    // define tenant if you have one
    tenantId: Option[String] = None,
    // the Camunda Port
    // there are Requests that wait until the process is ready - like getTask.
    // the Simulation waits 1 second between the Requests.
    // so with a timeout of 10 sec it will try 10 times (retryDuration = 1.second)
    maxCount: Int = 10,
    // REST endpoint of Camunda
    endpoint: String = "http://localhost:8080/engine-rest",
    // the maximum LogLevel you want to print the LogEntries.
    logLevel: LogLevel = LogLevel.INFO
):

  lazy val cockpitUrl: String =
    endpoint.replace("/engine-rest", "/camunda/app/cockpit/default")

  def withTenantId(tenantId: String): SimulationConfig =
    copy(tenantId = Some(tenantId))

  def withMaxCount(maxCount: Int): SimulationConfig =
    copy(maxCount = maxCount)

  def withPort(port: Int): SimulationConfig =
    copy(endpoint = s"http://localhost:$port/engine-rest")

  def withLogLevel(logLevel: LogLevel): SimulationConfig =
    copy(logLevel = logLevel)

  lazy val tenantPath: String = tenantId
    .map(id => s"/tenant-id/$id")
    .getOrElse("")
end SimulationConfig
