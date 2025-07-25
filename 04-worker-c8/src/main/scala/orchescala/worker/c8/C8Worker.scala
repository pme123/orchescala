package orchescala.worker.c8

import io.camunda.zeebe.client.api.response.ActivatedJob
import io.camunda.zeebe.client.api.worker.{JobClient, JobHandler}
import orchescala.domain.*
import orchescala.engine.EngineRuntime
import orchescala.worker.*
import orchescala.worker.WorkerError.*
import zio.*
import zio.ZIO.*

import java.time
import java.util.Date
import scala.jdk.CollectionConverters.*

trait C8Worker[In <: Product: InOutCodec, Out <: Product: InOutCodec]
    extends WorkerDsl[In, Out], BaseWorker[In, Out],
      JobHandler:
  protected def c8Context: C8Context

  def handle(client: JobClient, job: ActivatedJob): Unit =
    executeWithScope(run(client, job), job.getKey.toString)

  def run(client: JobClient, job: ActivatedJob): ZIO[SttpClientBackend, Throwable, Unit] =
    (for
      startDate              <- succeed(new Date())
      json                   <- extractJson(job)
      businessKey            <- extractBusinessKey(json)
      _                      <- logDebug(
                                  s"Worker: ${job.getType} (${job.getBpmnProcessId}) started > $businessKey"
                                )
      processVariables        = worker.variableNames.map(k => processVariable(k, json))
      _                      <- logDebug(s"processVariables: ${processVariables.size}")
      generalVariables       <- extractGeneralVariables(json)
      _                      <- logDebug(s"generalVariables: ${generalVariables.asJson}")
      given EngineRunContext <- createEngineRunContext(generalVariables)
      _                      <- logDebug(s"EngineRunContext created")
      executor               <- createExecutor
      filteredOut            <- WorkerExecutor(worker).execute(processVariables)
      _                      <- logDebug(s"filteredOut: $filteredOut")
      _                      <- handleSuccess(client, job, filteredOut, generalVariables.manualOutMapping, businessKey)
      _                      <-
        logInfo(
          s"Worker: ${job.getType} (${job.getBpmnProcessId}) ended ${printTimeOnConsole(startDate)} > $businessKey"
        )
    yield ())
      .catchAll: ex =>
        handleError(client, job, ex)

  private def createExecutor(using EngineRunContext) = {
    attempt(WorkerExecutor(worker)).mapError(ex =>
      UnexpectedError(
        s"Problem creating WorkerExecutor: ${ex.getMessage}"
      )
    )
  }

  private def createEngineRunContext(generalVariables: GeneralVariables) = {
    ZIO.attempt(EngineRunContext(c8Context, generalVariables)).mapError(
      ex =>
        UnexpectedError(
          s"Problem creating EngineRunContext: ${ex.getMessage}"
        )
    )
  }

  private def extractJson(job: ActivatedJob) =
    fromEither(io.circe.parser.parse(job.getVariables))
      .mapError(ex =>
        ValidatorError(
          s"Problem Json Parsing process variables ${job.getVariables}\n" + ex.getMessage
        )
      )

  private def handleSuccess(
      client: JobClient,
      job: ActivatedJob,
      filteredOutput: Map[String, Any],
      manualOutMapping: Boolean,
      businessKey: String
  ) =
    attempt(client.newCompleteCommand(job)
      .variables(filteredOutput.asJava)
      .send().join())
      .mapError(ex =>
        UnexpectedError(
          s"Problem complete job ${job.getKey} > $businessKey\n" + ex.getMessage
        )
      )

  private[worker] def handleError(
      client: JobClient,
      job: ActivatedJob,
      error: WorkerError
  ): ZIO[Any, Throwable, Unit] =
    (for
      _                <- logError(s"Error: ${error.causeMsg}")
      json             <- extractJson(job)
      generalVariables <- extractGeneralVariables(json)
      isErrorHandled    = errorHandled(error, generalVariables.handledErrorSeq)
      errorRegexHandled =
        regexMatchesAll(isErrorHandled, error, generalVariables.regexHandledErrorSeq)
      _                <- attempt(client.newFailCommand(job)
                            .retries(job.getRetries - 1)
                            .retryBackoff(time.Duration.ofSeconds(60))
                            .variables(Map("errorCode" -> error.errorCode, "errorMsg" -> error.errorMsg).asJava)
                            .errorMessage(error.causeMsg)
                            .send().join())
    yield (isErrorHandled, errorRegexHandled, generalVariables))
      .flatMap:
        case (true, true, generalVariables)  =>
          val mockedOutput = error match
            case error: ErrorWithOutput => error.output
            case _                      => Map.empty
          val filtered     = filteredOutput(generalVariables.outputVariableSeq, mockedOutput)
          ZIO.attempt(
            if
              error.isMock && !generalVariables.handledErrorSeq.contains(
                error.errorCode.toString
              )
            then
              handleSuccess(client, job, filtered, generalVariables.manualOutMapping, "")
            else
              val errorVars = Map(
                "errorCode" -> error.errorCode,
                "errorMsg"  -> error.errorMsg
              )
              val variables = (filtered ++ errorVars).asJava
              client.newFailCommand(job)
                .retries(job.getRetries - 1)
                .retryBackoff(time.Duration.ofSeconds(60))
                .variables(variables)
                .errorMessage(error.causeMsg)
                .send().join()
          )
        case (true, false, generalVariables) =>
          ZIO.fail(HandledRegexNotMatchedError(error, generalVariables.regexHandledErrorSeq))
        case _                               =>
          ZIO.fail(error)

end C8Worker
