package orchescala.engine.services

import orchescala.engine.domain.*
import zio.IO

trait HistoricProcessInstanceService extends EngineService:
  def engineType: EngineType
  
  def getProcessInstance(
                          processInstanceId: String
                        ): IO[EngineError, HistoricProcessInstance]
