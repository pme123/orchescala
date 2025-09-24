package orchescala.engine.services

import orchescala.domain.*
import orchescala.engine.EngineError
import orchescala.engine.domain.ProcessInfo
import zio.*

trait ProcessInstanceService:

  def startProcessAsync(
                         processDefId: String,
                         in: Json,
                         businessKey: Option[String]
                       ): IO[EngineError, ProcessInfo]

  def getVariables(
                    processInstanceId: String,
                    inOut: Product
                  ): IO[EngineError, Seq[JsonProperty]]

end ProcessInstanceService
