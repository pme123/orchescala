package orchescala.engine.c8

import orchescala.domain.*
import scala.util.Try
import scala.jdk.CollectionConverters.*

def jsonToVariablesMap(json: Json): Map[String, Any] =
  json.asObject.map(_.toMap.map { case (k, v) => k -> jsonToValue(v) }).getOrElse(Map.empty)

def jsonToVariablesMap(json: Map[String, Any]): Map[String, Any] =
  jsonToVariablesMap(Json.obj(json.toSeq.map { case (k, v) => k -> valueToJson(v) } *))

private def jsonToValue(json: Json): Any =
  json.fold(
    jsonNull = null,
    jsonBoolean = identity,
    jsonNumber = d => Try(d.toDouble).toOption.getOrElse(Try(d.toLong).toOption.orNull),
    jsonString = identity,
    jsonArray = _.map(jsonToValue).toList.asJava,
    jsonObject = obj => obj.toMap.map { case (k, v) => k -> jsonToValue(v) }.asJava
  )
