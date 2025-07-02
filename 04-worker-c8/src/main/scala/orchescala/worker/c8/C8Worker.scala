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
    extends WorkerDsl[In, Out],
      JobHandler:
  protected def c8Context: C8Context

  def handle(client: JobClient, job: ActivatedJob): Unit =
    Unsafe.unsafe:
      implicit unsafe =>
        EngineRuntime.zioRuntime.unsafe.fork:
          ZIO.scoped:
            for
              // Fork the worker execution within the scope
              fiber <- run(client, job)
                         .provideLayer(EngineRuntime.sharedExecutorLayer ++ HttpClientProvider.live ++ EngineRuntime.logger)
                         .fork
              // Add a finalizer to ensure the fiber is interrupted if the scope closes
              _     <- ZIO.addFinalizer:
                         fiber.status.flatMap: status =>
                           fiber.interrupt.when(!status.isDone)

              // Join the fiber to wait for completion
              result <- fiber.join
            yield result
          .ensuring:
            ZIO.logDebug(
              s"Worker execution for job ${job.getKey} completed and resources cleaned up"
            )

  def run(client: JobClient, job: ActivatedJob): ZIO[SttpClientBackend, Throwable, Unit] =
    (for
      startDate             <- succeed(new Date())
      json                  <- extractJson(job)
      businessKey           <- extractBusinessKey(json)
      _                     <- logInfo(
                                 s"Worker: ${job.getType} (${job.getBpmnProcessId}) started > $businessKey"
                               )
      processVariables       = worker.variableNames.map(k => processVariable(k, json))
      generalVariables      <- extractGeneralVariables(json)
      given EngineRunContext = EngineRunContext(c8Context, generalVariables)
      filteredOut           <- WorkerExecutor(worker).execute(processVariables)
      _                     <- logInfo(s"generalVariables: $generalVariables")
      _                     <- handleSuccess(client, job, filteredOut, generalVariables.manualOutMapping, businessKey)
      _                     <-
        logInfo(
          s"Worker: ${job.getType} (${job.getBpmnProcessId}) ended ${printTimeOnConsole(startDate)} > $businessKey"
        )
    yield ())
      .catchAll: ex =>
        handleError(client, job, ex)

  private def handleSuccess(
      client: JobClient,
      job: ActivatedJob,
      filteredOutput: Map[String, Any],
      manualOutMapping: Boolean, // TODO no local variables?!
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
      isErrorHandled    = errorHandled(error, generalVariables.handledErrors)
      errorRegexHandled =
        regexMatchesAll(isErrorHandled, error, generalVariables.regexHandledErrors)
      _                <- attempt(client.newFailCommand(job)
                            .retries(job.getRetries - 1)
                            .retryBackoff(time.Duration.ofSeconds(60))
                            .variables(Map("errorCode" -> error.errorCode, "errorMsg" -> error.errorMsg).asJava)
                            .errorMessage(error.causeMsg)
                            .send().join())
    yield (isErrorHandled, errorRegexHandled, generalVariables))
      .flatMap:
        case (true, true, generalVariables) =>
          val mockedOutput = error match
            case error: ErrorWithOutput =>
              error.output
            case _                      => Map.empty
          val filtered     = filteredOutput(generalVariables.outputVariables, mockedOutput)
          ZIO.attempt(
            if
              error.isMock && !generalVariables.handledErrors.contains(
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
        case (true, false, generalVariables)               =>
          ZIO.fail(HandledRegexNotMatchedError(error, generalVariables.regexHandledErrors))
        case _                              =>
          ZIO.fail(error)

  private def extractGeneralVariables(json: Json) =
    fromEither(
      customDecodeAccumulating[GeneralVariables](json.hcursor)
    ).mapError(ex =>
      ValidatorError(
        s"Problem extract general variables from $json\n" + ex.getMessage
      )
    )

  private def extractBusinessKey(json: Json) =
    fromEither(json.as[BusinessKey].map(_.businessKey.getOrElse("no businessKey")))
      .mapError(ex =>
        ValidatorError(
          s"Problem extract business Key from $json\n" + ex.getMessage
        )
      )

  private def extractJson(job: ActivatedJob) =
    fromEither(io.circe.parser.parse(job.getVariables))
      .mapError(ex =>
        ValidatorError(
          s"Problem Json Parsing process variables ${job.getVariables}\n" + ex.getMessage
        )
      )

  private def processVariable(
      key: String,
      json: Json
  ): IO[BadVariableError, (String, Option[Json])] =
    json.hcursor.downField(key).as[Option[Json]] match
      case Right(value) => ZIO.succeed(key -> value)
      case Left(ex)     => ZIO.fail(BadVariableError(ex.getMessage))

  case class BusinessKey(businessKey: Option[String])
  object BusinessKey:
    given InOutCodec[BusinessKey] = deriveInOutCodec

end C8Worker
