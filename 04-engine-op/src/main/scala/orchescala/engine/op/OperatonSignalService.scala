package orchescala.engine.op

import orchescala.engine.EngineConfig
import orchescala.engine.c7.C7SignalService
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiClient
import zio.IO

class OperatonSignalService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends C7SignalService, OperatonEventService

