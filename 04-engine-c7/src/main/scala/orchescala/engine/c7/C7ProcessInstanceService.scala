package orchescala.engine
package c7

import orchescala.domain.{InOutDecoder, InOutEncoder}
import orchescala.engine.domain.ProcessInfo
import orchescala.engine.{ProcessEngine, *}
import orchescala.engine.inOut.ProcessInstanceService
import orchescala.engine.json.JProcessInstanceService
import zio.{IO, ZIO}

class C7ProcessInstanceService(jProcessService: JProcessInstanceService) extends ProcessInstanceService:
  
  override def startProcessAsync[In <: Product: InOutEncoder](
      processDefId: String,
      in: In,
      businessKey: Option[String] = None
  ): IO[EngineError, ProcessInfo] =
    jProcessService.startProcessAsync(processDefId, in.asJson, businessKey)
  end startProcessAsync

  def startProcess[In <: Product: InOutEncoder, Out <: Product: InOutDecoder](
      processDefId: String,
      in: In,
      businessKey: Option[String]
  ): IO[EngineError, Out] = ???

  def sendMessage[In <: Product: InOutEncoder](
      messageDefId: String,
      in: In
  ): IO[EngineError, ProcessInfo] = ???

  def sendSignal[In <: Product: InOutEncoder](
      signalDefId: String,
      in: In
  ): IO[EngineError, ProcessInfo] = ???
end C7ProcessInstanceService
