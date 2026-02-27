package orchescala.engine.op

import orchescala.engine.EngineConfig
import orchescala.engine.c7.C7UserTaskService
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiClient
import zio.IO

class OpUserTaskService(override val processInstanceService: OpProcessInstanceService)(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends C7UserTaskService(processInstanceService), OpService

