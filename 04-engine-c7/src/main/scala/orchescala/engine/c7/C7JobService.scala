package orchescala.engine.c7

import orchescala.engine.EngineConfig
import orchescala.engine.domain.{EngineError, Job}
import orchescala.engine.services.JobService
import org.camunda.community.rest.client.api.JobApi
import org.camunda.community.rest.client.dto.{JobDto, JobQueryDto}
import org.camunda.community.rest.client.invoker.ApiClient
import zio.ZIO.logInfo
import zio.{IO, ZIO}

import scala.jdk.CollectionConverters.*

class C7JobService(using
    apiClientZIO: IO[EngineError, ApiClient],
    engineConfig: EngineConfig
) extends JobService, C7Service:

  def getJobs(
      processInstanceId: Option[String] = None
  ): IO[EngineError, List[Job]] =
    for
      apiClient <- apiClientZIO
      query     =  new JobQueryDto()
                     .processInstanceId(processInstanceId.orNull)
      jobDtos   <-
        ZIO
          .attempt:
            new JobApi(apiClient).queryJobs(null, null, query)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Jobs: $err"
            )
    yield mapToJobs(jobDtos)

  def execute(jobId: String): IO[EngineError, Unit] =
    for
      apiClient <- apiClientZIO
      _         <- logInfo(s"Executing Job: $jobId")
      _         <-
        ZIO
          .attempt:
            new JobApi(apiClient)
              .executeJob(jobId)
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem executing Job '$jobId': $err"
            )
    yield ()

  private def mapToJobs(
      jobs: java.util.List[JobDto]
  ): List[Job] =
    jobs.asScala.toList.map(mapToJob)

  private def mapToJob(
      job: JobDto
  ): Job =
    Job(
      id = Option(job.getId),
      jobDefinitionId = Option(job.getJobDefinitionId),
      dueDate = Option(job.getDueDate),
      processDefinitionKey = Option(job.getProcessDefinitionKey),
      processDefinitionId = Option(job.getProcessDefinitionId),
      processInstanceId = Option(job.getProcessInstanceId),
      executionId = Option(job.getExecutionId)
    )
end C7JobService
