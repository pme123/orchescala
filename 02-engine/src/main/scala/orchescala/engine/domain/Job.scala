package orchescala.engine.domain

case class Job(
    id: Option[String] = None,
    jobDefinitionId: Option[String] = None,
    dueDate: Option[java.time.OffsetDateTime] = None,
    processInstanceId: Option[String] = None,
    executionId: Option[String] = None,
    processDefinitionId: Option[String] = None,
    processDefinitionKey: Option[String] = None,
    retries: Option[Int] = None,
    exceptionMessage: Option[String] = None,
    failedActivityId: Option[String] = None,
    suspended: Option[Boolean] = None,
    priority: Option[Long] = None,
    tenantId: Option[String] = None,
    createTime: Option[java.time.OffsetDateTime] = None,
    batchId: Option[String] = None
)
