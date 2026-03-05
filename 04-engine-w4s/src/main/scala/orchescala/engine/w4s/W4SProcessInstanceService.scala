package orchescala.engine.w4s

import orchescala.domain.*
import orchescala.engine.EngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.ProcessInstanceService
import zio.{IO, ZIO}

class W4SProcessInstanceService(using
    engineConfig: EngineConfig
) extends ProcessInstanceService, W4SService:

  def startProcessAsync(
      processDefId: String,
      in: JsonObject,
      businessKey: Option[String],
      tenantId: Option[String],
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, ProcessInfo] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine manages workflows in-process. Use the W4S workflow runner to start processes."
    ))

  def startProcessByMessage(
      messageName: String,
      businessKey: Option[String] = None,
      tenantId: Option[String] = None,
      variables: Option[JsonObject] = None,
      identityCorrelation: Option[IdentityCorrelation] = None
  ): IO[EngineError, ProcessInfo] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine manages workflows in-process. Use the W4S workflow runner to send messages."
    ))

  def getVariablesInternal(
      processInstanceId: String,
      variableFilter: Option[Seq[String]]
  ): IO[EngineError, Seq[JsonProperty]] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine manages workflows in-process. Variables are managed by the workflow state."
    ))

end W4SProcessInstanceService

