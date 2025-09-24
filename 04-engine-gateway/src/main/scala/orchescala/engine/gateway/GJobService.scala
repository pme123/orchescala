package orchescala.engine.gateway

import orchescala.engine.domain.Job
import orchescala.engine.services.JobService
import orchescala.engine.{EngineConfig, EngineError}
import org.camunda.community.rest.client.api.JobApi
import org.camunda.community.rest.client.dto.JobDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.logInfo
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class GJobService(using
    services: Seq[JobService]
) extends JobService:

  def getJobs(
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Job]] =
    tryServicesWithErrorCollection[JobService, List[Job]](
      _.getJobs(processInstanceId),
      "getJobs"
    )

  def execute(jobId: String): IO[EngineError, Unit] =
    tryServicesWithErrorCollection[JobService, Unit](
      _.execute(jobId),
      "execute"
    )

end GJobService
