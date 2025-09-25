package orchescala.engine.gateway

import io.github.iltotore.iron.*
import io.github.iltotore.iron.constraint.collection.*
import orchescala.engine.*
import orchescala.engine.services.*

class GProcessEngine()(
    using
    engineConfig: EngineConfig,
    supportedEngines: Seq[ProcessEngine]
) extends ProcessEngine:

  lazy val processInstanceService: ProcessInstanceService                 =
    GProcessInstanceService(using supportedEngines.map(_.processInstanceService))
  lazy val historicProcessInstanceService: HistoricProcessInstanceService =
    GHistoricProcessInstanceService(using supportedEngines.map(_.historicProcessInstanceService))
  lazy val historicVariableService: HistoricVariableService               =
    GHistoricVariableService(using supportedEngines.map(_.historicVariableService))
  lazy val incidentService: IncidentService                               =
    GIncidentService(using supportedEngines.map(_.incidentService))
  lazy val jobService: JobService                                         =
    GJobService(using supportedEngines.map(_.jobService))
  lazy val messageService: MessageService                                 =
    GMessageService(using supportedEngines.map(_.messageService))
  lazy val signalService: SignalService                                   =
    GSignalService(using supportedEngines.map(_.signalService))
  lazy val userTaskService: UserTaskService                               =
    GUserTaskService(using supportedEngines.map(_.userTaskService))
end GProcessEngine
