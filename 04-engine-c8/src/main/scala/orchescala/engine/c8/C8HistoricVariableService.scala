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
          .fromFutureJava:
            // Same semantics as C7 (`executionIdIn(processInstanceId)`): only the variables of the
            // process instance's root scope, not the local ones of tasks / call activities /
            // multi-instance bodies - those may shadow a root variable with the same name (e.g.
            // a call activity's local `processStatus`). Without an explicit page the client
            // returns the first 100 variables only, and a long-running instance easily has more
            // (each task with an ioMapping adds a local scope), so the last ones (typically the
            // outputs set on the end event) would be missing.
            // The variable names (`variableName` or the `variableFilter` list) are filtered
            // server-side (`name in [...]`) - only what is asked for is fetched.
            camundaClient
              .newVariableSearchRequest()
              .filter(f =>
                processInstanceId.foreach: pid =>
                  f.processInstanceKey(pid.toLong)
                    .scopeKey(pid.toLong)
                variableNames(variableName, variableFilter) match
                  case Seq(single) => f.name(single)
                  case Seq()       => ()
                  case names       => f.name(_.in(names.asJava))
              )
              .page(_.limit(C8Service.variablesPageLimit))
              .send()
          .map:
              _.items()
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
