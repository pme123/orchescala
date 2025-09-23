package orchescala.engine.c8

import io.camunda.client.CamundaClient
import orchescala.engine.*
import orchescala.engine.EngineError.ServiceError
import orchescala.engine.domain.Job
import orchescala.engine.inOut.JobService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8JobService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends JobService:

  def getJobs(
      processInstanceId: Option[String]
  ): IO[EngineError, List[Job]] = ZIO.fail(ServiceError("Get Jobs not yet supported in Camunda 8"))

  def execute(jobId: String): IO[EngineError, Unit] = ???
end C8JobService
