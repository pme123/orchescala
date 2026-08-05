package orchescala.engine.c7

import org.camunda.community.rest.client.dto.VariableValueDto
import scala.jdk.CollectionConverters.*

private[c7] def filterVariables(
                             variableFilter: Option[Seq[String]],
                             variableDtos: java.util.Map[String, VariableValueDto]
                           ) =
  if variableFilter.isEmpty then variableDtos.asScala
  else
    variableDtos
      .asScala
      .filter: p =>
        p._2.getValue != null &&
          variableFilter.toSeq.flatten.contains(p._1)