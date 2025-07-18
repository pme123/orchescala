package orchescala.simulation.runner

import orchescala.engine.ProcessEngine
import orchescala.simulation.*
import zio.ZIO
import zio.ZIO.{logDebug, logInfo}

class UserTaskRunner(val userTaskScenario: SUserTask)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
) :
  lazy val scenarioOrStep                   = userTaskScenario
  lazy val userTaskService        = engine.userTaskService
  lazy val processInstanceService = engine.jProcessInstanceService
  lazy val scenarioOrStepRunner = ScenarioOrStepRunner(userTaskScenario)

  def getAndComplete: ResultType =
    val scenarioData1 = summon[ScenarioData].withTaskId(notSet)
    for
      given ScenarioData <- task
      _                  <- logInfo(s"UserTask ${summon[ScenarioData].context.taskId} found")
      given ScenarioData <- checkForm
      _                  <- logInfo(s"UserTask ${summon[ScenarioData].context.taskId} checkedForm")
      given ScenarioData <-
        userTaskScenario.waitForSec.map(scenarioOrStepRunner.waitFor).getOrElse(ZIO.succeed(summon[ScenarioData]))
      given ScenarioData <- completeTask
    yield summon[ScenarioData]
    end for
  end getAndComplete

  private def task: ResultType =
    def getTask(
        processInstanceId: String,
        taskDefinitionKey: String
    ): ResultType =
      userTaskService
        .getUserTask(processInstanceId)
        .mapError: err =>
          SimulationError.ProcessError(
            summon[ScenarioData].error(
              s"Problem getting Task '${userTaskScenario.scenarioName}': ${err.errorMsg}"
            )
          )
        .flatMap:
          case Some(userTask) =>
            logDebug(s"UserTask found: $taskDefinitionKey - ${userTask.id}")
              .as(
                summon[ScenarioData]
                  .withTaskId(userTask.id)
                  .info(
                    s"UserTask '${userTask.name.mkString}' ready"
                  )
                  .info(s"- taskId: ${userTask.id}")
                  .debug(s"- body: $userTask")
              )
          case None           =>
            logDebug(s"UserTask $taskDefinitionKey not ready") *>
              scenarioOrStepRunner.tryOrFail(getTask(processInstanceId, taskDefinitionKey))
    end getTask

    val processInstanceId = summon[ScenarioData].context.processInstanceId

    getTask(processInstanceId, userTaskScenario.id)(using summon[ScenarioData].withRequestCount(0))
  end task

  def checkForm: ResultType =
    val processInstanceId = summon[ScenarioData].context.processInstanceId
    for
      variables          <-
        processInstanceService
          .getVariables(processInstanceId, userTaskScenario.inOut.in)
          .mapError: err =>
            SimulationError.ProcessError(
              summon[ScenarioData].error(
                s"Problem getting Task '${userTaskScenario.scenarioName}': ${err.errorMsg}"
              )
            )
      _                  <- logDebug(s"Variables fetched for ${userTaskScenario.scenarioName}: $variables")
      given ScenarioData <- ZIO.succeed(summon[ScenarioData].info(s"UserTask '${userTaskScenario.scenarioName}' Form ready to check."))
      given ScenarioData <-
        ResultChecker.checkProps(
          userTaskScenario,
          variables
        )
      _ <- logDebug(s"UserTask Form is correct for ${userTaskScenario.scenarioName}")
    yield summon[ScenarioData]
    end for
  end checkForm

  private def completeTask: ResultType =
    val taskId = summon[ScenarioData].context.taskId
    for
      _ <- userTaskService.complete(taskId, userTaskScenario.camundaOutMap)
             .mapError: err =>
               SimulationError.ProcessError(
                 summon[ScenarioData].error(
                   s"Problem completing Task '${userTaskScenario.scenarioName}': ${err.errorMsg}"
                 )
               )
    yield summon[ScenarioData].info(s"Successful completed UserTask ${userTaskScenario.scenarioName}.")
    end for
  end completeTask

end UserTaskRunner
