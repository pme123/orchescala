package orchescala.engine.services

import orchescala.engine.domain.*
import zio.IO

trait JobService  extends EngineService:
  def getJobs(
                    processInstanceId: Option[String] = None
                  ): IO[EngineError, List[Job]]
  def execute(jobId: String): IO[EngineError, Unit]
end JobService
