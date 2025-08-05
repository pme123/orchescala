package orchescala.engine.c7

import orchescala.engine.domain.HistoricProcessInstance
import orchescala.engine.inOut.HistoricProcessInstanceService
import orchescala.engine.{EngineConfig, EngineError}
import org.camunda.community.rest.client.api.HistoricProcessInstanceApi
import org.camunda.community.rest.client.dto.HistoricProcessInstanceDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

class C7HistoricProcessInstanceService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends HistoricProcessInstanceService:

  def getProcessInstance(processInstanceId: String): IO[EngineError, HistoricProcessInstance] =
    for
      apiClient          <- apiClientZIO
      processInstanceDto <-
        ZIO
          .attempt:
            new HistoricProcessInstanceApi(apiClient)
              .getHistoricProcessInstance(processInstanceId)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Historic Process Instance '$processInstanceId': ${err.getMessage}"
            )
      processInstance    <- mapToHistoricProcessInstance(processInstanceDto)
    yield processInstance

  private def mapToHistoricProcessInstance(
      processInstanceDto: org.camunda.community.rest.client.dto.HistoricProcessInstanceDto
  ): IO[EngineError, HistoricProcessInstance] =
    ZIO
      .attempt:
        HistoricProcessInstance(
          id = processInstanceDto.getId,
          rootProcessInstanceId = processInstanceDto.getRootProcessInstanceId,
          superProcessInstanceId = Option(processInstanceDto.getSuperProcessInstanceId),
          processDefinitionName = processInstanceDto.getProcessDefinitionName,
          processDefinitionKey = processInstanceDto.getProcessDefinitionKey,
          processDefinitionVersion = processInstanceDto.getProcessDefinitionVersion,
          processDefinitionId = processInstanceDto.getProcessDefinitionId,
          businessKey = Option(processInstanceDto.getBusinessKey),
          startTime = processInstanceDto.getStartTime,
          endTime = Option(processInstanceDto.getEndTime),
          removalTime = Option(processInstanceDto.getRemovalTime),
          startUserId = Option(processInstanceDto.getStartUserId),
          deleteReason = Option(processInstanceDto.getDeleteReason),
          tenantId = Option(processInstanceDto.getTenantId),
          state = mapState(processInstanceDto.getState)
        )
      .mapError: err =>
        EngineError.MappingError(
          s"Problem mapping HistoricProcessInstanceDto to HistoricProcessInstance: ${err.getMessage}"
        )
  private def mapState(state: HistoricProcessInstanceDto.StateEnum)
      : HistoricProcessInstance.ProcessState =
    import HistoricProcessInstanceDto.StateEnum
    import HistoricProcessInstance.ProcessState
    state match
      case StateEnum.ACTIVE                => ProcessState.ACTIVE
      case StateEnum.COMPLETED             => ProcessState.COMPLETED
      case StateEnum.EXTERNALLY_TERMINATED => ProcessState.TERMINATED
      case StateEnum.INTERNALLY_TERMINATED => ProcessState.TERMINATED
      case StateEnum.SUSPENDED             => ProcessState.SUSPENDED
    end match
  end mapState
end C7HistoricProcessInstanceService
