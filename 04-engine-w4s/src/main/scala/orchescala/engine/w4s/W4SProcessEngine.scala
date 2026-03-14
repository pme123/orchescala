package orchescala.engine.w4s

import orchescala.engine.*
import orchescala.engine.services.*
import zio.ZIO

/** ProcessEngine implementation for Workflows4s (W4S).
  *
  * W4S is an in-process workflow engine - workflows are defined and executed in Scala code,
  * not via external BPMN engines. The service implementations return appropriate errors
  * for BPMN-specific operations that don't apply to W4S.
  *
  * The actual workflow execution is handled by the W4S runtime directly,
  * not through the traditional ProcessEngine REST-based service interface.
  */
class W4SProcessEngine()(using
    engineConfig: EngineConfig
) extends ProcessEngine:

  lazy val processInstanceService: ProcessInstanceService =
    W4SProcessInstanceService()
  lazy val historicProcessInstanceService: HistoricProcessInstanceService =
    W4SHistoricProcessInstanceService()
  lazy val historicVariableService: HistoricVariableService =
    W4SHistoricVariableService()
  lazy val incidentService: IncidentService =
    W4SIncidentService()
  lazy val jobService: JobService =
    W4SJobService()
  lazy val messageService: MessageService =
    W4SMessageService()
  lazy val signalService: SignalService =
    W4SSignalService()
  lazy val userTaskService: UserTaskService =
    W4SUserTaskService(W4SProcessInstanceService())

end W4SProcessEngine

object W4SProcessEngine:
  /** Creates an OpProcessEngine with the proper client resolved from SharedOpClientManager */
  def withClient()(using
                                           engineConfig: EngineConfig
  ): ZIO[SharedW4SClientManager, Nothing, W4SProcessEngine] = ???
  //  OpClient.resolveClient(operatonClient).map : resolvedClient =>
  //    given IO[EngineError, ApiClient] = resolvedClient

  //    OpProcessEngine()

