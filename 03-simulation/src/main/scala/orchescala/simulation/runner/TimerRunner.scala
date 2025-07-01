package orchescala.simulation.runner

import orchescala.domain.TimerEvent
import orchescala.engine.ProcessEngine
import orchescala.simulation.*
import zio.ZIO
import zio.ZIO.{logDebug, logInfo}

class TimerRunner(val timerScenario: STimerEvent)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
):
  lazy val scenarioOrStep                   = timerScenario
  lazy val jobService             = engine.jobService
  lazy val processInstanceService = engine.jProcessInstanceService
  lazy val scenarioOrStepRunner = ScenarioOrStepRunner(timerScenario)

  def getAndExecute: ResultType =

    for
      // default it waits until there is a job ready
      given ScenarioData <- timerScenario.optReadyVariable
                              .map(_ => EventRunner(timerScenario).loadVariable)
                              .getOrElse(ZIO.succeed(summon[ScenarioData]))
      given ScenarioData <- job
      given ScenarioData <- executeTimer
    yield summon[ScenarioData]
    end for
  end getAndExecute

  private def job: ResultType =
    def getJob(
        processInstanceId: String
    ): ResultType =

      for
        _                  <-
          logInfo(s"Fetching Job for ${timerScenario.inOut.id}: $processInstanceId")
        jobs               <-
          jobService
            .getJobs(processInstanceId = Some(processInstanceId))
            .mapError: err =>
              SimulationError.ProcessError(
                summon[ScenarioData].error(err.errorMsg)
              )
        _                  <- logInfo(s"Jobs fetched for ${timerScenario.scenarioName}: $jobs")
        given ScenarioData <-
          if jobs.nonEmpty then
            jobs.head.id
              .map: jobId =>
                ZIO.succeed:
                  summon[ScenarioData]
                    .withJobId(jobId)
                    .info(s"TimerEvent '${timerScenario.inOut.id}' ready")
              .getOrElse:
                ZIO.fail:
                  SimulationError.ProcessError(
                    summon[ScenarioData].error(
                      s"Job for '${timerScenario.scenarioName}' not found!"
                    )
                  )  
          else
            scenarioOrStepRunner.tryOrFail(getJob(processInstanceId))
      yield summon[ScenarioData]
      end for
    end getJob

    val processInstanceId = summon[ScenarioData].context.processInstanceId
    getJob(processInstanceId)(using summon[ScenarioData].withRequestCount(0))
  end job

  private def executeTimer: ResultType = 
    val jobId = summon[ScenarioData].context.jobId
    for 
      _ <- logInfo(s"Executing Timer: ${timerScenario.inOut.id} - $jobId")
      given ScenarioData <- jobService
                              .execute(jobId)
                              .as:
                                summon[ScenarioData]
                                  .info(
                                    s"Timer '${timerScenario.scenarioName}' executed successfully."
                                  )
                              .mapError: err =>
                                SimulationError.ProcessError(
                                  summon[ScenarioData].error(
                                    err.errorMsg
                                  )
                                )
      _                  <- logInfo(s"Timer $jobId executed")
    yield summon[ScenarioData]

end TimerRunner
