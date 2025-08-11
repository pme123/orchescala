package orchescala.engine.c8

import orchescala.domain.*
import scala.util.Try
import scala.jdk.CollectionConverters.*

def jsonToVariablesMap(json: Json): Map[String, Any] =
  json.asObject.map(_.toMap.map { case (k, v) => k -> jsonToValue(v) }).getOrElse(Map.empty)

def jsonToVariablesMap(json: Map[String, Any]): Map[String, Any] =
  jsonToVariablesMap(Json.obj(json.toSeq.map { case (k, v) => k -> valueToJson(v) } *))

protected def mapToC8Variables(
                                variables: Option[Map[String, CamundaVariable]]
                              ): java.util.Map[String, Any] =
  variables
    .map { in =>
      in
        .collect :
          case (k, v) if v.value != null =>
            k -> v.value
        .asJava
    }
    .getOrElse(Map.empty.asJava)

private def jsonToValue(json: Json): Any =
  json.fold(
    jsonNull = null,
    jsonBoolean = identity,
    jsonNumber = d => Try(d.toDouble).toOption.getOrElse(Try(d.toLong).toOption.orNull),
    jsonString = identity,
    jsonArray = _.map(jsonToValue).toList.asJava,
    jsonObject = obj => obj.toMap.map { case (k, v) => k -> jsonToValue(v) }.asJava
  )
