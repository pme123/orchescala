package orchescala.engine.c7

import orchescala.engine.*
import orchescala.engine.inOut.*
import orchescala.engine.json.*
import org.camunda.community.rest.client.invoker.ApiClient
import zio.IO

class C7ProcessEngine()(
    using
    IO[EngineError, ApiClient],
    EngineConfig
) extends ProcessEngine:

  lazy val processInstanceService: ProcessInstanceService                 =
    new C7ProcessInstanceService(jProcessInstanceService)
  lazy val historicProcessInstanceService: HistoricProcessInstanceService =
    new C7HistoricProcessInstanceService()
  lazy val historicVariableService: HistoricVariableService               = new C7HistoricVariableService()
  lazy val incidentService: IncidentService = new C7IncidentService()    
  lazy val jobService: JobService = new C7JobService()    
  lazy val signalService: SignalService = new C7SignalService()
  lazy val userTaskService: UserTaskService = new C7UserTaskService()

  lazy val jProcessInstanceService: JProcessInstanceService = new JC7ProcessInstanceService()
end C7ProcessEngine
