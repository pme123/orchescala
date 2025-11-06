package orchescala.engine.services

import orchescala.domain.*
import orchescala.engine.domain.*
import zio.*

trait HistoricVariableService extends EngineService:
  def getVariables(
      variableName: Option[String] = None,
      processInstanceId: Option[String] = None,
      @description(
        """
          |A List of variable names. Allows restricting the requested variables to the variable names in the list.
          |It is best practice to restrict the list of variables to the variables actually required by the form in order to minimize fetching of data. 
          |If the query parameter is ommitted all variables are fetched.
          |If the query parameter contains non-existent variable names, the variable names are ignored.
          |""".stripMargin
      )
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[HistoricVariable]]
end HistoricVariableService
