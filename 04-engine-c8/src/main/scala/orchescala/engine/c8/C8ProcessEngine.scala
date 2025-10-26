package orchescala.engine.c8


import io.camunda.client.CamundaClient
import orchescala.engine.*
import orchescala.engine.domain.EngineError
import orchescala.engine.services.*
import zio.*

case class C8ProcessEngine()(
  using
  IO[EngineError, CamundaClient],
  EngineConfig
) extends ProcessEngine:

  lazy val processInstanceService: ProcessInstanceService =
    new C8ProcessInstanceService()
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
    new C8UserTaskService(C8ProcessInstanceService())

end C8ProcessEngine

object C8ProcessEngine:

  /** Creates a C8ProcessEngine with the proper client resolved from SharedC8ClientManager */
  def withClient(c8Client: C8Client)(using engineConfig: EngineConfig): ZIO[SharedC8ClientManager, Nothing, C8ProcessEngine] =
    C8Client.resolveClient(c8Client).map { resolvedClient =>
      given IO[EngineError, CamundaClient] = resolvedClient
      C8ProcessEngine()
    }

