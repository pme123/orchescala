package orchescala.engine.c7

import orchescala.engine.EngineConfig
import orchescala.engine.domain.{EngineError, Job}
import orchescala.engine.services.JobService
import org.camunda.community.rest.client.api.JobApi
import org.camunda.community.rest.client.dto.JobDto
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
      jobDtos   <-
        ZIO
          .attempt:
            new JobApi(apiClient)
              .getJobs(
                null, // jobId
                null, // jobIds
                null, // jobDefinitionId
                processInstanceId.orNull, // processInstanceId
                null, // processInstanceIds
                null, // executionId
                null, // processDefinitionId
                null, // processDefinitionKey
                null, // activityId
                null, // withRetriesLeft
                null, // executable
                null, // timers
                null, // messages
                null, // dueDates
                null, // createTimes
                null, // withException
                null, // exceptionMessage
                null, // failedActivityId
                null, // noRetriesLeft
                null, // active
                null, // suspended
                null, // priorityLowerThanOrEquals
                null, // priorityHigherThanOrEquals
                null, // tenantIdIn
                null, // withoutTenantId
                null, // includeJobsWithoutTenantId
                null, // sortBy
                null, // sortOrder
                null, // firstResult
                null  // maxResults
              )
          .mapError: err =>
            EngineError.ProcessError(
              s"Problem getting Jobs: ${err.getMessage}"
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
              s"Problem executing Job '$jobId': ${err.getMessage}"
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
