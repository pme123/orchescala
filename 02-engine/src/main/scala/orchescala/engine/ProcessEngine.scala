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

object ProcessEngine:
  lazy val c7Endpoint = "http://localhost:8080/engine-rest"
  lazy val c7CockpitUrl = "http://localhost:8080/camunda/app/cockpit/default/#/process-instance/"
