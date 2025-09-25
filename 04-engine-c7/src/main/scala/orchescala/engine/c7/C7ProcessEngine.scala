package orchescala.engine.c7

import orchescala.engine.*
import orchescala.engine.domain.EngineError
import orchescala.engine.services.*
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

class C7ProcessEngine()(
    using
    IO[EngineError, ApiClient],
    EngineConfig
) extends ProcessEngine:

  lazy val processInstanceService: ProcessInstanceService                 =
    C7ProcessInstanceService()
  lazy val historicProcessInstanceService: HistoricProcessInstanceService =
    C7HistoricProcessInstanceService()
  lazy val historicVariableService: HistoricVariableService               = C7HistoricVariableService()
  lazy val incidentService: IncidentService                               = C7IncidentService()
  lazy val jobService: JobService                                         = C7JobService()
  lazy val messageService: MessageService                                 = C7MessageService()
  lazy val signalService: SignalService                                   = C7SignalService()
  lazy val userTaskService: UserTaskService                               = C7UserTaskService()
end C7ProcessEngine

object C7ProcessEngine:
  
  /** Creates a C7ProcessEngine with the proper client resolved from SharedC7ClientManager */
  def withClient(c7Client: C7Client)(using
                                     engineConfig: EngineConfig
  ): ZIO[SharedC7ClientManager, Nothing, C7ProcessEngine] =
    C7Client.resolveClient(c7Client).map { resolvedClient =>
      given IO[EngineError, ApiClient] = resolvedClient

      C7ProcessEngine()
    }
