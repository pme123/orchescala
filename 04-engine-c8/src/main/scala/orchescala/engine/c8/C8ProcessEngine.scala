package orchescala.engine.c8


import io.camunda.client.CamundaClient
import orchescala.engine.*
import orchescala.engine.inOut.*
import orchescala.engine.json.JProcessInstanceService
import zio.*

case class C8ProcessEngine()(
  using
  IO[EngineError, CamundaClient],
  EngineConfig
) extends ProcessEngine:

  lazy val processInstanceService: ProcessInstanceService =
    new C8ProcessInstanceService(jProcessInstanceService)
  lazy val historicProcessInstanceService: HistoricProcessInstanceService =
    new C8HistoricProcessInstanceService()
  lazy val historicVariableService: HistoricVariableService =
    new C8HistoricVariableService()
  lazy val incidentService: IncidentService =
    new C8IncidentService()
  lazy val jobService: JobService =
    new C8JobService()
  lazy val messageService: MessageService =
    new C8MessageService()
  lazy val signalService: SignalService =
    new C8SignalService()
  lazy val userTaskService: UserTaskService =
    new C8UserTaskService()

  lazy val jProcessInstanceService: JProcessInstanceService =
    new JC8ProcessInstanceService()

end C8ProcessEngine

