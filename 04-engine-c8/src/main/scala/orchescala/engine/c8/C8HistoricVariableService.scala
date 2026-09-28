package orchescala.engine.c8

import orchescala.engine.*
import orchescala.engine.domain.{EngineError, HistoricVariable}
import orchescala.engine.services.HistoricVariableService
import zio.{IO, ZIO}

class C8HistoricVariableService(using
    rest: C8RestClient,
    engineConfig: EngineConfig
) extends HistoricVariableService, C8Service:

  def getVariables(
      variableName: Option[String],
      processInstanceId: Option[String],
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[HistoricVariable]] =
    for
      variableDtos <-
        // root scope only, all pages, full values - see searchVariables
        searchVariables(processInstanceId, variableNames(variableName, variableFilter))
          .mapError(withContext(
            s"Problem getting Historic Variables for Process Instance '${processInstanceId.mkString}'"
          ))
      _            <- ZIO.logDebug(s"VariableDtos found: ${variableDtos.map(_.name).mkString(", ")}")
    yield mapToHistoricVariables(variableFilter, variableDtos)

  private def mapToHistoricVariables(
      variableFilter: Option[Seq[String]],
      variableDtos: Seq[C8RestModel.VariableResult]
  ): Seq[HistoricVariable] =
    filterVariables(variableFilter, variableDtos)
      .map: dto =>
        HistoricVariable(
          id = dto.variableKey,
          name = dto.name,
          value = mapToJson(dto),
          processDefinitionKey = None, // not supported
          processDefinitionId = None,  // not supported
          processInstanceId = dto.processInstanceKey,
          activityInstanceId = None,   // not supported
          taskId = None,               // not supported
          tenantId = dto.tenantId,
          errorMessage = None,         // not supported
          state = None,                // not supported
          createTime = None,           // not supported
          removalTime = None,          // not supported
          rootProcessInstanceId = None // not supported
        )
  end mapToHistoricVariables

  private def mapToJson(histVar: C8RestModel.VariableResult): Option[Json] =
    histVar.value.map(parser.parse) match
      case None                         => None
      case Some(Right(v)) if v.isNull   => None
      case Some(Right(v))               => Some(v)
      case Some(Left(exc))              =>
        Some(s"Problem parsing Variable from Camunda ${histVar.name} - ${histVar.value.orNull}: $exc".asJson)

end C8HistoricVariableService
