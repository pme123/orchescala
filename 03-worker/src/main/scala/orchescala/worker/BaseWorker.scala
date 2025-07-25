package orchescala.worker

import orchescala.domain.*
import orchescala.engine.EngineRuntime
import orchescala.worker.*
import orchescala.worker.WorkerError.{BadVariableError, ValidatorError}
import zio.*

trait BaseWorker[In <: Product: InOutCodec, Out <: Product: InOutCodec]
    extends WorkerDsl[In, Out]:

  protected def executeWithScope[T](execution: ZIO[SttpClientBackend, Throwable, T], jobId: String): Unit =
    Unsafe.unsafe:
      implicit unsafe =>
        EngineRuntime.zioRuntime.unsafe.fork:
          ZIO.scoped:
            for
              fiber <- execution
                         .provideLayer(EngineRuntime.sharedExecutorLayer ++ HttpClientProvider.live ++ EngineRuntime.logger)
                         .fork
              _     <- ZIO.addFinalizer:
                         fiber.status.flatMap: status =>
                           fiber.interrupt.when(!status.isDone)
              result <- fiber.join
            yield result
          .ensuring:
            ZIO.logDebug(s"Worker execution for job $jobId completed and resources cleaned up")

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
      case Right(value) => ZIO.succeed(key -> value)
      case Left(ex) => ZIO.fail(BadVariableError(ex.getMessage))
  
  case class BusinessKey(businessKey: Option[String])

  object BusinessKey:
    given InOutCodec[BusinessKey] = deriveInOutCodec
    
end BaseWorker