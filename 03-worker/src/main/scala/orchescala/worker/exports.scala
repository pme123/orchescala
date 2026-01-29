package orchescala
package worker

import io.circe.*
import orchescala.domain.*
import orchescala.engine.rest.SttpClientBackend
import orchescala.worker.WorkerError.*
import zio.{IO, ZIO}

import java.util.Date

export sttp.model.Uri.UriContext
export sttp.model.Method
export sttp.model.Uri

export zio.ZIO
export zio.IO

type SendRequestType[ServiceOut] =
  EngineRunContext ?=> ZIO[SttpClientBackend, ServiceError, ServiceResponse[ServiceOut]]

type RunWorkZIOOutput[Out] =
  EngineRunContext ?=> IO[CustomError, Out]

type InitProcessZIOOutput[InitIn] =
  EngineRunContext ?=> IO[InitProcessError, InitIn]

def decodeTo[A: InOutDecoder](
    jsonStr: String
): IO[WorkerError.UnexpectedError, A] =
  ZIO.fromEither(io.circe.parser
    .decodeAccumulating[A](jsonStr)
    .toEither)
    .mapError { ex =>
      WorkerError.UnexpectedError(errorMsg =
        ex.toList
          .map(_.getMessage())
          .mkString(
            "Decoding Error: Json is not valid:\n - ",
            "\n - ",
            s"\n * Json: ${jsonStr.take(3500)}\n" // 4000 throws error in Camunda.
          )
      )
    }
end decodeTo

type HandledErrorCodes = Seq[ErrorCodeType]

sealed trait WorkerError extends OrchescalaError:
  def isMock                                     = false
  def generalVariables: Option[GeneralVariables] = None

sealed trait ErrorWithOutput extends WorkerError:
  def output: Map[String, Any]

object WorkerError:

  case class CamundaBpmnError(errorCode: ErrorCodes, errorMsg: String)

  case class ValidatorError(
      errorMsg: String
  ) extends ErrorWithOutput:
    val errorCode: ErrorCodes    = ErrorCodes.`validation-failed`
    def output: Map[String, Any] = Map("validationErrors" -> errorMsg)
  end ValidatorError

  case class MockedOutput(
      output: Map[String, Any],
      errorMsg: String = "Output mocked"
  ) extends ErrorWithOutput:
    val errorCode: ErrorCodes = ErrorCodes.`output-mocked`
    override val isMock       = true
  end MockedOutput

  case class MockedOutputJson(
      output: Json,
      errorMsg: String = "Output mocked as Json"
  ) extends WorkerError:
    val errorCode: ErrorCodes = ErrorCodes.`output-mocked`
    override val isMock       = true
  end MockedOutputJson

  case object AlreadyHandledError extends WorkerError:
    val errorMsg: String      = "Error already handled."
    val errorCode: ErrorCodes = ErrorCodes.`error-already-handled`

  case class InitProcessError(
      errorMsg: String = "Problems initialize default variables of the Process."
  ) extends WorkerError:
    val errorCode: ErrorCodes = ErrorCodes.`error-unexpected`

  case class MockerError(
      errorMsg: String
  ) extends WorkerError:
    val errorCode: ErrorCodes = ErrorCodes.`mocking-failed`

  case class MappingError(
      errorMsg: String
  ) extends WorkerError:
    val errorCode: ErrorCodes = ErrorCodes.`mapping-error`

  case class UnexpectedError(
      errorMsg: String
  ) extends WorkerError:
    val errorCode: ErrorCodes = ErrorCodes.`error-unexpected`
  
  case class HandledRegexNotMatchedError(
      errorMsg: String
  ) extends WorkerError:
    val errorCode: ErrorCodes = ErrorCodes.`error-handledRegexNotMatched`

  object HandledRegexNotMatchedError:
    def apply(error: WorkerError, regexHandledErrors: Seq[String]): HandledRegexNotMatchedError =
      HandledRegexNotMatchedError(
        s"""The error was handled, but did not match the defined 'regexHandledErrors'.
           |Original Error: ${error.errorCode} - ${error.errorMsg}
           |Regexes: ${regexHandledErrors.mkString(">", "<, >", "<")}
           |""".stripMargin
      )
  end HandledRegexNotMatchedError

  case class BadVariableError(
      errorMsg: String
  ) extends WorkerError:
    val errorCode: ErrorCodes = ErrorCodes.`bad-variable`

  sealed trait RunWorkError extends WorkerError

  case class BadSignatureError(
                                errorMsg: String
                              ) extends RunWorkError:
    val errorCode: ErrorCodes = ErrorCodes.`service-auth-error`

  case class MissingHandlerError(
      errorMsg: String
  ) extends RunWorkError:
    val errorCode: ErrorCodes = ErrorCodes.`running-failed`

  case class CustomError(
      errorMsg: String,
      override val generalVariables: Option[GeneralVariables] = None,
      override val causeError: Option[WorkerError] = None
  ) extends RunWorkError:
    val errorCode: ErrorCodes = ErrorCodes.`custom-run-error`
  end CustomError

  case class UnexpectedRunError(
      errorMsg: String
  ) extends RunWorkError:
    val errorCode: ErrorCodes = ErrorCodes.`error-unexpected`

  trait ServiceError extends RunWorkError

  case class ServiceMappingError(
      errorMsg: String
  ) extends ServiceError:
    val errorCode: ErrorCodes = ErrorCodes.`service-mapping-error`

  case class ServiceMockingError(
      errorMsg: String
  ) extends ServiceError:
    val errorCode: ErrorCodes = ErrorCodes.`service-mocking-error`

  case class ServiceBadPathError(
      errorMsg: String
  ) extends ServiceError:
    val errorCode: ErrorCodes = ErrorCodes.`service-bad-path-error`

  case class ServiceAuthError(
      errorMsg: String
  ) extends ServiceError:
    val errorCode: ErrorCodes = ErrorCodes.`service-auth-error`

  object ServiceAuthError:
    def apply(ex: WorkerError): ServiceAuthError =
      ServiceAuthError(s"Problem authenticating request: $ex")
  end ServiceAuthError

  case class ServiceBadBodyError(
      errorMsg: String
  ) extends ServiceError:
    val errorCode: ErrorCodes = ErrorCodes.`service-bad-body-error`

  case class ServiceUnexpectedError(
      errorMsg: String
  ) extends ServiceError:
    val errorCode: ErrorCodes = ErrorCodes.`service-unexpected-error`

  case class ServiceRequestError(
      errorCode: Int,
      errorMsg: String
  ) extends ServiceError

  object ServiceRequestError:
    given InOutCodec[ServiceRequestError] = deriveCodec
    given ApiSchema[ServiceRequestError]  = deriveApiSchema

    def apply(err: WorkerError): ServiceRequestError =
      err match
        case ValidatorError(msg)            => ServiceRequestError(400, msg)
        case ServiceAuthError(msg)          => ServiceRequestError(401, msg)
        case ServiceBadBodyError(msg)       => ServiceRequestError(400, msg)
        case ServiceBadPathError(msg)       => ServiceRequestError(404, msg)
        case ServiceMappingError(msg)       => ServiceRequestError(400, msg)
        case ServiceRequestError(code, msg) => ServiceRequestError(code, msg)
        case ServiceUnexpectedError(msg)    => ServiceRequestError(500, msg)
        case err                            =>
      end match
      ServiceRequestError(500, err.errorMsg)
    end apply
  end ServiceRequestError

  case class TokenValidationError(
      errorMsg: String,
      errorCode: ErrorCodes = ErrorCodes.`mapping-error`
  ) extends WorkerError

  def requestMsg[ServiceIn: InOutEncoder](
      runnableRequest: RunnableRequest[ServiceIn]
  ): String =
    s""" - Request URL: ${prettyUriString(
        runnableRequest.apiUri.addQuerySegments(runnableRequest.qSegments)
      )}
       | - Request Body: ${runnableRequest.requestBodyOpt
        .map(_.asJson.deepDropNullValues)
        .getOrElse("")}
       | - Request Header: ${runnableRequest.headers.map { case k -> v => s"$k -> $v" }.mkString(
        ", "
      )}""".stripMargin

  def serviceErrorMsg[ServiceIn: InOutEncoder](
      status: Int,
      errorMsg: String,
      runnableRequest: RunnableRequest[ServiceIn]
  ): String =
    s"""Service Error: $status
       |ErrorMsg: $errorMsg
       |${requestMsg(runnableRequest)}""".stripMargin
end WorkerError

def niceClassName(clazz: Class[?]) =
  clazz.getName.split("""\$""").head

def printTimeOnConsole(start: Date) =
  val time  = new Date().getTime - start.getTime
  val color = if time > 1000 then Console.YELLOW_B
  else if time > 250 then Console.MAGENTA
  else Console.BLACK
  s"($color$time ms${Console.RESET})"
end printTimeOnConsole

def extractGeneralVariables(json: Json) =
  ZIO.fromEither(
    customDecodeAccumulating[GeneralVariables](json.hcursor)
  ).mapError(ex =>
    ValidatorError(
      s"Problem extract general variables from $json\n" + ex.getMessage
    )
  )
