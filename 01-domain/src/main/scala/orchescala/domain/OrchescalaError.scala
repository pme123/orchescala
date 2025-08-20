package orchescala.domain

trait OrchescalaError extends Throwable:

  def errorCode: ErrorCodeType

  def errorMsg: String

  def causeMsg = s"$errorCode: $errorMsg"

  def causeError: Option[OrchescalaError] = None
  
  override def toString(): String = causeMsg + causeError.map(e => s" - Caused by ${e.causeMsg}").getOrElse("")
end OrchescalaError