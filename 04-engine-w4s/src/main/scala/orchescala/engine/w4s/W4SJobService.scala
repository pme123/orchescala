package orchescala.engine.w4s

import orchescala.engine.EngineConfig
import orchescala.engine.domain.*
import orchescala.engine.services.JobService
import zio.{IO, ZIO}

class W4SJobService(using
    engineConfig: EngineConfig
) extends JobService, W4SService:

  def getJobs(
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Job]] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine does not support job queries. Jobs are managed within the workflow."
    ))

  def execute(jobId: String): IO[EngineError, Unit] =
    ZIO.fail(EngineError.ProcessError(
      "W4S engine does not support job execution. Jobs are managed within the workflow."
    ))

end W4SJobService

