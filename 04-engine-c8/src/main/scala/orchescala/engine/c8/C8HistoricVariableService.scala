package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.search.response.Variable
import orchescala.domain.CamundaVariable
import orchescala.domain.CamundaVariable.{CJson, CString}
import orchescala.engine.*
import orchescala.engine.domain.{EngineError, HistoricVariable}
import orchescala.engine.services.HistoricVariableService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8HistoricVariableService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends HistoricVariableService, C8Service:

  def getVariables(
      variableName: Option[String],
      processInstanceId: Option[String],
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[HistoricVariable]] =
    for
      camundaClient <- camundaClientZIO
      variableDtos  <-
        ZIO
          .attempt:
            camundaClient
              .newVariableSearchRequest()
              .filter(f =>
                (variableName, processInstanceId) match
                  case (Some(varName), Some(pid)) =>
                    f.name(varName)
                      .processInstanceKey(pid.toLong)
                  case (Some(varName), _)         => f.name(varName)
                  case (_, Some(pid))             => f.processInstanceKey(pid.toLong)
                  case _                          => ()
                end match
              ).send()
              .join()
              .items()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Historic Process Instance '$processInstanceId': $err"
            )
      _             <- ZIO.logDebug(s"VariableDtos found: ${variableDtos.asScala.toList.map(v =>
                           s"${v.getName} -> ${v.getValue}"
                         )}")
      variables     <-
        ZIO
          .attempt:
            mapToHistoricVariables(variableFilter, variableDtos.asScala.toSeq)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem mapping Historic Variables for Process Instance '${processInstanceId.mkString}': $err"
            )
    yield variables

  private def mapToHistoricVariables(
      variableFilter: Option[Seq[String]],
      variableDtos: Seq[Variable]
  ): Seq[HistoricVariable] =

    variableDtos
      .filter: dto =>
        variableFilter.isEmpty ||
          (dto.getValue != null &&
            variableFilter.toSeq.flatten.contains(dto.getName))
      .map: dto =>
        HistoricVariable(
          id = dto.getVariableKey.toString,
          name = dto.getName,
          value = mapToJson(dto),
          processDefinitionKey = None, // not supported
          processDefinitionId = None,  // not supported
          processInstanceId = Option(dto.getProcessInstanceKey).map(_.toString),
          activityInstanceId = None,   // not supported
          taskId = None,               // not supported
          tenantId = Option(dto.getTenantId),
          errorMessage = None,         // not supported
          state = None,                // not supported
          createTime = None,           // not supported
          removalTime = None,          // not supported
          rootProcessInstanceId = None // not supported
        )
  end mapToHistoricVariables

  private def mapToCamundaVariable(histVar: Variable): Option[CamundaVariable] =
    histVar.getValue match
      case null                                              => None
      case "null"                                            => None
      case v if v == "true" || v == "false"                  =>
        Some(CamundaVariable.CBoolean(histVar.getValue.toBoolean))
      case str if str.startsWith("\"") && str.endsWith("\"") =>
        Some(CamundaVariable.CString(str.drop(1).dropRight(1)))
      case str if str.startsWith("{") || str.startsWith("[") => Some(CamundaVariable.CJson(str))
      case v if v.toDoubleOption.isDefined                   => Some(CamundaVariable.CDouble(v.toDouble))
      case v if v.toLongOption.isDefined                     => Some(CamundaVariable.CLong(v.toLong))

  private def mapToJson(histVar: Variable): Option[Json] = 
    parser.parse(histVar.getValue) match
      case Right(v) if v.isNull  => None
      case Right(v)  => Some(v)
      case Left(exc) => Some(s"Problem parsing Variable from Camunda ${histVar.getName} - ${histVar.getValue}: $exc".asJson)

end C8HistoricVariableService
