package orchescala.engine.op

import orchescala.engine.*
import orchescala.engine.domain.EngineError
import orchescala.engine.services.*
import org.camunda.community.rest.client.invoker.ApiClient
import zio.{IO, ZIO}

class OpProcessEngine()(
    using
    IO[EngineError, ApiClient],
    EngineConfig
) extends ProcessEngine:

  lazy val processInstanceService: ProcessInstanceService                 =
    OpProcessInstanceService()
  lazy val historicProcessInstanceService: HistoricProcessInstanceService =
    OpHistoricProcessInstanceService()
  lazy val historicVariableService: HistoricVariableService               = OpHistoricVariableService()
  lazy val incidentService: IncidentService                               = OpIncidentService()
  lazy val jobService: JobService                                         = OpJobService()
  lazy val messageService: MessageService                                 = OpMessageService()
  lazy val signalService: SignalService                                   = OpSignalService()
  lazy val userTaskService: UserTaskService                               = OpUserTaskService(OpProcessInstanceService())
end OpProcessEngine

object OpProcessEngine:
  
  /** Creates an OpProcessEngine with the proper client resolved from SharedOpClientManager */
  def withClient(operatonClient: OpClient)(using
                                     engineConfig: EngineConfig
  ): ZIO[SharedOpClientManager, Nothing, OpProcessEngine] =
    OpClient.resolveClient(operatonClient).map : resolvedClient =>
      given IO[EngineError, ApiClient] = resolvedClient

        OpProcessEngine()

