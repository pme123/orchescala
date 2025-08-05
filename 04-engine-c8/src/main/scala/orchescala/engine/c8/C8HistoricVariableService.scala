package orchescala.engine.c8

import io.camunda.client.CamundaClient
import orchescala.engine.*
import orchescala.engine.domain.{HistoricVariable}
import orchescala.engine.inOut.HistoricVariableService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8HistoricVariableService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends HistoricVariableService:

  def getVariables(variableName: Option[String], processInstanceId: Option[String]): IO[EngineError, List[HistoricVariable]] = ???