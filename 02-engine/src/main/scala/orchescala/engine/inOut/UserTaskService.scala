package orchescala.engine.inOut

import orchescala.domain.CamundaVariable
import orchescala.engine.EngineError
import orchescala.engine.domain.UserTask
import zio.IO

trait UserTaskService:
  def getUserTask(processInstanceId: String): IO[EngineError, Option[UserTask]]
  def complete(taskId: String, out: Map[String, CamundaVariable]): IO[EngineError, Unit]
end UserTaskService
