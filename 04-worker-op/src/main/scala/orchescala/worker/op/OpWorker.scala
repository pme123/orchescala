package orchescala.worker.op

import orchescala.domain.*
import orchescala.engine.rest.SttpClientBackend
import orchescala.engine.{EngineRuntime, Slf4JLogger}
import orchescala.worker.*
import orchescala.worker.WorkerError.*
import orchescala.worker.op.OpHelper.*
import org.operaton.bpm.client.task as operaton
import zio.*
import zio.ZIO.*

import java.util.Date
import scala.jdk.CollectionConverters.*

trait OpWorker[In <: Product: InOutCodec, Out <: Product: InOutCodec]
    extends BaseWorker[In, Out], operaton.ExternalTaskHandler:

  protected def operatonContext: OpContext

  def logger = operatonContext.getLogger(getClass)

  override def execute(
      externalTask: operaton.ExternalTask,
      externalTaskService: operaton.ExternalTaskService
  ): Unit =
    executeJob(externalTask, externalTaskService, permits = None, rootLookup = OpWorker.noRootLookup)

  /** As the registry runs the job: at most `permits` jobs at once (see `BaseWorker.executeForked`),
    * a timed out job reported as failed, and `rootLookup` to check an IdentityCorrelation of a
    * call activity against its root process instance.
    */
  private[op] def executeJob(
      externalTask: operaton.ExternalTask,
      externalTaskService: operaton.ExternalTaskService,
      permits: Option[JobPermits],
      rootLookup: String => IO[String, Option[String]]
  ): Unit =
    given operaton.ExternalTask = externalTask
    // shared by the job and its lock renewal: their calls never overlap (see the class)
    val taskService = GuardedExternalTaskService(externalTaskService)
    executeForked(externalTask.getId)(
      execution = run(taskService, rootLookup),
      onTimeout = taskService.handleFailure(
        UnexpectedError(s"Worker ${externalTask.getTopicName} timed out after $workerTimeout")
      ),
      // an exception of the worker's code (a defect): it was lost - the task neither completed nor
      // failed, fetched again after its lock ran out, without counting down the retries
      onFailure = err =>
        taskService.handleFailure(
          UnexpectedError(s"Worker ${externalTask.getTopicName} failed unexpectedly: $err")
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
      externalTaskService: operaton.ExternalTaskService,
      rootLookup: String => IO[String, Option[String]] = OpWorker.noRootLookup
  )(using
      externalTask: operaton.ExternalTask
  ): ZIO[SttpClientBackend, Throwable, Unit] =
    for
      startDate <- succeed(new Date())
      _         <-
        logInfo(
          s"Worker: ${externalTask.getTopicName} (${externalTask.getId}) started > ${externalTask.getProcessInstanceId}"
        )
      _         <- executeWorker(externalTaskService, rootLookup)
      _         <-
        logInfo(
          s"Worker: ${externalTask.getTopicName} (${externalTask.getProcessInstanceId}) ended ${printTimeOnConsole(startDate)}   > ${externalTask.getBusinessKey}"
        )
    yield ()

  // the retries are read from the task only when handling a failure (calcRetries): before the
  // first failure they are `null` - converting them to Int up front threw a NullPointerException
  // on EVERY first run, a defect that left the task neither completed nor failed
  private def executeWorker(
      externalTaskService: operaton.ExternalTaskService,
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
                                        generalVariables.isManualOutMapping
                                      )
            _                      <- logDebug(s"Worker: ${worker.topic} completed successfully")
          yield ())
            .catchAll: ex =>
              externalTaskService.handleError(ex, generalVariables)
            .unit
        .catchAll: ex =>
          externalTaskService.handleFailure(ex)
  end executeWorker

  private def createEngineRunContext(
      generalVariables: GeneralVariables,
      rootLookup: String => IO[String, Option[String]]
  )(using externalTask: operaton.ExternalTask) =
    val processInstanceId = externalTask.getProcessInstanceId
    attempt(EngineRunContext(
      operatonContext,
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

  extension (externalTaskService: operaton.ExternalTaskService)

    private[worker] def handleSuccess(
        filteredOutput: Map[String, Any],
        manualOutMapping: Boolean
    ): HelperContext[URIO[Any, Unit]] = {
      ZIO.logDebug(s"handleSuccess BEFORE complete: ${worker.topic}") *>
        ZIO.attemptBlocking {
          externalTaskService.complete(
            summon[operaton.ExternalTask],
            if manualOutMapping then Map.empty.asJava
            else filteredOutput.asJava,                                           // Process Variables
            if !manualOutMapping then Map.empty.asJava else filteredOutput.asJava // local Variables
          )
        } *>
        ZIO.logDebug(s"handleSuccess AFTER complete: ${worker.topic}")
    }.catchAll: err =>
      handleFailure(
        UnexpectedError(
          s"There is an unexpected Error from completing a successful Worker to Operaton: $err."
        )
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
      val errorMsg          = error.errorMsg.replace("\n", "")
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
             handleSuccess(filtered, generalVariables.isManualOutMapping)
           else
             handleBpmnError(error, filtered)
          ).as(AlreadyHandledError)
        case (true, false) =>
          ZIO.succeed(HandledRegexNotMatchedError(error, generalVariables.regexHandledErrorSeq))
        case _             =>
          ZIO.succeed(error)
      end match
    end checkError

    private[worker] def handleBpmnError(
        error: WorkerError,
        filteredGeneralVariables: Map[String, Any]
    ): HelperContext[URIO[Any, Unit]] =
      val errorVars = Map(
        "errorCode" -> error.errorCode.toString,
        "errorMsg"  -> error.errorMsg
      )
      val variables = (filteredGeneralVariables ++ errorVars).asJava
      ZIO.attemptBlocking(
        externalTaskService.handleBpmnError(
          summon[operaton.ExternalTask],
          s"${error.errorCode}",
          error.errorMsg,
          variables
        )
      )
        .catchAll: err =>
          handleFailure(
            UnexpectedError(s"Problem handling BpmnError to Operaton: $err.")
          ).ignore
        .ignore
    end handleBpmnError

    private[worker] def handleFailure(
        error: WorkerError,
        inTestMode: Boolean = false
    ): HelperContext[URIO[Any, Unit]] =
      val retries           = calcRetries(error, operatonContext.workerConfig.doRetryList, inTestMode)
      val taskId            = summon[operaton.ExternalTask].getId
      val processInstanceId = summon[operaton.ExternalTask].getProcessInstanceId
      val businessKey       = summon[operaton.ExternalTask].getBusinessKey

      logError(
        s"Handle Failure for taskId: $taskId | processInstanceId: $processInstanceId | retries: $retries | $error"
      ) *>
        ZIO.attemptBlocking(
          externalTaskService.handleFailure(
            taskId,
            error.causeMsg,
            s" ${error.causeMsg}\nSee the log of the Worker: ${niceClassName(worker.getClass)}",
            Math.max(retries, 0), // < 0 not allowed
            10.seconds.toMillis
          )
        ).catchAll: throwable => // this should not happen
          logError(s"Problem handling Failure to Operaton: ${throwable.getMessage}.\n${throwable.getStackTrace.mkString("\n")}")

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

  /** Retries left after this failure - as C7Worker.calcRetries: counts down on every failure; on
    * the first one (retries still `null`) a ServiceError or an error of `doRetryMsgs` gets 2
    * retries, any other error none. Sending the unchanged count (as before) retried a failing
    * task every 10s without end.
    */
  private[worker] def calcRetries(
      error: WorkerError,
      doRetryMsgs: Seq[String],
      inTestMode: Boolean
  ): HelperContext[Int] =
    Option(summon[operaton.ExternalTask].getRetries)
      .map(_ - 1)
      .getOrElse:
        error match
          case _ if inTestMode                                                     => 0
          case _: ServiceError                                                     => 2
          case e: CustomError if e.causeError.exists(_.isInstanceOf[ServiceError]) => 2
          case _
              if doRetryMsgs.exists(msg => error.errorMsg.toLowerCase.contains(msg.toLowerCase)) =>
            2
          case _                                                                   => 0
  end calcRetries

end OpWorker

object OpWorker:
  /** Without the registry's lookup (e.g. a worker called directly) the root is unknown. */
  val noRootLookup: String => IO[String, Option[String]] = _ => ZIO.none
end OpWorker
