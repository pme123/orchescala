package orchescala.engine
package c7

import orchescala.domain.CamundaVariable
import orchescala.domain.CamundaVariable.*
import orchescala.engine.domain.{EngineError, HistoricVariable}
import orchescala.engine.services.HistoricVariableService
import org.camunda.community.rest.client.api.HistoricVariableInstanceApi
import org.camunda.community.rest.client.dto.HistoricVariableInstanceDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

class C7HistoricVariableService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends HistoricVariableService, C7Service:

  def getVariables(
      variableName: Option[String],
      processInstanceId: Option[String]
  ): IO[EngineError, Seq[HistoricVariable]] =
    for
      apiClient    <- apiClientZIO
      variableDtos <-
        ZIO
          .attempt:
            new HistoricVariableInstanceApi(apiClient)
              .getHistoricVariableInstances(
                variableName.orNull,      // variableName
                null,                     // variableNameLike
                null,                     // variableValue
                false,                    // variableNamesIgnoreCase
                null,                     // variableValuesIgnoreCase
                null,                     // variableTypeIn
                null,                     // includeDeleted
                processInstanceId.orNull, // processInstanceId
                null,                     // processInstanceIdIn
                null,                     // processDefinitionId
                null,                     // processDefinitionKey
                processInstanceId.orNull, // executionIdIn -> this makes sure only public variables are taken
                null,                     // caseInstanceId
                null,                     // caseExecutionIdIn
                null,                     // caseActivityIdIn
                null,                     // taskIdIn
                null,                     // activityInstanceIdIn
                null,                     // tenantIdIn
                null,                     // withoutTenantId
                null,                     // variableNameIn
                null,                     // sortBy
                null,                     // sortOrder
                null,                     // firstResult
                null,                     // maxResults
                false
              )
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Historic Process Instance '$processInstanceId': ${err.getMessage}"
            )
      variables    <-
        ZIO
          .attempt:
            mapToHistoricVariables(variableDtos)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem mapping Historic Variables for Process Instance '$processInstanceId': ${err.getMessage}"
            )
    yield variables

  private def mapToHistoricVariables(
      variableDtos: java.util.List[HistoricVariableInstanceDto]
  ): Seq[HistoricVariable] =
    import scala.jdk.CollectionConverters.*

    variableDtos.asScala.toSeq.map: dto =>
      HistoricVariable(
        id = dto.getId,
        name = dto.getName,
        value = mapToCamundaVariable(dto),
        processDefinitionKey = Option(dto.getProcessDefinitionKey),
        processDefinitionId = Option(dto.getProcessDefinitionId),
        processInstanceId = Option(dto.getProcessInstanceId),
        activityInstanceId = Option(dto.getActivityInstanceId),
        taskId = Option(dto.getTaskId),
        tenantId = Option(dto.getTenantId),
        errorMessage = Option(dto.getErrorMessage),
        state = Option(dto.getState),
        createTime = Option(dto.getCreateTime),
        removalTime = Option(dto.getRemovalTime),
        rootProcessInstanceId = Option(dto.getRootProcessInstanceId)
      )
  end mapToHistoricVariables

  private def mapToCamundaVariable(histVar: HistoricVariableInstanceDto) =
    histVar.getType.toLowerCase match
      case "null" => None
      case "json" => Option(CJson(histVar.getValue.toString))
      case _      => Option(histVar.getValue).map(CamundaVariable.valueToCamunda)
end C7HistoricVariableService
