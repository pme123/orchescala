package orchescala.worker.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.response.ActivatedJob
import io.camunda.client.api.worker.{JobClient, JobHandler}
import orchescala.domain.*
import orchescala.engine.c8.jsonToVariablesMap
import orchescala.engine.rest.SttpClientBackend
import orchescala.worker.*
import orchescala.worker.WorkerError.*
import zio.*
import zio.ZIO.*

import java.time
import java.util.Date
import scala.jdk.CollectionConverters.*

trait C8Worker[In <: Product: InOutCodec, Out <: Product: InOutCodec]
    extends WorkerDsl[In, Out], BaseWorker[In, Out], JobHandler:

  protected def c8Context: C8Context

  def handle(client: JobClient, job: ActivatedJob): Unit =
    handleJob(client, job, camundaClient = None)

  // blocking on the client's job thread: the client counts the job as active until the handler
  // returns - maxJobsActive limits the jobs in flight, and a running job is not handed out again
  private[c8] def handleJob(
      client: JobClient,
      job: ActivatedJob,
      camundaClient: Option[CamundaClient]
  ): Unit =
    executeBlocking(job.getKey.toString)(
      execution = runJob(client, job),
      onTimeout = failJob(client, job, s"Worker ${job.getType} timed out after $workerTimeout"),
      // an error before the worker ran (variables, business key) or an exception of the worker's
      // code: only logged - the job stayed activated until its timeout, then again, without end
      onFailure = err => failJob(client, job, s"Worker ${job.getType} failed unexpectedly: $err"),
      // the job timeout is short (fast recovery after a crash) - renewed while the job runs
      renewLock = ZIO.foreachDiscard(camundaClient)(renewTimeout(_, job)),
      lockExpiresAt = Some(job.getDeadline)
    )

  // the commands wait for the engine: attemptBlocking - not on ZIO's few threads
  private def renewTimeout(camundaClient: CamundaClient, job: ActivatedJob): UIO[Unit] =
    attemptBlocking:
      camundaClient.newUpdateTimeoutCommand(job).timeout(lockTimeout.toMillis).send().join()
    .catchAll(err => logWarning(s"Problem renewing the timeout of job ${job.getKey}: $err"))
    .unit

  /** The job did not finish (timed out, failed unexpectedly) - the engine must learn it failed. */
  private def failJob(client: JobClient, job: ActivatedJob, message: String): UIO[Unit] =
    attemptBlocking:
      client.newFailCommand(job)
        .retries(job.getRetries - 1)
        .retryBackoff(time.Duration.ofSeconds(60))
        .errorMessage(message)
        .send().join()
    .catchAll(err => logError(s"Problem failing the job ${job.getKey} ($message): $err"))
    .unit

  private def runJob(client: JobClient, job: ActivatedJob): ZIO[SttpClientBackend, Throwable, Unit] =
      for
        startDate        <- succeed(new Date())
        json             <- extractJson(job)
        businessKey      <- extractBusinessKey(json)
        _                <- logInfo(
                              s"Worker: ${job.getType} (${job.getBpmnProcessId}) started > $businessKey"
                            )
        processVariables  = worker.variableNames.map(k => processVariable(k, json))
        _                <- logDebug(s"processVariables: ${processVariables.size}")
        generalVariables <- extractGeneralVariables(json)
                              .map(gv => gv.copy(
                                _idempotentId = gv._idempotentId.orElse(Some(job.getKey.toString))
                              ))
        _                <- logDebug(s"generalVariables: $generalVariables")
        _                <- C8WorkerRunner(client, job, businessKey, generalVariables, processVariables)
                              .executeWorker()
        _                <-
          logInfo(
            s"Worker: ${job.getType} (${job.getBpmnProcessId}) ended ${printTimeOnConsole(startDate)} > $businessKey"
          )
      yield ()

  case class C8WorkerRunner(
      client: JobClient,
      job: ActivatedJob,
      businessKey: String,
      generalVariables: GeneralVariables,
      processVariables: Seq[IO[BadVariableError, (String, Option[Json])]]
  ):

    def executeWorker(): ZIO[SttpClientBackend, Throwable, Unit] =
      (for
        given EngineRunContext <- createEngineRunContext(generalVariables)
        _                      <- logDebug(s"EngineRunContext created")
        executor               <- createExecutor
        filteredOut            <- WorkerExecutor(worker).execute(processVariables)
        _                      <- logDebug(s"filteredOut: ${orchescala.engine.LogSafe.names(filteredOut)}")
        _                      <- handleSuccess(filteredOut)
        _                      <- logDebug(s"Worker: ${worker.topic} completed successfully")
      yield ())
        .catchAll: ex =>
          handleError(ex)
        .unit
    end executeWorker

    private[worker] def handleError(
        error: WorkerError
    ): URIO[Any, Unit] =
      // AlreadyHandledError means checkError already resolved it (handleSuccess/handleBpmnError
      // ran). Everything else - including UnexpectedError and a MockedOutput that somehow wasn't
      // resolved as handled - must go through handleFailure
      checkError(error, generalVariables, businessKey)
        .flatMap:
          case AlreadyHandledError => ZIO.unit
          case err                 => handleFailure(err)
    end handleError

    private[worker] def checkError(
        error: WorkerError,
        generalVariables: GeneralVariables,
        businessKey: String
    ): URIO[Any, WorkerError] =
      val errorMsg          = error.toString.replace("\n", "")
      val errorHandled      = isErrorHandled(error, generalVariables.handledErrorSeq)
      val errorRegexHandled =
        error.isMock || (errorHandled && generalVariables.regexHandledErrorSeq.forall(regex =>
          errorMsg.matches(s".*$regex.*")
        ))

      (errorHandled, errorRegexHandled) match
        case (true, true)  =>
          val mockedOutput               = error match
            case error: ErrorWithOutput =>
              error.output
            case _                      => Map.empty
          val filtered: Map[String, Any] =
            filteredOutput(generalVariables.outputVariableSeq, mockedOutput)
          (if
             error.isMock && !generalVariables.handledErrorSeq.contains(
               error.errorCode.toString
             )
           then
             handleSuccess(
               filtered + ("isMocked" -> true)
             )
           else
             handleBpmnError(
               error,
               filtered
             )
          ).as(AlreadyHandledError)
        case (true, false) =>
          ZIO.succeed(HandledRegexNotMatchedError(error, generalVariables.regexHandledErrorSeq))
        case _             =>
          ZIO.succeed(error)
      end match
    end checkError

    private def createExecutor(using EngineRunContext) =
      attempt(WorkerExecutor(worker)).mapError(ex =>
        UnexpectedError(
          s"Problem creating WorkerExecutor: ${ex.getMessage}"
        )
      )

    private def createEngineRunContext(generalVariables: GeneralVariables) =
      ZIO.attempt(EngineRunContext(
        c8Context,
        generalVariables,
        // C8 delivers the root with the job - no lookup
        Some(JobProcessInstance(
          job.getProcessInstanceKey.toString,
          ZIO.succeed(Option(job.getRootProcessInstanceKey).map(_.toString))
        )),
        workerTimeoutForContext
      )).mapError(ex =>
        UnexpectedError(
          s"Problem creating EngineRunContext: ${ex.getMessage}"
        )
      )

    private def handleSuccess(
        filteredOutput: Map[String, Any]
    ): URIO[Any, Unit] =
      ZIO
        .attempt:
          jsonToVariablesMap(filteredOutput)
        .flatMap: variablesMap =>
          logInfo(s"handleSuccess BEFORE complete: ${job.getType}") *>
            logDebug(s"handleSuccess BEFORE complete: ${orchescala.engine.LogSafe.names(variablesMap)}") *>
            attemptBlocking:
              client.newCompleteCommand(job)
                .variables((variablesMap + ("processInstanceKey" -> job.getProcessInstanceKey)).asJava)
                .send().join()
            .catchAll: err =>
              handleFailure(
                UnexpectedError(
                  s"There is an unexpected Error from completing a successful Worker to C7: $err."
                ),
                doRetry = true
              )
        .tapError: err =>
          logError(s"Problem completing job: $err.")
        .ignore

    private[worker] def handleBpmnError(
        error: WorkerError,
        filteredGeneralVariables: Map[String, Any]
    ): URIO[Any, Unit] =
      val errorVars = Map(
        "errorCode" -> error.errorCode.toString,
        "errorMsg"  -> error.toString
      )
      val variables =
        (filteredGeneralVariables ++
          errorVars +
          ("businessKey" -> businessKey)).asJava
      attemptBlocking:
        // joined: without, a failed command was lost - the job neither threw the error nor failed
        client.newThrowErrorCommand(job)
          .errorCode(error.errorCode.toString)
          .errorMessage(error.toString)
          .variables(variables)
          .send()
          .join()
      .catchAll: err =>
        handleFailure(
          UnexpectedError(s"Problem handling BpmnError to C8: $err."),
          doRetry = true
        )
      .ignore
    end handleBpmnError

    /** @param doRetry
      *   the error is temporary (a failed complete / throwError command) - retried like a
      *   ServiceError
      */
    private[worker] def handleFailure(
        error: WorkerError,
        doRetry: Boolean = false
    ): URIO[Any, Unit] =
      val retries =
        C8Worker.retriesAfter(error, job.getRetries, c8Context.workerConfig.doRetryList, doRetry)
      (for
        _                <- logInfo(s"Start handleError: ${error.errorCode}")
        errorHandled      = isErrorHandled(error, generalVariables.handledErrorSeq)
        _                <- logInfo(s"Handled errorHandled: $errorHandled")
        errorRegexHandled =
          regexMatchesAll(errorHandled, error, generalVariables.regexHandledErrorSeq)
        _                <- logInfo(s"Handled errorRegexHandled: $errorRegexHandled")
        _                <- attemptBlocking:
                              client.newFailCommand(job)
                                .retries(retries)
                                .retryBackoff(retryBackoff(error))
                                .variables(Map(
                                  "errorCode"          -> error.errorCode.toString,
                                  "errorMsg"           -> error.toString,
                                  "businessKey"        -> businessKey,
                                  "processInstanceKey" -> job.getProcessInstanceKey
                                ).asJava)
                                .errorMessage(error.causeMsg)
                                .send().join()
      yield (errorHandled, errorRegexHandled, generalVariables))
        .flatMap:
          case (true, true, generalVariables)  =>
            val mockedOutput = error match
              case error: ErrorWithOutput => error.output
              case _                      => Map.empty
            val filtered     = filteredOutput(generalVariables.outputVariableSeq, mockedOutput)
            if
              error.isMock && !generalVariables.handledErrorSeq.contains(
                error.errorCode.toString
              )
            then
              handleSuccess(
                filtered
              )
                .unit
            else
              val errorVars = Map(
                "errorCode" -> error.errorCode.toString,
                "errorMsg"  -> error.toString
              )
              logError(
                s"handleError: ${orchescala.engine.LogSafe.forLog(error.causeMsg)} ${error.isMock} ${!generalVariables.handledErrorSeq.contains(
                    error.errorCode.toString
                  )}"
              ) *>
                ZIO.attemptBlocking:
                  val variables = (filtered ++ errorVars).asJava
                  client.newFailCommand(job)
                    .retries(retries)
                    .retryBackoff(time.Duration.ofSeconds(60))
                    .variables(variables)
                    .errorMessage(error.toString)
                    .send().join()
            end if
          case (true, false, generalVariables) =>
            ZIO.fail(HandledRegexNotMatchedError(error, generalVariables.regexHandledErrorSeq))
          // the job is failed (above) - it was logged as "Problem handling Failure" for every error
          case _                               =>
            error match
              case _: IdentityCorrelationPendingError =>
                logInfo(s"Job ${job.getKey}: ${error.errorMsg}")
              case _ if retries > 0                   =>
                logWarning(s"Job ${job.getKey} failed (will be retried): ${orchescala.engine.LogSafe.forLog(error.toString)}")
              case _                                  =>
                logError(s"Job ${job.getKey} failed - no retries left: ${orchescala.engine.LogSafe.forLog(error.toString)}")
        .flatMapError: throwable =>
          // throwable is frequently one of our own WorkerError/OrchescalaError cases here (e.g. the
          // ZIO.fail(error) above) - those override toString but not getMessage, which stays null
          // (Throwable's default), so use toString to actually see what went wrong.
          logError(s"Problem handling Failure to C8: ${orchescala.engine.LogSafe.forLog(throwable.toString)}")
        .ignore
        .ignore
  end C8WorkerRunner

  /** When the engine hands a failed job out again - the IdentityCorrelation follows the start
    * within moments.
    */
  private[c8] def retryBackoff(error: WorkerError): time.Duration =
    error match
      case _: IdentityCorrelationPendingError => time.Duration.ofSeconds(2)
      case _                                  => time.Duration.ofSeconds(60)

  private def extractJson(job: ActivatedJob) =
    fromEither(io.circe.parser.parse(job.getVariables))
      .mapError(ex =>
        ValidatorError(
          orchescala.engine.LogSafe.withDetails(s"Problem Json Parsing process variables: ${ex.getMessage}", job.getVariables)
        )
      )
end C8Worker

object C8Worker:

  /** The retries left after a failure - like C7 / Operaton (`calcRetries`): only an error worth
    * trying again counts down the retries of the job (from the BPMN, default 3), any other ends in
    * an incident at once. Every error counted down before - a validation error ran three times, a
    * minute apart, before its incident.
    *
    * Worth trying again: a ServiceError (also wrapped in a CustomError), an error matching
    * `doRetryList`, a pending IdentityCorrelation, a temporary one (`doRetry`).
    */
  def retriesAfter(
      error: WorkerError,
      jobRetries: Int,
      doRetryMsgs: Seq[String],
      doRetry: Boolean = false
  ): Int =
    val worthTryingAgain = doRetry || (error match
      case _: WorkerError.IdentityCorrelationPendingError                                   => true
      case _: WorkerError.ServiceError                                                      => true
      case e: WorkerError.CustomError if e.causeError.exists(_.isInstanceOf[WorkerError.ServiceError]) =>
        true
      case e if doRetryMsgs.exists(msg => e.errorMsg.toLowerCase.contains(msg.toLowerCase)) => true
      case _                                                                                => false
    )
    if worthTryingAgain then (jobRetries - 1).max(0) else 0
  end retriesAfter

end C8Worker
