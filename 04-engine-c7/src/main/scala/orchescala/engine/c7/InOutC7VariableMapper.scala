package orchescala.engine.c7

import orchescala.domain.*
import orchescala.domain.CamundaVariable.CJson
import org.camunda.community.rest.client.dto.VariableValueDto

object InOutC7VariableMapper :
  
  def toC7Variables[In <: Product: InOutEncoder](in: In): Map[String, VariableValueDto] =
    CamundaVariable.toCamunda(in)
      .map((k, v) =>
        k -> toC7VariableValue(v)
      )
      
  private[c7] def toC7VariableValue(cValue: CamundaVariable) : VariableValueDto =
    new VariableValueDto()
      .value(cValue.value)
      .`type`(cValue.`type`)
end InOutC7VariableMapper
