package orchescala.engine.inOut

import orchescala.engine.EngineError
import orchescala.engine.domain.Job
import zio.IO

trait JobService :
  def getJobs(
                    processInstanceId: Option[String] = None
                  ): IO[EngineError, List[Job]]
  def execute(jobId: String): IO[EngineError, Unit]
end JobService
