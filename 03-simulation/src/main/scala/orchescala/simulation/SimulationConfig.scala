package orchescala.simulation

import orchescala.engine.{DefaultEngineConfig, EngineConfig, ProcessEngine}
import orchescala.engine.domain.{EngineType, ProcessResult}
import sttp.tapir.Schema.annotations.description

sealed trait SimulationConfig:
  def engineConfig: EngineConfig
  @description("define tenant if you have one")
  def tenantId: Option[String]
  @description(
    """there are Requests that wait until the process is ready - like getTask.
      |the Simulation waits 1 second between the Requests.
      |so with a timeout of 10 sec it will try 10 times (retryDuration = 1.second)""".stripMargin
  )
  def maxCount: Int
  @description(
    "Cockpit URL - to provide a link to the process instance. you can provide a different URL for each engine type with a Map"
  )
  def cockpitUrl: String | Map[EngineType, String]
  @description("the maximum LogLevel you want to print the LogEntries")
  def logLevel: LogLevel

  def cockpitUrl(processResult: ProcessResult): String =
    println(
      s"cockpitUrl (${processResult.engineType}): $cockpitUrl${processResult.processInstanceId}"
    )
    cockpitUrl match
      case url: String                   =>
        url + processResult.processInstanceId
      case urls: Map[EngineType, String] =>
        urls.getOrElse(processResult.engineType, "NOT-SET") + processResult.processInstanceId
    end match
  end cockpitUrl

  def withTenantId(tenantId: String): SimulationConfig

  def withMaxCount(maxCount: Int): SimulationConfig

  def withLogLevel(logLevel: LogLevel): SimulationConfig

  def validateProcess(doValidate: Boolean): SimulationConfig

  lazy val tenantPath: String = tenantId
    .map(id => s"/tenant-id/$id")
    .getOrElse("")
end SimulationConfig

case class DefaultSimulationConfig(
    engineConfig: EngineConfig = DefaultEngineConfig(),
    tenantId: Option[String] = None,
    maxCount: Int = 10,
    logLevel: LogLevel = LogLevel.INFO,
    cockpitUrl: String | Map[EngineType, String]
) extends SimulationConfig:

  def withTenantId(tenantId: String): SimulationConfig =
    copy(tenantId = Some(tenantId))

  def withMaxCount(maxCount: Int): SimulationConfig =
    copy(maxCount = maxCount)

  def withLogLevel(logLevel: LogLevel): SimulationConfig =
    copy(logLevel = logLevel)

  def validateProcess(doValidate: Boolean): SimulationConfig =
    copy(engineConfig = engineConfig.validateProcess(doValidate))
end DefaultSimulationConfig
