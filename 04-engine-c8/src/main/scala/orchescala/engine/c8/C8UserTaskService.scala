package orchescala.engine.c8

import io.camunda.zeebe.client.ZeebeClient
import orchescala.domain.CamundaVariable
import orchescala.engine.*
import orchescala.engine.domain.UserTask
import orchescala.engine.inOut.UserTaskService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8UserTaskService(using
    zeebeClientZIO: IO[EngineError, ZeebeClient],
    engineConfig: EngineConfig
) extends UserTaskService with C8EventService:

  def getUserTask(processInstanceId: String): IO[EngineError, Option[UserTask]] = ???

  def complete(taskId: String, out: Map[String, CamundaVariable]): IO[EngineError, Unit] = ???

