package orchescala.engine.inOut

import orchescala.engine.EngineError
import orchescala.engine.domain.HistoricProcessInstance
import zio.IO

trait HistoricProcessInstanceService :
  
  def getProcessInstance(
                          processInstanceId: String
                        ): IO[EngineError, HistoricProcessInstance]
