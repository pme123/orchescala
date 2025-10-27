package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.search.enums.ProcessInstanceState
import io.camunda.client.api.search.filter.ProcessInstanceFilter
import io.camunda.client.api.search.response.ProcessInstance
import io.camunda.client.impl.search.filter.ProcessInstanceFilterImpl
import orchescala.engine.*
import orchescala.engine.domain.{EngineError, HistoricProcessInstance}
import orchescala.engine.services.HistoricProcessInstanceService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import java.time.OffsetDateTime
import scala.jdk.CollectionConverters.*

class C8HistoricProcessInstanceService(using
    c8ClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends HistoricProcessInstanceService, C8Service:

  def getProcessInstance(processInstanceId: String): IO[EngineError, HistoricProcessInstance] =
    for
      c8Client        <- c8ClientZIO
      searchResponse  <-
        ZIO
          .attempt:
            c8Client
              .newProcessInstanceGetRequest(processInstanceId.toLong)
              .send()
              .join()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Historic Process Instance '$processInstanceId': $err"
            )
      processInstance <- mapToHistoricProcessInstance(searchResponse)
    yield processInstance

  private def mapToHistoricProcessInstance(
      processInstanceDto: ProcessInstance
  ): IO[EngineError, HistoricProcessInstance] =
    ZIO
      .attempt:
        HistoricProcessInstance(
          id = processInstanceDto.getProcessInstanceKey.toString,
          rootProcessInstanceId = Option(processInstanceDto.getParentProcessInstanceKey).map(_.toString).getOrElse(processInstanceDto.getProcessInstanceKey.toString),
          superProcessInstanceId = Option(processInstanceDto.getParentProcessInstanceKey).map(_.toString),
          processDefinitionName = processInstanceDto.getProcessDefinitionName,
          processDefinitionKey = processInstanceDto.getProcessDefinitionKey.toString,
          processDefinitionVersion = processInstanceDto.getProcessDefinitionVersion,
          processDefinitionId = processInstanceDto.getProcessDefinitionId,
          businessKey = None,  // only supported through variables
          startTime = OffsetDateTime.parse(processInstanceDto.getStartDate),
          endTime = Option(processInstanceDto.getEndDate).map(OffsetDateTime.parse),
          removalTime = None,
          startUserId = None,  // not supported
          deleteReason = None, // not supported
          tenantId = Option(processInstanceDto.getTenantId).filterNot(_ == "<default>"),
          state = mapState(processInstanceDto.getState)
        )
      .mapError: err =>
        EngineError.MappingError(
          s"Problem mapping HistoricProcessInstanceDto to HistoricProcessInstance: $err"
        )

  private def mapState(state: ProcessInstanceState)
      : HistoricProcessInstance.ProcessState =
    import ProcessInstanceState as StateEnum
    import HistoricProcessInstance.ProcessState
    state match
      case StateEnum.ACTIVE             => ProcessState.ACTIVE
      case StateEnum.COMPLETED          => ProcessState.COMPLETED
      case StateEnum.TERMINATED         => ProcessState.TERMINATED
      case StateEnum.UNKNOWN_ENUM_VALUE => ProcessState.UNKNOWN
    end match
  end mapState
end C8HistoricProcessInstanceService
