package orchescala.worker

import io.circe.Decoder.Result
import orchescala.domain.*
import orchescala.engine.EngineRuntime
import orchescala.worker.*
import orchescala.worker.WorkerError.{BadVariableError, ValidatorError}
import zio.*

trait BaseWorker[In <: Product: InOutCodec, Out <: Product: InOutCodec]
    extends WorkerDsl[In, Out]:

  /** Maximum time a worker is allowed to execute before being interrupted.
    * Override this in your worker if you need a different timeout.
    * Default is 5 minutes.
    */
  protected def workerTimeout: Duration = 5.minutes

  protected def executeWithScope[T](jobId: String)(
      execution: ZIO[SttpClientBackend, Throwable, T]
  ): Unit =
    Unsafe.unsafe:
      implicit unsafe =>
        EngineRuntime.zioRuntime.unsafe.fork:
          execution
            .provideLayer(
              EngineRuntime.sharedExecutorLayer ++ HttpClientProvider.live ++ EngineRuntime.logger
            )
            .timeout(workerTimeout)
            .flatMap:
              case Some(value) =>
                ZIO.logDebug(s"Worker execution for job $jobId completed successfully").as(value)
              case None =>
                ZIO.logError(s"Worker execution for job $jobId timed out after $workerTimeout") *>
                  ZIO.fail(new RuntimeException(s"Worker execution timed out after $workerTimeout"))
                    .tapError(err => ZIO.logError(s"Worker execution for job $jobId failed: ${err.getMessage}"))
            .catchAll: ex =>
              ZIO.logError(s"Worker execution for job $jobId failed: ${ex.getMessage}\n${ex.getStackTrace.mkString("\n")}")
                .unit // Return unit instead of failing
        

  protected def extractGeneralVariables(json: Json) =
    ZIO.fromEither(
      customDecodeAccumulating[GeneralVariables](json.hcursor)
    ).mapError(ex =>
      ValidatorError(
        s"Problem extract general variables from $json\n" + ex.getMessage
      )
    )

  protected def extractBusinessKey(json: Json) =
    ZIO.fromEither(json.as[BusinessKey].map(_.businessKey.getOrElse("no businessKey")))
      .mapError(ex =>
        ValidatorError(
          s"Problem extract business Key from $json\n" + ex.getMessage
        )
      )

  protected def processVariable(
      key: String,
      json: Json
  ): IO[BadVariableError, (String, Option[Json])] =
    json.hcursor.downField(key).as[Option[Json]] match
      case Right(value) =>
        ZIO.succeed(key -> value)
      case Left(ex)     =>
        ZIO.fail(BadVariableError(ex.getMessage))

  protected def isErrorHandled(error: WorkerError, handledErrors: Seq[String]): Boolean =
    error.isMock || // if it is mocked, it is handled in the error, as it also could be a successful output
      handledErrors.contains(error.errorCode.toString) || // if the error code is in the handled errors
      handledErrors.contains(error.causeError.map(_.errorCode.toString).getOrElse("NOT-HANDLED")) || // if the cause error code is in the handled errors
      handledErrors.map(  // if there is a catchall
        _.toLowerCase
      ).contains("catchall")

  case class BusinessKey(businessKey: Option[String])

  object BusinessKey:
    given InOutCodec[BusinessKey] = deriveInOutCodec

end BaseWorker
