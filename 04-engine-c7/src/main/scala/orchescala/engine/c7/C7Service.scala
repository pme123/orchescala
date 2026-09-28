package orchescala.engine.c7

import orchescala.domain.CamundaVariable
import orchescala.domain.CamundaVariable.*
import orchescala.engine.domain.{EngineError, EngineType}
import orchescala.engine.services.EngineService
import org.camunda.community.rest.client.dto.VariableValueDto
import org.camunda.community.rest.client.invoker.ApiException
import zio.{IO, ZIO}

trait C7Service extends EngineService:
  lazy val engineType: EngineType = EngineType.C7

  protected def toVariableValue(valueDto: VariableValueDto): IO[EngineError, CamundaVariable] =
    val value = valueDto.getValue
    if value == null then ZIO.succeed(CNull)
    else
      (valueDto.getType.toLowerCase match
        case "null" => ZIO.succeed(CNull)
        case "string" => ZIO.attempt(CString(value.toString))
        case "integer" | "int" => ZIO.attempt(CInteger(value.toString.toInt))
        case "long" => ZIO.attempt(CLong(value.toString.toLong))
        case "double" => ZIO.attempt(CDouble(value.toString.toDouble))
        case "boolean" => ZIO.attempt(CBoolean(value.toString.toBoolean))
        case "json" => ZIO.attempt(CJson(value.toString))
        case "file" => ZIO.attempt(CFile(value.toString, CFileValueInfo("not_set", None)))
        case _ => ZIO.attempt(CString(value.toString))
        ).mapError: err =>
        EngineError.ProcessError(
          s"Problem converting VariableDto '${valueDto.getType} -> $value: $err"
        )
    end if
  end toVariableValue
end C7Service

object C7Service:

  /** A client error (4xx) of the engine's REST API keeps its status - the gateway answers with it
    * (e.g. 404 for an unknown id, 401 for a rejected token) instead of 500 for any error.
    */
  def withStatus(cause: Any)(error: EngineError): EngineError =
    cause match
      case ex: ApiException if ex.getCode >= 400 && ex.getCode < 500 =>
        EngineError.ServiceRequestError(ex.getCode, error.errorMsg)
      case _                                                          =>
        error

end C7Service
