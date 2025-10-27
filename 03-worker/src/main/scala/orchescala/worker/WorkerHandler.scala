package orchescala
package worker

import io.circe
import orchescala.domain.*
import orchescala.worker.WorkerError.*
import sttp.model.{Method, Uri}
import zio.{IO, ZIO}

import scala.reflect.ClassTag

trait WorkerHandler[In <: Product: InOutCodec, Out <: Product: InOutCodec]:
  def worker: Worker[In, Out, ?]
  def topic: String

  type RunnerOutput =
    EngineRunContext ?=> IO[RunWorkError, Out]

  def applicationName: String
  def registerHandler(register: => Unit): Unit =
    val appPackageName = applicationName.replace("-", ".")
    val testMode       = sys.env.get("WORKER_TEST_MODE").contains("true") // did not work with lazy val
    if testMode || getClass.getName.startsWith(appPackageName)
    then
      register
      logger.info(s"Old Worker registered: $topic -> ${worker.getClass.getSimpleName}")
      logger.debug(prettyString(worker))
    else
      logger.info(
        s"Worker NOT registered: $topic -> ${worker.getClass.getSimpleName} (class starts not with $appPackageName)"
      )
    end if
  end registerHandler

  protected lazy val logger: OrchescalaLogger
end WorkerHandler

/** handler for Custom Validation (next to the automatic Validation of the In Object.
  *
  * For example if one of two optional variables must exist.
  *
  * Usage:
  * ```
  *  .withValidation(
  *    ValidationHandler(
  *      (in: In) => Right(in)
  *    )
  *  )
  * ```
  * or (with implicit conversion)
  * ```
  *  .withValidation(
  *      (in: In) => Right(in)
  *  )
  * ```
  * Default is no extra Validation.
  */
trait ValidationHandler[In <: Product: circe.Codec]:
  def validate(in: In): Either[ValidatorError, In]
end ValidationHandler

object ValidationHandler:
  def apply[
      In <: Product: InOutCodec
  ](funct: In => Either[ValidatorError, In]): ValidationHandler[In] =
    new ValidationHandler[In]:
      override def validate(in: In): Either[ValidatorError, In] =
        funct(in)
end ValidationHandler

type InitProcessFunction =
  EngineRunContext ?=> IO[InitProcessError, Map[String, Any]]

/** handler for Custom Process Initialisation. All the variables in the Result Map will be put on
  * the process.
  *
  * For example if you want to init process Variables to a certain value.
  *
  * Usage:
  * ```
  *  .withValidation(
  *    InitProcessHandler(
  *      (in: In) => {
  *       Right(
  *         Map("isCompany" -> true)
  *       ) // success
  *      }
  *    )
  *  )
  * ```
  * or (with implicit conversion)
  * ```
  *  .withValidation(
  *      (in: In) => {
  *       Right(
  *         Map("isCompany" -> true)
  *       ) // success
  *      }
  *  )
  * ```
  * Default is no Initialization.
  */
trait InitProcessHandler[
    In <: Product: InOutCodec
]:
  def init(input: In): InitProcessFunction
end InitProcessHandler
object InitProcessHandler:
  def apply[
      In <: Product: InOutCodec
  ](
      funct: In => EngineRunContext ?=> IO[InitProcessError, Map[String, Any]],
      processLabels: ProcessLabels
  ): InitProcessHandler[In] =
    new InitProcessHandler[In]:
      override def init(in: In): InitProcessFunction =
        funct(in)
          .map:
            _ ++ processLabels.toMap

end InitProcessHandler

trait RunWorkHandler[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec
]:

  type RunnerOutput    =
    EngineRunContext ?=> Either[RunWorkError, Out]
  type RunnerOutputZIO =
    EngineRunContext ?=> ZIO[SttpClientBackend, RunWorkError, Out]

  def runWorkZIO(inputObject: In): RunnerOutputZIO

end RunWorkHandler

case class ServiceHandler[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec,
    ServiceIn: InOutEncoder,
    ServiceOut: {InOutDecoder, ClassTag}
](
    httpMethod: Method,
    apiUri: In => Uri,
    querySegments: In => Seq[QuerySegmentOrParam],
    inputMapper: In => Option[ServiceIn],
    inputHeaders: In => Map[String, String],
    outputMapper: (ServiceResponse[ServiceOut], In) => Either[ServiceMappingError, Out],
    defaultServiceOutMock: MockedServiceResponse[ServiceOut],
    dynamicServiceOutMock: Option[In => MockedServiceResponse[ServiceOut]] = None,
    serviceInExample: ServiceIn
) extends RunWorkHandler[In, Out]:

  override def runWorkZIO(
      inputObject: In
  ): RunnerOutputZIO =
    for
      _                  <- ZIO.logDebug(s"Running Service: ${niceClassName(this.getClass)}")
      rRequest           <-
        ZIO.attempt(runnableRequest(inputObject))
          .mapError: err =>
            err.printStackTrace()
            ServiceUnexpectedError(
              s"There was an unexpected Error creating runnable Request: $err"
            )
      _                  <- ZIO.logDebug(s"Request created: ${rRequest.apiUri}")
      optWithServiceMock <- withServiceMock(rRequest, inputObject)
      _                  <- ZIO.logDebug(s"optWithServiceMock: $optWithServiceMock")
      output             <- handleMocking(optWithServiceMock, rRequest).getOrElse(
                              runService(rRequest, inputObject)
                            )
      _                  <- ZIO.logDebug(s"Output ready: $output")
    yield output
    end for
  end runWorkZIO

  private def runnableRequest(
      inputObject: In
  ): RunnableRequest[ServiceIn] =
    RunnableRequest(
      inputObject,
      httpMethod,
      apiUri(inputObject),
      querySegments(inputObject),
      inputMapper(inputObject),
      inputHeaders(inputObject)
    )

  private def withServiceMock(
      runnableRequest: RunnableRequest[ServiceIn],
      in: In
  )(using context: EngineRunContext): IO[ServiceError, Option[Out]] =
    (
      context.generalVariables.servicesMocked,
      context.generalVariables.outputServiceMock
    ) match
      case (_, Some(json)) =>
        (for
          _              <- ZIO.logDebug(s"Mocking Service with: $json")
          mockedResponse <- decodeMock[MockedServiceResponse[ServiceOut]](json)
          _              <- ZIO.logDebug(s"Mocked Response: $mockedResponse")
          out            <- handleServiceMock(mockedResponse, runnableRequest, in)
        yield out)
          .map(Some.apply)
      case (true, _)       =>
        handleServiceMock(
          dynamicServiceOutMock.map(_(in)).getOrElse(defaultServiceOutMock),
          runnableRequest,
          in
        )
          .map(Some.apply)
      case _               =>
        ZIO.none

  end withServiceMock

  private def decodeMock[Out: InOutDecoder](
      json: Json
  ): IO[ServiceMockingError, Out] =
    decodeTo[Out](json.asJson.deepDropNullValues.toString)
      .mapError(ex => ServiceMockingError(errorMsg = ex.causeMsg))
  end decodeMock

  private def handleMocking(
      optOutMock: Option[Out],
      runnableRequest: RunnableRequest[ServiceIn]
  )(using context: EngineRunContext): Option[IO[ServiceError, Out]] =
    optOutMock
      .map { mock =>
        context
          .getLogger(getClass)
          .debug(s"""Mocked Service: ${niceClassName(this.getClass)}
                    |${requestMsg(runnableRequest)}
                    | - mockedResponse: ${mock.asJson.deepDropNullValues}
                    |""".stripMargin)
        mock
      }
      .map(m => ZIO.succeed(m))
  end handleMocking

  private def handleServiceMock(
      mockedResponse: MockedServiceResponse[ServiceOut],
      runnableRequest: RunnableRequest[ServiceIn],
      in: In
  ): IO[ServiceError, Out] =
    mockedResponse match
      case MockedServiceResponse(_, Right(body), headers) =>
        ZIO
          .attempt:
            mapBodyOutput(body, headers, in)
          .mapError: err =>
            ServiceMappingError(s"Problem mapping mocked ServiceResponse to Out: $err")
          .flatMap:
            ZIO.fromEither
      case MockedServiceResponse(status, Left(body), _)   =>
        ZIO.fail(
          ServiceRequestError(
            status,
            serviceErrorMsg(
              status,
              s"Mocked Error: ${body.map(_.asJson.deepDropNullValues).getOrElse("-")}",
              runnableRequest
            )
          )
        )

  def mapBodyOutput(
      serviceOutput: ServiceOut,
      headers: Seq[Seq[String]],
      in: In
  ) =
    outputMapper(
      ServiceResponse(
        serviceOutput,
        // take correct ones and make a map of it
        headers
          .map(_.toList)
          .collect { case key :: value :: _ => key -> value }
          .toMap
      ),
      in
    )

  private def runService(
      runnableRequest: RunnableRequest[ServiceIn],
      in: In
  ): RunnerOutputZIO =

    for
      _          <- ZIO.logDebug(s"Sending Request: ${runnableRequest.apiUri}")
      serviceOut <-
        summon[EngineRunContext]
          .sendRequest[ServiceIn, ServiceOut](runnableRequest)
      _          <- ZIO.logDebug(s"Service Response: $serviceOut")
      eitherOut  <-
        ZIO
          .attempt(outputMapper(serviceOut, in))
          .mapError(err => ServiceMappingError(s"Problem mapping ServiceResponse to Out: $err"))
      _          <- ZIO.logDebug(s"Either Output: $eitherOut")
      out        <- ZIO.fromEither(eitherOut)
      _          <- ZIO.logDebug(s"Output: $out")
    yield out
  end runService

end ServiceHandler

trait CustomHandler[
    In <: Product: InOutCodec,
    Out <: Product: InOutCodec
] extends RunWorkHandler[In, Out]:

end CustomHandler

object CustomHandler:
  def apply[
      In <: Product: InOutCodec,
      Out <: Product: InOutCodec
  ](funct: In => RunWorkZIOOutput[Out]): CustomHandler[In, Out] =
    new CustomHandler[In, Out]:
      override def runWorkZIO(inputObject: In): RunnerOutputZIO =
        funct(inputObject)
end CustomHandler
