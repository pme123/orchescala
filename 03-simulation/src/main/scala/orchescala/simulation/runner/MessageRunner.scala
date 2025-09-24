package orchescala.simulation.runner

import orchescala.domain.SignalEvent
import orchescala.engine.ProcessEngine
import orchescala.simulation.*
import zio.ZIO
import zio.ZIO.logInfo

class MessageRunner(val messageScenario: SMessageEvent)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
):
  lazy val messageService         = engine.messageService
  lazy val processInstanceService = engine.processInstanceService
  lazy val scenarioOrStepRunner   = ScenarioOrStepRunner(messageScenario)

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
    def correlate: ResultType =
      val msgName                           = messageScenario.inOut.messageName.replace(
        SignalEvent.Dynamic_ProcessInstance,
        summon[ScenarioData].context.processInstanceId
      )
      val processInstanceId: Option[String] =
        if messageScenario.businessKey.isEmpty && messageScenario.processInstanceId then
          summon[ScenarioData].context.optProcessInstance
        else None
      val businessKey                       = messageScenario.businessKey.orElse(if processInstanceId.isDefined then None
      else Some(messageScenario.name))
      val tenantId                          = config.tenantId
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
                                      s"Message '$msgName'  (${messageScenario.scenarioName}) sent successfully."
                                    )
                                .catchAll: err =>
                                  scenarioOrStepRunner.tryOrFail(correlate)
        _                  <- logInfo(
                                s"""Message ${summon[ScenarioData].context.taskId} sent:
                  |- msgName: $msgName
                  |- processInstanceId: ${processInstanceId.getOrElse("-")}
                  |- businessKey: ${businessKey.getOrElse("-")}
                  |- tenantId: ${tenantId.getOrElse("-")}
                  |""".stripMargin
                              )
      yield summon[ScenarioData]
      end for
    end correlate

    correlate(using summon[ScenarioData].withRequestCount(0))
  end sendMsg

end MessageRunner
