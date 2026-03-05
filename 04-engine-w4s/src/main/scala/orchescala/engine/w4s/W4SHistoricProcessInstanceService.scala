package orchescala.engine.w4s

import orchescala.engine.EngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.HistoricProcessInstanceService
import zio.{IO, ZIO}

class W4SHistoricProcessInstanceService(using
    engineConfig: EngineConfig
) extends HistoricProcessInstanceService, W4SService:

  def getProcessInstance(
      processInstanceId: String
  ): IO[EngineError, HistoricProcessInstance] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine does not support historic process instance queries. Use the W4S workflow state."
    ))

end W4SHistoricProcessInstanceService

