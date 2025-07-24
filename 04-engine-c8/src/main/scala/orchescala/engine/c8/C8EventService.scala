package orchescala.engine.c8

import orchescala.domain.CamundaVariable

import scala.jdk.CollectionConverters.*

trait C8EventService:
  protected def mapToC8Variables(
      variables: Option[Map[String, CamundaVariable]]
  ): Map[String, Any] =
    variables
      .map { in =>
        in
          .collect {
            case (k, v) if v.value != null =>
              k -> v.value
          }
      }
      .getOrElse(Map.empty)