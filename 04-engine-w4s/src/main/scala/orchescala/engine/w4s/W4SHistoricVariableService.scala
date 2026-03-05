package orchescala.engine.w4s

import orchescala.domain.*
import orchescala.engine.EngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.HistoricVariableService
import zio.{IO, ZIO}

class W4SHistoricVariableService(using
    engineConfig: EngineConfig
) extends HistoricVariableService, W4SService:

  def getVariables(
      variableName: Option[String] = None,
      processInstanceId: Option[String] = None,
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[HistoricVariable]] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine does not support historic variable queries. Use the W4S workflow state."
    ))

end W4SHistoricVariableService

