package orchescala.engine

import orchescala.engine.inOut.*
import orchescala.engine.json.*

trait ProcessEngine:
  def processInstanceService: ProcessInstanceService
  def historicProcessInstanceService: HistoricProcessInstanceService
  def historicVariableService: HistoricVariableService
  def incidentService: IncidentService
  
  def jProcessInstanceService: JProcessInstanceService

end ProcessEngine
