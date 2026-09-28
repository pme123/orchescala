package orchescala.engine.services

import orchescala.engine.domain.*
import zio.IO

trait JobService  extends EngineService:
  /** @param timersOnly
    *   only the jobs of timers - e.g. to trigger a timer, not an async continuation
    */
  def getJobs(
      processInstanceId: Option[String] = None,
      timersOnly: Boolean = false
  ): IO[EngineError, List[Job]]
  def execute(jobId: String): IO[EngineError, Unit]
end JobService
