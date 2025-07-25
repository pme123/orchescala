package orchescala.worker.c7

import orchescala.domain.*
import orchescala.engine.{EngineRuntime, Slf4JLogger}
import orchescala.worker.*
import orchescala.worker.WorkerError.*
import org.camunda.bpm.client.task as camunda
import zio.*
import zio.ZIO.*

import java.util.Date
import scala.jdk.CollectionConverters.*

trait C7Worker[In <: Product: InOutCodec, Out <: Product: InOutCodec]
    extends WorkerDsl[In, Out], BaseWorker[In, Out], camunda.ExternalTaskHandler:

  protected def c7Context: C7Context

  def logger = c7Context.getLogger(getClass)

  override def execute(
      externalTask: camunda.ExternalTask,
      externalTaskService: camunda.ExternalTaskService
  ): Unit =
    executeWithScope(run(externalTaskService)(using externalTask), externalTask.getId)

  private[worker] def run(externalTaskService: camunda.ExternalTaskService)(using
      externalTask: camunda.ExternalTask
  ): ZIO[SttpClientBackend, Throwable, Unit] =
    for
      startDate <- succeed(new Date())
      _         <-
        logInfo(
          s"Worker: ${externalTask.getTopicName} (${externalTask.getId}) started > ${externalTask.getProcessInstanceId}"
        )
      _         <- executeWorker(externalTaskService)
      _         <-
        logInfo(
          s"Worker: ${externalTask.getTopicName} (${externalTask.getProcessInstanceId}) ended ${printTimeOnConsole(startDate)}   > ${externalTask.getBusinessKey}"
        )
    yield ()

  private def executeWorker(
      externalTaskService: camunda.ExternalTaskService
  ): HelperContext[ZIO[SttpClientBackend, Throwable, Unit]] =
    val tryProcessVariables =
      ProcessVariablesExtractor.extract(worker.variableNames)
    (for
      _                     <- logDebug(s"Executing Worker: ${worker.topic}")
      generalVariables      <- ProcessVariablesExtractor.extractGeneral()
      _                     <- logDebug(s"generalVariables: ${generalVariables.asJson}")
      given EngineRunContext = EngineRunContext(c7Context, generalVariables)
      filteredOut           <- WorkerExecutor(worker).execute(tryProcessVariables)
      _                     <- logDebug(s"filteredOut: $filteredOut")
      _                     <- externalTaskService.handleSuccess(
                                 filteredOut,
                                 generalVariables.manualOutMapping
                               )
      _                     <- logDebug(s"Worker: ${worker.topic} completed successfully")
    yield ())
      .catchAll: ex =>
        ProcessVariablesExtractor.extractGeneral(ex.generalVariables)
          .flatMap(generalVariables =>
            externalTaskService.handleError(ex, generalVariables)
          )
      .unit
  end executeWorker

  extension (externalTaskService: camunda.ExternalTaskService)

    private[worker] def handleSuccess(
        filteredOutput: Map[String, Any],
        manualOutMapping: Boolean
    ): HelperContext[URIO[Any, Unit]] = {
      ZIO.logDebug(s"handleSuccess BEFORE complete: ${worker.topic}") *>
        ZIO.attempt {
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
          s"There is an unexpected Error from completing a successful Worker to C7: ${err.getMessage}."
        ),
        doRetry = true
      )
    .ignore

    private[worker] def handleError(
        error: WorkerError,
        generalVariables: GeneralVariables
    ): HelperContext[URIO[Any, Unit]] =
      checkError(error, generalVariables)
        .flatMap:
          case _: (UnexpectedError | MockedOutput | AlreadyHandledError.type) =>
            ZIO.unit
          case err                                                            =>
            handleFailure(err, doRetry = true)

    end handleError

    private[worker] def isErrorHandled(
        error: WorkerError,
        handledErrors: Seq[String]
    ): Boolean = errorHandled(error, handledErrors)

    private[worker] def checkError(
        error: WorkerError,
        generalVariables: GeneralVariables
    ): HelperContext[URIO[Any, WorkerError]] =
      val errorMsg          = error.errorMsg.replace("\n", "")
      val errorHandled      = isErrorHandled(error, generalVariables.handledErrors)
      val errorRegexHandled =
        error.isMock ||(errorHandled && generalVariables.regexHandledErrors.forall(regex =>
          errorMsg.matches(s".*$regex.*"))
        )

      (errorHandled, errorRegexHandled) match
        case (true, true)  =>
          val mockedOutput               = error match
            case error: ErrorWithOutput =>
              error.output
            case _                      => Map.empty
          val filtered: Map[String, Any] =
            filteredOutput(generalVariables.outputVariables, mockedOutput)
          (if
             error.isMock && !generalVariables.handledErrors.contains(
               error.errorCode.toString
             )
           then
             handleSuccess(filtered, generalVariables.manualOutMapping)
           else
             handleBpmnError(error, filtered)
          ).as(AlreadyHandledError)
        case (true, false) =>
          ZIO.succeed(HandledRegexNotMatchedError(error, generalVariables.regexHandledErrors))
        case _             =>
          ZIO.succeed(error)
      end match
    end checkError

    private[worker] def handleBpmnError(
        error: WorkerError,
        filteredGeneralVariables: Map[String, Any]
    ): HelperContext[URIO[Any, Unit]] =
      val errorVars = Map(
        "errorCode" -> error.errorCode,
        "errorMsg"  -> error.errorMsg
      )
      val variables = (filteredGeneralVariables ++ errorVars).asJava
      ZIO.attempt(
        externalTaskService.handleBpmnError(
          summon[camunda.ExternalTask],
          s"${error.errorCode}",
          error.errorMsg,
          variables
        )
      )
        .catchAll: err =>
          handleFailure(
            UnexpectedError(s"Problem handling BpmnError to C7: ${err.getMessage}."),
            doRetry = true
          ).ignore
        .ignore
    end handleBpmnError

    private[worker] def handleFailure(
        error: WorkerError,
        doRetry: Boolean = false
    ): HelperContext[URIO[Any, Unit]] =
      val taskId            = summon[camunda.ExternalTask].getId
      val processInstanceId = summon[camunda.ExternalTask].getProcessInstanceId
      val businessKey       = summon[camunda.ExternalTask].getBusinessKey
      val retries           = calcRetries(error)

      if retries == 0 then logger.error(error)
      logError(
        s"Handle Failure for taskId: $taskId | processInstanceId: $processInstanceId | doRetry: $doRetry | retries: $retries | $error"
      ) *>
        ZIO
          .when(retries >= 0 || doRetry):
            ZIO.attempt(
              externalTaskService.handleFailure(
                taskId,
                error.causeMsg,
                s" ${error.causeMsg}\nSee the log of the Worker: ${niceClassName(worker.getClass)}",
                Math.max(retries, 0), // < 0 not allowed
                10.seconds.toMillis
              )
            ).flatMapError: throwable =>
              logError(s"Problem handling Failure to C7: ${throwable.getMessage}.")
            .ignore
          .ignore

    end handleFailure

    private[worker] def calcRetries(
        error: WorkerError
    ): HelperContext[Int] =
      val doRetryMsgs = Seq(
        "Entity was updated by another transaction concurrently",
        "An exception occurred in the persistence layer",
        "Exception when sending request: GET", // sttp.client3.SttpClientException$ReadException
        "Exception when sending request: PUT" // only GET and PUT to be safe a POST is not executed again
        //  "Service Unavailable",
        //  "Gateway Timeout"
      ).map(_.toLowerCase)
      val doRetry     = doRetryMsgs.exists(error.errorMsg.toLowerCase.contains)

      summon[camunda.ExternalTask].getRetries match
        case r if r <= 0 && doRetry => 2
        case r                      => r - 1

    end calcRetries

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

end C7Worker
