package orchescala.engine.c8

import orchescala.domain.*
import orchescala.domain.CamundaVariable.CJson
import orchescala.engine.domain.EngineError
import zio.{IO, ZIO}

import scala.util.Try
import scala.jdk.CollectionConverters.*

def jsonToVariablesMap(json: Json): Map[String, Any] =
  json.asObject.map(_.toMap.map { case (k, v) => k -> jsonToValue(v) }).getOrElse(Map.empty)

def jsonToVariablesMap(json: Map[String, Any]): Map[String, Any] =
  jsonToVariablesMap(Json.obj(json.toSeq.map { case (k, v) => k -> valueToJson(v) }*))

def mapToC8Variables(
    variables: Option[Map[String, CamundaVariable]]
): IO[EngineError, java.util.Map[String, Any]] =
  variables
    .map: in =>
      ZIO
        .foreach(in.filter((_, v) => v.value != null)):
          case k -> (v: CJson) =>
            ZIO
              .fromEither(parser.parse(v.value))
              .map:
                k -> _
              .mapError:
                err =>
                  EngineError.ProcessError(
                    s"Problem parsing Json for Variable '$k -> ${v.value}': $err"
                  )
          case (k, v) =>
            ZIO.succeed(k -> v.value)
        .map:
          _.asJava
    .getOrElse(ZIO.succeed(Map.empty.asJava))

private def jsonToValue(json: Json): Any =
  json.fold(
    jsonNull = null,
    jsonBoolean = identity,
    jsonNumber = d => Try(d.toDouble).toOption.getOrElse(Try(d.toLong).toOption.orNull),
    jsonString = identity,
    jsonArray = _.map(jsonToValue).toList.asJava,
    jsonObject = obj => obj.toMap.map { case (k, v) => k -> jsonToValue(v) }.asJava
  )
