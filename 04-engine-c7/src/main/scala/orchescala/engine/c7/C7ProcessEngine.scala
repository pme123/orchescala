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
  lazy val userTaskService: UserTaskService                               = C7UserTaskService(C7ProcessInstanceService())
end C7ProcessEngine

object C7ProcessEngine:
  def rootUrl(port: String)                             = s"http://localhost:$port"
  def restEndpoint(port: String)                        = s"${rootUrl(port)}/engine-rest"
  def cockpitEndpoint(port: String, engineName: String) =
    s"${rootUrl(port)}/$engineName/app/cockpit/default/#/process-instance/"
  lazy val port                                         = "8080"
  lazy val restUrl                                      = restEndpoint(port)
  lazy val cockpitUrl                                   = cockpitEndpoint(port, "camunda")

  /** Creates a C7ProcessEngine with the proper client resolved from SharedC7ClientManager */
  def withClient(c7Client: C7Client)(using
      engineConfig: EngineConfig
  ): ZIO[SharedC7ClientManager, Nothing, C7ProcessEngine] =
    C7Client.resolveClient(c7Client).map: resolvedClient =>
      given IO[EngineError, ApiClient] = resolvedClient

      C7ProcessEngine()
end C7ProcessEngine

// operaton has same except port
object OpProcessEngine:
  lazy val port       = "9999"
  lazy val restUrl    = C7ProcessEngine.restEndpoint(port)
  lazy val cockpitUrl = C7ProcessEngine.cockpitEndpoint(port, "operation")
