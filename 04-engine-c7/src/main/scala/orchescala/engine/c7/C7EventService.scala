package orchescala.engine
package c7

import orchescala.domain.CamundaVariable
import org.camunda.community.rest.client.dto.VariableValueDto

import scala.jdk.CollectionConverters.*

trait C7EventService extends C7Service:
  
  protected def mapToC7Variables(
                                variables: Option[JsonObject]
                              ): java.util.Map[String, VariableValueDto] =
    variables
      .map: in =>
        CamundaVariable
          .jsonObjectToProcessVariables(in)
          .map:
            case k -> v =>
              k -> new VariableValueDto()
                .value(v.value)
                .`type`(v.`type`)
      .getOrElse(Map.empty)
      .asJava
