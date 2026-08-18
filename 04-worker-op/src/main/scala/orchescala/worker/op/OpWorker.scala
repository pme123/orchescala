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
    executeWithScope(externalTask.getId):
      run(externalTaskService)(using externalTask)

  private[worker] def run(externalTaskService: operaton.ExternalTaskService)(using
      externalTask: operaton.ExternalTask
  ): ZIO[SttpClientBackend, Throwable, Unit] =
    for
      startDate <- succeed(new Date())
      _         <-
        logInfo(
          s"Worker: ${externalTask.getTopicName} (${externalTask.getId}) started > ${externalTask.getProcessInstanceId}"
        )
      _         <- executeWorker(externalTaskService, externalTask.getRetries)
      _         <-
        logInfo(
          s"Worker: ${externalTask.getTopicName} (${externalTask.getProcessInstanceId}) ended ${printTimeOnConsole(startDate)}   > ${externalTask.getBusinessKey}"
        )
    yield ()

  private def executeWorker(
      externalTaskService: operaton.ExternalTaskService,
      retries: Int
  ): HelperContext[ZIO[SttpClientBackend, Throwable, Unit]] =
    val tryProcessVariables =
      ProcessVariablesExtractor.extract(worker.variableNames)
    logDebug(s"Executing Worker: ${worker.topic}") *>
      ProcessVariablesExtractor.extractGeneral()
        .flatMap: generalVariables =>
          (for
            _                      <- logDebug(s"generalVariables: ${generalVariables.asJson}")
            given EngineRunContext <- createEngineRunContext(generalVariables)
            executor               <- createExecutor
            filteredOut            <- executor.execute(tryProcessVariables)
            _                      <- logDebug(s"filteredOut: $filteredOut")
            _                      <- externalTaskService.handleSuccess(
                                        filteredOut,
                                        generalVariables.isManualOutMapping,
                                        retries
                                      )
            _                      <- logDebug(s"Worker: ${worker.topic} completed successfully")
          yield ())
            .catchAll: ex =>
              externalTaskService.handleError(ex, generalVariables, retries)
            .unit
        .catchAll: ex =>
          externalTaskService.handleFailure(ex, retries = retries)
  end executeWorker

  private def createEngineRunContext(generalVariables: GeneralVariables) =
    attempt(EngineRunContext(operatonContext, generalVariables)).mapError(ex =>
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
        manualOutMapping: Boolean,
        retries: Int
    ): HelperContext[URIO[Any, Unit]] = {
      ZIO.logDebug(s"handleSuccess BEFORE complete: ${worker.topic}") *>
        ZIO.attempt {
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
        ),
        retries
      )
    .ignore

    private[worker] def handleError(
        error: WorkerError,
        generalVariables: GeneralVariables,
        retries: Int
    ): HelperContext[URIO[Any, Unit]] =
      checkError(error, generalVariables, retries)
        .flatMap:
          case _: (UnexpectedError | MockedOutput | AlreadyHandledError.type) =>
            ZIO.unit
          case err                                                            =>
            handleFailure(err, retries)

    end handleError

    private[worker] def checkError(
        error: WorkerError,
        generalVariables: GeneralVariables,
        retries: Int
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
             handleSuccess(filtered, generalVariables.isManualOutMapping, retries)
           else
             handleBpmnError(error, filtered, retries)
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
        retries: Int
    ): HelperContext[URIO[Any, Unit]] =
      val errorVars = Map(
        "errorCode" -> error.errorCode.toString,
        "errorMsg"  -> error.errorMsg
      )
      val variables = (filteredGeneralVariables ++ errorVars).asJava
      ZIO.attempt(
        externalTaskService.handleBpmnError(
          summon[operaton.ExternalTask],
          s"${error.errorCode}",
          error.errorMsg,
          variables
        )
      )
        .catchAll: err =>
          handleFailure(
            UnexpectedError(s"Problem handling BpmnError to Operaton: $err."),
            retries = retries
          ).ignore
        .ignore
    end handleBpmnError

    private[worker] def handleFailure(
        error: WorkerError,
        retries: Int
    ): HelperContext[URIO[Any, Unit]] =
      val taskId            = summon[operaton.ExternalTask].getId
      val processInstanceId = summon[operaton.ExternalTask].getProcessInstanceId
      val businessKey       = summon[operaton.ExternalTask].getBusinessKey

      logError(
        s"Handle Failure for taskId: $taskId | processInstanceId: $processInstanceId | retries: $retries | $error"
      ) *>
        ZIO.attempt(
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

end OpWorker

object OpWorker:

end OpWorker

