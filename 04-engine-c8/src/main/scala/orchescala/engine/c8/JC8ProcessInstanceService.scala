package orchescala.engine.c8

import io.camunda.zeebe.client.ZeebeClient
import io.camunda.zeebe.client.api.response.ProcessInstanceEvent
import orchescala.domain.CamundaVariable.*
import orchescala.domain.{CamundaProperty, CamundaVariable, JsonProperty}
import orchescala.engine.*
import orchescala.engine.domain.ProcessInfo
import orchescala.engine.json.JProcessInstanceService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class JC8ProcessInstanceService(using
    zeebeClientZIO: IO[EngineError, ZeebeClient],
    engineConfig: EngineConfig
) extends JProcessInstanceService:

  override def startProcessAsync(
      processDefId: String,
      in: Json,
      businessKey: Option[String] = None
  ): IO[EngineError, ProcessInfo] =
    for
      zeebeClient <- zeebeClientZIO
      _           <- logDebug(s"Starting Process '$processDefId' with variables: $in")
      instance    <- callStartProcessAsync(processDefId, businessKey, zeebeClient, in)
    yield ProcessInfo(
      processInstanceId = instance.getProcessInstanceKey.toString,
      businessKey = businessKey,
      status = ProcessInfo.ProcessStatus.Active
    )

  private def callStartProcessAsync(
      processDefId: String,
      businessKey: Option[String],
      zeebeClient: ZeebeClient,
      processVariables: Json
  ) =
    ZIO
      .attempt {
        val variables = processVariables.deepMerge( businessKey.map(bk => Json.obj("businessKey" -> bk.asJson)).getOrElse(Json.obj())) 
        val command = zeebeClient
          .newCreateInstanceCommand()
          .bpmnProcessId(processDefId)
          .latestVersion()
          .variables(processVariables)
        
        command.send().join()
      }
      .mapError { err =>
        EngineError.ProcessError(
          s"Problem starting Process '$processDefId': ${err.getMessage}"
        )
      }

  override def getVariables(processInstanceId: String, inOut: Product): IO[EngineError, Seq[JsonProperty]] =
    ZIO.fail(EngineError.ProcessError("getVariables not yet implemented for Camunda 8"))