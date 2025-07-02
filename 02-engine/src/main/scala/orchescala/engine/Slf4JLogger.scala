package orchescala.engine

import orchescala.domain.{OrchescalaError, OrchescalaLogger}
import org.slf4j.{Logger, LoggerFactory}

case class Slf4JLogger(private val delegateLogger: Logger) extends OrchescalaLogger:

  def debug(message: String): Unit =
    if delegateLogger.isDebugEnabled then
      delegateLogger.debug(message)

  def info(message: String): Unit =
    if delegateLogger.isInfoEnabled then
      delegateLogger.info(message)

  def warn(message: String): Unit =
    if delegateLogger.isWarnEnabled then
      delegateLogger.warn(message)

  def error(err: OrchescalaError): Unit =
    if delegateLogger.isErrorEnabled then
      delegateLogger.error(err.errorMsg)

end Slf4JLogger
object Slf4JLogger:
  def logger(name: String) = Slf4JLogger(LoggerFactory.getLogger(name))
end Slf4JLogger