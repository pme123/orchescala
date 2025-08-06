package orchescala.engine.inOut

import orchescala.domain.*
import orchescala.engine.EngineError
import orchescala.engine.domain.ProcessInfo
import zio.*

trait ProcessInstanceService:

  def startProcessAsync[In <: Product: InOutEncoder](
      processDefId: String,
      in: In,
      businessKey: Option[String]
  ): IO[EngineError, ProcessInfo]

  def getVariables[Out <: Product: InOutDecoder](
      processInstanceId: String,
      inOut: Out // to filter all variables
  ): IO[EngineError, Out]

end ProcessInstanceService
