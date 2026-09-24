package orchescala.engine.c8

import orchescala.engine.*
import orchescala.engine.services.*
import zio.*

case class C8ProcessEngine()(
  using
  C8RestClient,
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
    new C8UserTaskService()
  lazy val deploymentService: DeploymentService =
    new C8DeploymentService()

end C8ProcessEngine

object C8ProcessEngine:

  /** Creates a C8ProcessEngine whose services call the cluster over the client's REST API.
    *
    * The `SharedC8ClientManager` environment is no longer used by the engine services (only by the
    * job workers) - it stays in the signature for compatibility.
    */
  def withClient(c8Client: C8Client)(using engineConfig: EngineConfig): ZIO[SharedC8ClientManager, Nothing, C8ProcessEngine] =
    ZIO.succeed:
      given C8RestClient = c8Client.restClient
      C8ProcessEngine()
