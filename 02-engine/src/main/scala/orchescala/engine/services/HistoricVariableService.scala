package orchescala.engine.services

import orchescala.engine.EngineError
import orchescala.engine.domain.HistoricVariable
import zio.IO

trait HistoricVariableService :
  def getVariables(
      variableName: Option[String] = None,
      processInstanceId: Option[String] = None,
  ): IO[EngineError, Seq[HistoricVariable]]
end HistoricVariableService
