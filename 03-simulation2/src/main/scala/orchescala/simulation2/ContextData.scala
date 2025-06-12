package orchescala.simulation2

case class ContextData(
                        requestCount: Int = 0,
                        processInstanceId: String = notSet,
                        rootProcessInstanceId: String = notSet,
                        taskId: String = notSet,
                        jobId: String = notSet
                      ):
  lazy val optProcessInstance: Option[String] =
    if processInstanceId == notSet then None else Some(processInstanceId)
end ContextData
