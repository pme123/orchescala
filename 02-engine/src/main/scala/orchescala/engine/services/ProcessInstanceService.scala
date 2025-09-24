package orchescala.engine.services

import orchescala.domain.*
import orchescala.engine.domain.*
import zio.*

trait ProcessInstanceService extends EngineService:

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
