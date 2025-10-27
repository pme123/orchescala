package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.response.ProcessInstanceEvent
import io.camunda.client.api.search.response.Variable
import orchescala.domain.JsonProperty
import orchescala.engine.*
import orchescala.engine.domain.EngineType.C8
import orchescala.engine.domain.{EngineError, ProcessInfo}
import orchescala.engine.services.ProcessInstanceService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8ProcessInstanceService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends ProcessInstanceService, C8Service:

  def startProcessAsync(
      processDefId: String,
      in: Json,
      businessKey: Option[String],
      tenantId: Option[String]
  ): IO[EngineError, ProcessInfo] =
    for
      camundaClient <- camundaClientZIO
      _             <- logDebug(s"Starting Process '$processDefId' with variables: $in")
      instance      <- callStartProcessAsync(processDefId, businessKey, tenantId, camundaClient, in)
    yield ProcessInfo(
      processInstanceId = instance.getProcessInstanceKey.toString,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active,
      engineType = C8
    )

  private def callStartProcessAsync(
      processDefId: String,
      businessKey: Option[String],
      tenantId: Option[String],
      c8Client: CamundaClient,
      processVariables: Json
  ): IO[EngineError.ProcessError, ProcessInstanceEvent] =
    ZIO
      .attempt:
        val variables = processVariables.deepMerge(businessKey.map(bk =>
          Json.obj("businessKey" -> bk.asJson)
        ).getOrElse(Json.obj()))

        val variablesMap      = jsonToVariablesMap(variables)
        val command           = c8Client
          .newCreateInstanceCommand()
          .bpmnProcessId(processDefId)
          .latestVersion()
          .variables(variablesMap.asJava)
        val commandWithTenant =
          tenantId
            .orElse(engineConfig.tenantId)
            .map: tenantId =>
              command.tenantId(tenantId)
            .getOrElse(command)

        commandWithTenant.send().join()
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem starting Process '$processDefId': $err"
        )

  def getVariablesInternal(
      processInstanceId: String,
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[JsonProperty]] =
    for
      camundaClient <- camundaClientZIO
      variableDtos  <-
        ZIO
          .attempt:
            camundaClient
              .newVariableSearchRequest()
              .filter(_.processInstanceKey(processInstanceId.toLong))
              .send()
              .join()
              .items()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Variables for Process Instance '$processInstanceId': $err"
            )
      variables     <-
        ZIO
          .foreach(filterVariables(variableFilter, variableDtos.asScala.toSeq)): dto =>
            toVariableValue(dto)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem converting Variables for Process Instance '$processInstanceId' to Json: $err"
            )
      _             <- logInfo(s"Variables for Process Instance '$processInstanceId': $variables")
    yield variables

  private def filterVariables(variableFilter: Option[Seq[String]], variableDtos: Seq[Variable]) =
    if variableFilter.isEmpty then variableDtos
    else
      variableDtos
        .filter: v =>
          v.getValue != null &&
            variableFilter.toSeq.flatten.contains(v.getName)

  private def toVariableValue(valueDto: Variable): IO[EngineError, JsonProperty] =
    val value = valueDto.getValue
    (value match
      case "null" =>
        ZIO.attempt(Json.Null)
      case str    =>
        ZIO.fromEither(parser.parse(str))
    )
      .map: v =>
        JsonProperty(valueDto.getName, v)
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem converting VariableDto '${valueDto.getName} -> $value: $err"
        )

  end toVariableValue

end C8ProcessInstanceService
