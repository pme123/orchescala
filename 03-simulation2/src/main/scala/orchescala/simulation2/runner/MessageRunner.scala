package orchescala.simulation2.runner

import orchescala.domain.SignalEvent
import orchescala.engine.ProcessEngine
import orchescala.simulation2.*
import zio.ZIO
import zio.ZIO.logInfo

class MessageRunner(val messageScenario: SMessageEvent)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
):
  lazy val messageService         = engine.messageService
  lazy val processInstanceService = engine.jProcessInstanceService

  def sendMessage: ResultType =
    for
      _                  <-
        logInfo(
          s"Sending message: ${messageScenario.name}: ${summon[ScenarioData].context.processInstanceId}"
        )
      given ScenarioData <-
        messageScenario.optReadyVariable
          .map(_ => EventRunner(messageScenario).loadVariable)
          .getOrElse(ZIO.succeed(summon[ScenarioData]))
      given ScenarioData <- sendMsg
    yield summon[ScenarioData]

  private def sendMsg: ResultType =
    val msgName           = messageScenario.inOut.messageName.replace(
      SignalEvent.Dynamic_ProcessInstance,
      summon[ScenarioData].context.processInstanceId
    )
    val processInstanceId = summon[ScenarioData].context.optProcessInstance
    val businessKey       = if processInstanceId.isDefined then None else Some(messageScenario.name)
    val tenantId          = if processInstanceId.isDefined then None else config.tenantId
    for
      given ScenarioData <- messageService
                              .sendMessage(
                                name = msgName,
                                tenantId = tenantId,
                                processInstanceId = processInstanceId,
                                businessKey = businessKey,
                                variables = Some(messageScenario.inOut.camundaInMap)
                              )
                              .as:
                                summon[ScenarioData]
                                  .info(
                                    s"Message '$msgName' sent successfully."
                                  )
                              .mapError: err =>
                                SimulationError.ProcessError(
                                  summon[ScenarioData].error(
                                    err.errorMsg
                                  )
                                )
      _                  <- logInfo(s"Message ${summon[ScenarioData].context.taskId} sent")
    yield summon[ScenarioData]
    end for
  end sendMsg

end MessageRunner
