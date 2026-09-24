package orchescala.engine.c8

import orchescala.engine.*
import orchescala.engine.domain.{EngineError, HistoricProcessInstance}
import orchescala.engine.services.HistoricProcessInstanceService
import zio.{IO, ZIO}

class C8HistoricProcessInstanceService(using
    rest: C8RestClient,
    engineConfig: EngineConfig
) extends HistoricProcessInstanceService, C8Service:

  def getProcessInstance(processInstanceId: String): IO[EngineError, HistoricProcessInstance] =
    for
      processInstanceKey <- toKey("processInstanceId")(processInstanceId)
      instanceDto        <-
        rest
          .get[C8RestModel.ProcessInstanceResult](Seq("process-instances", processInstanceKey))
          .mapError(withContext(
            s"Problem getting Historic Process Instance '$processInstanceId'"
          ))
    yield mapToHistoricProcessInstance(instanceDto)

  private def mapToHistoricProcessInstance(
      instanceDto: C8RestModel.ProcessInstanceResult
  ): HistoricProcessInstance =
    HistoricProcessInstance(
      id = instanceDto.processInstanceKey,
      rootProcessInstanceId = instanceDto.rootProcessInstanceKey
        .orElse(instanceDto.parentProcessInstanceKey)
        .getOrElse(instanceDto.processInstanceKey),
      superProcessInstanceId = instanceDto.parentProcessInstanceKey,
      processDefinitionName = instanceDto.processDefinitionName.getOrElse(instanceDto.processDefinitionId),
      processDefinitionKey = instanceDto.processDefinitionKey,
      processDefinitionVersion = instanceDto.processDefinitionVersion,
      processDefinitionId = instanceDto.processDefinitionId,
      businessKey = None,  // only supported through variables
      startTime = instanceDto.startDate,
      endTime = instanceDto.endDate,
      removalTime = None,
      startUserId = None,  // not supported
      deleteReason = None, // not supported
      tenantId = instanceDto.tenantId.filterNot(_ == "<default>"),
      state = mapState(instanceDto.state)
    )

  private def mapState(state: String): HistoricProcessInstance.ProcessState =
    import HistoricProcessInstance.ProcessState
    state match
      case "ACTIVE"     => ProcessState.ACTIVE
      case "COMPLETED"  => ProcessState.COMPLETED
      case "TERMINATED" => ProcessState.TERMINATED
      case _            => ProcessState.UNKNOWN
  end mapState
end C8HistoricProcessInstanceService
