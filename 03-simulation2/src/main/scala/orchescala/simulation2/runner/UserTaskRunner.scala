package orchescala.simulation2.runner

import io.circe.*
import orchescala.domain.{CamundaProperty, CompleteTaskOut, FormVariables}
import orchescala.engine.ProcessEngine
import orchescala.simulation2.*
import zio.ZIO
import zio.ZIO.{logDebug, logInfo}

class UserTaskRunner(val userTaskScenario: SUserTask)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
) extends ScenarioOrStepRunner, ResultChecker:
  lazy val step                   = userTaskScenario
  lazy val userTaskService        = engine.userTaskService
  lazy val processInstanceService = engine.jProcessInstanceService

  def getAndComplete(scenarioData: ScenarioData): ResultType =
    val scenarioData1 = scenarioData.withTaskId(notSet)
    for
      scenarioData2 <- task(scenarioData1)
      _             <- logInfo(s"UserTask ${scenarioData2.context.taskId} found")
      scenarioData3 <- checkForm(scenarioData2)
      _             <- logInfo(s"UserTask ${scenarioData2.context.taskId} checkedForm")
      scenarioData4 <-
        userTaskScenario.waitForSec.map(waitFor(
          _,
          scenarioData3
        )).getOrElse(ZIO.succeed(scenarioData3))
      scenarioData5 <- completeTask(scenarioData4)
    yield scenarioData5
    end for
  end getAndComplete

  private def task(scenarioData: ScenarioData): ResultType =
    def getTask(
        processInstanceId: String,
        taskDefinitionKey: String
    )(data: ScenarioData): ResultType =
      userTaskService
        .getUserTask(processInstanceId)
        .mapError: err =>
          SimulationError.ProcessError(
            data.error(
              s"Problem getting Task '${userTaskScenario.name}': ${err.errorMsg}"
            )
          )
        .flatMap:
          case Some(userTask) =>
            logDebug(s"UserTask found: $taskDefinitionKey - ${userTask.id}")
              .as(
                data
                  .withTaskId(userTask.id)
                  .info(
                    s"UserTask '${userTask.name.mkString}' ready"
                  )
                  .info(s"- taskId: ${userTask.id}")
                  .debug(s"- body: $userTask")
              )
          case None           =>
            logDebug(s"UserTask $taskDefinitionKey not ready") *>
              tryOrFail(data, getTask(processInstanceId, taskDefinitionKey))
    end getTask

    val processInstanceId = scenarioData.context.processInstanceId

    getTask(processInstanceId, userTaskScenario.id)(scenarioData.withRequestCount(0))
  end task

  def checkForm(data: ScenarioData): ResultType =
    val processInstanceId = data.context.processInstanceId
    for
      variables     <-
        processInstanceService
          .getVariables(processInstanceId, userTaskScenario.inOut.in)
          .mapError: err =>
            SimulationError.ProcessError(
              data.error(s"Problem getting Task '${userTaskScenario.name}': ${err.errorMsg}")
            )
      _             <- logDebug(s"Variables fetched for ${userTaskScenario.name}: $variables")
      scenarioData1 <- ZIO.attempt(checkProps(
                         userTaskScenario,
                         variables,
                         data
                       )).mapError: err =>
                         err.printStackTrace()
                         SimulationError.ProcessError(
                           data.error(
                             s"Tests for UserTask Form ${userTaskScenario.name} failed - check log above (look for !!!)"
                           )
                         )
      _             <- logDebug(s"UserTask Form is correct for ${userTaskScenario.name}")
    yield scenarioData1
    end for
  end checkForm

  private def completeTask(data: ScenarioData): ResultType =
    val taskId = data.context.taskId
    for
      _ <- userTaskService.complete(taskId, userTaskScenario.camundaOutMap)
             .mapError: err =>
               SimulationError.ProcessError(
                 data.error(s"Problem completing Task '${userTaskScenario.name}': ${err.errorMsg}")
               )
    yield data.info(s"Successful completed UserTask ${userTaskScenario.name}.")
    end for
  end completeTask

end UserTaskRunner
