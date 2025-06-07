package orchescala.simulation2

case class ContextData(
                        requestCount: Int = 0,
                        processInstanceId: String = notSet,
                        rootProcessInstanceId: String = notSet,
                        taskId: String = notSet,
                        jobId: String = notSet
                      )
