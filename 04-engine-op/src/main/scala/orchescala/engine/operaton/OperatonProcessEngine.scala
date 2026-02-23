package orchescala.engine.operaton

import orchescala.engine.*
import orchescala.engine.domain.EngineError
import orchescala.engine.services.*
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

class OperatonProcessEngine()(
    using
    IO[EngineError, ApiClient],
    EngineConfig
) extends ProcessEngine:

  lazy val processInstanceService: ProcessInstanceService                 =
    OperatonProcessInstanceService()
  lazy val historicProcessInstanceService: HistoricProcessInstanceService =
    OperatonHistoricProcessInstanceService()
  lazy val historicVariableService: HistoricVariableService               = OperatonHistoricVariableService()
  lazy val incidentService: IncidentService                               = OperatonIncidentService()
  lazy val jobService: JobService                                         = OperatonJobService()
  lazy val messageService: MessageService                                 = OperatonMessageService()
  lazy val signalService: SignalService                                   = OperatonSignalService()
  lazy val userTaskService: UserTaskService                               = OperatonUserTaskService(OperatonProcessInstanceService())
end OperatonProcessEngine

object OperatonProcessEngine:
  
  /** Creates an OperatonProcessEngine with the proper client resolved from SharedOperatonClientManager */
  def withClient(operatonClient: OperatonClient)(using
                                     engineConfig: EngineConfig
  ): ZIO[SharedOperatonClientManager, Nothing, OperatonProcessEngine] =
    OperatonClient.resolveClient(operatonClient).map : resolvedClient =>
      given IO[EngineError, ApiClient] = resolvedClient

        OperatonProcessEngine()

