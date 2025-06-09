package orchescala.engine.inOut

import orchescala.domain.*
import orchescala.engine.EngineError
import orchescala.engine.domain.ProcessInfo
import zio.*

trait ProcessInstanceService:

  def startProcess[In <: Product: InOutEncoder, Out <: Product: InOutDecoder](
      processDefId: String,
      in: In,
      businessKey: Option[String]
  ): IO[EngineError, Out]

  def startProcessAsync[In <: Product: InOutEncoder](
      processDefId: String,
      in: In,
      businessKey: Option[String]
  ): IO[EngineError, ProcessInfo]

  def sendMessage[In <: Product: InOutEncoder](
      messageDefId: String,
      in: In
  ): IO[EngineError, ProcessInfo]

  def sendSignal[In <: Product: InOutEncoder](
      signalDefId: String,
      in: In
  ): IO[EngineError, ProcessInfo]
end ProcessInstanceService
