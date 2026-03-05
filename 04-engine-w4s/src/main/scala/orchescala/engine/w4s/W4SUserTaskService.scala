package orchescala.engine.w4s

import orchescala.domain.*
import orchescala.engine.EngineConfig
import orchescala.engine.domain.{EngineError, UserTask as EngineUserTask}
import orchescala.engine.services.{ProcessInstanceService, UserTaskService}
import zio.{IO, ZIO}

class W4SUserTaskService(val processInstanceService: ProcessInstanceService)(using
    engineConfig: EngineConfig
) extends UserTaskService, W4SService:

  def getUserTask(
      processInstanceId: String,
      userTaskDefId: String
  ): IO[EngineError, Option[EngineUserTask]] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine does not support user task queries via REST API. Use the W4S workflow mechanism."
    ))

  def complete(
      taskId: String,
      processVariables: JsonObject,
      identityCorrelation: Option[IdentityCorrelation]
  ): IO[EngineError, Unit] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine does not support user task completion via REST API. Use the W4S workflow mechanism."
    ))

end W4SUserTaskService

