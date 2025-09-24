package orchescala.engine
package c7

import orchescala.domain.CamundaVariable.*
import orchescala.domain.{CamundaProperty, CamundaVariable, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.ProcessInfo
import orchescala.engine.services.ProcessInstanceService
import org.camunda.community.rest.client.api.{ProcessDefinitionApi, ProcessInstanceApi}
import org.camunda.community.rest.client.dto.{StartProcessInstanceDto, VariableValueDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}
import scala.jdk.CollectionConverters.*

class C7ProcessInstanceService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends ProcessInstanceService:

  override def startProcessAsync(
      processDefId: String,
      in: Json,
      businessKey: Option[String] = None
  ): IO[EngineError, ProcessInfo] =

    for
      apiClient        <- apiClientZIO
      _                <- logDebug(s"Starting Process '$processDefId' with variables: $in")
      processVariables <- C7VariableMapper.toC7Variables(in)
      _                <- logDebug(s"Starting Process '$processDefId' with variables: $processVariables")
      instance         <- callStartProcessAsync(processDefId, businessKey, apiClient, processVariables)
    yield ProcessInfo(
      processInstanceId = instance.getId,
      businessKey = Option(instance.getBusinessKey),
      status = ProcessInfo.ProcessStatus.Active
    )
  end startProcessAsync

  private def callStartProcessAsync(
      processDefId: String,
      businessKey: Option[String],
      apiClient: ApiClient,
      processVariables: Map[String, VariableValueDto]
  ) =
    ZIO
      .attempt:
        engineConfig.tenantId
          .map: tenantId =>
            new ProcessDefinitionApi(apiClient)
              .startProcessInstanceByKeyAndTenantId(
                processDefId,
                tenantId,
                new StartProcessInstanceDto()
                  .variables(processVariables.asJava)
                  .businessKey(businessKey.orNull)
              )
          .getOrElse:
            new ProcessDefinitionApi(apiClient)
              .startProcessInstanceByKey(
                processDefId,
                new StartProcessInstanceDto()
                  .variables(processVariables.asJava)
                  .businessKey(businessKey.orNull)
              )
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem starting Process '$processDefId': ${err.getMessage}"
        )

  def getVariables(processInstanceId: String, inOut: Product): IO[EngineError, Seq[JsonProperty]] =
    for
      apiClient    <- apiClientZIO
      variableDtos <-
        ZIO
          .attempt:
            new ProcessInstanceApi(apiClient)
              .getProcessInstanceVariables(processInstanceId, false)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Variables for Process Instance '$processInstanceId': ${err.getMessage}"
            )
      variables    <-
        ZIO
          .foreach(filterVariables(inOut, variableDtos)):
            case k -> dto =>
              toVariableValue(dto).map(v => JsonProperty(k, v.toJson))
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem converting Variables for Process Instance '$processInstanceId' to Json: ${err.getMessage}"
            )
      _            <- logInfo(s"Variables for Process Instance '$processInstanceId': $variables")
    yield variables.toSeq

  private def filterVariables(inOut: Product, variableDtos: java.util.Map[String, VariableValueDto]) =
    variableDtos
      .asScala
      .filter: p =>
        p._2.getValue != null &&
          inOut.productElementNames.toSeq.contains(p._1)

  private def toVariableValue(valueDto: VariableValueDto): IO[EngineError, CamundaVariable] =
    val value = valueDto.getValue
    (valueDto.getType.toLowerCase match
      case "null"            => ZIO.attempt(CNull)
      case "string"          => ZIO.attempt(CString(value.toString))
      case "integer" | "int" => ZIO.attempt(CInteger(value.toString.toInt))
      case "long"            => ZIO.attempt(CLong(value.toString.toLong))
      case "double"          => ZIO.attempt(CDouble(value.toString.toDouble))
      case "boolean"         => ZIO.attempt(CBoolean(value.toString.toBoolean))
      case "json"            => ZIO.attempt(CJson(value.toString))
      case "file"            => ZIO.attempt(CFile(value.toString, CFileValueInfo("not_set", None)))
      case _                 => ZIO.attempt(CString(value.toString))
    ).mapError: err =>
      EngineError.ProcessError(
        s"Problem converting VariableDto '${valueDto.getType} -> $value: ${err.getMessage}"
      )
  end toVariableValue

end C7ProcessInstanceService
