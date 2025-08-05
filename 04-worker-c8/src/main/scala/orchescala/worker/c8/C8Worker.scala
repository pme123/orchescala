package orchescala.worker.c8

import io.camunda.client.api.response.ActivatedJob
import io.camunda.client.api.worker.{JobClient, JobHandler}
import orchescala.domain.*
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
    executeWithScope(job.getKey.toString):
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
        _                <- logDebug(s"generalVariables: ${generalVariables.asJson}")
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
        _                      <- logDebug(s"filteredOut: $filteredOut")
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
      checkError(error, generalVariables, businessKey)
        .flatMap:
          case x: (UnexpectedError | MockedOutput | AlreadyHandledError.type) =>
            ZIO.unit
          case err                                                            =>
            handleFailure(err)
    end handleError

    private[worker] def checkError(
        error: WorkerError,
        generalVariables: GeneralVariables,
        businessKey: String
    ): URIO[Any, WorkerError] =
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
             handleSuccess(
               filtered
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
      ZIO.attempt(EngineRunContext(c8Context, generalVariables)).mapError(ex =>
        UnexpectedError(
          s"Problem creating EngineRunContext: ${ex.getMessage}"
        )
      )

    private def handleSuccess(
        filteredOutput: Map[String, Any]
    ): URIO[Any, Unit] =
      logInfo(s"handleSuccess BEFORE complete: ${job.getType}") *>
        attempt:
          client.newCompleteCommand(job)
            .variables(filteredOutput.asJava)
            .send().join()
        .catchAll: err =>
          handleFailure(
            UnexpectedError(
              s"There is an unexpected Error from completing a successful Worker to C7: ${err.getMessage}."
            ),
            doRetry = true
          )
        .ignore

    private[worker] def handleBpmnError(
        error: WorkerError,
        filteredGeneralVariables: Map[String, Any]
    ): URIO[Any, Unit] =
      val errorVars = Map(
        "errorCode" -> error.errorCode,
        "errorMsg"  -> error.errorMsg
      )
      val variables =
        (filteredGeneralVariables ++ errorVars + ("businessKey" -> businessKey)).asJava
      attempt:
        client.newThrowErrorCommand(job)
          .errorCode(error.errorCode.toString)
          .errorMessage(error.errorMsg)
          .variables(variables)
          .send()
          .exceptionally(t =>
            throw new RuntimeException("Could not throw BPMN error: " + t.getMessage(), t);
          )
      .catchAll: err =>
        handleFailure(
          UnexpectedError(s"Problem handling BpmnError to C7: ${err.getMessage}."),
          doRetry = true
        )
      .ignore
    end handleBpmnError

    private[worker] def handleFailure(
        error: WorkerError,
        doRetry: Boolean = false // TODO: implement retries
    ): URIO[Any, Unit] =
      (for
        _                <- logInfo(s"Start handleError: ${error.errorCode}")
        errorHandled      = isErrorHandled(error, generalVariables.handledErrorSeq)
        _                <- logInfo(s"Handled errorHandled: ${errorHandled}")
        errorRegexHandled =
          regexMatchesAll(errorHandled, error, generalVariables.regexHandledErrorSeq)
        _                <- logInfo(s"Handled errorRegexHandled: ${errorRegexHandled}")
        _                <- attempt:
                              client.newFailCommand(job)
                                .retries(job.getRetries - 1)
                                .retryBackoff(time.Duration.ofSeconds(60))
                                .variables(Map(
                                  "errorCode"   -> error.errorCode,
                                  "errorMsg"    -> error.errorMsg,
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
                "errorCode" -> error.errorCode,
                "errorMsg"  -> error.errorMsg
              )
              logError(
                s"handleError: ${error.causeMsg} ${error.isMock} ${!generalVariables.handledErrorSeq.contains(
                    error.errorCode.toString
                  )}"
              ) *>
                ZIO.attempt:
                  val variables = (filtered ++ errorVars).asJava
                  client.newFailCommand(job)
                    .retries(job.getRetries - 1)
                    .retryBackoff(time.Duration.ofSeconds(60))
                    .variables(variables)
                    .errorMessage(error.causeMsg)
                    .send().join()
            end if
          case (true, false, generalVariables) =>
            ZIO.fail(HandledRegexNotMatchedError(error, generalVariables.regexHandledErrorSeq))
          case _                               =>
            ZIO.fail(error)
        .flatMapError: throwable =>
          logError(s"Problem handling Failure to C7: ${throwable.getMessage}.")
        .ignore
        .ignore
  end C8WorkerRunner

  private def extractJson(job: ActivatedJob) =
    fromEither(io.circe.parser.parse(job.getVariables))
      .mapError(ex =>
        ValidatorError(
          s"Problem Json Parsing process variables ${job.getVariables}\n" + ex.getMessage
        )
      )
end C8Worker
