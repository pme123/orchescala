package orchescala.engine

import orchescala.engine.services.*

trait ProcessEngine:
  def processInstanceService: ProcessInstanceService
  def historicProcessInstanceService: HistoricProcessInstanceService
  def historicVariableService: HistoricVariableService
  def incidentService: IncidentService
  def jobService: JobService
  def messageService: MessageService
  def signalService: SignalService
  def userTaskService: UserTaskService

end ProcessEngine

