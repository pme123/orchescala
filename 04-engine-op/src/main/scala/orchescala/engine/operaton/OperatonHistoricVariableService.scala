package orchescala.engine.operaton

import orchescala.engine.EngineConfig
import orchescala.engine.c7.C7HistoricVariableService
import orchescala.engine.domain.EngineError
import org.camunda.community.rest.client.invoker.ApiClient
import zio.IO

class OperatonHistoricVariableService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends C7HistoricVariableService, OperatonService

