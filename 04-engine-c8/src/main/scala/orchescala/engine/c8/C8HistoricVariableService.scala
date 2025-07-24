package orchescala.engine.c8

import io.camunda.zeebe.client.ZeebeClient
import orchescala.engine.*
import orchescala.engine.domain.{HistoricVariable}
import orchescala.engine.inOut.HistoricVariableService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8HistoricVariableService(using
    zeebeClientZIO: IO[EngineError, ZeebeClient],
    engineConfig: EngineConfig
) extends HistoricVariableService:

  def getVariables(variableName: Option[String], processInstanceId: Option[String]): IO[EngineError, List[HistoricVariable]] = ???