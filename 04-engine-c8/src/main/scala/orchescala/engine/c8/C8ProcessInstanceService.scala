package orchescala.engine.c8

import io.camunda.client.CamundaClient
import io.camunda.client.api.response.ProcessInstanceEvent
import io.camunda.client.api.search.response.Variable
import orchescala.domain.JsonProperty
import orchescala.engine.*
import orchescala.engine.domain.ProcessInfo
import orchescala.engine.services.ProcessInstanceService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8ProcessInstanceService(using
                               camundaClientZIO: IO[EngineError, CamundaClient],
                               engineConfig: EngineConfig
                              ) extends ProcessInstanceService:

  override def startProcessAsync(
                                  processDefId: String,
                                  in: Json,
                                  businessKey: Option[String] = None
                                ): IO[EngineError, ProcessInfo] =
    for
      camundaClient <- camundaClientZIO
      _ <- logDebug(s"Starting Process '$processDefId' with variables: $in")
      instance <- callStartProcessAsync(processDefId, businessKey, camundaClient, in)
    yield ProcessInfo(
      processInstanceId = instance.getProcessInstanceKey.toString,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active
    )

  private def callStartProcessAsync(
                                     processDefId: String,
                                     businessKey: Option[String],
                                     c8Client: CamundaClient,
                                     processVariables: Json
                                   ): IO[EngineError.ProcessError, ProcessInstanceEvent] =
    ZIO
      .attempt {
        val variables = processVariables.deepMerge(businessKey.map(bk =>
          Json.obj("businessKey" -> bk.asJson)
        ).getOrElse(Json.obj()))

        val variablesMap = jsonToVariablesMap(variables)
        val command = c8Client
          .newCreateInstanceCommand()
          .bpmnProcessId(processDefId)
          .latestVersion()
          .variables(variablesMap.asJava)

        command.send().join()
      }
      .mapError { err =>
        EngineError.ProcessError(
          s"Problem starting Process '$processDefId': ${err.getMessage}"
        )
      }

  override def getVariables(
                             processInstanceId: String,
                             inOut: Product
                           ): IO[EngineError, Seq[JsonProperty]] =
    for
      camundaClient <- camundaClientZIO
      variableDtos <-
        ZIO
          .attempt:
            camundaClient
              .newVariableSearchRequest()
              .filter(_.processInstanceKey(processInstanceId.toLong))
              .send()
              .join()
              .items()
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Variables for Process Instance '$processInstanceId': ${err.getMessage}"
            )
      variables <-
        ZIO
          .foreach(filterVariables(inOut, variableDtos.asScala.toSeq)): dto =>
            toVariableValue(dto)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem converting Variables for Process Instance '$processInstanceId' to Json: ${err.getMessage}"
            )
      _ <- logInfo(s"Variables for Process Instance '$processInstanceId': $variables")
    yield variables

  private def filterVariables(inOut: Product, variableDtos: Seq[Variable]) =
    variableDtos
      .filter: v =>
        v.getValue != null &&
          inOut.productElementNames.toSeq.contains(v.getName)

  private def toVariableValue(valueDto: Variable): IO[EngineError, JsonProperty] =
    val value = valueDto.getValue
    (value match
      case "null" =>
        ZIO.attempt(Json.Null)
      case str =>
        ZIO.fromEither(parser.parse(str))
      )
      .map: v =>
        JsonProperty(valueDto.getName, v)
      .mapError: err =>
        EngineError.ProcessError(
          s"Problem converting VariableDto '${valueDto.getName} -> $value: ${err.getMessage}"
        )

  end toVariableValue

end C8ProcessInstanceService