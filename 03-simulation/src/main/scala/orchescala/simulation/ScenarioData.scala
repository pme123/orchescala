package orchescala.simulation

case class ScenarioData(
    scenarioName: String,
    context: ContextData = ContextData(),
    logEntries: Seq[LogEntry] = Seq.empty
):

  lazy val maxLevel: LogLevel =
    logEntries.map(_.logLevel).sorted.headOption.getOrElse(LogLevel.DEBUG)

  lazy val maxLevelMsg: String =
    logEntries.sortBy(_.logLevel).headOption.map(_.msg).getOrElse("No Log Entries")

  lazy val hasErrors: Boolean =
    maxLevel == LogLevel.ERROR

  def log(logLevel: LogLevel, msg: String): ScenarioData =
    copy(logEntries = logEntries :+ LogEntry(logLevel, msg))

  def debug(msg: String): ScenarioData = log(LogLevel.DEBUG, msg)

  def info(msg: String): ScenarioData = log(LogLevel.INFO, msg)

  def warn(msg: String): ScenarioData = log(LogLevel.WARN, msg)

  def error(msg: String): ScenarioData = log(LogLevel.ERROR, msg)

  def withProcessInstanceId(processInstanceId: String): ScenarioData =
    copy(context = context.copy(processInstanceId = processInstanceId))
  def switchToSubProcess(): ScenarioData                             =
    copy(context =
      context.copy(rootProcessInstanceId = context.processInstanceId, processInstanceId = notSet)
    )
  def switchToMainProcess(): ScenarioData                            =
    copy(context =
      context.copy(
        rootProcessInstanceId = notSet,
        processInstanceId = context.rootProcessInstanceId
      )
    )
  def withTaskId(taskId: String): ScenarioData                       =
    copy(context = context.copy(taskId = taskId))
  def withJobId(jobId: String): ScenarioData                         =
    copy(context = context.copy(jobId = jobId))
  def withRequestCount(requestCount: Int): ScenarioData              =
    copy(context = context.copy(requestCount = requestCount))

end ScenarioData
