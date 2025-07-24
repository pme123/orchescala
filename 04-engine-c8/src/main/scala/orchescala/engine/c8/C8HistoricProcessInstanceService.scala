package orchescala.engine.c8

import io.camunda.zeebe.client.ZeebeClient
import orchescala.engine.*
import orchescala.engine.domain.HistoricProcessInstance
import orchescala.engine.inOut.HistoricProcessInstanceService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8HistoricProcessInstanceService(using
    zeebeClientZIO: IO[EngineError, ZeebeClient],
    engineConfig: EngineConfig
) extends HistoricProcessInstanceService:

  def getHistoricProcessInstances(processInstanceId: String)
      : IO[EngineError, List[HistoricProcessInstance]] =
    // Note: Zeebe doesn't have a direct historic process instance query API like Camunda 7
    // This would typically require additional implementation or Operate API
    ZIO.succeed(List.empty[HistoricProcessInstance])

  def deleteHistoricProcessInstance(
      processInstanceId: String
  ): IO[EngineError, Unit] =
    // Note: Zeebe doesn't have a direct historic process instance deletion API like Camunda 7
    ZIO.unit

  def getProcessInstance(processInstanceId: String): IO[EngineError, HistoricProcessInstance] = ???
end C8HistoricProcessInstanceService
