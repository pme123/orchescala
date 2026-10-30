package orchescala.worker.c8

import com.github.blemale.scaffeine.Scaffeine
import io.camunda.client.CamundaClient
import io.camunda.client.api.command.ClientHttpException
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
import java.util.concurrent.TimeUnit
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
      execution = runJob(client, job, camundaClient),
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

  private def runJob(
      client: JobClient,
      job: ActivatedJob,
      camundaClient: Option[CamundaClient]
  ): ZIO[SttpClientBackend, Throwable, Unit] =
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
        // the InitWorker overwrites a processInstanceId from outside with the own one - say so
        _                <- ZIO.foreachDiscard(C8Worker.foreignProcessInstanceId(worker, json, job.getProcessInstanceKey)):
                              foreign =>
                                logWarning(
                                  s"Worker: ${job.getType} - processInstanceId '$foreign' (from outside) is overwritten with " +
                                    s"the own '${job.getProcessInstanceKey}' - name a field that holds another process's id differently."
                                )
        _                <- C8WorkerRunner(client, job, businessKey, generalVariables, processVariables, camundaClient)
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
      processVariables: Seq[IO[BadVariableError, (String, Option[Json])]],
      // for the commands a JobClient does not have (set the variables of a BPMN error)
      camundaClient: Option[CamundaClient] = None
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
        Some(JobProcessInstance(
          job.getProcessInstanceKey.toString,
          C8Worker.rootProcessInstanceId(
            Option(job.getRootProcessInstanceKey).map(_.longValue),
            job.getProcessInstanceKey,
            camundaClient.map(C8Worker.fetchRootProcessInstanceKey)
          )
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
                .variables(
                  (variablesMap ++ C8Worker.engineVariables(worker, job.getProcessInstanceKey)).asJava
                )
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
      // engine values, not circe's Json - Zeebe would serialize a Json as a bean ({"number":false,...})
      val variables =
        C8Worker.bpmnErrorVariables(filteredGeneralVariables ++ errorVars + ("businessKey" -> businessKey))
      // C8 sets the variables of a thrown error locally at the catching error event - in C7 they
      // reach the process (e.g. the output of a mock). So first set them like a job completion
      // does (propagated to the upper scopes), then throw the error.
      val setVariables = camundaClient match
        case Some(cc) =>
          attemptBlocking:
            cc.newSetVariablesCommand(job.getElementInstanceKey)
              .variables(variables.asJava)
              .local(false)
              .send()
              .join()
        case None     =>
          logWarning(s"No CamundaClient - the variables of BPMN error ${error.errorCode} stay at the catching event.")
      (setVariables *>
        attemptBlocking:
          // joined: without, a failed command was lost - the job neither threw the error nor failed
          client.newThrowErrorCommand(job)
            .errorCode(error.errorCode.toString)
            .errorMessage(error.toString)
            .variables(variables.asJava)
            .send()
            .join()
      )
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
                                  "errorCode"   -> error.errorCode.toString,
                                  "errorMsg"    -> error.toString,
                                  "businessKey" -> businessKey
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

  /** What C7 has in `execution` - C8 has no `execution`: the InitWorker puts the key of the process
    * instance as `processInstanceId` into the process variables (in FEEL `= processInstanceId`, e.g.
    * `_idempotentId`) - engine agnostic, the name of the Gateway API and of C7.
    *
    * Always the own one - like `execution.processInstanceId` in C7: a `processInstanceId` from
    * outside (a start variable, the input of a call activity) is overwritten. Only the InitWorker:
    * it runs in the scope of the process - another worker (e.g. in a call activity) must not
    * overwrite it. A String: a key exceeds JavaScript's safe integers (the partition is in its
    * upper bits) - and `_idempotentId` is a String.
    *
    * A worker that needs the own id before (e.g. the InitWorker itself) takes
    * `EngineRunContext.processInstance` - the same in all engines.
    */
  def engineVariables(
      worker: Worker[?, ?, ?],
      processInstanceKey: Long
  ): Map[String, String] =
    worker match
      case _: InitWorker[?, ?, ?] => Map(processInstanceIdName -> processInstanceKey.toString)
      case _                      => Map.empty

  private val processInstanceIdName = "processInstanceId"

  /** The variables a worker fetches with its job - the InitWorker also a `processInstanceId` from
    * outside, to report that it overwrites it (see `foreignProcessInstanceId`).
    */
  def variablesToFetch(worker: Worker[?, ?, ?]): Seq[String] =
    val own = worker match
      case _: InitWorker[?, ?, ?] => Seq(processInstanceIdName)
      case _                      => Seq.empty
    (worker.variableNames ++ GeneralVariables.variableNames ++ own :+ "businessKey").distinct

  /** A `processInstanceId` the InitWorker got from outside that is not its own - it overwrites it. */
  def foreignProcessInstanceId(worker: Worker[?, ?, ?], json: Json, processInstanceKey: Long): Option[String] =
    worker match
      case _: InitWorker[?, ?, ?] =>
        json.hcursor.downField(processInstanceIdName).focus
          .flatMap(j => j.asString.orElse(j.asNumber.map(_.toString)))
          .filter(id => id.nonEmpty && id != processInstanceKey.toString)
      case _                      => None

  // the process instance of a job -> its root; a root never changes - bounded, so a long-running
  // worker app does not grow without end
  private lazy val rootProcessInstances =
    Scaffeine().maximumSize(10_000).expireAfterWrite(scala.concurrent.duration.FiniteDuration(1, "hour")).build[Long, String]()

  // a sub process just started may not be in the engine's search data yet - wait a moment
  private val rootLookupRetry: Schedule[Any, Any, Any] =
    Schedule.spaced(500.millis) && Schedule.recurs(10)

  // one lookup must not block the identity check for long
  private val rootLookupTimeout = 10.seconds

  /** The engine does not know the process instance (404) - a sub process just started may not be
    * in its search data yet. The only error of the lookup that is tried again.
    */
  final case class ProcessInstanceNotFound(processInstanceKey: Long)
      extends RuntimeException(s"process instance '$processInstanceKey' not found (404)")

  /** The root process instance of a job - only needed for jobs in call activities, whose
    * IdentityCorrelation is bound to the root (see `IdentityVerification.verifyBinding`).
    *
    * The REST job activation delivers it with the job. The gRPC one (the default) does not - the
    * client sets it to null - so it is looked up in the engine (`lookup`), tried again on a 404
    * and cached. Without `lookup` (no CamundaClient) there is no root.
    */
  def rootProcessInstanceId(
      jobRoot: Option[Long],
      processInstanceKey: Long,
      lookup: Option[Long => Task[Option[Long]]],
      retry: Schedule[Any, Any, Any] = rootLookupRetry
  ): IO[String, Option[String]] =
    (jobRoot, lookup) match
      case (Some(root), _)    => ZIO.some(root.toString)
      case (None, None)       => ZIO.none
      case (None, Some(find)) =>
        rootProcessInstances.getIfPresent(processInstanceKey) match
          case Some(root) => ZIO.some(root)
          case None       =>
            find(processInstanceKey)
              // only a 404 - any other error (auth, connection, timeout) is reported at once
              .retry(retry && Schedule.recurWhile[Throwable](_.isInstanceOf[ProcessInstanceNotFound]))
              .tap:
                case Some(root) => ZIO.succeed(rootProcessInstances.put(processInstanceKey, root.toString))
                case None       =>
                  ZIO.logWarning(
                    s"The engine knows no root of process instance '$processInstanceKey' - an IdentityCorrelation " +
                      "is then accepted only for the job's own process instance."
                  )
              .map(_.map(_.toString))
              .mapError:
                case _: ProcessInstanceNotFound =>
                  s"Root process instance of '$processInstanceKey' not found - the engine does not know the process instance (tried again)."
                case err                        =>
                  s"Root process instance of '$processInstanceKey' could not be looked up: ${err.getClass.getSimpleName}: ${err.getMessage}"
  end rootProcessInstanceId

  /** The root of a process instance from the engine (`GET /v2/process-instances/{key}`) - a 404 as
    * `ProcessInstanceNotFound`, waiting at most `rootLookupTimeout`.
    */
  def fetchRootProcessInstanceKey(client: CamundaClient)(processInstanceKey: Long): Task[Option[Long]] =
    attemptBlocking:
      Option(
        client.newProcessInstanceGetRequest(processInstanceKey).send()
          .join(rootLookupTimeout.toMillis, TimeUnit.MILLISECONDS)
          .getRootProcessInstanceKey
      ).map(_.longValue)
    .mapError(notFoundAs(processInstanceKey))

  /** A 404 of the engine as `ProcessInstanceNotFound` - any other error stays as it is. */
  def notFoundAs(processInstanceKey: Long)(err: Throwable): Throwable =
    err match
      case e: ClientHttpException if e.code == 404 => ProcessInstanceNotFound(processInstanceKey)
      case e                                       => e

  /** The variables of a BPMN error as engine values - a circe `Json` (e.g. a mocked output) too. */
  def bpmnErrorVariables(variables: Map[String, Any]): Map[String, Any] =
    jsonToVariablesMap(variables)

end C8Worker
