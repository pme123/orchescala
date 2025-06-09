package orchescala.engine.json

import orchescala.domain.*
import orchescala.engine.EngineError
import orchescala.engine.domain.ProcessInfo
import zio.*

trait JProcessInstanceService:
  def startProcess(
      processDefId: String,
      in: Json,
      businessKey: Option[String]
  ): IO[EngineError, Json]

  def startProcessAsync(
      processDefId: String,
      in: Json,
      businessKey: Option[String]
  ): IO[EngineError, ProcessInfo]

  def sendMessage(
      messageDefId: String,
      in: Json
  ): IO[EngineError, ProcessInfo]

  def sendSignal(
      signalDefId: String,
      in: Json
  ): IO[EngineError, ProcessInfo]
end JProcessInstanceService
