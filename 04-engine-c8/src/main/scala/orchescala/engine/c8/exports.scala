package orchescala.engine.c8

import orchescala.domain.*
import orchescala.domain.CamundaVariable.CJson
import orchescala.engine.domain.EngineError
import zio.{IO, ZIO}

import scala.util.Try
import scala.jdk.CollectionConverters.*

/** Variable names to filter server-side: the single `variableName` and/or the `variableFilter`
  * list, deduplicated. Empty means "all variables of the scope".
  */
private[c8] def variableNames(
    variableName: Option[String],
    variableFilter: Option[Seq[String]]
): Seq[String] =
  (variableName.toSeq ++ variableFilter.toSeq.flatten).distinct

private[c8] def filterVariables(
    variableFilter: Option[Seq[String]],
    variableDtos: Seq[C8RestModel.VariableResult]
) =
  if variableFilter.isEmpty then variableDtos
  else
    variableDtos
      .filter: v =>
        v.value.isDefined &&
          variableFilter.toSeq.flatten.contains(v.name)

private[c8] def toVariableValue(valueDto: C8RestModel.VariableResult): IO[EngineError, JsonProperty] =
  (valueDto.value match
    case None | Some("null") =>
      ZIO.succeed(Json.Null)
    case Some(str)           =>
      ZIO.fromEither(parser.parse(str))
  )
    .map: v =>
      JsonProperty(valueDto.name, v)
    .mapError: err =>
      EngineError.ProcessError(
        s"Problem converting VariableDto '${valueDto.name} -> ${valueDto.value.orNull}: $err"
      )

end toVariableValue

/** Variables of a process instance's root scope - the same semantics as C7
  * (`executionIdIn(processInstanceId)`): not the local ones of tasks / call activities /
  * multi-instance bodies, which may shadow a root variable with the same name (e.g. a call
  * activity's local `processStatus`). Names are filtered server-side, all pages are read and the
  * values are never truncated (the API cuts values longer than ~8KB by default).
  */
private[c8] def searchVariables(
    processInstanceId: Option[String],
    names: Seq[String]
)(using rest: C8RestClient): IO[EngineError, Seq[C8RestModel.VariableResult]] =
  for
    processInstanceKey <- ZIO.foreach(processInstanceId)(toKey("processInstanceId"))
    variables          <- rest.searchAll[C8RestModel.VariableResult](
                            Seq("variables", "search"),
                            C8RestModel.filter(
                              "processInstanceKey" -> processInstanceKey.map(Json.fromString),
                              "scopeKey"           -> processInstanceKey.map(Json.fromString),
                              "name"               -> C8RestModel.nameFilter(names)
                            ),
                            query = Map("truncateValues" -> "false")
                          )
  yield variables

/** Validates that an id is a C8 key (a number) - the API rejects anything else anyway, this gives a
  * clear error before the call.
  */
private[c8] def toKey(name: String)(id: String): IO[EngineError, String] =
  ZIO
    .fromOption(id.trim.toLongOption.map(_.toString))
    .orElseFail(EngineError.ProcessError(s"$name '$id' is not a valid C8 key (a number)."))

/** Adds context to an error of the REST client - an HTTP status is kept, so the gateway can pass
  * it on (404, 400, 401, 403).
  */
private[c8] def withContext(context: String)(err: EngineError): EngineError =
  err match
    case e: EngineError.ServiceRequestError => e.copy(errorMsg = s"$context: ${e.errorMsg}")
    case e                                  => EngineError.ProcessError(s"$context: ${e.errorMsg}")

def jsonToVariablesMap(json: Json): Map[String, Any] =
  json.asObject.map(_.toMap.map { case (k, v) => k -> jsonToValue(v) }).getOrElse(Map.empty)

def jsonToVariablesMap(json: Map[String, Any]): Map[String, Any] =
  jsonToVariablesMap(Json.obj(json.toSeq.map { case (k, v) => k -> valueToJson(v) }*))

private def jsonToValue(json: Json): Any =
  json.fold(
    jsonNull = null,
    jsonBoolean = identity,
    jsonNumber = d => Try(d.toDouble).toOption.getOrElse(Try(d.toLong).toOption.orNull),
    jsonString = identity,
    jsonArray = _.map(jsonToValue).toList.asJava,
    jsonObject = obj => obj.toMap.map { case (k, v) => k -> jsonToValue(v) }.asJava
  )
