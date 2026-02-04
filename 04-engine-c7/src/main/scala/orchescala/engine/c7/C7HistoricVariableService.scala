package orchescala.engine
package c7

import orchescala.domain.*
import orchescala.engine.domain.{EngineError, HistoricVariable}
import orchescala.engine.services.HistoricVariableService
import org.camunda.community.rest.client.api.HistoricVariableInstanceApi
import org.camunda.community.rest.client.dto.{HistoricVariableInstanceDto, HistoricVariableInstanceQueryDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

import java.util
import scala.collection.JavaConverters.seqAsJavaListConverter

class C7HistoricVariableService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends HistoricVariableService, C7Service:

  def getVariables(
      variableName: Option[String],
      processInstanceId: Option[String],
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[HistoricVariable]] =
    for
      apiClient    <- apiClientZIO
      dto = new HistoricVariableInstanceQueryDto()
        .variableName(variableName.orNull)
        .processInstanceId(processInstanceId.orNull)
        .executionIdIn(Seq(processInstanceId.orNull).asJava)
      variableDtos <-
        ZIO
          .attempt:
            new HistoricVariableInstanceApi(apiClient)
              .queryHistoricVariableInstances(null, null, true, dto)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Historic Process Instance '$processInstanceId': $err"
            )
      variables    <-
        ZIO
          .attempt:
            mapToHistoricVariables(variableFilter, variableDtos)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem mapping Historic Variables for Process Instance '${processInstanceId.mkString}': $err"
            )
    yield variables

  private def mapToHistoricVariables(
      variableFilter: Option[Seq[String]],
      variableDtos: java.util.List[HistoricVariableInstanceDto]
  ): Seq[HistoricVariable] =
    import scala.jdk.CollectionConverters.*

    variableDtos.asScala.toSeq
      .filter: dto =>
        variableFilter.isEmpty ||
          (dto.getValue != null &&
            variableFilter.toSeq.flatten.contains(dto.getName))
      .map: dto =>
        HistoricVariable(
          id = dto.getId,
          name = dto.getName,
          value = mapToJson(dto),
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

  private def mapToJson(histVar: HistoricVariableInstanceDto): Option[Json] =
    histVar.getType.toLowerCase match
      case "null" => None
      case "json" => Some(toJson(histVar.getValue.toString))
      case _ => Option(histVar.getValue).map(CamundaVariable.valueToCamunda).map(_.toJson)
end C7HistoricVariableService
