package orchescala.domain

trait OrchescalaLogger:
  def debug(message: String): Unit
  def info(message: String): Unit
  def warn(message: String): Unit
  def error(err: OrchescalaError): Unit
end OrchescalaLogger