package orchescala.engine.c7

import orchescala.domain.CamundaVariable
import org.camunda.community.rest.client.dto.VariableValueDto

import scala.jdk.CollectionConverters.*

trait C7EventService :
  protected def mapToC7Variables(
                                variables: Option[Map[String, CamundaVariable]]
                              ): java.util.Map[String, VariableValueDto] =
    variables
      .map: in =>
        in
          .map:
            case (k, v) =>
              k -> new VariableValueDto()
                .value(v.value)
                .`type`(v.`type`)
      .getOrElse(Map.empty)
      .asJava
