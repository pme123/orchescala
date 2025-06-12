package orchescala.engine.json

import orchescala.domain.*
import orchescala.engine.EngineError
import orchescala.engine.domain.ProcessInfo
import zio.*

trait JProcessInstanceService:

  def startProcessAsync(
      processDefId: String,
      in: Json,
      businessKey: Option[String]
  ): IO[EngineError, ProcessInfo]

  def getVariables(
      processInstanceId: String,
      inOut: Product
  ): IO[EngineError, Seq[JsonProperty]]
end JProcessInstanceService
