package orchescala.engine.services

import orchescala.engine.domain.*
import zio.IO

trait HistoricVariableService  extends EngineService:
  def getVariables(
      variableName: Option[String] = None,
      processInstanceId: Option[String] = None,
  ): IO[EngineError, Seq[HistoricVariable]]
end HistoricVariableService
