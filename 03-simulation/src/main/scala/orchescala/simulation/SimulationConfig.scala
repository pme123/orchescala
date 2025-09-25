package orchescala.simulation

import orchescala.engine.ProcessEngine
import orchescala.engine.domain.{EngineType, ProcessInfo, ProcessResult}

case class SimulationConfig(
    // define tenant if you have one
    tenantId: Option[String] = None,
    // the Camunda Port
    // there are Requests that wait until the process is ready - like getTask.
    // the Simulation waits 1 second between the Requests.
    // so with a timeout of 10 sec it will try 10 times (retryDuration = 1.second)
    maxCount: Int = 10,
    // REST endpoint of Camunda
    endpoint: String = ProcessEngine.c7Endpoint,

    cockpitUrl: String | Map[EngineType, String] = ProcessEngine.c7CockpitUrl,
    // the maximum LogLevel you want to print the LogEntries.
    logLevel: LogLevel = LogLevel.INFO
):

  def cockpitUrl(processResult: ProcessResult): String = {
    println(s"cockpitUrl (${processResult.engineType}): $cockpitUrl")
    cockpitUrl match
      case url: String =>
        url + processResult.processInstanceId
      case urls: Map[EngineType, String] =>
        urls.getOrElse(processResult.engineType, "NOT-SET") + processResult.processInstanceId
  }

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
