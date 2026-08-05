package orchescala.engine.c8

import io.camunda.client.api.search.response.Variable
import orchescala.domain.*
import orchescala.domain.CamundaVariable.CJson
import orchescala.engine.domain.EngineError
import zio.{IO, ZIO}

import scala.util.Try
import scala.jdk.CollectionConverters.*

private[c8] def filterVariables(variableFilter: Option[Seq[String]], variableDtos: Seq[Variable]) =
  if variableFilter.isEmpty then variableDtos
  else
    variableDtos
      .filter: v =>
        v.getValue != null &&
          variableFilter.toSeq.flatten.contains(v.getName)

private[c8] def toVariableValue(valueDto: Variable): IO[EngineError, JsonProperty] =
  val value = valueDto.getValue
  (value match
    case null | "null" =>
      ZIO.attempt(Json.Null)
    case str =>
      ZIO.fromEither(parser.parse(str))
    )
    .map: v =>
      JsonProperty(valueDto.getName, v)
    .mapError: err =>
      EngineError.ProcessError(
        s"Problem converting VariableDto '${valueDto.getName} -> $value: $err"
      )

end toVariableValue

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
