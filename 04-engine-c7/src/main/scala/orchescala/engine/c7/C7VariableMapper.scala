package orchescala.engine.c7

import orchescala.domain.*
import orchescala.engine.EngineError.MappingError
import org.camunda.community.rest.client.dto.VariableValueDto
import zio.{IO, ZIO}

object C7VariableMapper:
  
  def toC7Variables(in: Json): IO[ MappingError, Map[String, VariableValueDto]] =
    for
      camundaVariables <-
        ZIO
          .attempt:
            CamundaVariable.jsonToCamundaValue(in) match
              case m: Map[?, ?]        => m.asInstanceOf[Map[String, CamundaVariable]]
              case other               => throw new Exception(s"Expected a Map, but got $other")
          .mapError: err =>
            MappingError(s"Problem mapping In to C7 Variables: ${err.getMessage}")

      dtos <- ZIO.foreach(camundaVariables): (k, v) =>
        toC7VariableValue(v).map(k -> _)
    yield dtos

  private[c7] def toC7VariableValue(cValue: CamundaVariable) = {
    ZIO
      .attempt:
        new VariableValueDto()
          .value(cValue.value)
          .`type`(cValue.`type`)
      .mapError: err =>
        MappingError(s"Problem mapping CamundaVariable (${cValue.value}:${cValue.`type`}) to C7VariableValue: ${err.getMessage}")
  }
end C7VariableMapper
