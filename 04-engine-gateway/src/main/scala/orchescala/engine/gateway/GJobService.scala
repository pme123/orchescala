package orchescala.engine.gateway

import orchescala.engine.EngineConfig
import orchescala.engine.domain.{EngineError, Job}
import orchescala.engine.services.JobService
import org.camunda.community.rest.client.api.JobApi
import org.camunda.community.rest.client.dto.JobDto
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.logInfo
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class GJobService(using
    services: Seq[JobService]
) extends JobService, GService:

  def getJobs(
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Job]] =
    tryServicesWithErrorCollection[JobService, List[Job]](
      _.getJobs(processInstanceId),
      "getJobs",
      processInstanceId,
      Some((jobs: List[Job]) => jobs.headOption.flatMap(_.id).getOrElse("NOT-SET"))
    )

  def execute(jobId: String): IO[EngineError, Unit] =
    tryServicesWithErrorCollection[JobService, Unit](
      _.execute(jobId),
      "execute"
    )

end GJobService
