package orchescala.engine

import orchescala.engine.inOut.*
import orchescala.engine.json.*

trait ProcessEngine:
  def processInstanceService: ProcessInstanceService
  def historicProcessInstanceService: HistoricProcessInstanceService
  def historicVariableService: HistoricVariableService
  def incidentService: IncidentService
  def jobService: JobService
  def messageService: MessageService
  def signalService: SignalService
  def userTaskService: UserTaskService
  
  def jProcessInstanceService: JProcessInstanceService

end ProcessEngine
