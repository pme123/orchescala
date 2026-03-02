package orchescala.simulation
package runner

import orchescala.domain.{InOutDecoder, InOutEncoder}
import orchescala.engine.ProcessEngine
import orchescala.engine.domain.{EngineError, MessageCorrelationResult}
import orchescala.engine.rest.{HttpClientProvider, WorkerForwardUtil}
import zio.ZIO.*
import zio.{IO, ZIO}

import scala.reflect.ClassTag

class IsProcessScenarioRunner(scenario: IsProcessScenario)(using
    val engine: ProcessEngine,
    val config: SimulationConfig
):

  private lazy val processInstanceService = engine.processInstanceService
  private lazy val scenarioOrStepRunner   = ScenarioOrStepRunner(scenario)

  private val processName: String = scenario.process.processName

  private[simulation] def startProcess: ResultType =
    val variables = scenario.process.camundaInBody.asJson
    for
      _                  <-
        logDebug(
          s"Starting process: $processName - $variables"
        )
      initVariables      <- initProcess(variables)
      given ScenarioData <-
        processInstanceService.startProcessAsync(
          processName,
          initVariables.getOrElse(JsonObject()),
          Some(scenario.name),
          config.tenantId,
          identityCorrelation = Some(testIdentityCorrelation)
        ).mapError: err =>
          SimulationError.ProcessError(
            summon[ScenarioData].error(
              s"Problem starting Process '$processName': ${err.errorMsg}"
            )
          )
        .map: engineProcessInfo =>
          summon[ScenarioData].withProcessInstanceId(engineProcessInfo.processInstanceId)
            .info(
              s"Process '$processName' started (check ${config.cockpitUrl(engineProcessInfo)})"
            )
    yield summon[ScenarioData]
    end for
  end startProcess

  private[simulation] def sendMessage: ResultType =
    def correlate: ResultType =
      val msgName     = scenario.inOut.id
      val businessKey = Some(scenario.name)
      val tenantId    = config.tenantId
      for
        initVariables      <- initProcess(scenario.process.camundaInBody.asJson)
        given ScenarioData <-
          processInstanceService
            .startProcessByMessage(
              messageName = msgName,
              tenantId = tenantId,
              businessKey = businessKey,
              variables = initVariables,
              identityCorrelation = Some(testIdentityCorrelation)
            )
            .map: result =>
              summon[ScenarioData]
                .withProcessInstanceId(result.processInstanceId)
                .info(
                  s"Process '$processName' started (check ${config.cockpitUrl(result)})"
                )
            .mapError: err =>
              SimulationError.ProcessError(
                summon[ScenarioData].error(
                  err.errorMsg
                )
              )
        _                  <- logInfo(s"Start Message ${summon[ScenarioData].context.taskId} sent")
      yield summon[ScenarioData]
      end for
    end correlate

    logInfo(
      s"Sending message: ${scenario.name}: ${summon[ScenarioData].context.processInstanceId}"
    ) *>
      correlate(using summon[ScenarioData].withRequestCount(0))
  end sendMessage


  private def initProcess(variables: Json)(using ScenarioData) =
    // Forward request to the worker app
    WorkerForwardUtil.forwardWorkerRequest(processName, variables, "No token needed")(using
        config.engineConfig
      )
      .provideLayer(HttpClientProvider.live)
      .map:
        _.asObject
      .mapError:
        case err: EngineError =>
          SimulationError.ProcessError(summon[ScenarioData].error(
            s"Problem starting Process '$processName': ${err.errorMsg}"
          ))
end IsProcessScenarioRunner
