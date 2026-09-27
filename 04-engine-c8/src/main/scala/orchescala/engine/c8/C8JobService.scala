package orchescala.engine.c8

import orchescala.engine.*
import orchescala.engine.domain.EngineError.ServiceError
import orchescala.engine.domain.{EngineError, Job}
import orchescala.engine.services.JobService
import zio.{IO, ZIO}

class C8JobService(using
    rest: C8RestClient,
    engineConfig: EngineConfig
) extends JobService, C8Service:

  def getJobs(
      processInstanceId: Option[String]
  ): IO[EngineError, List[Job]] = ZIO.fail(ServiceError("Get Jobs not yet supported in Camunda 8"))

  def execute(jobId: String): IO[EngineError, Unit] =
    ZIO.fail(ServiceError("Execute Job not yet supported in Camunda 8"))
end C8JobService
