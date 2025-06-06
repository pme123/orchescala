package orchescala
package engine

import orchescala.domain.*
import zio.*

trait ProcessService:
  def startProcess[In <: Product: InOutEncoder, Out <: Product: InOutDecoder](
      processDefId: String,
      in: In,
      businessKey: Option[String]
  ): IO[EngineError, Out]

  def startProcessAsync[In <: Product: InOutEncoder](
      processDefId: String,
      in: In,
      businessKey: Option[String]
  ): IO[EngineError, EngineProcessInfo]

  def sendMessage[In <: Product: InOutEncoder](
      messageDefId: String,
      in: In
  ): IO[EngineError, EngineProcessInfo]

  def sendSignal[In <: Product: InOutEncoder](
      signalDefId: String,
      in: In
  ): IO[EngineError, EngineProcessInfo]
end ProcessService
