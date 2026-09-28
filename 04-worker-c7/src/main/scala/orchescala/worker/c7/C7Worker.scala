package orchescala.worker.c7

import orchescala.domain.*
import orchescala.engine.rest.SttpClientBackend
import orchescala.engine.{EngineRuntime, Slf4JLogger}
import orchescala.worker.*
import orchescala.worker.WorkerError.*
import org.camunda.bpm.client.exception.NotFoundException
import org.camunda.bpm.client.task as camunda
import zio.*
import zio.ZIO.*

import java.util.Date
import scala.jdk.CollectionConverters.*

trait C7Worker[In <: Product: InOutCodec, Out <: Product: InOutCodec]
    extends BaseWorker[In, Out], camunda.ExternalTaskHandler:

  protected def c7Context: C7Context

  def logger = c7Context.getLogger(getClass)

  override def execute(
      externalTask: camunda.ExternalTask,
      externalTaskService: camunda.ExternalTaskService
  ): Unit =
    executeJob(externalTask, externalTaskService, permits = None, rootLookup = C7Worker.noRootLookup)

  /** As the registry runs the job: at most `permits` jobs at once (see `BaseWorker.executeForked`),
    * a timed out job reported as failed, and `rootLookup` to check an IdentityCorrelation of a
    * call activity against its root process instance.
    */
  private[c7] def executeJob(
      externalTask: camunda.ExternalTask,
      externalTaskService: camunda.ExternalTaskService,
      permits: Option[JobPermits],
      rootLookup: String => IO[String, Option[String]]
  ): Unit =
    given camunda.ExternalTask = externalTask
    // shared by the job and its lock renewal: their calls never overlap (see the class)
    val taskService = GuardedExternalTaskService(externalTaskService)
    executeForked(externalTask.getId)(
      execution = run(taskService, rootLookup),
      onTimeout = taskService.handleFailure(
        UnexpectedError(s"Worker ${externalTask.getTopicName} timed out after $workerTimeout"),
        inTestMode = false
      ),
      // an exception of the worker's code (a defect): it was lost - the task neither completed nor
      // failed, fetched again after its lock ran out, without counting down the retries
      onFailure = err =>
        taskService.handleFailure(
          UnexpectedError(s"Worker ${externalTask.getTopicName} failed unexpectedly: $err"),
          inTestMode = false
        ),
      permits = permits,
      // back to the engine at once - waiting longer would let its lock run out
      onNoPermit = attemptBlocking(taskService.unlock(externalTask))
        .catchAll(err => logError(s"Problem unlocking task ${externalTask.getId}: $err"))
        .unit,
      // the lock is short (fast recovery after a crash) - renewed while the job runs
      renewLock = attemptBlocking(taskService.extendLock(externalTask, lockTimeout.toMillis))
        .catchAll(err => logWarning(s"Problem extending the lock of task ${externalTask.getId}: $err"))
        .unit,
      lockExpiresAt = Option(externalTask.getLockExpirationTime).map(_.getTime)
    )
  end executeJob

  private[worker] def run(
      externalTaskService: camunda.ExternalTaskService,
      rootLookup: String => IO[String, Option[String]] = C7Worker.noRootLookup
  )(using
      externalTask: camunda.ExternalTask
  ): ZIO[SttpClientBackend, Throwable, Unit] =
    for
      startDate <- succeed(new Date())
      _         <-
        logInfo(
          s"Worker: ${externalTask.getTopicName} (${externalTask.getId}) started > ${externalTask.getProcessInstanceId} (retries: ${externalTask.getRetries})"
        )
      _         <- executeWorker(externalTaskService, rootLookup)
      _         <-
        logInfo(
          s"Worker: ${externalTask.getTopicName} (${externalTask.getProcessInstanceId}) ended ${printTimeOnConsole(startDate)}   > ${externalTask.getBusinessKey}"
        )
    yield ()

  private def executeWorker(
      externalTaskService: camunda.ExternalTaskService,
      rootLookup: String => IO[String, Option[String]]
  ): HelperContext[ZIO[SttpClientBackend, Throwable, Unit]] =
    val tryProcessVariables =
      ProcessVariablesExtractor.extract(worker.variableNames)
    logDebug(s"Executing Worker: ${worker.topic}") *>
      ProcessVariablesExtractor.extractGeneral()
        .flatMap: generalVariables =>
          (for
            _                      <- logDebug(s"generalVariables: ${generalVariables.asJson}")
            given EngineRunContext <- createEngineRunContext(generalVariables, rootLookup)
            executor               <- createExecutor
            filteredOut            <- executor.execute(tryProcessVariables)
            _                      <- logDebug(s"filteredOut: $filteredOut")
            _                      <- externalTaskService.handleSuccess(
                                        filteredOut,
                                        generalVariables.isManualOutMapping,
                                        inTestMode = generalVariables._servicesMocked.contains(true)
                                      )
            _                      <- logDebug(s"Worker: ${worker.topic} completed successfully")
          yield ())
            .catchAll: ex =>
              externalTaskService.handleError(ex, generalVariables)
            .unit
        .catchAll: ex =>
          externalTaskService.handleFailure(ex, inTestMode = false)
  end executeWorker

  private def createEngineRunContext(
      generalVariables: GeneralVariables,
      rootLookup: String => IO[String, Option[String]]
  )(using externalTask: camunda.ExternalTask) =
    val processInstanceId = externalTask.getProcessInstanceId
    attempt(EngineRunContext(
      c7Context,
      generalVariables,
      Some(JobProcessInstance(processInstanceId, rootLookup(processInstanceId))),
      workerTimeoutForContext
    )).mapError(ex =>
      UnexpectedError(
        s"Problem creating EngineRunContext: ${ex.getMessage}"
      )
    )

  private def createExecutor(using EngineRunContext) =
    attempt(WorkerExecutor(worker)).mapError(ex =>
      UnexpectedError(
        s"Problem creating WorkerExecutor: ${ex.getMessage}"
      )
    )

  extension (externalTaskService: camunda.ExternalTaskService)

    private[worker] def handleSuccess(
        filteredOutput: Map[String, Any],
        manualOutMapping: Boolean,
        inTestMode: Boolean
    ): HelperContext[URIO[Any, Unit]] = {
      ZIO.logDebug(s"handleSuccess BEFORE complete: ${worker.topic}") *>
        ZIO.attemptBlocking {
          externalTaskService.complete(
            summon[camunda.ExternalTask],
            if manualOutMapping then Map.empty.asJava
            else filteredOutput.asJava,                                           // Process Variables
            if !manualOutMapping then Map.empty.asJava else filteredOutput.asJava // local Variables
          )
        } *>
        ZIO.logDebug(s"handleSuccess AFTER complete: ${worker.topic}")
    }.catchAll: err =>
      handleFailure(
        UnexpectedError(
          s"There is an unexpected Error from completing a successful Worker to C7: $err."
        ),
        inTestMode
      )
    .ignore

    private[worker] def handleError(
        error: WorkerError,
        generalVariables: GeneralVariables
    ): HelperContext[URIO[Any, Unit]] =
      // AlreadyHandledError means checkError already resolved it (handleSuccess/handleBpmnError
      // ran). Everything else - including UnexpectedError and a MockedOutput that somehow wasn't
      // resolved as handled - must go through handleFailure
      checkError(error, generalVariables)
        .flatMap:
          case AlreadyHandledError => ZIO.unit
          case err                 => handleFailure(err, generalVariables._servicesMocked.contains(true))

    end handleError

    private[worker] def checkError(
        error: WorkerError,
        generalVariables: GeneralVariables
    ): HelperContext[URIO[Any, WorkerError]] =
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
          val inTestMode                 = generalVariables._servicesMocked.contains(true)
          (if
             error.isMock && !generalVariables.handledErrorSeq.contains(
               error.errorCode.toString
             )
           then
             handleSuccess(
               filtered,
               generalVariables.isManualOutMapping,
               inTestMode = inTestMode
             )
           else
             handleBpmnError(error, filtered, inTestMode)
          ).as(AlreadyHandledError)
        case (true, false) =>
          ZIO.succeed(HandledRegexNotMatchedError(error, generalVariables.regexHandledErrorSeq))
        case _             =>
          ZIO.succeed(error)
      end match
    end checkError

    private[worker] def handleBpmnError(
        error: WorkerError,
        filteredGeneralVariables: Map[String, Any],
        inTestMode: Boolean
    ): HelperContext[URIO[Any, Unit]] =
      val errorVars = Map(
        "errorCode" -> error.errorCode.toString,
        "errorMsg"  -> error.toString
      )
      val variables = (filteredGeneralVariables ++ errorVars).asJava
      ZIO.attemptBlocking(
        externalTaskService.handleBpmnError(
          summon[camunda.ExternalTask],
          s"${error.errorCode}",
          error.toString,
          variables
        )
      )
        .catchAll: err =>
          handleFailure(
            UnexpectedError(s"Problem handling BpmnError to C7: $err."),
            inTestMode = inTestMode
          ).ignore
        .ignore
    end handleBpmnError

    private[worker] def handleFailure(
        error: WorkerError,
        inTestMode: Boolean
    ): HelperContext[URIO[Any, Unit]] =
      val taskId            = summon[camunda.ExternalTask].getId
      val processInstanceId = summon[camunda.ExternalTask].getProcessInstanceId
      val businessKey       = summon[camunda.ExternalTask].getBusinessKey
      val retries           = calcRetries(error, c7Context.workerConfig.doRetryList, inTestMode)
      val logMsg            =
        s"Handle Failure for taskId: $taskId | processInstanceId: $processInstanceId | retries: $retries | $error"

      logInfo(s"Start: $logMsg") *>
        ZIO.attemptBlocking(
          externalTaskService.handleFailure(
            taskId,
            error.causeMsg,
            error.toString,
            Math.max(retries, 0),
            retryTimeout(error).toMillis
          )
        ).foldZIO(
          {
            case _: NotFoundException =>
              logInfo(
                s"External Task $taskId does not exist anymore - cancelled concurrently. Dropped error: $error"
              )
            case throwable            =>
              logError(logMsg) *> logError(
                s"Problem handling Failure to C7: ${throwable.getMessage}."
              )
          },
          _ =>
            error match
              case _: IdentityCorrelationPendingError => logInfo(s"$logMsg (tried again shortly)")
              case _ if retries > 0                   => logWarning(s"$logMsg (will be retried)")
              case _                                  => logError(logMsg)
        ).ignore

    end handleFailure

    private[worker] def filteredOutput(
        outputVariables: Seq[String],
        allOutputs: Map[String, Any]
    ): Map[String, Any] =
      outputVariables match
        case filter if filter.isEmpty => allOutputs
        case filter                   =>
          allOutputs
            .filter:
              case k -> _ => filter.contains(k)

    end filteredOutput

  end extension

  /** When the engine hands a failed task out again. */
  private[worker] def retryTimeout(error: WorkerError): Duration =
    error match
      case _: IdentityCorrelationPendingError => 2.seconds
      case _                                  => 10.seconds

  private[worker] def calcRetries(
      error: WorkerError,
      doRetryMsgs: Seq[String],
      inTestMode: Boolean
  ): HelperContext[Int] =
    Option(summon[camunda.ExternalTask].getRetries)
      .map:
        _ - 1 // counts down normally like any other error, so it is retried at most twice total.
      .getOrElse: // on the first failure (getRetries is still null) an error matching doRetryMsgs
        error match
          case _ if inTestMode                                                     => 0
          // the correlation follows the start within moments - a few quick tries, then an incident
          case _: IdentityCorrelationPendingError                                  => 3
          case _: ServiceError                                                     => 2 // ServiceError gets 2 retries on initial attempt
          case e: CustomError if e.causeError.exists(_.isInstanceOf[ServiceError]) =>
            2 // CustomError wrapping ServiceError gets 2 retries on initial attempt
          case e
              if doRetryMsgs.exists(msg => error.errorMsg.toLowerCase.contains(msg.toLowerCase)) =>
            2 // (e.g. transient Camunda/DB races) gets the same one-off retry budget as an error
          case _                                                                   => 0

  end calcRetries
end C7Worker

object C7Worker:
  /** Without the registry's lookup (e.g. a worker called directly) the root is unknown. */
  val noRootLookup: String => IO[String, Option[String]] = _ => ZIO.none
