package orchescala.engine.c8

import io.camunda.client.CamundaClient
import orchescala.engine.*
import orchescala.engine.domain.EngineError.ServiceError
import orchescala.engine.domain.{EngineError, Job}
import orchescala.engine.services.JobService
import zio.ZIO.{logDebug, logInfo}
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C8JobService(using
    camundaClientZIO: IO[EngineError, CamundaClient],
    engineConfig: EngineConfig
) extends JobService, C8Service:

  def getJobs(
      processInstanceId: Option[String]
  ): IO[EngineError, List[Job]] = ZIO.fail(ServiceError("Get Jobs not yet supported in Camunda 8"))

  def execute(jobId: String): IO[EngineError, Unit] = ???
end C8JobService
